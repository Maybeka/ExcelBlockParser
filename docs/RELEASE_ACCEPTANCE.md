# Stabilization Release Acceptance

## Release Candidate Gates

The candidate must pass the following on the release commit:

1. Every tracked workbook fixture loads through ExcelJS. The extraction
   fixtures additionally verify merged values, mappings, regions,
   multi-sheet data, reconciliation, and deterministic diagnostics.
2. Browser, direct-Electron, and packaged-Electron Playwright suites pass.
   Browser-only fixture/native cases remain explicitly skipped; their native
   equivalents are covered by `test:native` and `test:packaged`.
3. A generated 50,000-cell workbook loads and extracts to JSON in under
   12 seconds on the release runner. This is the supported interactive
   performance threshold, not a promise that every workbook below the 100 MB
   safety limit has identical timing.
4. A serialized v2 export survives JSON serialization and import without
   changing its configured output or block-result data.
5. Native recovery save, load, and clear operations retain valid v2 session
   data and leave no recovery data after clear.

## Defect Triage

There are no known release-blocking defects after these gates pass. The
supported limitations in [SUPPORT.md](SUPPORT.md) are accepted product
boundaries for this release: `.xlsx` is preferred, unsupported Excel features
are not preserved/executed, and oversized/slow files are rejected rather than
partially processed. The legacy Wails path is development-only.

Any defect that corrupts v2 template/output data, loses recoverable workspace
state, bypasses the main-process file policy, or blocks the documented example
workflow is a release blocker.
