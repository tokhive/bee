package bee

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tunnel"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/logx"
	"github.com/tokhive/bee/relay"
)

type egressConfig struct {
	ConnectProxy            string            `json:"connect_proxy,omitempty"`
	Targets                 []string          `json:"targets"`
	InboxKeyID              string            `json:"inbox_key_id"`
	Credential              tee.Secret        `json:"credential"`
	Codex                   *codexSource      `json:"codex,omitempty"`
	Claude                  *claudeSource     `json:"claude,omitempty"`
	Capabilities            *capabilitySource `json:"capabilities,omitempty"`
	capabilitySequence      int64
	accountGeneration       int64
	authorization           *codexCredential
	lastRegistration        time.Time
	lastAccountState        string
	maintenanceTask         *beewire.MaintenanceTask
	lastCapabilitySync      time.Time
	lastCapabilityAttempt   time.Time
	capabilityRevision      string
	metadataReportedAt      time.Time
	metadataGeneration      int64
	metadataLease           string
	metadataModels          []string
	capabilityReportPending bool
	pacer                   syncPacer
	failures                *egressFailures
}

// useStateDirectory points the sources at a Bee-owned directory for the small
// runtime state that must outlive the process. Only the capability cooldown
// needs it today, and only on Claude, whose quota endpoint is the one that
// answers a refusal without naming a time to come back.
func (cfg *egressConfig) useStateDirectory(directory string) {
	if cfg == nil || cfg.Claude == nil || directory == "" {
		return
	}
	cfg.Claude.capabilities.cooldown = cooldownStore{path: filepath.Join(directory, "capability-cooldown.json")}
}

var errInboxIdentity = errors.New("TEE inbox public key does not match the independently pinned identity; credentials were not submitted")
var errCodexAuthorization = errors.New("Codex authorization unavailable")

// platformTargets is the upstream address each official account source needs
// in targets. A platform configured without it registers its account with
// Hive and then refuses every connection Hive sends for it.
var platformTargets = []struct{ field, target string }{
	{"codex", "chatgpt.com:443"},
	{"claude", "api.anthropic.com:443"},
}

