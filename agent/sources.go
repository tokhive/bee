package bee

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/tokhive/bee/beewire"
)

// syncSource is one account source a Bee keeps synchronized with Hive: an
// official subscription login, an official Platform key or a reseller key.
type syncSource struct {
	// name identifies the source among those of one Bee.
	name string
	// platform is the supply platform Hive reports readiness for, or "" for a
	// source that is not a platform account.
	platform    string
	synchronize func(context.Context, localState, string, io.Writer, bool) error
	report      func(io.Writer, string, string)
	// state is the account state the source last reported, or nil for a
	// source that does not report one; it is only read from the goroutine
	// that runs synchronize.
	state func() string
	// targets are upstream addresses this source adds to the egress allowlist
	// beyond the configuration's own targets.
	targets []string
	// wanted marks that Hive asked this source for a capability report.
	wanted func()
}

// sourceSet runs each source in its own context under the connection's, so a
// source can join or leave a live connection without ending it or disturbing
// the other sources. Streams already bridged to an upstream are bound to the
// tunnel session, not to any source, and finish undisturbed.
type sourceSet struct {
	mu      sync.Mutex
	entries []*sourceEntry
	session *sourceSession
}

type sourceEntry struct {
	syncSource
	stop context.CancelFunc
	done chan struct{}
}

// sourceSession is one connection's synchronization: its lease and the
// workers started on it.
type sourceSession struct {
	ctx      context.Context
	state    localState
	lease    string
	out      io.Writer
	failures chan error
	workers  sync.WaitGroup
}

var errSourceExists = errors.New("an account source with this name is already configured")

// begin starts every source on a new connection. The returned wait ends the
// session and returns once all of its workers, including those of sources
// added meanwhile, have exited; call it after ctx is done.
func (s *sourceSet) begin(ctx context.Context, state localState, lease string, out io.Writer) (<-chan error, func()) {
	session := &sourceSession{ctx: ctx, state: state, lease: lease, out: out, failures: make(chan error, 1)}
	s.mu.Lock()
	s.session = session
	for _, entry := range s.entries {
		s.launch(session, entry)
	}
	s.mu.Unlock()
	return session.failures, func() {
		s.mu.Lock()
		if s.session == session {
			s.session = nil
		}
		s.mu.Unlock()
		session.workers.Wait()
	}
}

// add configures a source and, on a live connection, starts it at once.
func (s *sourceSet) add(source syncSource) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if slices.ContainsFunc(s.entries, func(e *sourceEntry) bool { return e.name == source.name }) {
		return errSourceExists
	}
	entry := &sourceEntry{syncSource: source}
	s.entries = append(s.entries, entry)
	if s.session != nil {
		s.launch(s.session, entry)
	}
	return nil
}

// remove stops a source and returns once its workers have exited. Pausing its
// platform in Hive first keeps new work from arriving meanwhile.
func (s *sourceSet) remove(name string) bool {
	s.mu.Lock()
	i := slices.IndexFunc(s.entries, func(e *sourceEntry) bool { return e.name == name })
	if i < 0 {
		s.mu.Unlock()
		return false
	}
	entry := s.entries[i]
	s.entries = slices.Delete(s.entries, i, i+1)
	stop, done := entry.stop, entry.done
	s.mu.Unlock()
	if stop != nil {
		stop()
		<-done
	}
	return true
}

// sourceInfo names a configured source and its platform.
type sourceInfo struct{ name, platform string }

func (s *sourceSet) list() []sourceInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := make([]sourceInfo, 0, len(s.entries))
	for _, entry := range s.entries {
		list = append(list, sourceInfo{entry.name, entry.platform})
	}
	return list
}

func (s *sourceSet) names() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.entries))
	for _, entry := range s.entries {
		names = append(names, entry.name)
	}
	return names
}

// allows reports whether a source added an upstream to the allowlist.
func (s *sourceSet) allows(host string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.ContainsFunc(s.entries, func(e *sourceEntry) bool { return slices.Contains(e.targets, host) })
}

// want passes Hive's capability request to the sources of that platform.
func (s *sourceSet) want(platform string) {
	s.mu.Lock()
	var wanted []func()
	for _, entry := range s.entries {
		if entry.platform == platform && entry.wanted != nil {
			wanted = append(wanted, entry.wanted)
		}
	}
	s.mu.Unlock()
	for _, mark := range wanted {
		mark()
	}
}

// launch starts one source's worker; the caller holds s.mu.
func (s *sourceSet) launch(session *sourceSession, entry *sourceEntry) {
	ctx, stop := context.WithCancel(session.ctx)
	done := make(chan struct{})
	entry.stop, entry.done = stop, done
	source := entry.syncSource
	session.workers.Go(func() {
		defer close(done)
		session.run(ctx, source)
	})
}

