# Session And JSON Contract

## Stable Contract: Version 2

The exported JSON document is the public contract between Excel Block Parser
and downstream tools. Version 2 is the stabilization-release contract. New
consumers must require `version: 2`; the application continues to import
version 1 sessions and migrates them in memory by adding an empty
`config.regions` array.

The contract has two related uses:

- **Template:** `config` describes reusable workbook extraction settings.
- **Extraction output:** `data`, `blockResults`, and `regionResults` contain
  the result of the most recent parse.

Consumers that generate code must use `data` and, where needed,
`blockResults`. They must not depend on workbook paths, React state, UI
selection state, or `dataSnapshot`, which is an optional editor aid.

## Required Top-Level Shape

```json
{
  "version": 2,
  "exportedAt": "2026-07-16T00:00:00.000Z",
  "config": {
    "blocks": [],
    "activeBlockId": "",
    "focusMode": "always-editable",
    "regions": []
  },
  "data": {},
  "blockResults": []
}
```

`regionResults` is omitted when no configured region produced output. A
top-level `sourceFileName` is optional and informational only.

Each `blockResults` item has a stable `blockId`, `label`, `rowCount`, and
`data` array. The keys in a row are the configured column keys. `data` is an
object keyed by block label and contains the same row data for convenient
consumption. Block labels therefore need to be unique for unambiguous output.

## Compatibility Rules

- Version 2 fields and their meaning are stable throughout the 1.x release
  line.
- Compatible changes may add optional fields only.
- Renaming, removing, or changing the type/meaning of an existing v2 field
  requires a new session version and an explicit migration.
- `null` means an unavailable cell/configuration value; a missing optional
  field means the feature was not exported.
- Dates are exported as `YYYY-MM-DD`; export timestamps are ISO-8601 UTC
  strings.

The machine-readable contract is [session-v2.schema.json](session-v2.schema.json).
It is intentionally permissive for optional editor metadata while requiring
the stable fields that downstream consumers depend on.

## Migration

Version 1 sessions lack region configuration. Importing one creates
`config.regions: []` and reports that it was migrated. Re-exporting produces
the canonical version 2 form. No older session version is supported.
