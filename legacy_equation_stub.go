//go:build !windows

package main

import "fmt"

func rasterizeLegacyEquationPreview(_ []byte, _ string) ([]byte, error) {
	return nil, fmt.Errorf("legacy Equation Editor previews require the Windows Wails runtime")
}
