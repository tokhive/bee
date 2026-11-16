package bee

// Adapter for pre-protocol failure fixtures. Direct wire and real Hive tests
// exercise the recovery contract; this preserves the older storage fault hooks.
import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"

	"github.com/tokhive/bee/beewire"
)

func newPairingFixtureServer(legacy http.Handler) *httptest.Server {
	type fixture struct {
		input            beewire.PairingAttempt
		pair             beewire.Pairing
		identity         *beewire.Identity
		advanced, closed bool
	}
	var mu sync.Mutex
	records := map[string]*fixture{}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == beewire.PairingRecoveryCapabilitiesPath {
			json.NewEncoder(w).Encode(map[string]int{"version": 1, "pairing_recovery": 1})
			return
		}
		if r.URL.Path == beewire.PairingLegacyPath || r.URL.Path == beewire.PairingLegacyPath+"/close" {
			id := ""
			state := "unknown"
			if r.Method == "POST" {
				var in struct {
					ID string `json:"id"`
				}
				json.NewDecoder(r.Body).Decode(&in)
				id = in.ID
				state = "closed"
			}
			json.NewEncoder(w).Encode(beewire.PairingRecoveryStatus{Version: 1, AttemptID: id, State: state, Blockers: []beewire.PairingBlocker{}, ObservedAt: time.Now()})
			return
		}
		if !strings.HasPrefix(r.URL.Path, beewire.PairingRecoveryPath) {
			legacy.ServeHTTP(w, r)
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, beewire.PairingRecoveryPath), "/")
		id := parts[0]
		action := ""
		if len(parts) > 1 {
			action = parts[1]
		}
		secret := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		key := secret + id
		invoke := func(method, path, auth string, body []byte) *httptest.ResponseRecorder {
			req := r.Clone(r.Context())
			req.Method = method
			req.URL.Path = path
			req.Header = r.Header.Clone()
			req.Header.Del("Authorization")
			if auth != "" {
				req.Header.Set("Authorization", "Bearer "+auth)
			}
			req.Body = http.NoBody
			if body != nil {
				req.Body = ioNop(body)
			}
			result := httptest.NewRecorder()
			legacy.ServeHTTP(result, req)
			return result
		}
		forward := func(result *httptest.ResponseRecorder) { w.WriteHeader(result.Code); w.Write(result.Body.Bytes()) }
		mu.Lock()
		f := records[key]
		mu.Unlock()
		if action == "begin" && f == nil {
			var input beewire.PairingAttempt
			json.NewDecoder(r.Body).Decode(&input)
			digest := sha256.Sum256([]byte(secret))
			raw, _ := json.Marshal(beewire.StartPairing{Name: input.Name, CredentialHash: hex.EncodeToString(digest[:])})
			result := invoke("POST", "/api/bee/pairings", "", raw)
			if result.Code >= 300 {
				forward(result)
				return
			}
			var pair beewire.Pairing
			if json.Unmarshal(result.Body.Bytes(), &pair) != nil {
				forward(result)
				return
			}
			f = &fixture{input: input, pair: pair}
			mu.Lock()
			records[key] = f
			mu.Unlock()
		} else if f == nil {
			w.WriteHeader(404)
			w.Write([]byte(`{"error":{"code":"pairing_attempt_not_found"}}`))
			return
		}
		out := beewire.PairingRecoveryStatus{Version: 1, AttemptID: id, State: "pending", Pairing: &f.pair, Blockers: []beewire.PairingBlocker{}, ObservedAt: time.Now()}
		if action == "close" || action == "cancel" {
			f.closed = true
		}
		if f.closed {
			out.State = "closed"
		} else if f.identity != nil {
			out.State = "completed"
			out.Identity = f.identity
		} else if action != "begin" {
			if action == "advance" {
				if f.advanced {
					res := invoke("GET", "/api/bee/identity", secret, nil)
					if res.Code != 200 {
						forward(res)
						return
					}
					var identity beewire.Identity
					json.Unmarshal(res.Body.Bytes(), &identity)
					f.identity = &identity
					out.State = "completed"
					out.Identity = &identity
					json.NewEncoder(w).Encode(out)
					return
				}
				f.advanced = true
				res := invoke("POST", "/api/bee/pairings/redeem", f.pair.PairingToken, []byte(`{}`))
				if res.Code == 409 && strings.Contains(res.Body.String(), "device_draining") {
					f.advanced = false
					out.State = "draining"
					json.NewEncoder(w).Encode(out)
					return
				}
				if res.Code >= 300 || json.Unmarshal(res.Body.Bytes(), &beewire.Identity{}) != nil {
					forward(res)
					return
				}
				var identity beewire.Identity
				json.Unmarshal(res.Body.Bytes(), &identity)
				f.identity = &identity
				out.State = "completed"
				out.Identity = &identity
			} else {
				if f.advanced {
					res := invoke("GET", "/api/bee/identity", secret, nil)
					if res.Code == 200 {
						var identity beewire.Identity
						if json.Unmarshal(res.Body.Bytes(), &identity) == nil {
							f.identity = &identity
							out.State = "completed"
							out.Identity = &identity
						}
					}
				}
				if out.Identity == nil && f.advanced {
					w.WriteHeader(503)
					w.Write([]byte(`{"error":{"code":"unavailable"}}`))
					return
				}
				if out.Identity == nil {
					res := invoke("GET", "/api/bee/pairings", f.pair.PairingToken, nil)
					if res.Code == 410 {
						out.State = "expired"
					} else if res.Code >= 300 {
						forward(res)
						return
					} else {
						var pair beewire.Pairing
						json.Unmarshal(res.Body.Bytes(), &pair)
						out.State = pair.Status
					}
				}
			}
		}
		if out.State == "" {
			out.State = "pending"
		}
		json.NewEncoder(w).Encode(out)
	}))
}
func ioNop(raw []byte) *fixtureBody { return &fixtureBody{bytes.NewReader(raw)} }

type fixtureBody struct{ *bytes.Reader }

func (*fixtureBody) Close() error { return nil }
