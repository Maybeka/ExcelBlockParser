package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	pathpkg "path"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf8"
)

const (
	maxPythonArtifacts          = 100
	maxPythonArtifactBytes      = 5 * 1024 * 1024
	maxPythonArtifactTotalBytes = 25 * 1024 * 1024
	maxPythonArtifactPathBytes  = 512
)

type PythonArtifact struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding,omitempty"`
}

type preparedPythonArtifact struct {
	artifact PythonArtifact
	target   string
	exists   bool
}

var windowsReservedNames = map[string]bool{
	"con": true, "prn": true, "aux": true, "nul": true,
	"com1": true, "com2": true, "com3": true, "com4": true, "com5": true, "com6": true, "com7": true, "com8": true, "com9": true,
	"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true, "lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
}

func decodePythonArtifacts(artifactsJSON string) ([]PythonArtifact, error) {
	decoder := json.NewDecoder(strings.NewReader(artifactsJSON))
	decoder.DisallowUnknownFields()
	var artifacts []PythonArtifact
	if err := decoder.Decode(&artifacts); err != nil {
		return nil, fmt.Errorf("invalid Python artifact list: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("invalid Python artifact list: unexpected trailing data")
	}
	if len(artifacts) == 0 {
		return nil, errors.New("Python did not generate any files")
	}
	if len(artifacts) > maxPythonArtifacts {
		return nil, fmt.Errorf("Python artifacts exceed the %d-file limit", maxPythonArtifacts)
	}
	return artifacts, nil
}

func validatePythonArtifactPath(value string) error {
	if value == "" || len(value) > maxPythonArtifactPathBytes {
		return errors.New("artifact paths must contain between 1 and 512 bytes")
	}
	if strings.Contains(value, `\`) {
		return errors.New("artifact paths must use forward slashes")
	}
	if strings.HasPrefix(value, "/") || filepath.VolumeName(value) != "" || pathpkg.Clean(value) != value {
		return errors.New("artifact paths must be normalized relative paths")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return errors.New("artifact paths must not contain empty, current, or parent segments")
		}
		if strings.HasSuffix(segment, ".") || strings.HasSuffix(segment, " ") {
			return errors.New("artifact path segments must not end with a dot or space")
		}
		stem := strings.ToLower(strings.SplitN(segment, ".", 2)[0])
		if windowsReservedNames[stem] {
			return errors.New("artifact paths must not use Windows reserved names")
		}
		if strings.ContainsAny(segment, `<>:"|?*`) || strings.IndexFunc(segment, func(character rune) bool { return character < 0x20 }) >= 0 {
			return errors.New("artifact path contains characters that are invalid on Windows")
		}
	}
	return nil
}

func inspectArtifactPath(root, relativePath string) (string, bool, error) {
	target := filepath.Join(root, filepath.FromSlash(relativePath))
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false, errors.New("artifact path escapes the selected directory")
	}
	current := root
	segments := strings.Split(relativePath, "/")
	for _, segment := range segments[:len(segments)-1] {
		current = filepath.Join(current, segment)
		info, statErr := os.Lstat(current)
		if errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if statErr != nil {
			return "", false, fmt.Errorf("unable to inspect artifact directory: %w", statErr)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", false, fmt.Errorf("artifact parent %q is not a regular directory", segment)
		}
	}
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return target, false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("unable to inspect artifact destination: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", false, fmt.Errorf("artifact destination %q is not a regular file", relativePath)
	}
	return target, true, nil
}

