package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func pythonProject(entry string, files ...PythonProjectFile) PythonProjectPackage {
	return PythonProjectPackage{EntryPath: entry, Files: files}
}

func TestPythonRuntimeCapturesOutputAndResult(t *testing.T) {
	runner := &pythonRuntimeRunner{}
	result := runner.Eval("print('hello from python')\n1 + 2")
	if !result.OK || result.HostError != "" || result.Error != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Stdout != "hello from python\n" {
		t.Fatalf("unexpected output: %#v", result)
	}
}

func TestPythonProjectRunnerReceivesDataAndReturnsJSON(t *testing.T) {
	runner := &pythonRuntimeRunner{}
	contextJSON := `{"contractVersion":1,"project":{"name":"Demo"},"data":{"records":[{"value":7}]},"blockResults":[],"regionResults":[]}`
	result := runner.RunProject(pythonProject("main.py", PythonProjectFile{Path: "main.py", Source: `
def process(context):
    print("processing", context["project"]["name"])
    return {"doubled": context["data"]["records"][0]["value"] * 2}
`}), contextJSON)
	if !result.OK || result.HostError != "" || result.Error != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if !strings.Contains(result.Stdout, "processing Demo") {
		t.Fatalf("missing script output: %#v", result)
	}
	var value map[string]int
	if err := json.Unmarshal([]byte(result.ResultJSON), &value); err != nil || value["doubled"] != 14 {
		t.Fatalf("unexpected JSON result: %q (%v)", result.ResultJSON, err)
	}
}

func TestPythonProjectRunnerRequiresProcessEntryPoint(t *testing.T) {
	result := (&pythonRuntimeRunner{}).RunProject(pythonProject("main.py", PythonProjectFile{Path: "main.py", Source: "value = 1"}), `{}`)
	if result.OK || !strings.Contains(result.Error, "process(context)") || result.HostError != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestPythonProjectRunnerRejectsNonJSONResult(t *testing.T) {
	result := (&pythonRuntimeRunner{}).RunProject(pythonProject("main.py", PythonProjectFile{Path: "main.py", Source: "def process(context):\n    return {1, 2}"}), `{}`)
	if result.OK || !strings.Contains(result.Error, "JSON serializable") || result.HostError != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestPythonProjectRunnerImportsProjectModules(t *testing.T) {
	result := (&pythonRuntimeRunner{}).RunProject(pythonProject("main.py",
		PythonProjectFile{Path: "main.py", Source: "from generators.formatting import multiply\n\ndef process(context):\n    return {\"value\": multiply(context[\"value\"])}"},
		PythonProjectFile{Path: "generators/formatting.py", Source: "def multiply(value):\n    return value * 3"},
	), `{"value": 7}`)
	if !result.OK || result.Error != "" || result.HostError != "" || !strings.Contains(result.ResultJSON, `"value": 21`) {
		t.Fatalf("project module import failed: %#v", result)
	}
}

func TestPythonProjectRunnerRejectsUnsafeProjectPaths(t *testing.T) {
	result := (&pythonRuntimeRunner{}).RunProject(pythonProject("../main.py", PythonProjectFile{Path: "../main.py", Source: "def process(context): return {}"}), `{}`)
	if result.OK || !strings.Contains(result.HostError, "entry Python file") {
		t.Fatalf("unsafe project path accepted: %#v", result)
	}
}

func TestPythonRuntimeReportsPythonExceptions(t *testing.T) {
	result := (&pythonRuntimeRunner{}).Eval("raise ValueError('bad input')")
	if result.OK || !strings.Contains(result.Error, "ValueError: bad input") || result.HostError != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestPythonRuntimeHasNoHostFilesystem(t *testing.T) {
	result := (&pythonRuntimeRunner{}).Eval("open('/etc/passwd').read()")
	if result.OK || result.HostError != "" || result.Error == "" {
		t.Fatalf("host file unexpectedly accessible: %#v", result)
	}
}

func TestPythonRuntimeCanCancelLoop(t *testing.T) {
	runner := &pythonRuntimeRunner{}
	done := make(chan pythonEvalResult, 1)
	go func() { done <- runner.Eval("while True:\n    pass") }()

	deadline := time.Now().Add(3 * time.Second)
	for !runner.Cancel() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}

	select {
	case result := <-done:
		if result.OK || !strings.Contains(result.Error, "KeyboardInterrupt") {
			t.Fatalf("unexpected cancellation result: %#v", result)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Python debug run did not stop after cancellation")
	}
}
