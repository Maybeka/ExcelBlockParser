# Project JSON Contract

## Current Development Format: Version 3

The saved JSON document is the current application project format. It may
change before the 2.0.0 compatibility commitment. Its filename, without
`.json`, is the project name. Opening a file makes that filename authoritative;
**Save Project As** therefore renames the project.

The project contains both editor configuration and the most recent extraction
result:

- `project` defines workbook sources, extractors, regions, ordering, and active
  editor state. Its optional `pythonScript` stores a self-contained multi-file
  Python package with an explicit entry file.
- `data`, `blockResults`, and optional `regionResults` contain the most recent
  successful run result.
- `exportedAt` records when the project file was last saved.

## Required Top-Level Shape

```json
{
  "version": 3,
  "exportedAt": "2026-08-09T00:00:00.000Z",
  "project": {
    "id": "project-1",
    "name": "Example project",
    "workbooks": [],
    "activeWorkbookId": null,
    "blocks": [],
    "regions": [],
    "activeBlockId": "",
    "activeRegionId": null,
    "focusMode": "always-editable",
    "pythonScript": {
      "entryPath": "main.py",
      "files": [
        { "path": "main.py", "source": "from helpers import transform\n\ndef process(context):\n    return transform(context)\n" },
        { "path": "helpers.py", "source": "def transform(context):\n    return context[\"data\"]\n" }
      ]
    }
  },
  "data": {},
  "blockResults": []
}
```

Each workbook has a stable `id`, display `name`, optional `sourcePath`, known
`sheetNames`, and `activeSheetName`. Relative source paths are resolved from
the project file directory. If a source cannot be opened, the application
requires the user to reassign its path or remove it in Project settings.
Saving or using Save Project As automatically persists workbook sources
relative to the destination project file whenever both paths are on the same
filesystem root. Windows sources on a different drive remain absolute. Runtime
file authorization continues to use resolved paths and is not stored as UI
state.

Blocks and regions are project-level ordered collections. Every item belongs to
exactly one workbook through `workbookId`; selecting an item in project
navigation activates its owning workbook and sheet. Names need only be unique
within that workbook. Parsed `data` is keyed first by workbook ID and then by
extractor label so equal labels in different workbooks remain unambiguous.

The Python source is project configuration, not extracted output. It is only
executed after an explicit user action and receives the current `data`,
`blockResults`, and `regionResults` through the contract documented in
[PROJECT_PYTHON.md](PROJECT_PYTHON.md).

## Lifecycle

- **Open Project** loads v3, authorizes configured workbook paths, and opens
  all available workbooks.
- **Save Project** overwrites the currently opened or previously saved path.
- **Save Project As** chooses a new path and updates the project name from that
  filename.
- **New Project** creates an unsaved project; its first Save opens Save As.
- **Close Project** clears the active project and attached workbook runtime.

## Development Compatibility

Before 2.0.0, the application validates only the current v3 shape. Earlier
development JSON files may be rejected, even when their `version` is `3`.
Versions 1 and 2 are also unsupported. The application does not attempt
partial or best-effort migration.

The machine-readable current contract is
[project-v3.schema.json](project-v3.schema.json).
