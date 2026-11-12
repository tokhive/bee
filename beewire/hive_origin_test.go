package beewire_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tokhive/bee/beewire"
)

func TestHiveOriginKeysFollowSharedContractWithoutChangingInput(t *testing.T) {
	raw, err := os.ReadFile("testdata/hive-origin-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Accepted []struct{ Input, Key string }
		Rejected []string
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, sample := range fixture.Accepted {
		got, err := beewire.CanonicalHiveOrigin(sample.Input)
		if err != nil || got != sample.Key {
			t.Errorf("input=%q key=%q error=%v; want=%q", sample.Input, got, err, sample.Key)
		}
	}
	for _, input := range fixture.Rejected {
		if got, err := beewire.CanonicalHiveOrigin(input); err == nil {
			t.Errorf("accepted unsafe input=%q key=%q", input, got)
		}
	}
}
