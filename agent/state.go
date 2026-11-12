package bee

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/tokhive/bee/beewire"
)

type localState struct {
	RuntimeEpoch string            `json:"runtime_epoch,omitempty"`
	Hive         string            `json:"hive"`
	Name         string            `json:"name"`
	Credential   string            `json:"credential"`
	Pairing      *beewire.Pairing  `json:"pairing,omitempty"`
	Identity     *beewire.Identity `json:"identity,omitempty"`
}

func readState(path string) (localState, error) {
	var state localState
	file, err := openRegularNoFollow(path)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, failCause("BEE-DEVICE-CONFIG", fmt.Errorf("open device configuration %s: %w", path, err))
	}
	defer file.Close()
	if err := validatePrivateFile(file); err != nil {
		return state, failCause("BEE-DEVICE-CONFIG", fmt.Errorf("check device configuration protection %s: %w", path, err))
	}
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	var decoded *localState
	if err = decoder.Decode(&decoded); err != nil {
		return state, failCause("BEE-DEVICE-CONFIG", fmt.Errorf("decode device configuration %s: %w", path, err))
	}
	if decoded == nil {
		return state, failf("BEE-DEVICE-CONFIG", "%s: expected a JSON object, got null", path)
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return state, failf("BEE-DEVICE-CONFIG", "%s: extra content after the device JSON object at byte %d; keep exactly one JSON object", path, decoder.InputOffset())
	}
	if decoded.RuntimeEpoch != "" && !desktopHexID(decoded.RuntimeEpoch, 24) {
		return state, failf("BEE-DEVICE-CONFIG", "%s: Bee runtime epoch rejected: bytes=%d; required=48 lowercase hex characters", path, len(decoded.RuntimeEpoch))
	}
	return *decoded, nil
}

func saveState(path string, state localState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode Bee configuration: %w", err)
	}
	if err := writePrivateFile(path, append(data, '\n'), ".bee-*"); err != nil {
		return fmt.Errorf("save Bee configuration: %w", err)
	}
	return nil
}
