package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func artifactJSON(t *testing.T, artifacts []PythonArtifact) string {
	t.Helper()
	encoded, err := json.Marshal(artifacts)
	if err != nil {
		t.Fatalf("encode artifacts: %v", err)
	}
	return string(encoded)
}

func TestPythonArtifactsWriteNestedUTF8Files(t *testing.T) {
	directory := t.TempDir()
	encoded := artifactJSON(t, []PythonArtifact{
		{Path: "models/customer.py", Content: "class Customer:\n    pass\n", Encoding: "utf-8"},
		{Path: "schema.json", Content: `{"name":"客户"}`},
	})
	prepared, conflicts, err := preparePythonArtifacts(directory, encoded)
	if err != nil || conflicts != 0 || len(prepared) != 2 {
		t.Fatalf("prepare artifacts = %#v, %d, %v", prepared, conflicts, err)
	}
	if err := writePreparedPythonArtifacts(directory, prepared); err != nil {
		t.Fatalf("write artifacts: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(directory, "models", "customer.py"))
	if err != nil || string(content) != "class Customer:\n    pass\n" {
		t.Fatalf("generated Python = %q, %v", content, err)
	}
	content, err = os.ReadFile(filepath.Join(directory, "schema.json"))
	if err != nil || string(content) != `{"name":"客户"}` {
		t.Fatalf("generated JSON = %q, %v", content, err)
	}
}

func TestPythonArtifactsReportAndReplaceRegularFileConflicts(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "output.txt")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	prepared, conflicts, err := preparePythonArtifacts(directory, artifactJSON(t, []PythonArtifact{{Path: "output.txt", Content: "new"}}))
	if err != nil || conflicts != 1 {
		t.Fatalf("prepare conflict = %d, %v", conflicts, err)
	}
	if err := writePreparedPythonArtifacts(directory, prepared); err != nil {
		t.Fatalf("replace artifact: %v", err)
	}
	content, _ := os.ReadFile(target)
	if string(content) != "new" {
		t.Fatalf("replaced content = %q", content)
	}
}

func TestPythonArtifactsDoNotOverwriteFilesCreatedAfterConfirmation(t *testing.T) {
	directory := t.TempDir()
	prepared, conflicts, err := preparePythonArtifacts(directory, artifactJSON(t, []PythonArtifact{{Path: "output.txt", Content: "generated"}}))
	if err != nil || conflicts != 0 {
		t.Fatalf("prepare new artifact = %d, %v", conflicts, err)
	}
	target := filepath.Join(directory, "output.txt")
	if err := os.WriteFile(target, []byte("external"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writePreparedPythonArtifacts(directory, prepared); err == nil || !strings.Contains(err.Error(), "appeared after") {
		t.Fatalf("late conflict error = %v", err)
	}
	content, _ := os.ReadFile(target)
	if string(content) != "external" {
		t.Fatalf("late conflict was overwritten = %q", content)
	}
}

func TestPythonArtifactsRejectUnsafeAndDuplicatePaths(t *testing.T) {
	directory := t.TempDir()
	unsafePaths := []string{"../escape.py", "/absolute.py", `folder\file.py`, "a//b.py", "CON.txt", "folder/name. ", "C:/drive.py", "bad?.py"}
	for _, unsafePath := range unsafePaths {
		t.Run(strings.ReplaceAll(unsafePath, "/", "_"), func(t *testing.T) {
			_, _, err := preparePythonArtifacts(directory, artifactJSON(t, []PythonArtifact{{Path: unsafePath, Content: "x"}}))
			if err == nil {
				t.Fatalf("unsafe path %q was accepted", unsafePath)
			}
		})
	}
	_, _, err := preparePythonArtifacts(directory, artifactJSON(t, []PythonArtifact{
		{Path: "Result.py", Content: "first"},
		{Path: "result.py", Content: "second"},
	}))
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate error = %v", err)
	}
	_, _, err = preparePythonArtifacts(directory, `[{"path":"ok.py","content":"x","mode":"exec"}]`)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown field error = %v", err)
	}
}

func TestPythonArtifactsRejectSymlinkDestinationsAndParents(t *testing.T) {
	directory := t.TempDir()
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "target.py")
	if err := os.WriteFile(outsideFile, []byte("safe"), 0o644); err != nil {
		t.Fatal(err)
	}
	createTestSymlink(t, outside, filepath.Join(directory, "linked"))
	if _, _, err := preparePythonArtifacts(directory, artifactJSON(t, []PythonArtifact{{Path: "linked/output.py", Content: "unsafe"}})); err == nil {
		t.Fatal("symlink parent was accepted")
	}
	createTestSymlink(t, outsideFile, filepath.Join(directory, "output.py"))
	if _, _, err := preparePythonArtifacts(directory, artifactJSON(t, []PythonArtifact{{Path: "output.py", Content: "unsafe"}})); err == nil {
		t.Fatal("symlink destination was accepted")
	}
	content, _ := os.ReadFile(outsideFile)
	if string(content) != "safe" {
		t.Fatalf("symlink target changed = %q", content)
	}
}

func TestPythonArtifactsEnforceCountAndSizeLimits(t *testing.T) {
	directory := t.TempDir()
	many := make([]PythonArtifact, maxPythonArtifacts+1)
	for index := range many {
		many[index] = PythonArtifact{Path: "file-" + strings.Repeat("0", index%3) + string(rune('a'+index%26)) + ".txt", Content: "x"}
	}
	if _, _, err := preparePythonArtifacts(directory, artifactJSON(t, many)); err == nil || !strings.Contains(err.Error(), "file limit") {
		t.Fatalf("count limit error = %v", err)
	}
	large := strings.Repeat("x", maxPythonArtifactBytes+1)
	if _, _, err := preparePythonArtifacts(directory, artifactJSON(t, []PythonArtifact{{Path: "large.txt", Content: large}})); err == nil || !strings.Contains(err.Error(), "5 MB") {
		t.Fatalf("size limit error = %v", err)
	}
}
