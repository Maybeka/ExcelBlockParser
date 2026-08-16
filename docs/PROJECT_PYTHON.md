# Project Python Contract

## Purpose

Each Project v3 document may store one Python script at
`project.pythonScript.source`. The script transforms the complete result from
**Run & Preview**. Execution is always explicit through **Project actions >
Project Python > Run**.

The script is not assigned to individual blocks or regions and is not run when
a project is opened, saved, recovered, or parsed.

The editor provides semantic syntax highlighting, search, bracket matching,
code folding, syntax diagnostics, local and member completion, definition
hover details, and a hierarchical class/function/method symbol tree. `F12` and
`Cmd/Ctrl + click` go to definitions; a resolvable symbol is underlined while
the navigation modifier is held.

The local semantic model distinguishes class construction from function calls
and resolves instance methods from constructor assignments, type annotations,
`self` attributes, return annotations, and class inheritance. This support is
intentionally scoped to the single project script. It does not resolve imported
modules, installed packages, dynamically assigned members, decorators that
replace types, or other runtime-only Python behavior. Full cross-module Python
semantics would require a separate language server and are outside the embedded
editor boundary.

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
serialized result limit is 32 MB. The UI previews at most 1,000,000 characters
per view. A result does not replace the project's parsed `data`.

### Generated text files

A result may optionally contain a top-level `artifacts` array:

```python
def process(context):
    return {
        "result": {"generated": 2},
        "artifacts": [
            {
                "path": "models/customer.py",
                "content": "class Customer:\n    pass\n",
                "encoding": "utf-8",
            },
            {
                "path": "schema/customer.json",
                "content": '{"type":"object"}',
            },
        ],
    }
```

The **Files** tab previews these files. **Save generated files** asks the user
to select one output directory; the Wails host, not Python, writes the files.
Existing regular files require explicit replacement confirmation.

Artifact paths are platform-neutral relative paths using `/`. Absolute paths,
`.` and `..` segments, backslashes, duplicate case-insensitive paths, Windows
reserved names, unsafe characters, and symbolic-link destinations or parents
are rejected. Artifacts support UTF-8 text only. A run may provide at most 100
files, 5 MB per file, and 25 MB in total. Writes use a temporary file and atomic
replacement for each destination.

## Runtime Boundary

The Wails host creates a fresh embedded interpreter for every run. Global
variables and imported module state do not persist between runs. Only the
bundled Python standard library is available.

The runtime denies direct host filesystem access, network resolution and
connections, and child-process execution. Generated files cross the runtime
boundary only through the validated result contract above. One run may be
active at a time and can be cancelled with `KeyboardInterrupt`.

Electron and browser mode expose the editor for development but do not execute
the script.

## Manual Verification

1. Open a Project v3 document in the Wails application and select **Run &
   Preview** so the current project context is available.
2. Open **Project actions > Project Python** and use the generated text-file
   example above as the `process(context)` return value.
3. Select **Run**. Verify that the dialog activates **Files**, lists both nested
   paths, and changes the content preview when each path is selected.
4. Select **Save generated files**, create or choose an empty output directory,
   and verify that both files are written with the exact UTF-8 content shown in
   the preview.
5. Run and save again to the same directory. Select **Cancel** in the replacement
   confirmation and verify that neither file changes. Repeat and select
   **Replace**; verify that both files contain the new content.
6. Change a returned path to `../outside.py`, `C:/outside.py`, `CON.txt`, or a
   duplicate path with different letter case. Verify that **Files** reports the
   contract error and saving is unavailable.

Python must remain unable to read the saved files with `open()`. File output is
an explicit host operation after a successful run, not Python filesystem access.
