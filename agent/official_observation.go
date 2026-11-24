package bee

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// officialObservationTransport keeps safe evidence of an official request that
// failed, so the caller's error names the endpoint, status and redacted body.
type officialObservationTransport struct {
	base    http.RoundTripper
	failure error
}

func (t *officialObservationTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	t.failure = nil
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	res, err := base.RoundTrip(r)
	if err != nil {
		t.failure = &safeTransportFailure{cause: err, message: fmt.Sprintf("official request %s %s received no HTTP response: %s", r.Method, r.URL.Scheme+"://"+r.URL.Host+r.URL.Path, safeText(err.Error(), token))}
		return nil, t.failure
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, readErr := io.ReadAll(io.LimitReader(res.Body, 65537))
		original := res.Body
		res.Body = &evidenceReadCloser{Reader: io.MultiReader(bytes.NewReader(body), original), Closer: original}
		t.failure = fmt.Errorf("official request %s %s: HTTP %d; required=HTTP 2xx; response_body=%s", r.Method, r.URL.Scheme+"://"+r.URL.Host+r.URL.Path, res.StatusCode, safeResponseBody(body, token))
		if readErr != nil {
			t.failure = errors.Join(t.failure, fmt.Errorf("read official error response: %w", readErr))
		}
	}
	return res, nil
}

type evidenceReadCloser struct {
	io.Reader
	io.Closer
}

func observedOfficialTransport(base http.RoundTripper) *officialObservationTransport {
	if existing, ok := base.(*officialObservationTransport); ok {
		return existing
	}
	return &officialObservationTransport{base: base}
}

// finishOfficialFailure joins the observed request evidence to the caller's failure.
func finishOfficialFailure(observed *officialObservationTransport, failure error) error {
	if failure == nil || observed.failure == nil || strings.Contains(failure.Error(), observed.failure.Error()) {
		return failure
	}
	return errors.Join(failure, observed.failure)
}
