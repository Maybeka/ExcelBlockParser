package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx           context.Context
	previewData   map[string]interface{}
	previewOpen   bool
	filePolicy    filePolicy
	projectPaths  map[string]bool
	recoveryDir   string
	emitEvent     func(context.Context, string, ...interface{})
	pythonRuntime pythonRuntimeRunner
}

// CancelPythonRun requests KeyboardInterrupt for the active project run.
func (a *App) CancelPythonRun() bool {
	return a.pythonRuntime.Cancel()
}

// RunProjectPython executes the project's packaged process(context) entry point.
func (a *App) RunProjectPython(project PythonProjectPackage, contextJSON string) PythonProjectResult {
	return a.pythonRuntime.RunProject(project, contextJSON)
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.previewData = make(map[string]interface{})
	a.projectPaths = make(map[string]bool)
	a.emitEvent = runtime.EventsEmit
	baseDir, err := os.UserConfigDir()
	if err != nil {
		baseDir = os.TempDir()
	}
	a.recoveryDir = filepath.Join(baseDir, "Excel Block Parser")
}

// Quit closes the Wails application from the renderer-owned title bar. Keeping
// this as a bound method avoids relying on the optional window.runtime global,
// which is not present in every Wails/WebView2 startup path.
func (a *App) Quit() {
	runtime.Quit(a.ctx)
}

func (a *App) authorizeProjectSources(content, projectPath string) {
	var document struct {
		Version int `json:"version"`
		Project struct {
			Workbooks []struct {
				SourcePath string `json:"sourcePath"`
			} `json:"workbooks"`
		} `json:"project"`
	}
	a.filePolicy.resetApprovedWorkbooks()
	if json.Unmarshal([]byte(content), &document) != nil || document.Version != 3 {
		return
	}
	for _, workbook := range document.Project.Workbooks {
		if workbook.SourcePath == "" {
			continue
		}
		sourcePath := workbook.SourcePath
		if !filepath.IsAbs(sourcePath) && projectPath != "" {
			sourcePath = filepath.Join(filepath.Dir(projectPath), sourcePath)
		}
		_, _ = a.filePolicy.approveWorkbookAlias(workbook.SourcePath, sourcePath)
	}
}

// OpenPreviewWindow emits an event for the frontend to navigate to the preview route.
// Returns nil (Wails v2 does not natively support multiple windows — the frontend
// SPA router handles the navigation via hash routing).
func (a *App) OpenPreviewWindow(blockId string) error {
	a.emit("open-preview", blockId)
	a.previewOpen = true
	return nil
}

// SetPreviewData stores the renderer's complete, typed preview payload.
func (a *App) SetPreviewData(blockId string, data interface{}) {
	a.previewData[blockId] = data
}

// GetPreviewData returns the stored preview data for the given blockId,
// or nil if no data has been set.
func (a *App) GetPreviewData(blockId string) interface{} {
	return a.previewData[blockId]
}

// OpenXlsx opens a native file dialog filtered to .xlsx/.xls files and
// authorizes the selected workbook for a later bounded read.
func (a *App) OpenXlsx() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Excel File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Excel Files (*.xlsx, *.xls)", Pattern: "*.xlsx;*.xls"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	return a.filePolicy.approveWorkbook(path)
}

// ReadFile reads only the workbook selected by OpenXlsx.
func (a *App) ReadFile(path string) ([]byte, error) {
	return a.filePolicy.readApprovedWorkbook(path)
}

// JsonSaveResult mirrors the Electron IPC return type.
type JsonSaveResult struct {
	Success  bool   `json:"success"`
	FilePath string `json:"filePath,omitempty"`
	Error    string `json:"error,omitempty"`
}

type PythonArtifactExportResult struct {
	Success   bool   `json:"success"`
	Directory string `json:"directory,omitempty"`
	Written   int    `json:"written,omitempty"`
	Error     string `json:"error,omitempty"`
}

