package beewire

// ControlsHeader lists, on a Bee's connection request, the control streams the
// Bee serves. Hive opens no control stream a Bee did not name: an older Bee
// takes every stream for an upstream connection, and would refuse and report
// one without a host as a target outside its allowlist.
const ControlsHeader = "X-Bee-Controls"

// ControlCapabilities asks the Bee to observe and report one platform's
// capabilities now rather than at its next interval. Hive asks when it holds
// an account out until a newer observation arrives, as it does once an
// upstream quota refusal's cooldown has run, and a request is waiting for it.
const ControlCapabilities = "capabilities"

// Control is the open metadata of a control stream, which Hive closes as soon
// as it is open; an upstream stream's metadata names a host instead.
type Control struct {
	Control  string `json:"control"`
	Platform string `json:"platform"`
}
