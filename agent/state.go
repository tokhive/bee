package bee

import (
	"encoding/json"
	"errors"
	"fmt"
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
		return state, fmt.Errorf("open Bee configuration: %w", err)
	}
	defer file.Close()
	if err := validatePrivateFile(file); err != nil {
		return state, fmt.Errorf("check Bee configuration protection: %w", err)
	}
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&state); err != nil {
		return localState{}, fmt.Errorf("decode Bee configuration %q: %w", path, err)
	}
	if state.RuntimeEpoch != "" && !desktopHexID(state.RuntimeEpoch, 24) {
		return localState{}, fmt.Errorf("Bee runtime epoch rejected: bytes=%d; required=48 lowercase hex characters", len(state.RuntimeEpoch))
	}
	return state, nil
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