func preparePythonArtifacts(root, artifactsJSON string) ([]preparedPythonArtifact, int, error) {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, 0, fmt.Errorf("output directory is unavailable: %w", err)
	}
	rootInfo, err := os.Stat(resolvedRoot)
	if err != nil || !rootInfo.IsDir() {
		return nil, 0, errors.New("output directory is not a directory")
	}
	artifacts, err := decodePythonArtifacts(artifactsJSON)
	if err != nil {
		return nil, 0, err
	}
	prepared := make([]preparedPythonArtifact, 0, len(artifacts))
	canonicalPaths := make(map[string]bool, len(artifacts))
	totalBytes := 0
	conflicts := 0
	for _, artifact := range artifacts {
		if err := validatePythonArtifactPath(artifact.Path); err != nil {
			return nil, 0, fmt.Errorf("invalid artifact path %q: %w", artifact.Path, err)
		}
		if artifact.Encoding != "" && !strings.EqualFold(artifact.Encoding, "utf-8") {
			return nil, 0, fmt.Errorf("artifact %q must use utf-8 encoding", artifact.Path)
		}
		if !utf8.ValidString(artifact.Content) {
			return nil, 0, fmt.Errorf("artifact %q is not valid UTF-8", artifact.Path)
		}
		size := len([]byte(artifact.Content))
		if size > maxPythonArtifactBytes {
			return nil, 0, fmt.Errorf("artifact %q exceeds the 5 MB limit", artifact.Path)
		}
		totalBytes += size
		if totalBytes > maxPythonArtifactTotalBytes {
			return nil, 0, errors.New("Python artifacts exceed the 25 MB total limit")
		}
		canonicalPath := strings.ToLower(artifact.Path)
		if canonicalPaths[canonicalPath] {
			return nil, 0, fmt.Errorf("duplicate artifact path %q", artifact.Path)
		}
		canonicalPaths[canonicalPath] = true
		target, exists, err := inspectArtifactPath(resolvedRoot, artifact.Path)
		if err != nil {
			return nil, 0, err
		}
		if exists {
			conflicts++
		}
		prepared = append(prepared, preparedPythonArtifact{artifact: artifact, target: target, exists: exists})
	}
	return prepared, conflicts, nil
}

func ensureArtifactParent(root, target string) error {
	relative, err := filepath.Rel(root, filepath.Dir(target))
	if err != nil {
		return err
	}
	current := root
	if relative == "." {
		return nil
	}
	for _, segment := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, segment)
		info, statErr := os.Lstat(current)
		if errors.Is(statErr, os.ErrNotExist) {
			if err := os.Mkdir(current, 0o755); err != nil {
				return fmt.Errorf("unable to create artifact directory: %w", err)
			}
			continue
		}
		if statErr != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return fmt.Errorf("artifact parent directory became unsafe")
		}
	}
	return nil
}

func writeArtifactAtomically(target, content string) error {
	directory := filepath.Dir(target)
	temporary, err := os.CreateTemp(directory, ".python-artifact-*.tmp")
	if err != nil {
		return fmt.Errorf("unable to create temporary artifact: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.WriteString(content); err != nil {
		temporary.Close()
		return fmt.Errorf("unable to write artifact: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("unable to close artifact: %w", err)
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		if runtime.GOOS != "windows" || os.Remove(target) != nil {
			return fmt.Errorf("unable to commit artifact: %w", err)
		}
		if err := os.Rename(temporaryPath, target); err != nil {
			return fmt.Errorf("unable to commit artifact: %w", err)
		}
	}
	return nil
}

func writePreparedPythonArtifacts(root string, artifacts []preparedPythonArtifact) error {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("output directory is unavailable: %w", err)
	}
	for _, prepared := range artifacts {
		if err := ensureArtifactParent(resolvedRoot, prepared.target); err != nil {
			return err
		}
		_, exists, err := inspectArtifactPath(resolvedRoot, prepared.artifact.Path)
		if err != nil {
			return err
		}
		if exists && !prepared.exists {
			return fmt.Errorf("artifact destination %q appeared after replacement confirmation", prepared.artifact.Path)
		}
		if err := writeArtifactAtomically(prepared.target, prepared.artifact.Content); err != nil {
			return fmt.Errorf("unable to write artifact %q: %w", prepared.artifact.Path, err)
		}
	}
	return nil
}
