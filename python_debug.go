package main

import (
	"errors"
	"fmt"
	"sync"
	"time"

	python "github.com/goccy/go-python"
)

const (
	maxPythonDebugSourceBytes = 256 * 1024
	pythonDebugMemoryBytes    = 128 * 1024 * 1024
)

var errPythonDebugBusy = errors.New("another Python debug run is already active")

type PythonDebugResult struct {
	OK         bool   `json:"ok"`
	Repr       string `json:"repr"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	Error      string `json:"error"`
	HostError  string `json:"hostError"`
	DurationMS int64  `json:"durationMs"`
}

type pythonDebugRunner struct {
	mu          sync.Mutex
	interrupter *python.Interrupter
	running     bool
}

func (r *pythonDebugRunner) Run(source string) (result PythonDebugResult) {
	started := time.Now()
	defer func() { result.DurationMS = time.Since(started).Milliseconds() }()

	if len(source) > maxPythonDebugSourceBytes {
		result.HostError = fmt.Sprintf("Python source exceeds the %d KB debug limit.", maxPythonDebugSourceBytes/1024)
		return result
	}

	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		result.HostError = errPythonDebugBusy.Error()
		return result
	}
	r.running = true
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		r.interrupter = nil
		r.running = false
		r.mu.Unlock()
	}()

	fsys, err := python.NewStdlibMemFS()
	if err != nil {
		result.HostError = fmt.Sprintf("prepare isolated Python filesystem: %v", err)
		return result
	}

	interpreter, err := python.NewInterpreter(python.Config{
		FS:             fsys,
		Env:            []string{"PYTHONUTF8=1"},
		MaxMemoryBytes: pythonDebugMemoryBytes,
		NetAccess:      func(string) bool { return false },
		Resolve:        func(string) bool { return false },
		Dial:           func(string, string, int) bool { return false },
		Exec:           func(string, []string) bool { return false },
	})
	if err != nil {
		result.HostError = fmt.Sprintf("start embedded Python: %v", err)
		return result
	}
	defer interpreter.Close()

	interrupter, err := interpreter.PrepareInterrupt()
	if err != nil {
		result.HostError = fmt.Sprintf("prepare Python cancellation: %v", err)
		return result
	}
	r.mu.Lock()
	r.interrupter = interrupter
	r.mu.Unlock()

	evaluation, err := interpreter.Eval(source)
	r.mu.Lock()
	r.interrupter = nil
	r.mu.Unlock()
	if err != nil {
		result.HostError = fmt.Sprintf("embedded Python runtime failure: %v", err)
		return result
	}

	result.OK = evaluation.Ok
	result.Repr = evaluation.Repr
	result.Stdout = evaluation.Stdout
	result.Stderr = evaluation.Stderr
	result.Error = evaluation.Error
	return result
}

func (r *pythonDebugRunner) Cancel() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.interrupter == nil {
		return false
	}
	r.interrupter.Fire()
	return true
}
