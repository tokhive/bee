package bee

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

var failureIdentifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,127}$`)

type failureRecorderKey struct{}
type DesktopFailureRecorder func(DesktopDiagnosticEvent) error
type failureRecorder struct {
	mu        sync.Mutex
	write     DesktopFailureRecorder
	recent    []string
	snapshots map[string]string
}

// The recorder follows the owned process context, including background work.
// Failure evidence is written synchronously, independently of lossy timing events.
func WithDesktopFailureRecorder(ctx context.Context, recorder DesktopFailureRecorder) context.Context {
	return context.WithValue(ctx, failureRecorderKey{}, &failureRecorder{write: recorder, snapshots: map[string]string{}})
}
func (r *failureRecorder) writeLocked(code, check, message string) error {
	if !failureIdentifier.MatchString(code) {
		code = "unknown_failure"
	}
	if !desktopFailureCheck.MatchString(check) {
		check = "bridge_reply"
	}
	event := DesktopDiagnosticEvent{Time: time.Now().UTC().Format(time.RFC3339Nano), Level: "error", Module: "bridge", Code: "failure_observed", Evidence: map[string]string{"check": check, "failure_code": code, "failure_message": boundedFailureText(desktopSafeText(message), 30000)}}
	if err := r.write(event); err != nil {
		return fmt.Errorf("record failure check=%s code=%s message=%s: %w", check, code, event.Evidence["failure_message"], err)
	}
	return nil
}
func recordRequestFailure(ctx context.Context, check string, cause error, secrets ...string) error {
	if cause == nil {
		return nil
	}
	recorder, _ := ctx.Value(failureRecorderKey{}).(*failureRecorder)
	if recorder == nil {
		return cause
	}
	message := desktopSafeText(cause.Error(), secrets...)
	snapshotMessage := message
	var detailed *DesktopFailure
	if errors.As(cause, &detailed) {
		snapshotMessage = desktopSafeText(detailed.Message, secrets...)
		if detailed.Details != nil {
			evidence, _ := json.Marshal(detailed.Details.Evidence)
			message += "; evidence=" + safeResponseBody(evidence, secrets...)
		}
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	if err := recorder.writeLocked(desktopRequestFailureCode(cause), check, message); err != nil {
		return errors.Join(cause, fmt.Errorf("write failure evidence: %w", err))
	}
	recorder.recent = append(recorder.recent, snapshotMessage)
	if len(recorder.recent) > 128 {
		recorder.recent = recorder.recent[1:]
	}
	return cause
}

// RecordDesktopReplyFailures records only public error nodes, never successful
// payloads or credentials. Reading the same snapshot does not log its failure
// repeatedly; a later recovery clears that slot. A source HTTP failure already
// recorded above is not logged a second time by its reply wrapper.
func RecordDesktopReplyFailures(ctx context.Context, method, platform string, raw []byte) error {
	recorder, _ := ctx.Value(failureRecorderKey{}).(*failureRecorder)
	if recorder == nil {
		return nil
	}
	var reply any
	if err := json.Unmarshal(raw, &reply); err != nil {
		return fmt.Errorf("decode public failure projection: %w", err)
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	seen := map[string]string{}
	var visit func(any, string) error
	visit = func(value any, path string) error {
		switch value := value.(type) {
		case map[string]any:
			code, _ := value["code"].(string)
			message, _ := value["message"].(string)
			if code != "" && message != "" {
				check, _ := value["check"].(string)
				if check == "" {
					check = method
				}
				// Include existing structured evidence in the same event as the failure.
				if details, ok := value["details"].(map[string]any); ok {
					if c, ok := details["check"].(string); ok {
						check = c
					}
					value = details
				}
				if evidence, ok := value["evidence"].(map[string]any); ok && len(evidence) > 0 {
					b, _ := json.Marshal(evidence)
					message += "; evidence=" + safeResponseBody(b)
				}
				message = desktopSafeText(message)
				slot := method + ":" + platform + ":" + path
				seen[slot] = code + ":" + check + ":" + message
				if recorder.snapshots[slot] == seen[slot] {
					return nil
				}
				for _, source := range recorder.recent {
					if strings.Contains(message, source) {
						return nil
					}
				}
				return recorder.writeLocked(code, check, message)
			}
			for key, child := range value {
				if err := visit(child, path+"."+key); err != nil {
					return err
				}
			}
		case []any:
			for i, child := range value {
				if err := visit(child, fmt.Sprintf("%s.%d", path, i)); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := visit(reply, ""); err != nil {
		return fmt.Errorf("write public failure evidence: %w", err)
	}
	prefix := method + ":" + platform + ":"
	for slot := range recorder.snapshots {
		if strings.HasPrefix(slot, prefix) {
			delete(recorder.snapshots, slot)
		}
	}
	for slot, signature := range seen {
		recorder.snapshots[slot] = signature
	}
	return nil
}
