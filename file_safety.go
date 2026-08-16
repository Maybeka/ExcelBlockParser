package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	maxWorkbookBytes int64 = 100 * 1024 * 1024
	maxProjectBytes  int64 = 25 * 1024 * 1024
	fileReadTimeout        = 30 * time.Second
)

type filePolicy struct {
	approvedWorkbookPaths map[string]string
}

func isSupportedWorkbookPath(path string) bool {
	extension := strings.ToLower(filepath.Ext(path))
	return extension == ".xlsx" || extension == ".xls"
}

func sanitizeJSONFileName(value, fallback string) string {
	name := filepath.Base(value)
	if name == "." || name == string(filepath.Separator) || name == "" {
		return fallback
	}
	var sanitized strings.Builder
	for _, character := range name {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '.' || character == '_' || character == '-' {
			sanitized.WriteRune(character)
		} else {
			sanitized.WriteByte('_')
		}
	}
	result := sanitized.String()
	if result == "" || result == "." || result == ".." {
		return fallback
	}
	if !strings.HasSuffix(strings.ToLower(result), ".json") {
		return result + ".json"
	}
	return result
}

func resolveRegularFile(path string, maxBytes int64, label string) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("%s is unavailable: %w", label, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("%s is unavailable: %w", label, err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", label)
	}
	if info.Size() > maxBytes {
		return "", fmt.Errorf("%s exceeds the %d MB limit", label, maxBytes/(1024*1024))
	}
	return resolved, nil
}

func (p *filePolicy) approveWorkbook(path string) (string, error) {
	return p.approveWorkbookAlias(path, path)
}

func (p *filePolicy) approveWorkbookAlias(alias, path string) (string, error) {
	resolved, err := resolveRegularFile(path, maxWorkbookBytes, "Workbook")
	if err != nil {
		return "", err
	}
	if !isSupportedWorkbookPath(resolved) {
		return "", errors.New("select an .xlsx or .xls workbook")
	}
	if p.approvedWorkbookPaths == nil {
		p.approvedWorkbookPaths = make(map[string]string)
	}
	p.approvedWorkbookPaths[filepath.Clean(alias)] = resolved
	p.approvedWorkbookPaths[resolved] = resolved
	return resolved, nil
}

func (p *filePolicy) resetApprovedWorkbooks() {
	p.approvedWorkbookPaths = make(map[string]string)
}

func (p *filePolicy) readApprovedWorkbook(path string) ([]byte, error) {
	approvedPath, approved := p.approvedWorkbookPaths[filepath.Clean(path)]
	if !approved {
		return nil, errors.New("select a workbook before reading it")
	}
	resolved, err := resolveRegularFile(approvedPath, maxWorkbookBytes, "Workbook")
	if err != nil {
		return nil, err
	}
	if resolved != approvedPath {
		return nil, errors.New("the workbook must be selected through the Open dialog")
	}
	data, err := readFileWithTimeout(resolved, fileReadTimeout, os.ReadFile)
	if err != nil {
		return nil, fmt.Errorf("unable to read workbook: %w", err)
	}
	return data, nil
}

func readJSONFile(path string, maxBytes int64, label string) (string, error) {
	resolved, err := resolveRegularFile(path, maxBytes, label)
	if err != nil {
		return "", err
	}
	data, err := readFileWithTimeout(resolved, fileReadTimeout, os.ReadFile)
	if err != nil {
		return "", fmt.Errorf("unable to read %s: %w", strings.ToLower(label), err)
	}
	if !json.Valid(data) {
		return "", fmt.Errorf("%s is not valid JSON", label)
	}
	return string(data), nil
}

func writeJSONFile(path string, jsonData string) error {
	if !strings.EqualFold(filepath.Ext(path), ".json") {
		return errors.New("export path must use the .json extension")
	}
	if int64(len([]byte(jsonData))) > maxProjectBytes {
		return errors.New("export exceeds the 25 MB limit")
	}
	if !json.Valid([]byte(jsonData)) {
		return errors.New("export data is not valid JSON")
	}
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("export path must be a regular file")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("unable to inspect export path: %w", err)
	}

	directory := filepath.Dir(path)
	if info, err := os.Stat(directory); err != nil || !info.IsDir() {
		if err != nil {
			return fmt.Errorf("export directory is unavailable: %w", err)
		}
		return errors.New("export directory is not a directory")
	}
	temporary, err := os.CreateTemp(directory, ".export-*.tmp")
	if err != nil {
		return fmt.Errorf("unable to create export file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.WriteString(jsonData); err != nil {
		temporary.Close()
		return fmt.Errorf("unable to write export data: %w", err)
	}
	if err := temporary.Chmod(0o644); err != nil {
		temporary.Close()
		return fmt.Errorf("unable to set export permissions: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("unable to close export data: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		if runtime.GOOS != "windows" || os.Remove(path) != nil {
			return fmt.Errorf("unable to commit export data: %w", err)
		}
		if err := os.Rename(temporaryPath, path); err != nil {
			return fmt.Errorf("unable to commit export data: %w", err)
		}
	}
	return nil
}

func recoveryFilePath(baseDir string) string {
	return filepath.Join(baseDir, "recovery", "workspace-session.json")
}

func saveRecovery(baseDir, jsonData string) error {
	if int64(len([]byte(jsonData))) > maxProjectBytes {
		return errors.New("recovery data exceeds the 25 MB limit")
	}
	if !json.Valid([]byte(jsonData)) {
		return errors.New("recovery data is not valid JSON")
	}
	target := recoveryFilePath(baseDir)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("unable to create recovery directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".workspace-session-*.tmp")
	if err != nil {
		return fmt.Errorf("unable to create recovery file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.WriteString(jsonData); err != nil {
		temporary.Close()
		return fmt.Errorf("unable to write recovery data: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("unable to close recovery data: %w", err)
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		if runtime.GOOS != "windows" || os.Remove(target) != nil {
			return fmt.Errorf("unable to commit recovery data: %w", err)
		}
		if err := os.Rename(temporaryPath, target); err != nil {
			return fmt.Errorf("unable to commit recovery data: %w", err)
		}
	}
	return nil
}

func loadRecovery(baseDir string) (string, error) {
	target := recoveryFilePath(baseDir)
	data, err := readFileWithTimeout(target, fileReadTimeout, os.ReadFile)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("unable to read recovery data: %w", err)
	}
	if int64(len(data)) > maxProjectBytes {
		return "", errors.New("recovery data exceeds the 25 MB limit")
	}
	if !json.Valid(data) {
		return "", errors.New("recovery data is not valid JSON")
	}
	return string(data), nil
}

func readFileWithTimeout(path string, timeout time.Duration, read func(string) ([]byte, error)) ([]byte, error) {
	type readResult struct {
		data []byte
		err  error
	}
	result := make(chan readResult, 1)
	go func() {
		data, err := read(path)
		result <- readResult{data: data, err: err}
	}()
	select {
	case value := <-result:
		return value.data, value.err
	case <-time.After(timeout):
		return nil, fmt.Errorf("reading file timed out after %s", timeout)
	}
}

func clearRecovery(baseDir string) error {
	err := os.Remove(recoveryFilePath(baseDir))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("unable to clear recovery data: %w", err)
	}
	return nil
}
