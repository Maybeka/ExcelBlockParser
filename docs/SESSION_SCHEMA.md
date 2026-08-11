# Project JSON Contract

## Stable Contract: Version 3

The saved JSON document is the application project file and the public
contract for downstream tools. Its filename, without `.json`, is the project
name. Opening a file makes that filename authoritative; **Save Project As**
therefore renames the project.

The project contains both editor configuration and the most recent extraction
result:

- `project` defines workbook sources, extractors, regions, ordering, and active
  editor state.
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
    "focusMode": "always-editable"
  },
  "data": {},
  "blockResults": []
}
```

Each workbook has a stable `id`, display `name`, optional `sourcePath`, known
`sheetNames`, and `activeSheetName`. Relative source paths are resolved from
the project file directory. If a source cannot be opened, the application
requires the user to reassign its path or remove it in Project settings.

Every block and region belongs to exactly one workbook through `workbookId`.
Names need only be unique within that workbook. Parsed `data` is keyed first by
workbook ID and then by extractor label so equal labels in different workbooks
remain unambiguous.

## Lifecycle

- **Open Project** loads v3, authorizes configured workbook paths, and opens
  all available workbooks.
- **Save Project** overwrites the currently opened or previously saved path.
- **Save Project As** chooses a new path and updates the project name from that
  filename.
- **New Project** creates an unsaved project; its first Save opens Save As.
- **Close Project** clears the active project and attached workbook runtime.

## Compatibility

Project v3 is the only supported project format. Versions 1 and 2 are rejected
with an unsupported-version error; the application does not attempt partial or
best-effort migration. All newly saved files use version 3.

The machine-readable current contract is
[project-v3.schema.json](project-v3.schema.json).
