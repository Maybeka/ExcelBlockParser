# Manual Acceptance Test Plan

## Purpose

Use this guide to decide whether a packaged Wails Excel Block Parser release is
fit for distribution. Run it against the Wails ZIP artifact on Windows 11 x64,
not `npm run dev`, an Electron package, or a browser build.

Each case has a pass/fail result. Stop the release and file a defect for any
failure that corrupts project/output data, loses a recoverable workspace,
bypasses a file-size/type guard, or prevents the core workflow in TC-03.

## Tester Setup

Record this information before testing:

| Field | Value |
| --- | --- |
| Release version and tag | |
| Artifact name and SHA-256 | |
| Platform and OS version | |
| CPU architecture | |
| Tester and date | |

### Required Files

Copy these files from the release commit's `examples/` directory to a writable
test folder outside the repository:

- `test_data.xlsx`
- `test_data_v2.xlsx`
- `multi_sheet.xlsx`
- `m2_integration.xlsx`
- `empty.xlsx`
- `project.json`

`project.json` is the strict Project v3 fixture used to verify the current
project lifecycle and schema contract. Keep the original unchanged. Create a
separate `output/` directory for generated JSON files and screenshots.

### Install The Artifact

1. Extract the Wails ZIP artifact to a writable local folder.
2. Launch **Excel Block Parser** from the installed location. Confirm the
   application can start and has its required GUI/WebView dependency. Record
   any Windows security notice: the v1 candidate is intentionally unsigned.
3. Record the version shown by the artifact filename. It must match the release
   tag.

## Test Cases

### TC-01: Clean Launch And Controls

**Steps**

1. Launch the installed app with no recovery project pending.
2. Inspect the header and left workspace area.
3. Resize the window to roughly 1024 x 700, then to a narrow width.

**Expected result**

- The header shows **Excel Block Parser**, Undo, Redo, Diagnostics, and a
  project control whose menu contains New, Save, Save As, Settings, and Close.
- A default `block_1` is visible and the canvas says to open an XLSX file.
- Run & Preview in the extraction panel is disabled until a range is selected.
- Workspace navigation remains reachable at narrow widths.

**Evidence:** screenshot of the clean launch and any layout defect.

### TC-02: Native Open, Cancel, And Guarded Inputs

**Steps**

1. Create a project, open **Project settings**, select **Add workbook source**,
   then cancel the native dialog.
2. Confirm the default workspace is unchanged.
3. Select **Add workbook source** again and choose `test_data.xlsx`.
4. Verify the filename appears in the header and `Sheet1` appears in the
   workspace navigator.
5. Try selecting a non-workbook file in the native dialog, if the dialog
   permits showing all files. Cancel instead of forcing a renamed file.

**Expected result**

- Cancel is harmless and produces no error or workspace mutation.
- The `.xlsx` fixture loads into the spreadsheet canvas.
- The dialog is limited to `.xlsx` and `.xls` file selection.

**Evidence:** screenshot of the loaded workbook and filename.

### TC-03: Core Project, Preview, And Save Workflow

This is the required end-to-end acceptance case.

**Steps**

1. Select **Open Project** and choose the untouched `project.json` fixture.
2. If warned that the current project will be replaced, select **Open Project**.
3. Confirm the strict Project v3 fixture opens and the configured block is
   named **block_1** with range `Sheet1!A1:D9`.
4. Select **Run & Preview** in the extraction panel.
5. In the preview, inspect the parsed view and verify there are eight rows.
   The first row must contain `Alice`, `25`, `88.5`, and `New York`; the last
   row must contain `Hank`, `29`, `60`, and `Dubai`.
6. Close the preview, select **Save Project As**, and choose
   `output/core-workflow.json`.
7. If validation displays a confirmation, inspect the listed issues and select
   **Save anyway** only when they are expected for the fixture.
8. Open the saved project JSON in a text editor.

**Expected result**

- Import succeeds as Project v3 and does not silently discard or normalize the
  configuration. Project versions 1 and 2 must instead be rejected.
- Preview shows the expected parsed records with numeric age/score values.
- The project is valid JSON with `"version": 3`, `project`, `data`, and
  `blockResults`.
- The saved data and corresponding block result both contain eight
  records with the expected first and last values.

**Evidence:** save `core-workflow.json` and a preview screenshot. This file is
the primary evidence for the stable contract described in
[SESSION_SCHEMA.md](SESSION_SCHEMA.md).

### TC-04: Save And Reopen Stability

**Steps**

1. Close the current project from the project menu after
   `core-workflow.json` exists.
2. Select **Open Project**.
3. Open `output/core-workflow.json` and confirm replacement when asked.
4. Select **Run & Preview** and save a second file with **Save Project As**,
   `output/core-workflow-roundtrip.json`.
5. Compare the two files' `version`, block label, configured range, data row
   count, and the first/last output records.

**Expected result**

- Re-import restores the configured block without an error.
- Both projects are version 3 and have equivalent configured output and parsed
  records. `exportedAt` may differ.

**Evidence:** retain both JSON files and note any unexpected structural diff.

### TC-05: Multi-Sheet And Region Workflow

**Steps**

1. Open `multi_sheet.xlsx`.
2. Use the workspace navigator to switch between its sheets. Verify the canvas
   changes with the selected sheet.
