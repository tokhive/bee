package bee

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

type DesktopRuntimeSnapshot struct {
	RunID           *string                           `json:"run_id"`
	Revision        int64                             `json:"revision"`
	NetworkRevision int64                             `json:"network_revision"`
	ObservedAt      string                            `json:"observed_at"`
	Local           string                            `json:"local"`
	Connection      string                            `json:"connection"`
	Platforms       map[string]DesktopRuntimePlatform `json:"platforms"`
	Operation       *DesktopOperation                 `json:"operation"`
	StopReceipt     *DesktopStopReceipt               `json:"stop_receipt"`
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