// run keeps one source synchronized until ctx ends or Hive rejects the device.
func (session *sourceSession) run(ctx context.Context, source syncSource) {
	slog.Info("authorization synchronization started", "module", "sync", "platform", source.label())
	first := true
	reported := ""
	for ctx.Err() == nil {
		err := source.synchronize(ctx, session.state, session.lease, session.out, first)
		source.announceStateChange(ctx, &reported)
		if err != nil && ctx.Err() == nil {
			var failure *apiFailure
			if errors.Is(err, errInboxIdentity) || errors.As(err, &failure) && (failure.Status == 401 || failure.Status == 403) {
				slog.Error("authorization synchronization stopped", "module", "sync", "platform", source.label(), "error", err.Error())
				select {
				case session.failures <- err:
				default:
				}
				return
			}
			// The cause belongs in the line. This branch is the one
			// that means "something unexpected", and without it a
			// provider is told only that synchronization did not
			// confirm — the same sentence for an unreachable Hive, a
			// rejected lease and a malformed response.
			source.report(session.out, "sync_unconfirmed", source.label()+" authorization synchronization unconfirmed; retrying; Hive will stop dispatching when the authorization synchronization deadline is reached: "+err.Error())
		}
		// A reseller key is not a platform account, so Hive has no
		// platform readiness to report for it.
		if first && source.platform != "" {
			session.workers.Go(func() { reportReadiness(ctx, session.state, source.platform, session.out) })
		}
		first = false
		if pause(ctx, 2*time.Second) != nil {
			return
		}
	}
}

// announceStateChange tells the desktop app to read the platform again when
// what the source reports has changed since *reported: recovered after a new
// sign-in, needs confirmation, rejected. That is a change in what Hive holds
// for the platform, and the app would otherwise show the earlier answer until
// its next scheduled read.
func (source syncSource) announceStateChange(ctx context.Context, reported *string) {
	if source.state == nil || source.platform == "" {
		return
	}
	if state := source.state(); state != *reported {
		*reported = state
		runStatusFrom(ctx).publish(controlEvent{Name: "supply", Data: map[string]string{"platform": source.platform}})
	}
}

// supplyPlatforms are the platforms a subscription account is supplied for,
// in the order they are listed and started.
var supplyPlatforms = []string{"openai", "claude", beewire.GooglePlatform}

func supplyPlatform(platform string) bool { return slices.Contains(supplyPlatforms, platform) }

// sourceName is the name of the source that supplies a platform's account.
func sourceName(platform string) string {
	if platform == beewire.GooglePlatform {
		return "antigravity"
	}
	return platform
}

// label is the name a source's log lines carry.
func (source syncSource) label() string {
	switch source.name {
	case "openai":
		return "OpenAI"
	case "claude":
		return "Claude"
	case "antigravity":
		return "Google"
	}
	return source.name
}

// sources returns the account sources of this configuration, built from the
// file the first time they are asked for.
func (cfg *egressConfig) sources() *sourceSet {
	cfg.sourcesOnce.Do(func() {
		cfg.sourceSet = &sourceSet{}
		for _, source := range cfg.fileSources() {
			cfg.sourceSet.add(source)
		}
	})
	return cfg.sourceSet
}

// fileSources are the sources the egress configuration file names, in the
// order they have always started.
func (cfg *egressConfig) fileSources() []syncSource {
	var sources []syncSource
	if cfg.Codex != nil {
		source := syncSource{name: "openai", platform: "openai", synchronize: cfg.synchronize, report: cfg.accountMessage, state: func() string { return cfg.lastAccountState }}
		if cfg.Capabilities != nil {
			source.wanted = func() { cfg.capabilityWanted.Store(true) }
		}
		sources = append(sources, source)
	}
	if cfg.Claude != nil {
		claude := cfg.Claude
		claude.capabilityWanted = &cfg.claudeCapabilityWanted
		sources = append(sources, syncSource{name: "claude", platform: "claude", synchronize: claude.synchronize, report: claude.message, state: func() string { return claude.lastState },
			wanted: func() { cfg.claudeCapabilityWanted.Store(true) }})
	}
	if cfg.Antigravity != nil {
		antigravity := cfg.Antigravity
		antigravity.capabilityWanted = &cfg.antigravityCapabilityWanted
		sources = append(sources, syncSource{name: "antigravity", platform: beewire.GooglePlatform, synchronize: antigravity.synchronize, report: antigravity.message, state: func() string { return antigravity.lastState },
			wanted: func() { cfg.antigravityCapabilityWanted.Store(true) }})
	}
	if cfg.OpenAIAPI != nil {
		sources = append(sources, syncSource{name: "openai_api", synchronize: cfg.synchronizeOpenAIAPI, report: cfg.OpenAIAPI.message})
	}
	if cfg.ClaudeAPI != nil {
		sources = append(sources, syncSource{name: "claude_api", synchronize: cfg.synchronizeClaudeAPI, report: cfg.ClaudeAPI.message})
	}
	if cfg.Reseller != nil {
		sources = append(sources, syncSource{name: cfg.Reseller.Reseller, synchronize: cfg.synchronizeReseller, report: cfg.Reseller.message})
	}
	return sources
}

// allowed reports whether a stream may be bridged to host: the configuration
// lists it, or a source added while running brought it.
func (cfg *egressConfig) allowed(host string) bool {
	return slices.Contains(cfg.Targets, host) || cfg.sources().allows(host)
}

// control acts on a control stream Hive opened. A platform this Bee does not
// observe is ignored.
func (cfg *egressConfig) control(control beewire.Control) {
	if control.Control != beewire.ControlCapabilities {
		egressDebug("control stream ignored: unknown control %q", control.Control)
		return
	}
	slog.Info("capability report requested by Hive", "module", "sync", "platform", control.Platform)
	cfg.sources().want(control.Platform)
}
