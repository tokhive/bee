package beewire

import (
	"strings"
	"testing"
	"time"
)

func TestResellerKeyAndStatusValidation(t *testing.T) {
	fingerprint := strings.Repeat("ab", 32)
	if !(ResellerKey{Reseller: "wokey", KeyFingerprint: fingerprint}).Valid() {
		t.Fatal("valid key rejected")
	}
	for _, key := range []ResellerKey{
		{Reseller: "Wokey", KeyFingerprint: fingerprint},
		{Reseller: "wokey", KeyFingerprint: strings.ToUpper(fingerprint)},
		{Reseller: "wokey", KeyFingerprint: "sk-not-a-fingerprint"},
	} {
		if key.Valid() {
			t.Errorf("%+v accepted", key)
		}
	}
	ok := ResellerStatus{KeyFingerprint: fingerprint, State: ResellerReady, Models: []string{"gpt-6-astra", "claude-opus-5-5"}, AvailableUSD: "9.995931"}
	if !ok.Valid() {
		t.Fatal("valid status rejected")
	}
	for name, edit := range map[string]func(*ResellerStatus){
		"unknown state":   func(s *ResellerStatus) { s.State = "rate_limited" },
		"duplicate model": func(s *ResellerStatus) { s.Models = []string{"a", "a"} },
		"bad balance":     func(s *ResellerStatus) { s.AvailableUSD = "-1" },
		"bad fingerprint": func(s *ResellerStatus) { s.KeyFingerprint = "x" },
	} {
		status := ok
		status.Models = append([]string(nil), ok.Models...)
		edit(&status)
		if status.Valid() {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestResellerChargesValidation(t *testing.T) {
	charge := ResellerCharge{RequestID: "2026102608083912dfi", Model: "claude-sonnet-5-5", Status: "succeeded", AmountUSD: "0.000021", ChargedAt: time.Now()}
	ok := ResellerCharges{KeyFingerprint: strings.Repeat("ab", 32), Charges: []ResellerCharge{charge}}
	if !ok.Valid() {
		t.Fatal("valid charges rejected")
	}
	for name, edit := range map[string]func(*ResellerCharges){
		"none":         func(c *ResellerCharges) { c.Charges = nil },
		"duplicate":    func(c *ResellerCharges) { c.Charges = append(c.Charges, c.Charges[0]) },
		"bad id":       func(c *ResellerCharges) { c.Charges[0].RequestID = "a b" },
		"bad amount":   func(c *ResellerCharges) { c.Charges[0].AmountUSD = "-1" },
		"no time":      func(c *ResellerCharges) { c.Charges[0].ChargedAt = time.Time{} },
		"too many":     func(c *ResellerCharges) { c.Charges = make([]ResellerCharge, MaxResellerCharges+1) },
		"wrong prints": func(c *ResellerCharges) { c.KeyFingerprint = "x" },
	} {
		report := ResellerCharges{KeyFingerprint: ok.KeyFingerprint, Charges: []ResellerCharge{charge}}
		edit(&report)
		if report.Valid() {
			t.Errorf("%s accepted", name)
		}
	}
}
