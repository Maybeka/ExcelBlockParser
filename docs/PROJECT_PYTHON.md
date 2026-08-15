# Project Python Contract

## Purpose

Each Project v3 document may store one Python script at
`project.pythonScript.source`. The script transforms the complete result from
**Run & Preview**. Execution is always explicit through **Project actions >
Project Python > Run**.

The script is not assigned to individual blocks or regions and is not run when
a project is opened, saved, recovered, or parsed.

The editor provides syntax highlighting, search, bracket matching, code
folding, a local class/function/method symbol list, `F12` go-to-definition, and
`Cmd/Ctrl + click` go-to-definition. Navigation is limited to symbols declared
in the single project script; it does not resolve imported modules, installed
packages, or inferred runtime types.

## Entry Point

The script must define this callable:

```python
def process(context):
    return context["data"]
```

`process` receives one dictionary. Its return value must be JSON serializable.
The editor accepts up to 256 KB of UTF-8 source.

## Input Contract

The current contract version is `1`:

```json
{
  "contractVersion": 1,
  "project": {
    "id": "project-1",
    "name": "Example project",
    "workbooks": [
      { "id": "book-1", "name": "source.xlsx", "sheetNames": ["Sheet1"] }
    ]
  },
  "data": {},
  "blockResults": [],
  "regionResults": []
}
```

`context["data"]` is exactly the `data` section produced by the current
successful parse. For multi-workbook projects it is keyed first by workbook ID
and then by extractor or feature output key.

`blockResults` and `regionResults` provide the detailed result records from the
same parse. Project metadata intentionally excludes workbook `sourcePath` and
other host filesystem details.

The context is passed by value as JSON. Python cannot mutate live application
state through it.

## Result And Output

The returned value is serialized with `json.dumps(..., allow_nan=False)` and
shown in the **Result** tab. `print` output and stderr are shown separately in
the **Output** tab. Exceptions retain their Python traceback.

The context limit is 25 MB, captured stdout/stderr is limited to 1 MB, and the
serialized result limit is 10 MB. The UI previews at most 1,000,000 characters
per view. A result does not currently write files or replace the project's
parsed `data`.

## Runtime Boundary

The Wails host creates a fresh embedded interpreter for every run. Global
variables and imported module state do not persist between runs. Only the
bundled Python standard library is available.

The runtime denies host filesystem access, network resolution and connections,
and child-process execution. One run may be active at a time and can be
cancelled with `KeyboardInterrupt`.

Electron and browser mode expose the editor for development but do not execute
the script.
