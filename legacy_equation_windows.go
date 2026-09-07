//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	gdiplusDLL             = windows.NewLazySystemDLL("gdiplus.dll")
	gdiplusStartupProc     = gdiplusDLL.NewProc("GdiplusStartup")
	gdiplusShutdownProc    = gdiplusDLL.NewProc("GdiplusShutdown")
	gdipLoadImageProc      = gdiplusDLL.NewProc("GdipLoadImageFromFile")
	gdipSaveImageProc      = gdiplusDLL.NewProc("GdipSaveImageToFile")
	gdipDisposeImageProc   = gdiplusDLL.NewProc("GdipDisposeImage")
	pngEncoderCLSID        = guid{Data1: 0x557cf406, Data2: 0x1a04, Data3: 0x11d3, Data4: [8]byte{0x9a, 0x73, 0x00, 0x00, 0xf8, 0x1e, 0xf3, 0x2e}}
)

type gdiplusStartupInput struct {
	Version                  uint32
	DebugEventCallback       uintptr
	SuppressBackgroundThread uint32
	SuppressExternalCodecs   uint32
}

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

func rasterizeLegacyEquationPreview(preview []byte, extension string) ([]byte, error) {
	extension = strings.ToLower(strings.TrimPrefix(extension, "."))
	if extension != "emf" && extension != "wmf" {
		return nil, fmt.Errorf("unsupported legacy equation preview format: %s", extension)
	}
	directory, err := os.MkdirTemp("", "equation-preview-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	inputPath := filepath.Join(directory, "preview."+extension)
	outputPath := filepath.Join(directory, "preview.png")
	if err := os.WriteFile(inputPath, preview, 0o600); err != nil {
		return nil, err
	}

	var token uintptr
	startupInput := gdiplusStartupInput{Version: 1}
	if status, _, _ := gdiplusStartupProc.Call(uintptr(unsafe.Pointer(&token)), uintptr(unsafe.Pointer(&startupInput)), 0); status != 0 {
		return nil, fmt.Errorf("GDI+ startup failed with status %d", status)
	}
	defer gdiplusShutdownProc.Call(token)

	inputName, err := windows.UTF16PtrFromString(inputPath)
	if err != nil {
		return nil, err
	}
	var image uintptr
	if status, _, _ := gdipLoadImageProc.Call(uintptr(unsafe.Pointer(inputName)), uintptr(unsafe.Pointer(&image))); status != 0 {
		return nil, fmt.Errorf("GDI+ could not load the %s preview (status %d)", extension, status)
	}
	defer gdipDisposeImageProc.Call(image)

	outputName, err := windows.UTF16PtrFromString(outputPath)
	if err != nil {
		return nil, err
	}
	if status, _, _ := gdipSaveImageProc.Call(image, uintptr(unsafe.Pointer(outputName)), uintptr(unsafe.Pointer(&pngEncoderCLSID)), 0); status != 0 {
		return nil, fmt.Errorf("GDI+ could not encode the legacy equation preview as PNG (status %d)", status)
	}
	return os.ReadFile(outputPath)
}
