package beewire

import (
	"strings"
	"testing"
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
