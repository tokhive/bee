package bee

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

const antigravityTestTokens = `{"access_token":"ya29.synthetic-google-access","refresh_token":"1//synthetic-google-refresh","expires_in":3599,"scope":"openid","token_type":"Bearer"}`

// antigravityLoginFixture is a sign-in against a synthetic Google: the browser
// is a function that visits the callback, and no request leaves the process.
type antigravityLoginFixture struct {
	login  antigravityLogin
	google *googleFake
	out    *bytes.Buffer
	// link is the sign-in address the login showed.
	link *url.URL
}

func newAntigravityLogin(t *testing.T) *antigravityLoginFixture {
	t.Helper()
	fixture := &antigravityLoginFixture{out: &bytes.Buffer{}}
	fixture.google = &googleFake{t: t, answer: map[string]func(*http.Request, string) (int, string){
		googleTokenURL: func(r *http.Request, body string) (int, string) {
			form := googleForm(t, body)
			query := fixture.link.Query()
			if form.Get("grant_type") != "authorization_code" || form.Get("code") != "synthetic-code" || form.Get("client_id") != antigravityClientID || form.Get("client_secret") != antigravityClientSecret || form.Get("redirect_uri") != query.Get("redirect_uri") {
				t.Errorf("token request %v", form)
			}
			if oauth2.S256ChallengeFromVerifier(form.Get("code_verifier")) != query.Get("code_challenge") {
				t.Error("the code verifier does not answer the challenge the sign-in began with")
			}
			return 200, antigravityTestTokens
		},
		googleUserURL: func(r *http.Request, _ string) (int, string) {
			if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer "+antigravityTestAccess {
				t.Error("userinfo request", r.Method, r.Header)
			}
			return 200, `{"id":"` + antigravityTestUser + `","email":"provider@example.test","verified_email":true}`
		},
		googleProd + "loadCodeAssist": func(r *http.Request, body string) (int, string) {
			if r.Header.Get("Authorization") != "Bearer "+antigravityTestAccess || r.Header.Get("Content-Type") != "application/json" || !strings.HasPrefix(r.Header.Get("User-Agent"), "antigravity/hub/") {
				t.Error("loadCodeAssist headers", r.Header)
			}
			if !strings.Contains(body, `"ideType":"ANTIGRAVITY"`) || !strings.Contains(body, `"ideName":"antigravity"`) {
				t.Error("loadCodeAssist body", body)
			}
			return 200, antigravityTestLoad
		},
	}}
	fixture.login = antigravityLogin{store: antigravityStoreIn(t.TempDir()), transport: fixture.google, listen: "127.0.0.1:0", out: fixture.out}
	fixture.login.open = fixture.browser(t, nil)
	return fixture
}

// browser signs the person in: it reads the sign-in address and visits the
// address Google would send the browser to, changed by reply when given.
func (f *antigravityLoginFixture) browser(t *testing.T, reply func(url.Values)) func(string) error {
	return func(address string) error {
		link, err := url.Parse(address)
		if err != nil {
			t.Error(err)
			return err
		}
		f.link = link
		query := link.Query()
		redirect, _ := url.Parse(query.Get("redirect_uri"))
		if redirect.Hostname() != "localhost" || redirect.Path != "/oauth-callback" {
			t.Error("redirect address", redirect)
		}
		values := url.Values{"state": {query.Get("state")}, "code": {"synthetic-code"}, "scope": {query.Get("scope")}}
		if reply != nil {
			reply(values)
		}
		go func() {
			// A client of its own: other tests replace http.DefaultTransport.
			browser := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}
			res, err := browser.Get("http://127.0.0.1:" + redirect.Port() + redirect.Path + "?" + values.Encode())
			if err == nil {
				res.Body.Close()
			}
		}()
		return nil
	}
}

func assertNoAntigravitySecrets(t *testing.T, text string) {
	t.Helper()
	for _, secret := range []string{antigravityTestAccess, "synthetic-google-refresh", "synthetic-code", antigravityClientSecret} {
		if strings.Contains(text, secret) {
			t.Fatalf("output exposes %q: %s", secret, text)
		}
	}
}

