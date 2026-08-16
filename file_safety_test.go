package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func writeTestFile(t *testing.T, directory, name, content string) string {
	t.Helper()
	path := filepath.Join(directory, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
	return path
}

func createTestSymlink(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("Windows runner cannot create a symbolic-link test fixture: %v", err)
		}
		t.Fatalf("create test symlink: %v", err)
	}
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

func TestFilePolicyRetainsMultipleProjectWorkbooksAndAliases(t *testing.T) {
	directory := t.TempDir()
	first := writeTestFile(t, directory, "first.xlsx", "first")
	second := writeTestFile(t, directory, "second.xlsx", "second")
	policy := &filePolicy{}

	if _, err := policy.approveWorkbookAlias("sources/first.xlsx", first); err != nil {
		t.Fatalf("approve first workbook alias: %v", err)
	}
	if _, err := policy.approveWorkbookAlias("sources/second.xlsx", second); err != nil {
		t.Fatalf("approve second workbook alias: %v", err)
	}
	for path, expected := range map[string]string{"sources/first.xlsx": "first", "sources/second.xlsx": "second"} {
		data, err := policy.readApprovedWorkbook(path)
		if err != nil || string(data) != expected {
			t.Fatalf("read approved workbook %q = %q, %v", path, data, err)
		}
	}
	policy.resetApprovedWorkbooks()
	if _, err := policy.readApprovedWorkbook("sources/first.xlsx"); err == nil {
		t.Fatal("expected reset workbook authorization to be rejected")
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
	if actual := sanitizeJSONFileName("../../unsafe report", "project.json"); actual != "unsafe_report.json" {
		t.Fatalf("sanitize unsafe name = %q", actual)
	}
	if actual := sanitizeJSONFileName("report.JSON", "project.json"); actual != "report.JSON" {
		t.Fatalf("sanitize JSON name = %q", actual)
	}
	if actual := sanitizeJSONFileName("", "project.json"); actual != "project.json" {
		t.Fatalf("sanitize empty name = %q", actual)
	}
}

func TestJSONAndRecoveryValidation(t *testing.T) {
	directory := t.TempDir()
	valid := writeTestFile(t, directory, "project.json", `{"version":3}`)
	invalid := writeTestFile(t, directory, "invalid.json", `{`)
	if content, err := readJSONFile(valid, maxProjectBytes, "Project file"); err != nil || content != `{"version":3}` {
		t.Fatalf("read valid JSON = %q, %v", content, err)
	}
	if _, err := readJSONFile(invalid, maxProjectBytes, "Project file"); err == nil {
		t.Fatal("expected invalid JSON to be rejected")
	}
	if err := saveRecovery(directory, `{"blocks":[]}`); err != nil {
		t.Fatalf("save recovery: %v", err)
	}
	if err := saveRecovery(directory, `{"blocks":["updated"]}`); err != nil {
		t.Fatalf("replace recovery: %v", err)
	}
	if content, err := loadRecovery(directory); err != nil || content != `{"blocks":["updated"]}` {
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
	if _, err := readJSONFile(oversized, 5, "Project file"); err == nil {
		t.Fatal("expected oversized project file to be rejected")
	}
}

func TestWriteJSONFileUsesSafeRegularDestination(t *testing.T) {
	directory := t.TempDir()
	destination := filepath.Join(directory, "output.json")
	if err := writeJSONFile(destination, `{"version":3}`); err != nil {
		t.Fatalf("write JSON file: %v", err)
	}
	if err := writeJSONFile(destination, `{"version":3}`); err != nil {
		t.Fatalf("replace JSON file: %v", err)
	}
	content, err := os.ReadFile(destination)
	if err != nil || string(content) != `{"version":3}` {
		t.Fatalf("exported content = %q, %v", content, err)
	}
	if err := writeJSONFile(filepath.Join(directory, "output.txt"), `{"version":3}`); err == nil {
		t.Fatal("expected non-JSON destination to be rejected")
	}

	target := writeTestFile(t, directory, "target.json", `{"safe":true}`)
	link := filepath.Join(directory, "link.json")
	createTestSymlink(t, target, link)
	if err := writeJSONFile(link, `{"unsafe":true}`); err == nil {
		t.Fatal("expected export symlink to be rejected")
	}
	content, err = os.ReadFile(target)
	if err != nil || string(content) != `{"safe":true}` {
		t.Fatalf("symlink target changed = %q, %v", content, err)
	}
}

func TestReadFileWithTimeout(t *testing.T) {
	data, err := readFileWithTimeout("fast", time.Second, func(path string) ([]byte, error) {
		if path != "fast" {
			return nil, errors.New("unexpected path")
		}
		return []byte("ok"), nil
	})
	if err != nil || string(data) != "ok" {
		t.Fatalf("fast read = %q, %v", data, err)
	}
	_, err = readFileWithTimeout("slow", time.Millisecond, func(string) ([]byte, error) {
		time.Sleep(10 * time.Millisecond)
		return nil, errors.New("late read")
	})
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("timeout error = %v", err)
	}
}