// ExportPythonArtifacts lets the user select one output directory and writes
// only the validated relative UTF-8 files returned by the project script.
func (a *App) ExportPythonArtifacts(projectName string, artifactsJSON string) PythonArtifactExportResult {
	validationRoot, err := os.MkdirTemp("", "python-artifact-validation-*")
	if err != nil {
		return PythonArtifactExportResult{Error: "unable to validate generated files"}
	}
	defer os.RemoveAll(validationRoot)
	_, _, err = preparePythonArtifacts(validationRoot, artifactsJSON)
	if err != nil {
		return PythonArtifactExportResult{Error: err.Error()}
	}
	directory, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Save Generated Files - " + projectName,
		CanCreateDirectories: true,
	})
	if err != nil {
		return PythonArtifactExportResult{Error: err.Error()}
	}
	if directory == "" {
		return PythonArtifactExportResult{Error: "cancelled"}
	}
	artifacts, conflicts, err := preparePythonArtifacts(directory, artifactsJSON)
	if err != nil {
		return PythonArtifactExportResult{Error: err.Error()}
	}
	if conflicts > 0 {
		choice, dialogErr := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
			Type:          runtime.QuestionDialog,
			Title:         "Replace generated files?",
			Message:       fmt.Sprintf("%d generated file(s) already exist in the selected directory.", conflicts),
			Buttons:       []string{"Replace", "Cancel"},
			DefaultButton: "Cancel",
			CancelButton:  "Cancel",
		})
		if dialogErr != nil {
			return PythonArtifactExportResult{Error: dialogErr.Error()}
		}
		if choice != "Replace" {
			return PythonArtifactExportResult{Error: "cancelled"}
		}
	}
	if err := writePreparedPythonArtifacts(directory, artifacts); err != nil {
		return PythonArtifactExportResult{Error: err.Error()}
	}
	return PythonArtifactExportResult{Success: true, Directory: directory, Written: len(artifacts)}
}

// SaveJson opens a save dialog and writes JSON data to the chosen path.
func (a *App) SaveJson(defaultName string, jsonData string) JsonSaveResult {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Project As",
		DefaultFilename: sanitizeJSONFileName(defaultName, "project.json"),
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil {
		return JsonSaveResult{Success: false, Error: err.Error()}
	}
	if path == "" {
		return JsonSaveResult{Success: false, Error: "cancelled"}
	}

	if err := writeJSONFile(path, jsonData); err != nil {
		return JsonSaveResult{Success: false, Error: err.Error()}
	}
	a.projectPaths[filepath.Clean(path)] = true

	return JsonSaveResult{Success: true, FilePath: path}
}

// SaveJsonToPath overwrites a project that was opened or saved by this app.
func (a *App) SaveJsonToPath(path string, jsonData string) JsonSaveResult {
	cleanPath := filepath.Clean(path)
	if !a.projectPaths[cleanPath] {
		return JsonSaveResult{Success: false, Error: "the project must be opened or saved through the application first"}
	}
	if err := writeJSONFile(cleanPath, jsonData); err != nil {
		return JsonSaveResult{Success: false, Error: err.Error()}
	}
	return JsonSaveResult{Success: true, FilePath: cleanPath}
}

// JsonOpenResult mirrors the Electron IPC return type.
type JsonOpenResult struct {
	FilePath string `json:"filePath"`
	Content  string `json:"content"`
}

// OpenJson opens a JSON file dialog. Cancellation returns nil; read and JSON
// validation failures are returned as errors so the renderer can report them.
func (a *App) OpenJson() (*JsonOpenResult, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Project",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}

	content, err := readJSONFile(path, maxProjectBytes, "Project file")
	if err != nil {
		return nil, err
	}
	a.projectPaths[filepath.Clean(path)] = true
	a.authorizeProjectSources(content, path)

	return &JsonOpenResult{
		FilePath: path,
		Content:  content,
	}, nil
}

func (a *App) SaveRecovery(jsonData string) error {
	return saveRecovery(a.recoveryDir, jsonData)
}

func (a *App) LoadRecovery() (string, error) {
	content, err := loadRecovery(a.recoveryDir)
	if err == nil && content != "" {
		a.authorizeProjectSources(content, "")
	}
	return content, err
}

func (a *App) ClearRecovery() error {
	return clearRecovery(a.recoveryDir)
}

func (a *App) ClosePreviewWindow() {
	a.previewOpen = false
	a.previewData = make(map[string]interface{})
	a.emit("close-preview")
}

func (a *App) emit(event string, data ...interface{}) {
	if a.emitEvent != nil {
		a.emitEvent(a.ctx, event, data...)
	}
}
