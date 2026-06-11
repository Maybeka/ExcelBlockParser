package main

import (
	"context"
	"encoding/json"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	previewData map[string]interface{}
	previewOpen bool
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.previewData = make(map[string]interface{})
}

// OpenPreviewWindow emits an event for the frontend to navigate to the preview route.
// Returns nil (Wails v2 does not natively support multiple windows — the frontend
// SPA router handles the navigation via hash routing).
func (a *App) OpenPreviewWindow(blockId string) error {
	runtime.EventsEmit(a.ctx, "open-preview", blockId)
	a.previewOpen = true
	return nil
}

// SetPreviewData stores parsed block data for the preview window.
// rawData contains the original [][]interface{} rows;
// parsedData contains the column-mapped []map[string]interface{} rows.
func (a *App) SetPreviewData(blockId string, rawData [][]interface{}, parsedData []map[string]interface{}) {
	a.previewData[blockId] = map[string]interface{}{
		"rawRows":    rawData,
		"parsedRows": parsedData,
	}
}

// GetPreviewData returns the stored preview data for the given blockId,
// or nil if no data has been set.
func (a *App) GetPreviewData(blockId string) interface{} {
	return a.previewData[blockId]
}

// OpenXlsx opens a native file dialog filtered to .xlsx/.xls files.
// Returns the absolute file path, or empty string if cancelled.
func (a *App) OpenXlsx() string {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Excel File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Excel Files (*.xlsx, *.xls)", Pattern: "*.xlsx;*.xls"},
		},
	})
	if err != nil || path == "" {
		return ""
	}
	return path
}

// ReadFile reads a file and returns its bytes as a []byte.
func (a *App) ReadFile(path string) []byte {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
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
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil || path == "" {
		return JsonSaveResult{Success: false, Error: "cancelled"}
	}

	err = os.WriteFile(path, []byte(jsonData), 0644)
	if err != nil {
		return JsonSaveResult{Success: false, Error: err.Error()}
	}

	return JsonSaveResult{Success: true, FilePath: path}
}

// JsonOpenResult mirrors the Electron IPC return type.
type JsonOpenResult struct {
	FilePath string `json:"filePath"`
	Content  string `json:"content"`
}

// OpenJson opens a JSON file dialog and reads the file content.
// Returns nil if cancelled or on error.
func (a *App) OpenJson() *JsonOpenResult {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import Config",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil || path == "" {
		return nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	// Validate it's parseable JSON
	var js json.RawMessage
	if err := json.Unmarshal(data, &js); err != nil {
		return nil
	}

	return &JsonOpenResult{
		FilePath: path,
		Content:  string(data),
	}
}
