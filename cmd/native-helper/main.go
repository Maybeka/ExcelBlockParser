package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"time"

	mtefmathml "github.com/Maybeka/mtef-mathml"
)

type helperRequest struct {
	ID        int                  `json:"id"`
	Method    string               `json:"method"`
	Project   PythonProjectPackage `json:"project"`
	Context   string               `json:"context"`
	Data      []byte               `json:"data"`
	Extension string               `json:"extension"`
}

type helperResponse struct {
	ID    int         `json:"id"`
	Value interface{} `json:"value,omitempty"`
	Error string      `json:"error,omitempty"`
}

func main() {
	var outputMu sync.Mutex
	var workers sync.WaitGroup
	var active atomic.Bool
	var cancellation atomic.Bool
	runner := &pythonRuntimeRunner{}
	write := func(response helperResponse) {
		outputMu.Lock()
		defer outputMu.Unlock()
		if err := json.NewEncoder(os.Stdout).Encode(response); err != nil {
			fmt.Fprintln(os.Stderr, err)
		}
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 65536), 96*1024*1024)
	slots := make(chan struct{}, 4)
	for scanner.Scan() {
		var request helperRequest
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			write(helperResponse{Error: "invalid helper request"})
			continue
		}
		if request.Method == "cancel" {
			running := active.Load()
			if running {
				cancellation.Store(true)
				runner.Cancel()
			}
			write(helperResponse{ID: request.ID, Value: running})
			continue
		}
		if request.Method == "hello" {
			write(helperResponse{ID: request.ID, Value: map[string]interface{}{"protocol": 1, "python": "goccy/go-python v0.1.0", "mathType": "mtef-mathml v0.2.0"}})
			continue
		}
		isRun := request.Method == "run"
		if isRun {
			if !active.CompareAndSwap(false, true) {
				write(helperResponse{ID: request.ID, Error: "another Python run is already active"})
				continue
			}
			cancellation.Store(false)
		}
		select {
		case slots <- struct{}{}:
		default:
			if isRun {
				active.Store(false)
			}
			write(helperResponse{ID: request.ID, Error: "desktop helper is busy"})
			continue
		}
		workers.Add(1)
		go func(request helperRequest) {
			defer workers.Done()
			defer func() { <-slots }()
			response := helperResponse{ID: request.ID}
			switch request.Method {
			case "run":
				finished := make(chan struct{})
				monitorDone := make(chan struct{})
				go func() {
					defer close(monitorDone)
					ticker := time.NewTicker(10 * time.Millisecond)
					defer ticker.Stop()
					for {
						select {
						case <-finished:
							return
						case <-ticker.C:
							if cancellation.Load() {
								runner.Cancel()
							}
						}
					}
				}()
				response.Value = runner.RunProject(request.Project, request.Context)
				close(finished)
				<-monitorDone
				active.Store(false)
			case "mathType":
				if len(request.Data) == 0 || len(request.Data) > 32*1024*1024 {
					response.Error = "MathType OLE object must contain between 1 byte and 32 MB"
					break
				}
				result, err := mtefmathml.ConvertOLE(request.Data)
				if err != nil {
					response.Error = err.Error()
					break
				}
				diagnostics := make([]map[string]interface{}, 0, len(result.Diagnostics))
				for _, diagnostic := range result.Diagnostics {
					diagnostics = append(diagnostics, map[string]interface{}{"severity": string(diagnostic.Severity), "offset": diagnostic.Offset, "construct": diagnostic.Construct, "message": diagnostic.Message})
				}
				response.Value = map[string]interface{}{"supported": result.Supported, "mathMl": result.MathML, "diagnostics": diagnostics}
			case "rasterize":
				if len(request.Data) == 0 || len(request.Data) > 32*1024*1024 {
					response.Error = "Equation preview must contain between 1 byte and 32 MB"
					break
				}
				data, err := rasterizeLegacyEquationPreview(request.Data, request.Extension)
				if err != nil {
					response.Error = err.Error()
				} else {
					response.Value = data
				}
			default:
				response.Error = "unknown desktop helper method"
			}
			write(response)
		}(request)
	}
	cancellation.Store(true)
	runner.Cancel()
	workers.Wait()
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
