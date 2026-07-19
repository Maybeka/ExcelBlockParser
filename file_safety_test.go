package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestFile(t *testing.T, directory, name, content string) string {
	t.Helper()
	path := filepath.Join(directory, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
	return path
}

func TestFilePolicyApprovesOnlySelectedWorkbook(t *testing.T) {
	directory := t.TempDir()
	first := writeTestFile(t, directory, "first.xlsx", "first")
	second := writeTestFile(t, directory, "second.xlsx", "second")
	policy := &filePolicy{}

	if _, err := policy.approveWorkbook(first); err != nil {
		t.Fatalf("approve workbook: %v", err)
	}
	data, err := policy.readApprovedWorkbook(first)
	if err != nil || string(data) != "first" {
		t.Fatalf("read approved workbook = %q, %v", data, err)
	}
	if _, err := policy.readApprovedWorkbook(second); err == nil {
		t.Fatal("expected unapproved workbook to be rejected")
	}
}

func TestFilePolicyRejectsUnsupportedOrOversizedWorkbook(t *testing.T) {
	directory := t.TempDir()
	policy := &filePolicy{}
	if _, err := policy.approveWorkbook(writeTestFile(t, directory, "source.csv", "a,b")); err == nil {
		t.Fatal("expected unsupported extension to be rejected")
	}
	large := writeTestFile(t, directory, "large.xlsx", strings.Repeat("x", 10))
	if _, err := resolveRegularFile(large, 5, "Workbook"); err == nil {
		t.Fatal("expected oversized workbook to be rejected")
	}
}

func TestSanitizeJSONFileName(t *testing.T) {
	if actual := sanitizeJSONFileName("../../unsafe report", "session.json"); actual != "unsafe_report.json" {
		t.Fatalf("sanitize unsafe name = %q", actual)
	}
	if actual := sanitizeJSONFileName("report.JSON", "session.json"); actual != "report.JSON" {
		t.Fatalf("sanitize JSON name = %q", actual)
	}
	if actual := sanitizeJSONFileName("", "session.json"); actual != "session.json" {
		t.Fatalf("sanitize empty name = %q", actual)
	}
}

func TestJSONAndRecoveryValidation(t *testing.T) {
	directory := t.TempDir()
	valid := writeTestFile(t, directory, "session.json", `{"version":2}`)
	invalid := writeTestFile(t, directory, "invalid.json", `{`)
	if content, err := readJSONFile(valid, maxSessionBytes, "Session file"); err != nil || content != `{"version":2}` {
		t.Fatalf("read valid JSON = %q, %v", content, err)
	}
	if _, err := readJSONFile(invalid, maxSessionBytes, "Session file"); err == nil {
		t.Fatal("expected invalid JSON to be rejected")
	}
	if err := saveRecovery(directory, `{"blocks":[]}`); err != nil {
		t.Fatalf("save recovery: %v", err)
	}
	if content, err := loadRecovery(directory); err != nil || content != `{"blocks":[]}` {
		t.Fatalf("load recovery = %q, %v", content, err)
	}
	if err := clearRecovery(directory); err != nil {
		t.Fatalf("clear recovery: %v", err)
	}
	if content, err := loadRecovery(directory); err != nil || content != "" {
		t.Fatalf("load cleared recovery = %q, %v", content, err)
	}
}

func TestRecoveryAndExportRejectCorruptOrOversizedData(t *testing.T) {
	directory := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(recoveryFilePath(directory)), 0o755); err != nil {
		t.Fatalf("create recovery directory: %v", err)
	}
	if err := os.WriteFile(recoveryFilePath(directory), []byte("{"), 0o644); err != nil {
		t.Fatalf("write corrupt recovery: %v", err)
	}
	if _, err := loadRecovery(directory); err == nil {
		t.Fatal("expected corrupt recovery to be rejected")
	}
	if err := saveRecovery(directory, "{"); err == nil {
		t.Fatal("expected invalid recovery JSON to be rejected")
	}
	if err := writeJSONFile(filepath.Join(directory, "output.json"), "{"); err == nil {
		t.Fatal("expected invalid export JSON to be rejected")
	}
	oversized := writeTestFile(t, directory, "oversized.json", strings.Repeat("x", 6))
	if _, err := readJSONFile(oversized, 5, "Session file"); err == nil {
		t.Fatal("expected oversized session file to be rejected")
	}
}
