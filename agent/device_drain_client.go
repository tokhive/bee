package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/tokhive/bee/beewire"
)

var ErrDeviceDrainUnsupported = errors.New("Hive device-drain capability is unsupported")

// DeviceDrainHTTPError keeps the HTTP evidence for query retry policy. Its body
// has already had credentials, URL credentials and query parameters removed.
type DeviceDrainHTTPError struct {
	Status int
	Code   string
	Body   string
}

type deviceDrainRequestError struct {
	message string
	cause   error
}

func (e *deviceDrainRequestError) Error() string { return e.message }
func (e *deviceDrainRequestError) Unwrap() error { return e.cause }

func (e *DeviceDrainHTTPError) Error() string {
	return fmt.Sprintf("device-drain HTTP rejected: status=%d code=%s body=%s", e.Status, e.Code, e.Body)
}

type DeviceDrainClientConfig struct {
	Origin     string
	Credential string
	DeviceID   string
	OwnerID    string
	HTTPClient *http.Client
}

// DeviceDrainClient is bound to one saved device and origin. It never mutates
// local state, refreshes identity, retries writes, or follows redirects.
type DeviceDrainClient struct {
	config    DeviceDrainClientConfig
	origin    string
	http      *http.Client
	mu        sync.Mutex
	supported bool
}

