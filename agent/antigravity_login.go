package bee

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

// antigravityLoginWindow bounds one sign-in, from the address being shown to
// the browser coming back.
const antigravityLoginWindow = 10 * time.Minute

// antigravityLogin is one run of bee antigravity-login.
type antigravityLogin struct {
	store     antigravityStore
	transport http.RoundTripper
	// listen is where the browser's return is awaited; tests take a free port.
	listen string
	// open shows the sign-in address in a browser; nil shows nothing.
	open func(string) error
	// paste reads the address the person copies back from the browser.
	paste func() (string, error)
	out   io.Writer
	// manual has the person carry the return address back by hand.
	manual bool
}

// run signs in and stores the result. It returns the stored sign-in and the
// one it replaced, if any.
func (l antigravityLogin) run(ctx context.Context) (credential, previous antigravityCredential, err error) {
	ctx, cancel := context.WithTimeout(ctx, antigravityLoginWindow)
	defer cancel()
	state, verifier := rand.Text(), oauth2.GenerateVerifier()
	redirect := antigravityRedirect
	var listener net.Listener
	if !l.manual {
		if listener, err = net.Listen("tcp", l.listen); err != nil {
			fmt.Fprintf(l.out, "%s is in use or cannot be opened, so the browser cannot hand the sign-in back by itself.\n", l.listen)
		} else {
			defer listener.Close()
			redirect = fmt.Sprintf("http://localhost:%d/oauth-callback", listener.Addr().(*net.TCPAddr).Port)
		}
	}
	config := antigravityOAuth(redirect)
	link := config.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("prompt", "consent"), oauth2.SetAuthURLParam("include_granted_scopes", "true"))
	fmt.Fprintf(l.out, "Open this address in a browser and sign in with the Google account to supply:\n\n  %s\n\n", link)
	if l.open != nil {
		// Best effort: the address above is there for when nothing opens.
		_ = l.open(link)
	}
	var code string
	if listener != nil {
		fmt.Fprintln(l.out, "Waiting for the sign-in to finish in the browser...")
		code, err = antigravityReturn(ctx, listener, state)
	} else {
		fmt.Fprintf(l.out, "After signing in, the browser is sent to an address beginning %s that does not load.\nCopy that whole address from the browser and paste it here: ", antigravityRedirect)
		code, err = antigravityPasted(ctx, l.paste, state)
	}
	if err != nil {
		return credential, previous, err
	}

	token, err := config.Exchange(antigravityOAuthContext(ctx, l.transport), code, oauth2.VerifierOption(verifier))
	if err != nil {
		return credential, previous, fail("BEE-ANTIGRAVITY-LOGIN", "the authorization code was not accepted: "+antigravityOAuthFailure(err, code, verifier))
	}
	credential = antigravityCredential{AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, ExpiresAt: token.Expiry.UTC().Truncate(time.Second)}
	if credential.RefreshToken == "" || !strings.EqualFold(token.Type(), "Bearer") || !credential.available(time.Now()) {
		return antigravityCredential{}, previous, fail("BEE-ANTIGRAVITY-LOGIN", "Google's answer lacks a refresh token or a usable access token")
	}
	if credential.UserID, credential.Email, err = antigravityUser(ctx, l.transport, credential.AccessToken); err != nil {
		return antigravityCredential{}, previous, antigravityProblem(err)
	}
	post := antigravityAnywhere(ctx, l.transport, credential.AccessToken)
	account, err := antigravityLoad(credential.AccessToken, post)
	if err == nil && account.project == "" {
		fmt.Fprintln(l.out, "Google is setting this account up for Antigravity...")
		account.project, err = antigravityOnboard(ctx, account, post)
	}
	if err != nil {
		return antigravityCredential{}, previous, antigravityProblem(err)
	}
	credential.ProjectID, credential.Tier, credential.Plan = account.project, account.tier, account.plan
	// Supply does not wait on the product-improvement setting: a refresh
	// tries again until Google confirms it off.
	if err := antigravityKeepPrivate(ctx, l.transport, credential.AccessToken, credential.ProjectID); err != nil {
		fmt.Fprintln(l.out, "Could not turn off Google's product-improvement setting for this account yet; Bee will try again:", safeText(err.Error(), credential.AccessToken))
	} else {
		credential.Private = true
		fmt.Fprintln(l.out, "Turned off Google's product-improvement setting for this account.")
	}
	if !credential.valid() {
		return antigravityCredential{}, previous, fail("BEE-ANTIGRAVITY-LOGIN", "Google's answers do not make a complete sign-in")
	}
	unlock, err := l.store.lock(ctx)
	if err != nil {
		return antigravityCredential{}, previous, failCause("BEE-ANTIGRAVITY-STORE", err)
	}
	defer unlock()
	previous, _ = l.store.read()
	if err := l.store.write(credential); err != nil {
		return antigravityCredential{}, previous, failCause("BEE-ANTIGRAVITY-STORE", err)
	}
	return credential, previous, nil
}

// antigravityReply takes the authorization code out of the address Google
// sent the browser to, once it is the reply to this sign-in.
func antigravityReply(query url.Values, state string) (string, error) {
	if subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(state)) != 1 {
		return "", fail("BEE-ANTIGRAVITY-LOGIN", "the reply carries a different state than this sign-in began with")
	}
	if refusal := query.Get("error"); refusal != "" {
		return "", fail("BEE-ANTIGRAVITY-LOGIN", "Google answered "+boundedFailureText(safeText(refusal), 128))
	}
	code := query.Get("code")
	if code == "" || len(code) > 4096 {
		return "", fail("BEE-ANTIGRAVITY-LOGIN", "the reply carries no authorization code")
	}
	return code, nil
}

