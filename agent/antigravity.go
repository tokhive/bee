package bee

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

// A Google account reaches Gemini models, and the Claude models Antigravity
// offers, through its Antigravity sign-in. No
// official client keeps that sign-in where Bee could read it, so Bee signs in
// itself (bee antigravity-login) and keeps the result in a private file of its
// own, which nothing else writes.

var (
	errAntigravityMissing       = errors.New("no Antigravity sign-in is stored; run bee antigravity-login")
	errAntigravityUnreadable    = errors.New("the stored Antigravity sign-in cannot be used; run bee antigravity-login to replace it")
	errAntigravityExpired       = errors.New("the Antigravity access token has expired and cannot be renewed; run bee antigravity-login")
	errAntigravityStale         = errors.New("the Antigravity access token has expired; waiting for Hive to schedule its refresh")
	errAntigravitySignIn        = errors.New("Google no longer accepts the stored Antigravity sign-in; run bee antigravity-login to sign in again")
	errAntigravitySourceChanged = errors.New("the Antigravity sign-in changed during the operation; reading it again")
	errAntigravityLock          = errors.New("another Bee process is updating the Antigravity sign-in; waiting for the next synchronization")
)

// antigravityCredential is the sign-in Bee keeps for a Google account: what
// antigravity-login obtained, and every refresh since.
type antigravityCredential struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	// UserID is Google's stable id of the account; an email can change.
	UserID string `json:"user_id"`
	// Email is shown to the Provider only and never leaves this machine.
	Email     string `json:"email"`
	ProjectID string `json:"project_id"`
	Tier      string `json:"tier"`
	Plan      string `json:"plan"`
	// Rejected is the OAuth error Google ended this sign-in with. A refresh
	// token it names is not offered to Google again.
	Rejected string `json:"rejected,omitempty"`
	// Private is whether Google confirmed the account's product-improvement
	// setting off (antigravityKeepPrivate). Until it has, every refresh tries
	// again.
	Private bool `json:"private,omitempty"`
}

// String keeps a credential out of anything that formats one by accident.
func (antigravityCredential) String() string { return "[Antigravity sign-in]" }

func (c antigravityCredential) secret() tee.Secret {
	return tee.Secret{Token: c.AccessToken, Header: "authorization", Scheme: "Bearer"}
}

func (c antigravityCredential) valid() bool {
	return c.secret().Validate() == nil && beewire.ValidCodexIdentity(c.UserID) && beewire.ValidProjectID(c.ProjectID) && !c.ExpiresAt.IsZero()
}

func (c antigravityCredential) available(now time.Time) bool {
	return now.Add(30 * time.Second).Before(c.ExpiresAt)
}

// same reports whether two reads of the store found the same sign-in.
func (c antigravityCredential) same(other antigravityCredential) bool {
	instant := c.ExpiresAt.Equal(other.ExpiresAt)
	c.ExpiresAt, other.ExpiresAt = time.Time{}, time.Time{}
	return instant && c == other
}

func antigravityDigest(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func (c antigravityCredential) fingerprint() string {
	return antigravityDigest(beewire.GooglePlatform + "\x00" + c.UserID)
}

func (c antigravityCredential) metadata() beewire.Authorization {
	return beewire.Authorization{AccountID: c.UserID, AccountFingerprint: c.fingerprint(), ExpiresAt: c.ExpiresAt, CredentialRevision: antigravityDigest(c.AccessToken), ProjectID: c.ProjectID}
}

// base is the endpoint that serves this account's generation requests, and so
// the one whose model list and quota describe it.
func (c antigravityCredential) base() string {
	return antigravityBase(beewire.AntigravityHostFor(c.Plan))
}

func antigravityBase(host string) string {
	return "https://" + strings.TrimSuffix(host, ":443")
}

// antigravityPlan names the market plan of an Antigravity tier, or "" for a
// tier Bee does not supply. Google has added finer tiers inside Pro and Ultra
// (g1-pro-plus-tier, g1-ultra-lite-tier), which keep their plan; an account
// without a tier is on the free one.
func antigravityPlan(tier string) string {
	tier = strings.ToLower(strings.TrimSpace(tier))
	switch {
	case tier == "" || tier == "free-tier":
		return "free"
	case strings.HasPrefix(tier, "g1-pro-") && strings.HasSuffix(tier, "-tier"):
		return "pro"
	case strings.HasPrefix(tier, "g1-ultra-") && strings.HasSuffix(tier, "-tier"):
		return "ultra"
	}
	return ""
}
