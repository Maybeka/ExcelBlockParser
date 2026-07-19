package main

import (
	"context"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	previewData map[string]interface{}
	previewOpen bool
	filePolicy  filePolicy
	recoveryDir string
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.previewData = make(map[string]interface{})
	baseDir, err := os.UserConfigDir()
	if err != nil {
		baseDir = os.TempDir()
	}
	a.recoveryDir = filepath.Join(baseDir, "Excel Block Parser")
}

// OpenPreviewWindow emits an event for the frontend to navigate to the preview route.
// Returns nil (Wails v2 does not natively support multiple windows — the frontend
// SPA router handles the navigation via hash routing).
func (a *App) OpenPreviewWindow(blockId string) error {
	runtime.EventsEmit(a.ctx, "open-preview", blockId)
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

// SaveJson opens a save dialog and writes JSON data to the chosen path.
func (a *App) SaveJson(defaultName string, jsonData string) JsonSaveResult {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save JSON",
		DefaultFilename: sanitizeJSONFileName(defaultName, "session.json"),
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

	return JsonSaveResult{Success: true, FilePath: path}
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
		Title: "Import Config",
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

	content, err := readJSONFile(path, maxSessionBytes, "Session file")
	if err != nil {
		return nil, err
	}

	return &JsonOpenResult{
		FilePath: path,
		Content:  content,
	}, nil
}

func (a *App) SaveRecovery(jsonData string) error {
	return saveRecovery(a.recoveryDir, jsonData)
}

func (a *App) LoadRecovery() (string, error) {
	return loadRecovery(a.recoveryDir)
}

func (a *App) ClearRecovery() error {
	return clearRecovery(a.recoveryDir)
}

func (a *App) ClosePreviewWindow() {
	a.previewOpen = false
	a.previewData = make(map[string]interface{})
	runtime.EventsEmit(a.ctx, "close-preview")
}
