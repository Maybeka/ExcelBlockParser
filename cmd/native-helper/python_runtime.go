package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"sync"
	"time"

	python "github.com/goccy/go-python"
)

const (
	maxPythonSourceBytes     = 2 * 1024 * 1024
	maxPythonProjectBytes    = 8 * 1024 * 1024
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

type PythonProjectFile struct {
	Path   string `json:"path"`
	Source string `json:"source"`
}

type PythonProjectPackage struct {
	EntryPath string              `json:"entryPath"`
	Files     []PythonProjectFile `json:"files"`
}

func normalizePythonProjectPath(value string) (string, bool) {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if value == "" || strings.HasPrefix(value, "/") || !strings.HasSuffix(value, ".py") { return "", false }
	clean := path.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || clean != value { return "", false }
	return clean, true
}

func validatePythonProjectPackage(project PythonProjectPackage) (PythonProjectPackage, error) {
	entryPath, ok := normalizePythonProjectPath(project.EntryPath)
	if !ok || len(project.Files) == 0 { return PythonProjectPackage{}, errors.New("Python package requires an entry Python file") }
	names := make(map[string]bool, len(project.Files))
	files := make([]PythonProjectFile, 0, len(project.Files))
	totalBytes := 0
	for _, file := range project.Files {
		filePath, valid := normalizePythonProjectPath(file.Path)
		if !valid || len(file.Source) > maxPythonSourceBytes { return PythonProjectPackage{}, fmt.Errorf("Python package contains an invalid file: %s", file.Path) }
		key := strings.ToLower(filePath)
		if names[key] { return PythonProjectPackage{}, fmt.Errorf("Python package contains duplicate file path: %s", filePath) }
		names[key] = true
		totalBytes += len(file.Source)
		if totalBytes > maxPythonProjectBytes { return PythonProjectPackage{}, fmt.Errorf("Python package exceeds the %d MB limit", maxPythonProjectBytes/(1024*1024)) }
		files = append(files, PythonProjectFile{Path: filePath, Source: file.Source})
	}
	if !names[strings.ToLower(entryPath)] { return PythonProjectPackage{}, errors.New("Python package entry file is missing") }
	return PythonProjectPackage{EntryPath: entryPath, Files: files}, nil
}

type pythonRuntimeRunner struct {
	mu          sync.Mutex
	interrupter *python.Interrupter
	running     bool
}

func (r *pythonRuntimeRunner) begin() (*python.Interpreter, error) {
	return r.beginWithFS(nil)
}

func (r *pythonRuntimeRunner) beginWithProjectFiles(files []PythonProjectFile) (*python.Interpreter, error) {
	fSys, err := python.NewStdlibMemFS()
	if err != nil { return nil, fmt.Errorf("prepare isolated Python filesystem: %w", err) }
	for _, file := range files {
		filePath := "/project/" + file.Path
		if err := fSys.MkdirAll(path.Dir(filePath), 0o755); err != nil { return nil, fmt.Errorf("prepare Python project directory: %w", err) }
		if err := fSys.WriteFile(filePath, []byte(file.Source), 0o644); err != nil { return nil, fmt.Errorf("prepare Python project file: %w", err) }
	}
	return r.beginWithFS(fSys)
}

func (r *pythonRuntimeRunner) beginWithFS(fSys *python.MemFS) (*python.Interpreter, error) {
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
	if fSys == nil {
		var err error
		fSys, err = python.NewStdlibMemFS()
		if err != nil { return fail(fmt.Errorf("prepare isolated Python filesystem: %w", err)) }
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

func (r *pythonRuntimeRunner) RunProject(project PythonProjectPackage, contextJSON string) (result PythonProjectResult) {
	started := time.Now()
	defer func() { result.DurationMS = time.Since(started).Milliseconds() }()
	project, err := validatePythonProjectPackage(project)
	if err != nil {
		result.HostError = err.Error()
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

	encodedContext, _ := json.Marshal(contextJSON)
	entryModule := strings.ReplaceAll(strings.TrimSuffix(project.EntryPath, ".py"), "/", ".")
	encodedEntryModule, _ := json.Marshal(entryModule)
	wrapper := fmt.Sprintf(`
import json as __ebp_json
import sys as __ebp_sys
__ebp_context = __ebp_json.loads(%s)
__ebp_sys.path.insert(0, "/project")
__ebp_entry_module = __import__(%s, fromlist=["process"])
__ebp_entry = getattr(__ebp_entry_module, "process", None)
if not callable(__ebp_entry):
    raise TypeError("Python package entry file must define callable process(context)")
__ebp_result = __ebp_entry(__ebp_context)
__ebp_result_json = __ebp_json.dumps(__ebp_result, ensure_ascii=False, allow_nan=False)
`, encodedContext, encodedEntryModule)

	interpreter, err := r.beginWithProjectFiles(project.Files)
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
