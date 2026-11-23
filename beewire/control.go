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

// ControlEgress is not a control stream: a Bee that runs the residential role
// names it on the same header, so Hive offers that device as an egress seller
// and never sends a lease to a Bee that would refuse it. Older Bees omit it
// and are simply not offered, which keeps a mixed fleet working.
const ControlEgress = "egress"

// Control is the open metadata of a control stream, which Hive closes as soon
// as it is open; an upstream stream's metadata names a host instead.
type Control struct {
	Control  string `json:"control"`
	Platform string `json:"platform"`
}