func NewDeviceDrainClient(config DeviceDrainClientConfig) (*DeviceDrainClient, error) {
	origin, err := beewire.CanonicalHiveOrigin(config.Origin)
	if err != nil {
		return nil, err
	}
	if !deviceCredentialPattern.MatchString(config.Credential) {
		return nil, fmt.Errorf("device-drain credential format rejected: bytes=%d; required=Bee device credential; secret omitted", len(config.Credential))
	}
	probe := beewire.DeviceDrainRequest{ID: strings.Repeat("0", 48), DeviceID: config.DeviceID, OwnerID: config.OwnerID, Origin: config.Origin}
	if err := probe.Validate(); err != nil {
		return nil, err
	}
	client := httpClient()
	if config.HTTPClient != nil {
		copy := *config.HTTPClient
		client = &copy
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &DeviceDrainClient{config: config, origin: origin, http: client}, nil
}
func (c *DeviceDrainClient) Capabilities(ctx context.Context) (beewire.DeviceDrainCapabilities, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	result, err := c.capabilities(ctx)
	c.supported = err == nil
	return result, err
}
func (c *DeviceDrainClient) capabilities(ctx context.Context) (beewire.DeviceDrainCapabilities, error) {
	raw, err := c.call(ctx, beewire.DeviceDrainCapabilitiesPath, http.MethodGet, nil)
	if err != nil {
		var failure *DeviceDrainHTTPError
		if errors.As(err, &failure) && (failure.Status == 404 || failure.Status == 405 || failure.Status == 501) {
			return beewire.DeviceDrainCapabilities{}, fmt.Errorf("%w: %w", ErrDeviceDrainUnsupported, err)
		}
		return beewire.DeviceDrainCapabilities{}, err
	}
	result, err := beewire.DecodeDeviceDrainCapabilities(raw)
	if err != nil {
		return result, fmt.Errorf("device-drain capability response: %w", err)
	}
	if result.DeviceDrain != beewire.DeviceDrainVersion {
		return result, fmt.Errorf("%w: actual=%d required=1", ErrDeviceDrainUnsupported, result.DeviceDrain)
	}
	return result, nil
}
func (c *DeviceDrainClient) requireCapability(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.supported {
		return nil
	}
	if _, err := c.capabilities(ctx); err != nil {
		return err
	}
	c.supported = true
	return nil
}
func (c *DeviceDrainClient) checkRequest(request beewire.DeviceDrainRequest) error {
	if err := request.Validate(); err != nil {
		return err
	}
	if request.Origin != c.config.Origin || request.DeviceID != c.config.DeviceID || request.OwnerID != c.config.OwnerID {
		return fmt.Errorf("device-drain client binding rejected: origin_match=%t device_match=%t owner_match=%t; required=original saved binding", request.Origin == c.config.Origin, request.DeviceID == c.config.DeviceID, request.OwnerID == c.config.OwnerID)
	}
	return nil
}
func (c *DeviceDrainClient) operation(ctx context.Context, request beewire.DeviceDrainRequest, action, method string, input any) (beewire.DeviceDrainStatus, error) {
	var zero beewire.DeviceDrainStatus
	if err := c.checkRequest(request); err != nil {
		return zero, err
	}
	if err := c.requireCapability(ctx); err != nil {
		return zero, err
	}
	raw, err := c.call(ctx, beewire.DeviceDrainOperationsPath+request.ID+action, method, input)
	if err != nil {
		return zero, err
	}
	status, err := beewire.DecodeDeviceDrainStatus(raw)
	if err == nil {
		err = status.ValidateFor(request)
	}
	if err != nil {
		return zero, fmt.Errorf("device-drain original operation response: %w", err)
	}
	return status, nil
}
func (c *DeviceDrainClient) Begin(ctx context.Context, request beewire.DeviceDrainRequest) (beewire.DeviceDrainStatus, error) {
	status, err := c.operation(ctx, request, "/begin", http.MethodPost, request)
	if err == nil && status.State == "absent" {
		return beewire.DeviceDrainStatus{}, fmt.Errorf("device-drain begin result rejected: state=absent; required=persisted original operation or cancellation tombstone")
	}
	return status, err
}
func (c *DeviceDrainClient) Status(ctx context.Context, request beewire.DeviceDrainRequest) (beewire.DeviceDrainStatus, error) {
	return c.operation(ctx, request, "", http.MethodGet, nil)
}
func (c *DeviceDrainClient) Seal(ctx context.Context, request beewire.DeviceDrainSealRequest) (beewire.DeviceDrainStatus, error) {
	if err := request.Validate(); err != nil {
		return beewire.DeviceDrainStatus{}, err
	}
	status, err := c.operation(ctx, request.Request, "/seal", http.MethodPost, request)
	if err == nil && (status.Seal == nil || *status.Seal != request) {
		return beewire.DeviceDrainStatus{}, fmt.Errorf("device-drain seal result rejected: original_action_match=false; required=persisted seal request")
	}
	return status, err
}
func (c *DeviceDrainClient) Release(ctx context.Context, request beewire.DeviceDrainReleaseRequest) (beewire.DeviceDrainStatus, error) {
	if err := request.Validate(); err != nil {
		return beewire.DeviceDrainStatus{}, err
	}
	status, err := c.operation(ctx, request.Request, "/release", http.MethodPost, request)
	if err == nil && (status.Release == nil || *status.Release != request) {
		return beewire.DeviceDrainStatus{}, fmt.Errorf("device-drain release result rejected: original_action_match=false; required=persisted release request")
	}
	return status, err
}

var drainCredentialText = regexp.MustCompile(`(?:bee_|beep_)[A-Za-z0-9_-]+`)
var drainErrorCode = regexp.MustCompile(`^[a-z][a-z0-9_]{0,127}$`)

func (c *DeviceDrainClient) safeError(err error) string {
	return drainCredentialText.ReplaceAllString(connectionMessage(err, c.config.Credential), "[redacted]")
}
func (c *DeviceDrainClient) call(ctx context.Context, path, method string, input any) ([]byte, error) {
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return nil, fmt.Errorf("device-drain request encoding failed: %s", c.safeError(err))
		}
		body = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.origin+path, body)
	if err != nil {
		return nil, fmt.Errorf("device-drain HTTP request construction failed: %s", c.safeError(err))
	}
	request.Header.Set("Authorization", "Bearer "+c.config.Credential)
	request.Header.Set("X-Hive-Request", "1")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", userAgent())
	response, err := c.http.Do(request)
	if err != nil {
		return nil, &deviceDrainRequestError{message: fmt.Sprintf("device-drain %s %s transport failed: %s", method, path, c.safeError(err)), cause: err}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, beewire.DeviceDrainMaxBody+1))
	if err != nil {
		return nil, &deviceDrainRequestError{message: fmt.Sprintf("device-drain HTTP body read failed: status=%d: %s", response.StatusCode, c.safeError(err)), cause: err}
	}
	if len(raw) > beewire.DeviceDrainMaxBody {
		return nil, fmt.Errorf("device-drain HTTP body rejected: status=%d bytes_exceed=%d; maximum=%d", response.StatusCode, len(raw), beewire.DeviceDrainMaxBody)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var envelope struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &envelope)
		code := "unrecognized_code"
		if drainErrorCode.MatchString(envelope.Error.Code) && c.safeError(errors.New(envelope.Error.Code)) == envelope.Error.Code {
			code = envelope.Error.Code
		}
		return nil, &DeviceDrainHTTPError{Status: response.StatusCode, Code: code, Body: c.safeError(errors.New(string(raw)))}
	}
	return raw, nil
}
