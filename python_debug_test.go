package main

import (
	"strings"
	"testing"
	"time"
)

func TestPythonDebugRunnerCapturesOutputAndResult(t *testing.T) {
	runner := &pythonDebugRunner{}
	result := runner.Run("print('hello from python')\n1 + 2")
	if !result.OK || result.HostError != "" || result.Error != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Stdout != "hello from python\n" {
		t.Fatalf("unexpected output: %#v", result)
	}
}

func TestPythonDebugRunnerReportsPythonExceptions(t *testing.T) {
	result := (&pythonDebugRunner{}).Run("raise ValueError('bad input')")
	if result.OK || !strings.Contains(result.Error, "ValueError: bad input") || result.HostError != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestPythonDebugRunnerHasNoHostFilesystem(t *testing.T) {
	result := (&pythonDebugRunner{}).Run("open('/etc/passwd').read()")
	if result.OK || result.HostError != "" || result.Error == "" {
		t.Fatalf("host file unexpectedly accessible: %#v", result)
	}
}

func TestPythonDebugRunnerCanCancelLoop(t *testing.T) {
	runner := &pythonDebugRunner{}
	done := make(chan PythonDebugResult, 1)
	go func() { done <- runner.Run("while True:\n    pass") }()

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