func TestAntigravityLoginStoresTheSignInGoogleReturns(t *testing.T) {
	fixture := newAntigravityLogin(t)
	if err := fixture.login.report(context.Background()); err != nil {
		t.Fatal(err)
	}
	query := fixture.link.Query()
	if fixture.link.Scheme+"://"+fixture.link.Host+fixture.link.Path != "https://accounts.google.com/o/oauth2/v2/auth" || query.Get("client_id") != antigravityClientID || query.Get("response_type") != "code" ||
		query.Get("code_challenge_method") != "S256" || len(query.Get("code_challenge")) != 43 || len(query.Get("state")) < 20 || query.Get("access_type") != "offline" || query.Get("prompt") != "consent" {
		t.Fatalf("sign-in address %v", query)
	}
	if scopes := strings.Fields(query.Get("scope")); len(scopes) != 5 || scopes[0] != "https://www.googleapis.com/auth/cloud-platform" || scopes[3] != "https://www.googleapis.com/auth/cclog" {
		t.Fatalf("scopes %v", scopes)
	}
	stored, err := fixture.login.store.read()
	if err != nil {
		t.Fatal(err)
	}
	if stored.AccessToken != antigravityTestAccess || stored.RefreshToken != "1//synthetic-google-refresh" || stored.UserID != antigravityTestUser || stored.Email != "provider@example.test" ||
		stored.ProjectID != "synthetic-project-1" || stored.Tier != "g1-pro-tier" || stored.Plan != "pro" || time.Until(stored.ExpiresAt) < 55*time.Minute || time.Until(stored.ExpiresAt) > time.Hour {
		t.Fatalf("stored sign-in is not what Google returned: plan=%s tier=%s project=%s expires=%s", stored.Plan, stored.Tier, stored.ProjectID, stored.ExpiresAt)
	}
	out := fixture.out.String()
	if !strings.Contains(out, fixture.link.String()) || !strings.Contains(out, "Signed in to Google as provider@example.test") || !strings.Contains(out, "plan     pro") {
		t.Fatalf("the person was not shown the address and the result: %s", out)
	}
	assertNoAntigravitySecrets(t, out)
	if fixture.google.count(googleDaily+"loadCodeAssist") != 0 {
		t.Fatal("an account production answered for was also asked of daily")
	}
}

func TestAntigravityLoginRefusesAReplyThatIsNotItsOwn(t *testing.T) {
	for name, reply := range map[string]func(url.Values){
		"another state": func(v url.Values) { v.Set("state", "someone-elses-state") },
		"no state":      func(v url.Values) { v.Del("state") },
		"denied":        func(v url.Values) { v.Del("code"); v.Set("error", "access_denied") },
		"no code":       func(v url.Values) { v.Del("code") },
	} {
		t.Run(name, func(t *testing.T) {
			fixture := newAntigravityLogin(t)
			fixture.login.open = fixture.browser(t, reply)
			err := fixture.login.report(context.Background())
			if code, _, _, _ := Coded(err); code != "BEE-ANTIGRAVITY-LOGIN" {
				t.Fatalf("got %v, want BEE-ANTIGRAVITY-LOGIN", err)
			}
			if name == "denied" && !strings.Contains(err.Error(), "access_denied") {
				t.Fatal("Google's refusal is not named", err)
			}
			if len(fixture.google.calls) != 0 {
				t.Fatal("a reply that was not accepted still reached Google", fixture.google.calls)
			}
			if _, err := fixture.login.store.read(); !errors.Is(err, errAntigravityMissing) {
				t.Fatal("a failed sign-in was stored")
			}
		})
	}
}

