package main

import (
	"context"
	"fmt"
	"testing"
)

func TestAppPreviewDataLifecycle(t *testing.T) {
	events := make([]string, 0, 2)
	app := &App{
		ctx:         context.Background(),
		previewData: make(map[string]interface{}),
		emitEvent: func(_ context.Context, event string, _ ...interface{}) {
			events = append(events, event)
		},
	}
	preview := map[string]interface{}{"blockId": "block-1", "rows": 2}

	if err := app.OpenPreviewWindow("block-1"); err != nil {
		t.Fatalf("open preview: %v", err)
	}
	if !app.previewOpen {
		t.Fatal("preview should be open")
	}
	app.SetPreviewData("block-1", preview)
	if actual := app.GetPreviewData("block-1"); actual == nil {
		t.Fatal("expected stored preview data")
	}
	if actual := app.GetPreviewData("missing"); actual != nil {
		t.Fatalf("missing preview data = %#v, want nil", actual)
	}

	app.ClosePreviewWindow()
	if app.previewOpen {
		t.Fatal("preview should be closed")
	}
	if actual := app.GetPreviewData("block-1"); actual != nil {
		t.Fatalf("closed preview data = %#v, want nil", actual)
	}
	if len(events) != 2 || events[0] != "open-preview" || events[1] != "close-preview" {
		t.Fatalf("preview events = %#v", events)
	}
}

func TestAppRecoveryLifecycle(t *testing.T) {
	app := &App{recoveryDir: t.TempDir()}
	content := `{"version":3,"project":{"id":"project-1"}}`

	if err := app.SaveRecovery(content); err != nil {
		t.Fatalf("save recovery: %v", err)
	}
	actual, err := app.LoadRecovery()
	if err != nil || actual != content {
		t.Fatalf("load recovery = %q, %v", actual, err)
	}
	if err := app.ClearRecovery(); err != nil {
		t.Fatalf("clear recovery: %v", err)
	}
	actual, err = app.LoadRecovery()
	if err != nil || actual != "" {
		t.Fatalf("cleared recovery = %q, %v", actual, err)
	}
}

func TestRecoveryReauthorizesEveryDeclaredWorkbook(t *testing.T) {
	directory := t.TempDir()
	first := writeTestFile(t, directory, "first.xlsx", "first")
	second := writeTestFile(t, directory, "second.xlsx", "second")
	app := &App{recoveryDir: t.TempDir()}
	content := `{"version":3,"project":{"workbooks":[{"sourcePath":` + fmt.Sprintf("%q", first) + `},{"sourcePath":` + fmt.Sprintf("%q", second) + `}]}}`

	if err := app.SaveRecovery(content); err != nil {
		t.Fatalf("save recovery: %v", err)
	}
	if _, err := app.LoadRecovery(); err != nil {
		t.Fatalf("load recovery: %v", err)
	}
	for path, expected := range map[string]string{first: "first", second: "second"} {
		data, err := app.ReadFile(path)
		if err != nil || string(data) != expected {
			t.Fatalf("read recovered workbook %q = %q, %v", path, data, err)
		}
	}
}
