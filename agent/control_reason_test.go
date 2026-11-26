package bee

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestProblemCarriesTheReasonTheSignInCannotBeUsed(t *testing.T) {
	empty := failCause("BEE-CLAUDE-SOURCE", &credentialError{kind: "token_missing"})
	problem := problemOf(empty)
	if problem.Code != "BEE-CLAUDE-SOURCE" || problem.Reason == nil {
		t.Fatalf("problem = %+v", problem)
	}
	if problem.Reason.En != "Claude Code accessToken is empty" || problem.Reason.Zh != "Claude Code 的 accessToken 为空" {
		t.Fatalf("reason = %+v", problem.Reason)
	}

	missing := problemOf(failCause("BEE-CLAUDE-SOURCE", errClaudeKeychainMissing))
	if missing.Reason == nil || !strings.Contains(missing.Reason.En, "Keychain entry was not found") {
		t.Fatalf("keychain reason = %+v", missing.Reason)
	}
}

func TestProblemWithoutAKnownReasonOmitsIt(t *testing.T) {
	problem := problemOf(failCause("BEE-CLAUDE-SOURCE", errors.New("something else")))
	if problem.Reason != nil {
		t.Fatalf("reason = %+v", problem.Reason)
	}
	raw, err := json.Marshal(problem)
	if err != nil || strings.Contains(string(raw), "reason") {
		t.Fatalf("json = %s %v", raw, err)
	}
}
