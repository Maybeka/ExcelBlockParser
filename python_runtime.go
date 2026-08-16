package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	python "github.com/goccy/go-python"
)

const (
	maxPythonSourceBytes     = 256 * 1024
	maxPythonContextBytes    = 25 * 1024 * 1024
	maxPythonResultBytes     = 32 * 1024 * 1024
	maxPythonOutputBytes     = 1 * 1024 * 1024
	pythonRuntimeMemoryBytes = 128 * 1024 * 1024
)

var errPythonRuntimeBusy = errors.New("another Python run is already active")

type pythonEvalResult struct {
	OK         bool   `json:"ok"`
	Repr       string `json:"repr"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	Error      string `json:"error"`
	HostError  string `json:"hostError"`
	DurationMS int64  `json:"durationMs"`
}

type PythonProjectResult struct {
	OK         bool   `json:"ok"`
	ResultJSON string `json:"resultJson"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	Error      string `json:"error"`
	HostError  string `json:"hostError"`
	DurationMS int64  `json:"durationMs"`
}

type pythonRuntimeRunner struct {
	mu          sync.Mutex
	interrupter *python.Interrupter
	running     bool
}

func (r *pythonRuntimeRunner) begin() (*python.Interpreter, error) {
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return nil, errPythonRuntimeBusy
	}
	r.running = true
	r.mu.Unlock()

	fail := func(err error) (*python.Interpreter, error) {
		r.mu.Lock()
		r.running = false
		r.mu.Unlock()
		return nil, err
	}
	fSys, err := python.NewStdlibMemFS()
	if err != nil {
		return fail(fmt.Errorf("prepare isolated Python filesystem: %w", err))
	}
	interpreter, err := python.NewInterpreter(python.Config{
		FS:             fSys,
		Env:            []string{"PYTHONUTF8=1"},
		MaxMemoryBytes: pythonRuntimeMemoryBytes,
		NetAccess:      func(string) bool { return false },
		Resolve:        func(string) bool { return false },
		Dial:           func(string, string, int) bool { return false },
		Exec:           func(string, []string) bool { return false },
	})
	if err != nil {
		return fail(fmt.Errorf("start embedded Python: %w", err))
	}
	interrupter, err := interpreter.PrepareInterrupt()
	if err != nil {
		_ = interpreter.Close()
		return fail(fmt.Errorf("prepare Python cancellation: %w", err))
	}
	r.mu.Lock()
	r.interrupter = interrupter
	r.mu.Unlock()
	return interpreter, nil
}

func (r *pythonRuntimeRunner) finish(interpreter *python.Interpreter) {
	r.mu.Lock()
	r.interrupter = nil
	r.running = false
	r.mu.Unlock()
	_ = interpreter.Close()
}

func (r *pythonRuntimeRunner) Eval(source string) (result pythonEvalResult) {
	started := time.Now()
	defer func() { result.DurationMS = time.Since(started).Milliseconds() }()

	if len(source) > maxPythonSourceBytes {
		result.HostError = fmt.Sprintf("Python source exceeds the %d KB limit.", maxPythonSourceBytes/1024)
		return result
	}

	interpreter, err := r.begin()
	if err != nil {
		result.HostError = err.Error()
		return result
	}
	defer r.finish(interpreter)

	evaluation, err := interpreter.Eval(source)
	if err != nil {
		result.HostError = fmt.Sprintf("embedded Python runtime failure: %v", err)
		return result
	}

	result.OK = evaluation.Ok
	result.Repr = evaluation.Repr
	result.Stdout = evaluation.Stdout
	result.Stderr = evaluation.Stderr
	result.Error = evaluation.Error
	if len(result.Stdout)+len(result.Stderr) > maxPythonOutputBytes {
		result.HostError = "Python output exceeds the 1 MB limit."
		return result
	}
	return result
}

func (r *pythonRuntimeRunner) RunProject(source string, contextJSON string) (result PythonProjectResult) {
	started := time.Now()
	defer func() { result.DurationMS = time.Since(started).Milliseconds() }()
	if len(source) > maxPythonSourceBytes {
		result.HostError = fmt.Sprintf("Python source exceeds the %d KB limit.", maxPythonSourceBytes/1024)
		return result
	}
	if len(contextJSON) > maxPythonContextBytes {
		result.HostError = "Python context exceeds the 25 MB limit."
		return result
	}
	if !json.Valid([]byte(contextJSON)) {
		result.HostError = "Python context is not valid JSON."
		return result
	}

	encodedSource, _ := json.Marshal(source)
	encodedContext, _ := json.Marshal(contextJSON)
	wrapper := fmt.Sprintf(`
import json as __ebp_json
__ebp_context = __ebp_json.loads(%s)
__ebp_namespace = {"__builtins__": __builtins__, "__name__": "__project_script__"}
exec(compile(%s, "<project-script>", "exec"), __ebp_namespace)
__ebp_entry = __ebp_namespace.get("process")
if not callable(__ebp_entry):
    raise TypeError("Project script must define callable process(context)")
__ebp_result = __ebp_entry(__ebp_context)
__ebp_result_json = __ebp_json.dumps(__ebp_result, ensure_ascii=False, allow_nan=False)
`, encodedContext, encodedSource)

	interpreter, err := r.begin()
	if err != nil {
		result.HostError = err.Error()
		return result
	}
	defer r.finish(interpreter)

	evaluation, err := interpreter.Eval(wrapper)
	if err != nil {
		result.HostError = fmt.Sprintf("embedded Python runtime failure: %v", err)
		return result
	}
	result.Stdout = evaluation.Stdout
	result.Stderr = evaluation.Stderr
	result.Error = evaluation.Error
	if !evaluation.Ok {
		return result
	}
	encodedResult, err := interpreter.Eval("print(__ebp_result_json)")
	if err != nil {
		result.HostError = fmt.Sprintf("read Python result: %v", err)
		return result
	}
	if !encodedResult.Ok {
		result.Error = encodedResult.Error
		result.Stderr += encodedResult.Stderr
		return result
	}
	if len(encodedResult.Stdout) > maxPythonResultBytes {
		result.HostError = "Python result exceeds the 32 MB limit."
		return result
	}
	result.ResultJSON = encodedResult.Stdout
	if !json.Valid([]byte(result.ResultJSON)) {
		result.HostError = "Python returned invalid JSON."
		return result
	}
	result.OK = true
	return result
}

func (r *pythonRuntimeRunner) Cancel() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.interrupter == nil {
		return false
	}
	r.interrupter.Fire()
	return true
}