func TestAntigravityLoginFailsWhenGoogleRefusesTheCode(t *testing.T) {
	for name, test := range map[string]struct {
		status int
		body   string
		want   string
	}{
		"refused":          {400, `{"error":"invalid_grant","error_description":"Malformed auth code for synthetic-code."}`, "invalid_grant"},
		"no refresh token": {200, `{"access_token":"ya29.synthetic-google-access","expires_in":3599,"token_type":"Bearer"}`, "refresh token"},
		"no lifetime":      {200, `{"access_token":"ya29.synthetic-google-access","refresh_token":"1//synthetic-google-refresh","token_type":"Bearer"}`, "usable access token"},
		"unreachable":      {0, "", "the authorization code was not accepted"},
	} {
		t.Run(name, func(t *testing.T) {
			fixture := newAntigravityLogin(t)
			fixture.google.answer[googleTokenURL] = googleAnswer(test.status, test.body)
			err := fixture.login.report(context.Background())
			if code, summary, _, _ := Coded(err); code != "BEE-ANTIGRAVITY-LOGIN" || !strings.Contains(summary, test.want) {
				t.Fatalf("got %v, want BEE-ANTIGRAVITY-LOGIN naming %q", err, test.want)
			}
			assertNoAntigravitySecrets(t, err.Error()+fixture.out.String())
			if _, err := fixture.login.store.read(); !errors.Is(err, errAntigravityMissing) {
				t.Fatal("a failed sign-in was stored")
			}
		})
	}
}

func TestAntigravityLoginOnboardsAnAccountWithoutAProject(t *testing.T) {
	previous := antigravityOnboardPoll
	antigravityOnboardPoll = time.Millisecond
	t.Cleanup(func() { antigravityOnboardPoll = previous })
	fixture := newAntigravityLogin(t)
	fixture.google.answer[googleProd+"loadCodeAssist"] = googleAnswer(200, `{"currentTier":"free-tier","allowedTiers":[{"id":"legacy-tier"},{"id":"free-tier","isDefault":true}]}`)
	polls := 0
	fixture.google.answer[googleProd+"onboardUser"] = func(r *http.Request, body string) (int, string) {
		if body != `{"metadata":{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"},"tierId":"free-tier"}` {
			t.Error("onboardUser body", body)
		}
		if polls++; polls < 3 {
			return 200, `{"name":"operations/synthetic","done":false}`
		}
		return 200, `{"done":true,"response":{"cloudaicompanionProject":{"id":"onboarded-project-7","name":"Synthetic"}}}`
	}
	if err := fixture.login.report(context.Background()); err != nil {
		t.Fatal(err)
	}
	stored, err := fixture.login.store.read()
	if err != nil || stored.ProjectID != "onboarded-project-7" || stored.Plan != "free" || stored.Tier != "free-tier" || polls != 3 {
		t.Fatalf("onboarding: project=%q plan=%q polls=%d err=%v", stored.ProjectID, stored.Plan, polls, err)
	}

	// Without a default tier there is nothing to onboard the account with.
	fixture = newAntigravityLogin(t)
	fixture.google.answer[googleProd+"loadCodeAssist"] = googleAnswer(200, `{"currentTier":{"id":"free-tier"}}`)
	if code, _, _, _ := Coded(fixture.login.report(context.Background())); code != "BEE-ANTIGRAVITY-PROJECT" {
		t.Fatal("an account without a project was accepted", code)
	}
	// An onboarding that never finishes is given up on.
	fixture = newAntigravityLogin(t)
	fixture.google.answer[googleProd+"loadCodeAssist"] = googleAnswer(200, `{"allowedTiers":[{"id":"free-tier","isDefault":true}]}`)
	fixture.google.answer[googleProd+"onboardUser"] = googleAnswer(200, `{"done":false}`)
	if code, _, _, _ := Coded(fixture.login.report(context.Background())); code != "BEE-ANTIGRAVITY-PROJECT" || fixture.google.count(googleProd+"onboardUser") != 5 {
		t.Fatal("an unfinished onboarding was not given up on after five polls", code, fixture.google.count(googleProd+"onboardUser"))
	}
}