// antigravityReturn serves the one request Google sends the browser back
// with, answers it with a page, and stops listening.
func antigravityReturn(ctx context.Context, listener net.Listener, state string) (string, error) {
	type reply struct {
		code string
		err  error
	}
	replies := make(chan reply, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /oauth-callback", func(w http.ResponseWriter, r *http.Request) {
		code, err := antigravityReply(r.URL.Query(), state)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			io.WriteString(w, "The sign-in did not complete. Return to the terminal running bee antigravity-login.\n")
		} else {
			io.WriteString(w, "Signed in. You can close this tab and return to the terminal.\n")
		}
		select {
		case replies <- reply{code, err}:
		default:
		}
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go server.Serve(listener)
	defer func() {
		// The page is written before the listener goes away.
		closing, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		server.Shutdown(closing)
		server.Close()
	}()
	select {
	case <-ctx.Done():
		return "", fail("BEE-ANTIGRAVITY-LOGIN", "the browser did not come back before the sign-in ended")
	case got := <-replies:
		return got.code, got.err
	}
}

// antigravityPasted reads what the person copied from the browser: the whole
// address it was sent to, or the authorization code alone.
func antigravityPasted(ctx context.Context, paste func() (string, error), state string) (string, error) {
	lines := make(chan string, 1)
	go func() {
		line, _ := paste()
		lines <- line
	}()
	var line string
	select {
	case <-ctx.Done():
		return "", fail("BEE-ANTIGRAVITY-LOGIN", "nothing was pasted before the sign-in ended")
	case line = <-lines:
	}
	line = strings.Trim(strings.TrimSpace(line), `"'`)
	if _, query, address := strings.Cut(line, "?"); address {
		query, _, _ = strings.Cut(query, "#")
		values, err := url.ParseQuery(query)
		if err != nil {
			return "", fail("BEE-ANTIGRAVITY-LOGIN", "the pasted address cannot be read")
		}
		return antigravityReply(values, state)
	}
	if line == "" || len(line) > 4096 || strings.ContainsAny(line, " \t") {
		return "", fail("BEE-ANTIGRAVITY-LOGIN", "what was pasted is neither the address nor an authorization code")
	}
	return line, nil
}

// openBrowser asks the desktop to show an address.
func openBrowser(address string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", address)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
	default:
		command = exec.Command("xdg-open", address)
	}
	if err := command.Start(); err != nil {
		return err
	}
	go command.Wait()
	return nil
}

// antigravityDirectory is the directory the sign-in is kept under for a
// device configuration, "" being the default one.
func antigravityDirectory(configPath string) (string, error) {
	if configPath == "" {
		configPath = defaultConfigPath()
	}
	if configPath == "" {
		return "", errors.New("failed to locate user configuration directory; use --config")
	}
	return filepath.Dir(configPath), nil
}

// antigravityTransport is how Bee's own requests to Google leave for a device
// configuration: through the connect_proxy of its egress configuration, as
// they do while Bee runs. HTTPS_PROXY applies either way. Tests replace it.
var antigravityTransport = func(ctx context.Context, directory string) http.RoundTripper {
	if cfg, err := readEgress(ctx, filepath.Join(directory, "egress.json")); err == nil && cfg.ConnectProxy != "" {
		if address, err := localConnectProxy(cfg.ConnectProxy); err == nil {
			return officialTransport(address)
		}
	}
	return nil
}

func antigravityLoginCommand(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee antigravity-login", flag.ContinueOnError)
	flags.SetOutput(out)
	configPath := flags.String("config", "", "device configuration file; the sign-in is kept in its directory")
	noBrowser := flags.Bool("no-browser", false, "open no browser and wait for none: print the sign-in address, then read the address the browser was sent to from standard input")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("antigravity-login accepts no extra arguments")
	}
	directory, err := antigravityDirectory(*configPath)
	if err != nil {
		return err
	}
	login := antigravityLogin{store: antigravityStoreIn(directory), transport: antigravityTransport(ctx, directory), listen: antigravityListen, open: openBrowser, out: out, manual: *noBrowser,
		paste: func() (string, error) { return bufio.NewReader(io.LimitReader(setupInput, 8192)).ReadString('\n') }}
	if *noBrowser {
		login.open = nil
	}
	return login.report(ctx)
}

// report runs the sign-in and tells the person what was stored.
func (l antigravityLogin) report(ctx context.Context) error {
	credential, previous, err := l.run(ctx)
	if err != nil {
		return err
	}
	fmt.Fprintf(l.out, "\nSigned in to Google as %s\n  plan     %s (tier %q)\n  project  %s\n  stored   %s\n", credential.Email, credential.Plan, credential.Tier, credential.ProjectID, l.store.path)
	if previous.UserID != "" && previous.UserID != credential.UserID {
		fmt.Fprintln(l.out, "This is a different account than the one stored before. A Bee that supplies the earlier one pauses until you confirm the change: bee account-status --platform google, then bee confirm-account.")
	}
	fmt.Fprintln(l.out, "Next: bee setup offers this account for supply. A running Bee that already supplies it picks the new sign-in up by itself.")
	return nil
}