func readEgress(ctx context.Context, path string) (*egressConfig, error) {
	info, err := os.Lstat(path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return nil, fail("BEE-CONFIG-NOT-FOUND", path)
	case err != nil:
		return nil, fail("BEE-CONFIG-UNREADABLE", path)
	case !info.Mode().IsRegular():
		return nil, fail("BEE-CONFIG-NOT-REGULAR", path)
	case info.Mode().Perm()&0077 != 0:
		return nil, failf("BEE-CONFIG-PERMISSIONS", "%s has mode %04o", path, info.Mode().Perm())
	case info.Size() > 65536:
		return nil, fail("BEE-CONFIG-TOO-LARGE", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fail("BEE-CONFIG-UNREADABLE", path)
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil {
		return nil, fail("BEE-CONFIG-UNREADABLE", path)
	}
	if len(raw) > 65536 {
		return nil, fail("BEE-CONFIG-TOO-LARGE", path)
	}
	cfg, err := decodeEgress(raw)
	if err != nil {
		return nil, err
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// decodeEgress parses the configuration strictly and says where it is wrong.
func decodeEgress(raw []byte) (*egressConfig, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var cfg egressConfig
	err := decoder.Decode(&cfg)
	var syntax *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	switch {
	case err == nil:
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return nil, fail("BEE-CONFIG-SYNTAX", "file ends before the JSON object is complete")
	case errors.As(err, &syntax):
		// Offset counts the offending byte as read.
		return nil, failf("BEE-CONFIG-SYNTAX", "%s at %s", syntax.Error(), position(raw, syntax.Offset-1))
	case errors.As(err, &typeErr):
		return nil, failf("BEE-CONFIG-FIELD-TYPE", "%q must be %s, not %s, at %s", typeErr.Field, jsonKind(typeErr.Type), typeErr.Value, position(raw, typeErr.Offset))
	default:
		// The decoder reports an unknown field only by name.
		if name, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			field, _ := strconv.Unquote(name)
			detail := strconv.Quote(field)
			if at := bytes.Index(raw, []byte(name)); at >= 0 {
				detail += " at " + position(raw, int64(at))
			}
			return nil, fail("BEE-CONFIG-UNKNOWN-FIELD", detail)
		}
		return nil, fail("BEE-CONFIG-SYNTAX", err.Error())
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, failf("BEE-CONFIG-TRAILING-DATA", "after %s", position(raw, decoder.InputOffset()))
	}
	return &cfg, nil
}

// position turns a byte offset into a 1-based line and column.
func position(raw []byte, offset int64) string {
	if offset < 0 || offset > int64(len(raw)) {
		offset = int64(len(raw))
	}
	before := raw[:offset]
	line := bytes.Count(before, []byte("\n")) + 1
	column := int(offset) - bytes.LastIndexByte(before, '\n')
	return fmt.Sprintf("line %d, column %d", line, column)
}

func jsonKind(t reflect.Type) string {
	switch t.Kind() {
	case reflect.String:
		return "a string"
	case reflect.Bool:
		return "true or false"
	case reflect.Slice, reflect.Array:
		return "a list"
	case reflect.Struct, reflect.Map, reflect.Pointer:
		return "an object"
	default:
		return "a number"
	}
}

func (cfg *egressConfig) validate() error {
	if len(cfg.Targets) == 0 {
		return fail("BEE-CONFIG-NO-TARGETS", "")
	}
	if len(cfg.Targets) > 16 {
		return failf("BEE-CONFIG-TOO-MANY-TARGETS", "%d targets", len(cfg.Targets))
	}
	for _, target := range cfg.Targets {
		host, port, err := net.SplitHostPort(target)
		number, portErr := strconv.Atoi(port)
		if err != nil || host == "" || portErr != nil || number < 1 || number > 65535 {
			return fail("BEE-CONFIG-TARGET-FORMAT", strconv.Quote(target))
		}
	}
	if cfg.dynamicAuthorization() {
		if cfg.Credential != (tee.Secret{}) {
			return fail("BEE-CONFIG-STATIC-MIXED", "")
		}
		// The live synchronizer reads the source so re-login can recover without restarting Bee.
	} else if cfg.Credential == (tee.Secret{}) {
		return fail("BEE-CONFIG-NO-SOURCE", "")
	} else if cfg.Credential.Token == "" || cfg.Credential.Validate() != nil {
		return fail("BEE-CONFIG-STATIC-CREDENTIAL", "")
	}
	id, err := hex.DecodeString(cfg.InboxKeyID)
	if (!cfg.dynamicAuthorization() || cfg.InboxKeyID != "") && (err != nil || len(id) != 32) {
		return fail("BEE-CONFIG-INBOX-KEY", "")
	}
	cfg.InboxKeyID = hex.EncodeToString(id)
	if cfg.Claude != nil && cfg.Claude.Store != "keychain" {
		return failf("BEE-CONFIG-CLAUDE-STORE", "store is %q", cfg.Claude.Store)
	}
	if cfg.Capabilities != nil && cfg.Codex == nil {
		return fail("BEE-CONFIG-CAPABILITIES-SOURCE", "")
	}
	if cfg.Capabilities != nil && !cfg.Capabilities.valid() {
		return fail("BEE-CONFIG-CAPABILITIES-URL", "")
	}
	if !cfg.loopbackTargets() {
		for _, platform := range platformTargets {
			configured := platform.field == "codex" && cfg.Codex != nil || platform.field == "claude" && cfg.Claude != nil
			if configured && !slices.Contains(cfg.Targets, platform.target) {
				return failf("BEE-CONFIG-TARGET-MISSING", "%q is configured but targets lacks %s", platform.field, platform.target)
			}
		}
	}
	if cfg.ConnectProxy != "" {
		address, err := localConnectProxy(cfg.ConnectProxy)
		if err != nil {
			// The value may carry proxy credentials, so it is not echoed.
			return fail("BEE-CONFIG-PROXY", "")
		}
		official := officialTransport(address)
		if cfg.Codex != nil {
			cfg.Codex.transport = official
		}
		if cfg.Capabilities != nil {
			cfg.Capabilities.transport = official
		}
		if cfg.Claude != nil {
			cfg.Claude.transport = official
		}
	}
	return nil
}

// loopbackTargets reports a configuration whose every target is a loopback IP:
// a local acceptance fixture standing in for the official upstreams, which
// therefore cannot be expected among its targets.
func (cfg *egressConfig) loopbackTargets() bool {
	for _, target := range cfg.Targets {
		host, _, _ := net.SplitHostPort(target)
		if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
			return false
		}
	}
	return true
}

func (cfg *egressConfig) dynamicAuthorization() bool { return cfg.Codex != nil || cfg.Claude != nil }

func (cfg *egressConfig) accountMessage(out io.Writer, state, message string) {
	if cfg.lastAccountState != state {
		notify(out, supplyStateLevel(state), "sync", message, "platform", "openai", "state", state)
		cfg.lastAccountState = state
	}
}

func (cfg *egressConfig) synchronize(ctx context.Context, state localState, lease string, out io.Writer, force bool) error {
	// The local source is read every cycle whatever the pacer says: it is what
	// notices that the provider logged in again, and waiting out an
	// observation window before looking would make a re-login take as long as
	// the window. Only the Hive round trip below is paced, because that is the
	// part that costs a write transaction.
	credential, sourceErr := cfg.Codex.readForMaintenance(ctx)
	changed := sourceErr == nil && (cfg.authorization == nil || !cfg.authorization.sameAuthorization(credential))
	if !force && sourceErr == nil && !changed && cfg.pacer.skip(time.Now()) {
		return nil
	}
	// The previous cycle's response already carried the account version this
	// one has to claim, so the read is only for a cycle that has none.
	observed, known := cfg.pacer.expected()
	cfg.pacer.unsettled()
	if !known {
		if err := call(ctx, httpClient(), state.Hive, "/api/bee/platforms/openai/account", "GET", state.Credential, nil, &observed); err != nil {
			return err
		}
	}
	if sourceErr != nil {
		cfg.authorization = nil
		if force || cfg.lastAccountState != "source_unavailable" || time.Since(cfg.lastRegistration) >= 10*time.Second {
			if err := call(ctx, httpClient(), state.Hive, "/api/bee/platforms/openai/account/source", "PUT", state.Credential, map[string]string{"lease": lease}, nil); err != nil {
				return err
			}
			cfg.lastRegistration = time.Now()
		}
		cfg.accountMessage(out, "source_unavailable", "new OpenAI jobs paused; waiting for official Codex authorization recovery: "+sourceErr.Error())
		return nil
	}
	var result beewire.MaintenanceResponse
	err := call(ctx, httpClient(), state.Hive, "/api/bee/maintenance", "POST", state.Credential,
		beewire.MaintenanceRequest{Lease: lease, Codex: credential.metadata(), ExpectedGeneration: observed.Generation, ExpectedRevision: observed.CredentialRevision}, &result)
	if err != nil {
		return err
	}
	if result.Account.Status == "confirmation_required" {
		cfg.accountMessage(out, "confirmation_required", "different OpenAI account detected; new jobs paused; run bee account-status --platform openai and explicitly confirm with bee confirm-account")
		return nil
	}
	if result.Task == nil && result.Account.Status != "ready" {
		cfg.accountMessage(out, "maintenance_wait", "OpenAI authorization maintenance incomplete; new jobs paused")
		return nil
	}
	cfg.accountGeneration = result.Account.Generation
	if result.Task != nil {
		task := result.Task
		if task.ID == "" || task.DeviceID != state.Identity.ID || task.Platform != "openai" || task.AccountGeneration != result.Account.Generation || task.AccountFingerprint != credential.metadata().AccountFingerprint || task.KeyVersion < 1 {
			return errors.New("invalid Hive authorization maintenance task binding")
		}
		slog.Info("openai maintenance task received", "module", "maintenance", "task", task.ID, "key_version", task.KeyVersion)
		credential, err = cfg.Codex.executeMaintenance(ctx, *task)
		if err != nil {
			cfg.authorization = nil
			if stopErr := call(ctx, httpClient(), state.Hive, "/api/bee/platforms/openai/account/source", "PUT", state.Credential, map[string]string{"lease": lease}, nil); stopErr != nil {
				return stopErr
			}
			cfg.accountMessage(out, "maintenance_wait", "new OpenAI jobs paused; waiting for official Codex authorization recovery: "+err.Error())
			return nil
		}
		cfg.authorization, cfg.maintenanceTask = &credential, task
		slog.Info("openai maintenance task completed", "module", "maintenance", "task", task.ID)
		if err = cfg.register(ctx, state, lease); err != nil {
			var failure *apiFailure
			if errors.Is(err, errCodexExpired) || errors.As(err, &failure) && failure.Code == "invalid_codex_authorization" {
				cfg.authorization = nil
				if stopErr := call(ctx, httpClient(), state.Hive, "/api/bee/platforms/openai/account/source", "PUT", state.Credential, map[string]string{"lease": lease}, nil); stopErr != nil {
					return stopErr
				}
				cfg.accountMessage(out, "maintenance_wait", "OpenAI authorization expired during synchronization; waiting for a new authorization maintenance task")
				return nil
			}
			return err
		}
	}
	cfg.authorization = &credential
	cfg.lastRegistration = time.Now()
	cfg.accountMessage(out, "ready", "OpenAI authorization synchronized and account confirmed")
	if cfg.Capabilities != nil && cfg.capabilitiesDue(force, changed, credential) {
		cfg.lastCapabilityAttempt = time.Now()
		cfg.capabilityReportPending = true
		if err := cfg.synchronizeCapabilities(ctx, state, lease, force); err != nil {
			return err
		}
	}
	// A cycle that handled a task leaves Hive in a state worth confirming at
	// once, so only a quiet one may idle, and only until the observation needs
	// renewing or the next capability report falls due.
	if result.Task == nil && cfg.authorization != nil && !cfg.capabilityReportPending {
		cfg.pacer.settled(result.Account, time.Now(), cfg.capabilityWorkAt())
	}
	return nil
}

func (cfg *egressConfig) capabilityInterval() time.Duration {
	if cfg.Capabilities.LocalURL != "" {
		// Explicit loopback fixtures retain a short cycle for lifecycle tests.
		return 10 * time.Second
	}
	return beewire.CapabilityUsageInterval
}

func (cfg *egressConfig) capabilitiesDue(force, changed bool, credential codexCredential) bool {
	if force || changed || !cfg.Capabilities.retryAt.IsZero() && !time.Now().Before(cfg.Capabilities.retryAt) {
		return true
	}
	return time.Since(cfg.lastCapabilityAttempt) >= 10*time.Second && (cfg.capabilityReportPending || cfg.capabilityRevision != credential.metadata().CredentialRevision || time.Since(cfg.lastCapabilitySync) >= cfg.capabilityInterval())
}

// capabilityWorkAt is when this platform next owes a capability report, so the
// pacer never idles past work the cycle would otherwise have picked up. A
// cooldown that expires sooner than the interval is the earlier of the two.
func (cfg *egressConfig) capabilityWorkAt() time.Time {
	if cfg.Capabilities == nil {
		return time.Time{}
	}
	at := cfg.lastCapabilitySync.Add(cfg.capabilityInterval())
	if !cfg.Capabilities.retryAt.IsZero() && cfg.Capabilities.retryAt.Before(at) {
		at = cfg.Capabilities.retryAt
	}
	return at
}

func (cfg *egressConfig) register(ctx context.Context, state localState, lease string) error {
	secret := cfg.Credential
	var codex *beewire.CodexAuthorization
	if cfg.authorization != nil {
		if !time.Now().Before(cfg.authorization.ExpiresAt.Add(-30 * time.Second)) {
			return errCodexExpired
		}
		secret = cfg.authorization.Secret
		metadata := cfg.authorization.metadata()
		codex = &metadata
	}
	var key tee.InboxPublic
	if err := call(ctx, httpClient(), state.Hive, "/api/bee/credential-key", "GET", state.Credential, nil, &key); err != nil {
		return err
	}
	hash := sha256.Sum256(key.PublicKey)
	if hash != key.KeyID || cfg.Codex == nil && hex.EncodeToString(hash[:]) != cfg.InboxKeyID {
		return errInboxIdentity
	}
	taskID := ""
	if cfg.Codex != nil {
		if cfg.maintenanceTask == nil || cfg.maintenanceTask.Key.KeyID != key.KeyID {
			return errors.New("TEE inbox public key changed; waiting for a new maintenance task")
		}
		latest, err := cfg.Codex.read(ctx)
		if err != nil || !latest.sameAuthorization(*cfg.authorization) {
			return errSourceChanged
		}
		taskID = cfg.maintenanceTask.ID
	}
	envelope, err := tee.EncryptCredential(key, beewire.ProviderID(state.Identity.ID), secret)
	if err != nil {
		return errInboxIdentity
	}
	var registered struct {
		Generation int64 `json:"account_generation"`
	}
	err = call(ctx, httpClient(), state.Hive, "/api/bee/credentials", "POST", state.Credential,
		struct {
			Lease    string                      `json:"lease"`
			Envelope tee.Envelope                `json:"envelope"`
			Codex    *beewire.CodexAuthorization `json:"codex,omitempty"`
			TaskID   string                      `json:"task_id,omitempty"`
		}{lease, envelope, codex, taskID}, &registered)
	if err == nil {
		cfg.accountGeneration = registered.Generation
		slog.Debug("openai credential registered", "module", "maintenance", "generation", registered.Generation)
	}
	return err
}

// egressDebug reports why a stream was dropped. Every rejection below is silent
// by design — the agent is not party to the session — but that leaves an
// operator with no way to tell a whitelist miss from a dial failure, so this
// prints a date-time stamped line to stderr when BEE_DEBUG is set (or
// TOKHIVE_LOG_LEVEL=debug). Hosts only; never stream contents.
func egressDebug(format string, args ...any) {
	if !egressDebugEnabled() {
		return
	}
	logx.Stamp("[bee-debug]", "egress", format, args...)
}

func egressDebugEnabled() bool { return os.Getenv("BEE_DEBUG") != "" || logx.DebugOn() }

// countingConn tallies bytes each way so a debug run can tell a stalled TLS
// handshake from an upstream that never answered. Counts bytes, never
// contents, and is installed only under BEE_DEBUG: this wraps the buyer's own
// inference stream, and a default run should carry nothing it will not read.
type countingConn struct {
	net.Conn
	read, written atomic.Int64
}

func (c *countingConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.read.Add(int64(n))
	return n, err
}

func (c *countingConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	c.written.Add(int64(n))
	return n, err
}

func (cfg *egressConfig) start(ctx context.Context, conn *websocket.Conn, out io.Writer) *relay.Session {
	if cfg.failures == nil {
		cfg.failures = newEgressFailures()
	}
	return relay.New(ctx, conn, tunnel.High, func(live context.Context, stream *tunnel.Stream, metadata []byte) {
		var open struct {
			Host string `json:"host"`
		}
		if len(metadata) > 1024 || json.Unmarshal(metadata, &open) != nil {
			egressDebug("stream rejected: unreadable open metadata (%d bytes)", len(metadata))
			cfg.failures.report(out, failf("BEE-EGRESS-METADATA", "%d bytes", len(metadata)), "")
			return
		}
		egressDebug("stream opened for %q", open.Host)
		allowed := false
		for _, target := range cfg.Targets {
			if open.Host == target {
				allowed = true
				break
			}
		}
		if !allowed {
			egressDebug("stream rejected: %q is not in the target allowlist %v", open.Host, cfg.Targets)
			cfg.failures.report(out, fail("BEE-EGRESS-NOT-ALLOWED", strconv.Quote(open.Host)), open.Host)
			return
		}
		live, timing := startBeeStream(live, open.Host, cfg.ConnectProxy != "")
		upstream, err := cfg.dialEgress(live, open.Host)
		timing.Open(err)
		if err != nil {
			timing.Close(relay.BridgeResult{Direction: "connect", Reason: dialCloseReason(live, err)})
			egressDebug("dial %q failed: %v", open.Host, err)
			if live.Err() == nil {
				cfg.failures.report(out, dialProblem(open.Host, err), open.Host)
			}
			return
		}
		defer upstream.Close()
		var observer relay.BridgeObserver
		if timing != nil {
			observer = timing
		}
		var counter *countingConn
		started := time.Now()
		if egressDebugEnabled() {
			egressDebug("bridging to %q", open.Host)
			counter = &countingConn{Conn: upstream}
			upstream = counter
		}
		result := relay.BridgeObserved(live, stream, upstream, observer)
		timing.Close(result)
		if counter != nil {
			egressDebug("stream to %q closed after %s: sent %d bytes upstream, received %d bytes",
				open.Host, time.Since(started).Round(time.Millisecond), counter.written.Load(), counter.read.Load())
		}
	})
}
