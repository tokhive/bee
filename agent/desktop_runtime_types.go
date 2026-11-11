package bee

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// These DTOs are shared by the owned runtime and its private bridge. Defining a
// DTO does not advertise its command as available; the bridge requires a service.
type DesktopNetworkConfig struct {
	Revision     int64  `json:"revision"`
	ConnectProxy string `json:"connect_proxy"`
}

type DesktopOperation struct {
	ID       string               `json:"id"`
	Kind     string               `json:"kind"`
	Platform *string              `json:"platform"`
	State    string               `json:"state"`
	Revision int64                `json:"revision"`
	Error    *DesktopAccountError `json:"error"`
}

type DesktopRuntimePlatform struct {
	Account           DesktopAccountSnapshot `json:"account"`
	Supply            *DesktopSupply         `json:"supply"`
	SelectionRevision int64                  `json:"selection_revision"`
}

type DesktopStartupProgress struct {
	Stage       string  `json:"stage"`
	OperationID *string `json:"operation_id"`
	Completed   *int64  `json:"completed"`
	Total       *int64  `json:"total"`
}

type DesktopRuntimeSnapshot struct {
	StartupProgress  *DesktopStartupProgress           `json:"startup_progress,omitempty"`
	RunID            *string                           `json:"run_id"`
	Revision         int64                             `json:"revision"`
	NetworkRevision  int64                             `json:"network_revision"`
	ObservedAt       string                            `json:"observed_at"`
	Local            string                            `json:"local"`
	ConnectionDetail *DesktopConnectionDetail          `json:"connection_detail"`
	Connection       string                            `json:"connection"`
	Platforms        map[string]DesktopRuntimePlatform `json:"platforms"`
	Operation        *DesktopOperation                 `json:"operation"`
	StopReceipt      *DesktopStopReceipt               `json:"stop_receipt"`
	LegacyStop       *DesktopLegacyStopStatus          `json:"legacy_stop"`
}

type DesktopLegacyStopStatus struct {
	Phase      string               `json:"phase"`
	Platforms  []string             `json:"platforms"`
	Error      *DesktopAccountError `json:"error"`
	CanRecheck bool                 `json:"can_recheck"`
}

type DesktopStartRequest struct {
	ExpectedRevision int64    `json:"expected_revision"`
	ResumePlatforms  []string `json:"resume_platforms"`
}

type DesktopStopRequest struct {
	ExpectedRevision int64  `json:"expected_revision"`
	Reason           string `json:"reason"`
}

type DesktopStopReceipt struct {
	WorkersStopped bool `json:"workers_stopped"`
	IntentSaved    bool `json:"intent_saved"`
	SessionClean   bool `json:"session_clean"`
}

type DesktopAuthorizeRequest struct {
	Platform         string               `json:"platform"`
	Source           DesktopAccountSource `json:"source"`
	ExpectedRevision int64                `json:"expected_revision"`
}

// The sidecar is bundled with the desktop; omission is a contract error rather
// than an implicit assertion that there was no observed failure.
func (s *DesktopRuntimeSnapshot) UnmarshalJSON(raw []byte) error {
	fields := []string{"run_id", "revision", "network_revision", "observed_at", "local", "connection", "connection_detail", "platforms", "operation", "stop_receipt", "legacy_stop"}
	var members map[string]json.RawMessage
	if err := json.Unmarshal(raw, &members); err != nil {
		return err
	}
	if _, ok := members["startup_progress"]; ok {
		fields = append(fields, "startup_progress")
	}
	if _, err := connectionObject(raw, fields...); err != nil {
		return fmt.Errorf("runtime snapshot fields: %w", err)
	}
	type plain DesktopRuntimeSnapshot
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("decode runtime snapshot: %w", err)
	}
	*s = DesktopRuntimeSnapshot(value)
	return nil
}