3. In the Blocks panel, use the Add menu and select **Add Region**.
4. Activate the new region, drag a multi-cell range in the spreadsheet, and
   confirm the region shows the selected sheet and A1 range.
5. Add an **Empty Row** split rule with minimum gap `1`, then select **Run & Preview**.
6. On a range containing a fully blank column, add **Empty Col** with minimum
   gap `1`; run again and verify horizontal and vertical boundaries combine.
7. Save the project, close it, reopen it, and inspect the Region's detected
   block list and ranges.
8. Repeat with `m2_integration.xlsx` if more than one split result is not
   evident in the first workbook.

**Expected result**

- Sheet navigation is stable and does not lose the selected workspace item.
- A region records its range and sheet.
- The preview presents rectangular detected blocks for qualified blank-row and
  blank-column boundaries.
- Detected block ranges remain attached to their owning Region after save and
  reopen. They do not appear as independent top-level Extractors.
- Increasing a minimum gap above the available consecutive blank rows or
  columns prevents that boundary from splitting. No silent no-op occurs.

**Evidence:** screenshot of selected region/range and preview results.

### TC-06: Reconciliation Against Changed Source

**Steps**

1. Open `test_data_v2.xlsx`.
2. Import the original `project.json` fixture and choose **Replace All**.
3. Read the reconciliation message or use the affected block's sync action to
   open its reconciliation flow.
4. Inspect the reported changed, added, removed, or shifted columns.
5. Do not apply a suggested fix unless its range/sheet matches the visible
   workbook. If applied, parse and preview again.

**Expected result**

- The app reports the configuration/source mismatch instead of silently
  treating the changed workbook as equivalent.
- Any applied fix is explicit and leaves a valid, parseable configuration.

**Evidence:** screenshot of reconciliation diagnostics and any applied fix.

### TC-07: Undo, Redo, And Unsaved-Change Protection

**Steps**

1. With a workbook open, click **Add** to create `block_2`.
2. Select Undo, or press Command+Z on macOS / Control+Z on Windows/Linux while
   focus is outside a text field.
3. Verify `block_2` disappears, then select Redo or use Command+Shift+Z /
   Control+Shift+Z (Control+Y is also supported on Windows/Linux).
4. Make another configuration change and select **Open Project**, **New
   Project**, or **Close Project** from the project control.
5. In the discard prompt, select Cancel; then repeat and select Discard.

**Expected result**

- Undo and redo restore the expected block state.
- Cancel preserves the current workspace; Discard performs the requested file
  action and removes unsaved modifications.

**Evidence:** note keyboard used and screenshot any state mismatch.

### TC-08: Recovery After Interrupted Work

**Steps**

1. Open `test_data.xlsx`, add `block_2`, and wait at least two seconds for
   autosave.
2. Force-quit the application using the operating system. Do not export or
   use the app's normal close flow.
3. Relaunch the installed application.
4. In **Recover unsaved workspace?**, select **Recover** and verify `block_2`
   is restored.
5. Repeat the setup, force-quit, relaunch, and choose **Discard**.
6. Relaunch once more to confirm the recovery prompt is gone.

**Expected result**

- Recovery offers an explicit choice and restores the unsaved configuration
  when chosen.
- Discard clears recovery data and does not prompt again.
- The app does not claim to recover a copy of the external workbook; only the
  workspace configuration and current parsed state are expected.

**Evidence:** screenshots of Recover and Discard outcomes. Clean up recovery
data before testing the next artifact.

### TC-09: Unsupported And Failure Behavior

**Steps**

1. Open `empty.xlsx` and attempt to select a range and parse it.
2. Attempt to import a copy of `core-workflow.json` with its `version` changed
   to `999`.
3. Attempt to import a text file renamed with `.json` that contains invalid
   JSON.
4. Start an export and cancel the native save dialog.

**Expected result**

- Empty or invalid selections produce actionable diagnostics rather than a
  crash or fabricated output.
- Unsupported project versions and malformed JSON show an import error and do
  not replace the existing workspace.
- Cancelling export leaves the workspace/recovery state available.

**Evidence:** capture each error message and verify the previous block remains
visible after each failed import.

### TC-10: Performance Observation

**Steps**

1. On the release test runner or a documented comparable machine, generate the
   ignored fixture and run the benchmark harness from the release commit:

   ```bash
   npm run generate:fixtures -- --performance
   npm run benchmark:workbook
   ```

2. Attach the reported phase timings and total for the 50,000-cell workbook
   case to the release record.

**Expected result**

- The 50,000-cell load-and-extract-to-JSON case completes under 12 seconds.
- Do not treat this as a guarantee for every file smaller than 100 MB; files
  over the size limit or read/conversion guard are intentionally rejected.

**Evidence:** attach the test output to the release record.

## Final Sign-Off

Complete this table for each supported artifact:

| Case | Pass / Fail / Not run | Evidence location | Defect ID or note |
| --- | --- | --- | --- |
| TC-01 | | | |
| TC-02 | | | |
| TC-03 | | | |
| TC-04 | | | |
| TC-05 | | | |
| TC-06 | | | |
| TC-07 | | | |
| TC-08 | | | |
| TC-09 | | | |
| TC-10 | | | |

Approve only when TC-03, TC-04, TC-08, and all applicable platform-specific
cases pass, automated gates are green, and every known limitation in
[SUPPORT.md](SUPPORT.md) is acceptable for the release. Record release
approval with the artifact checksum and the signer's name.