func TestAntigravityLoginRefusesAnAccountThatCannotSupply(t *testing.T) {
	for name, test := range map[string]struct {
		status     int
		body, code string
		detail     string
	}{
		"unknown tier": {200, `{"cloudaicompanionProject":"synthetic-project-1","currentTier":{"id":"standard-tier"}}`, "BEE-ANTIGRAVITY-TIER", `"standard-tier"`},
		"ineligible":   {200, `{"currentTier":{"id":"free-tier"},"ineligibleTiers":[{"tier":{"id":"free-tier"},"reasonCode":"INELIGIBLE_ACCOUNT","reasonMessage":"Your account is not eligible."}]}`, "BEE-ANTIGRAVITY-INELIGIBLE", "INELIGIBLE_ACCOUNT"},
		"verification": {403, `{"error":{"code":403,"status":"PERMISSION_DENIED","message":"Verify your account to continue.","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"VALIDATION_REQUIRED","metadata":{"validation_url":"https://accounts.google.com/signin/continue?sarp=1&plt=synthetic"}}]}}`, "BEE-ANTIGRAVITY-VERIFY", "https://accounts.google.com/signin/continue?sarp=1&plt=synthetic"},
		"disabled":     {403, `{"error":{"code":403,"status":"PERMISSION_DENIED","message":"This service has been disabled in this account for violation of Terms of Service.","details":[{"reason":"TOS_VIOLATION","metadata":{"appeal_url":"https://support.google.com/accounts/troubleshooter/2402620"}}]}}`, "BEE-ANTIGRAVITY-DISABLED", "https://support.google.com/accounts/troubleshooter/2402620"},
		"forbidden":    {403, `{"error":{"code":403,"status":"PERMISSION_DENIED","message":"The caller does not have permission"}}`, "BEE-ANTIGRAVITY-FORBIDDEN", "HTTP 403"},
		"bad request":  {400, `{"error":{"code":400,"message":"Invalid request"}}`, "BEE-ANTIGRAVITY-UPSTREAM", "HTTP 400"},
	} {
		t.Run(name, func(t *testing.T) {
			fixture := newAntigravityLogin(t)
			fixture.google.answer[googleProd+"loadCodeAssist"] = googleAnswer(test.status, test.body)
			err := fixture.login.report(context.Background())
			code, summary, fix, _ := Coded(err)
			if code != test.code || !strings.Contains(summary, test.detail) || fix == "" {
				t.Fatalf("got %v, want %s naming %s", err, test.code, test.detail)
			}
			assertNoAntigravitySecrets(t, err.Error()+fixture.out.String())
			if _, err := fixture.login.store.read(); !errors.Is(err, errAntigravityMissing) {
				t.Fatal("an account that cannot supply was stored")
			}
		})
	}
	// An ineligible tier beside a paid one is the account's history, not its standing.
	fixture := newAntigravityLogin(t)
	fixture.google.answer[googleProd+"loadCodeAssist"] = googleAnswer(200, `{"cloudaicompanionProject":"synthetic-project-1","paidTier":"g1-ultra-tier","ineligibleTiers":[{"reasonCode":"INELIGIBLE_ACCOUNT"}]}`)
	if err := fixture.login.report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if stored, _ := fixture.login.store.read(); stored.Plan != "ultra" {
		t.Fatal("a paid account with an ineligible tier listed was not stored as paid")
	}
}

func TestAntigravityAccountCallsFallThroughToDaily(t *testing.T) {
	for _, status := range []int{0, 404, 408, 429, 500, 503} {
		fixture := newAntigravityLogin(t)
		fixture.google.answer[googleProd+"loadCodeAssist"] = googleAnswer(status, `{"error":{"code":503}}`)
		fixture.google.answer[googleDaily+"loadCodeAssist"] = googleAnswer(200, antigravityTestLoad)
		if err := fixture.login.report(context.Background()); err != nil {
			t.Fatalf("production answering %d was not followed by daily: %v", status, err)
		}
	}
	// What production refuses for the account itself is not asked of daily.
	fixture := newAntigravityLogin(t)
	fixture.google.answer[googleProd+"loadCodeAssist"] = googleAnswer(401, `{"error":{"code":401,"message":"Invalid bearer token"}}`)
	if code, _, _, _ := Coded(fixture.login.report(context.Background())); code != "BEE-ANTIGRAVITY-UPSTREAM" || fixture.google.count(googleDaily+"loadCodeAssist") != 0 {
		t.Fatal("a refusal was retried on the other endpoint", code)
	}
}

