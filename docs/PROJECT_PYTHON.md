# Project Python Contract

## Purpose

Each Project v3 document may store one self-contained multi-file Python package at
`project.pythonScript`. The package transforms the complete result from
the current project extraction. Execution is always explicit through
**Project actions > Project Python > Run**. Selecting **Run** first refreshes
the project extraction input without opening the extraction preview, then
executes the Python script.

The script is not assigned to individual blocks or regions and is not run when
a project is opened, saved, recovered, or parsed.

The editor provides semantic syntax highlighting, search, bracket matching,
code folding, syntax diagnostics, local and member completion, definition
hover details, a file tree, and a hierarchical class/function/method symbol
tree. `F12` and `Cmd/Ctrl + click` go to definitions; a resolvable symbol is
underlined while the navigation modifier is held.

The local semantic model distinguishes class construction from function calls
and resolves instance methods from constructor assignments, type annotations,
`self` attributes, return annotations, and class inheritance. This support is
also resolves direct imports between project files, imported module members, and
methods on instances constructed from imported classes. It does not resolve
installed packages, wildcard or dynamic imports, dynamically assigned members,
decorators that replace types, or other runtime-only Python behavior. Full
cross-module Python semantics would require a separate language server and are
outside the embedded editor boundary.

## Package Files And Entry Point

The package is stored in the project JSON, never loaded from a developer
workspace. It contains `entryPath` and a list of UTF-8 `.py` files. Paths are
relative, use `/`, cannot contain `.` or `..`, and are unique without regard to
case so the package is portable to Windows. The default entry is `main.py`.

Use the Files tree in **Project Python** to add, select, rename, delete, and
choose an entry file. Create `generators/models.py` directly to add a nested
module. Imports between project files use ordinary Python imports:

```python
# main.py
from generators.models import build

def process(context):
    return build(context["data"])
```

```python
# generators/models.py
def build(data):
    return {"records": data}
```

The entry file must define this callable:

The script must define this callable:

```python
def process(context):
    return context["data"]
```

`process` receives one dictionary. Its return value must be JSON serializable.
Each file accepts up to 2 MB; the full package accepts up to 8 MB. Python runs
from a fresh virtual filesystem for every execution. Only project files and the
embedded standard library can be imported. The package still cannot read or
write host files, access the network, execute processes, or install packages.

The default package returns a JSON-safe summary and three generated files:
`generated/project-summary.json`, `generated/project_data.py`, and
`generated/project_summary.sv`. It is a
working `process(context)` example for both result review and file export.

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

The **Files** tab previews this structured file collection and selects one file
at a time. Python (`.py`), JSON (`.json`), Verilog (`.v`, `.vh`) and
SystemVerilog (`.sv`, `.svh`) previews use the bundled Shiki TextMate grammars
with the Catppuccin Latte theme; other UTF-8 text is shown verbatim. **Save generated files** asks the user
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

1. Open a Project v3 document in the Wails application.
2. Open **Project actions > Project Python** and use the generated text-file
   example above as the `process(context)` return value.
3. Select **Run**. Verify that the workspace prepares the current extraction
   input without opening the extraction preview, activates **Files**, lists the generated
   paths, and changes the content preview when each path is selected.
4. Select **Save generated files**, create or choose an empty output directory,
   and verify that all files are written with the exact UTF-8 content shown in
   the preview.
5. Run and save again to the same directory. Select **Cancel** in the replacement
   confirmation and verify that neither file changes. Repeat and select
   **Replace**; verify that all files contain the new content.
6. Change a returned path to `../outside.py`, `C:/outside.py`, `CON.txt`, or a
   duplicate path with different letter case. Verify that **Files** reports the
   contract error and saving is unavailable.

Python must remain unable to read the saved files with `open()`. File output is
an explicit host operation after a successful run, not Python filesystem access.
