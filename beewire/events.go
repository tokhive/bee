package beewire

import (
	"regexp"
	"time"
)

// SupplyEvent is a connection failure on a provider's path that Hive cannot
// tie to one request (ADR 0016, #42 option c): an egress connection the Bee
// refused or could not open, or a relay stream Hive could not hand to the Bee.
// It names a code, an address and a count, never content.
type SupplyEvent struct {
	At    time.Time `json:"at"`
	Code  string    `json:"code"`
	Host  string    `json:"host,omitempty"`
	Count int       `json:"count"`
}

// SupplyEventReport is what a Bee posts to Hive.
type SupplyEventReport struct {
	Events []SupplyEvent `json:"events"`
}

// MaxReportedEvents bounds one report; a Bee throttles below it anyway.
const MaxReportedEvents = 20

// Relay event codes, recorded by Hive.
const (
	EventRelayNoBee      = "relay_no_bee"
	EventRelayDialFailed = "relay_dial_failed"
)

var eventCode = regexp.MustCompile(`^BEE-EGRESS-[A-Z]+(-[A-Z]+)*$`)

// BeeEventCode reports whether code is one a Bee may report.
func BeeEventCode(code string) bool {
	_, ok := eventExplanations[code]
	return ok && eventCode.MatchString(code)
}

// ExplainEvent explains a supply event code, for the administrator's supply
// failures page, the call audit and the Bee's own log.
func ExplainEvent(code string) (ReasonExplanation, bool) {
	e, ok := eventExplanations[code]
	e.Reason = code
	return e, ok
}

// EventCodes lists every supply event code.
func EventCodes() []string {
	codes := make([]string, 0, len(eventExplanations))
	for code := range eventExplanations {
		codes = append(codes, code)
	}
	return codes
}

var eventExplanations = map[string]ReasonExplanation{
	"BEE-EGRESS-NOT-ALLOWED": {
		Cause: "Hive asked this Bee to reach an address that is not in targets, and Bee refused",
		Fix:   "if the address belongs to a platform you supply, add it to targets; otherwise nothing is wrong, Bee refuses such requests by design",
	},
	"BEE-EGRESS-DIAL": {
		Cause: "Bee could not connect to the upstream platform",
		Fix:   "check this machine's network, DNS and firewall; if it needs a proxy to reach the platform, set connect_proxy",
	},
	"BEE-EGRESS-PROXY": {
		Cause: "the local connect_proxy failed to open a tunnel to the upstream platform",
		Fix:   "check that the proxy at connect_proxy is running and allows CONNECT to the platform's address",
	},
	"BEE-EGRESS-METADATA": {
		Cause: "Bee could not read a connection request from Hive",
		Fix:   "update Bee to the version the market expects; if it persists, report the code and time to the market administrator",
	},
	EventRelayNoBee: {
		Cause: "the TEE asked Hive to reach this provider's Bee, but no Bee connection was live",
		Fix:   "keep bee run connected; frequent occurrences mean the Bee's connection to Hive keeps dropping",
	},
	EventRelayDialFailed: {
		Cause: "Hive could not open a stream to this provider's Bee over its connection",
		Fix:   "the Bee's connection was failing at that moment; check its network and whether it reconnected",
	},
}