func TestAntigravityLoginReadsThePastedAddressWhenNoBrowserReturns(t *testing.T) {
	state := regexp.MustCompile(`[?&]state=([A-Za-z0-9_-]+)`)
	for name, paste := range map[string]func(state string) string{
		"address": func(state string) string {
			return "http://localhost:51121/oauth-callback?state=" + state + "&code=synthetic-code&scope=email\n"
		},
		"quoted": func(state string) string {
			return ` "http://localhost:51121/oauth-callback?code=synthetic-code&state=` + state + `#" `
		},
		"bare code": func(string) string { return "synthetic-code\n" },
	} {
		t.Run(name, func(t *testing.T) {
			fixture := newAntigravityLogin(t)
			fixture.login.manual, fixture.login.open = true, nil
			fixture.login.paste = func() (string, error) {
				// The person reads the address off the terminal.
				shown := regexp.MustCompile(`https://accounts\.google\.com/\S+`).FindString(fixture.out.String())
				fixture.link, _ = url.Parse(shown)
				return paste(state.FindStringSubmatch(shown)[1]), nil
			}
			if err := fixture.login.report(context.Background()); err != nil {
				t.Fatal(err)
			}
			if fixture.link.Query().Get("redirect_uri") != antigravityRedirect {
				t.Fatal("a sign-in carried back by hand used another redirect address")
			}
			if stored, err := fixture.login.store.read(); err != nil || stored.UserID != antigravityTestUser {
				t.Fatal("pasted sign-in not stored", err)
			}
			assertNoAntigravitySecrets(t, fixture.out.String())
		})
	}
	for name, pasted := range map[string]string{
		"another state": "http://localhost:51121/oauth-callback?state=other&code=synthetic-code",
		"nothing":       "\n",
		"prose":         "it did not load\n",
	} {
		t.Run(name, func(t *testing.T) {
			fixture := newAntigravityLogin(t)
			fixture.login.manual, fixture.login.open = true, nil
			fixture.login.paste = func() (string, error) { return pasted, nil }
			if code, _, _, _ := Coded(fixture.login.report(context.Background())); code != "BEE-ANTIGRAVITY-LOGIN" || len(fixture.google.calls) != 0 {
				t.Fatal("unusable paste accepted", code)
			}
		})
	}
}

func TestAntigravityLoginFallsBackToPasteWhenThePortIsTaken(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()
	fixture := newAntigravityLogin(t)
	fixture.login.listen = taken.Addr().String()
	opened := ""
	fixture.login.open = func(address string) error { opened = address; return errors.New("no browser here") }
	fixture.login.paste = func() (string, error) {
		fixture.link, _ = url.Parse(opened)
		return antigravityRedirect + "?code=synthetic-code&state=" + fixture.link.Query().Get("state"), nil
	}
	if err := fixture.login.report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(fixture.out.String(), taken.Addr().String()+" is in use") || fixture.link.Query().Get("redirect_uri") != antigravityRedirect {
		t.Fatalf("the busy port was not explained: %s", fixture.out)
	}
}

func TestAntigravityLoginEndsWhenNothingComesBack(t *testing.T) {
	fixture := newAntigravityLogin(t)
	fixture.login.open = nil
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if code, _, _, _ := Coded(fixture.login.report(ctx)); code != "BEE-ANTIGRAVITY-LOGIN" {
		t.Fatal("a sign-in nobody finished did not end", code)
	}
}

func TestAntigravityLoginReplacesAnotherAccountUnderTheLock(t *testing.T) {
	fixture := newAntigravityLogin(t)
	earlier := antigravitySample(time.Now().Add(time.Hour))
	earlier.UserID = "998877665544332211009"
	if err := fixture.login.store.write(earlier); err != nil {
		t.Fatal(err)
	}
	if err := fixture.login.report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if stored, _ := fixture.login.store.read(); stored.UserID != antigravityTestUser || !strings.Contains(fixture.out.String(), "different account") {
		t.Fatal("the earlier account was not replaced with a notice", fixture.out)
	}
	if _, err := os.Stat(fixture.login.store.path); err != nil {
		t.Fatal(err)
	}
}

func TestAntigravityOAuthClientSecretCanBeReplaced(t *testing.T) {
	if antigravityOAuth("").ClientSecret != antigravityClientSecret {
		t.Fatal("default client secret")
	}
	t.Setenv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "synthetic-replacement")
	if config := antigravityOAuth(antigravityRedirect); config.ClientSecret != "synthetic-replacement" || config.Endpoint.TokenURL != googleTokenURL || config.RedirectURL != antigravityRedirect {
		t.Fatal("the environment did not replace the client secret")
	}
}
