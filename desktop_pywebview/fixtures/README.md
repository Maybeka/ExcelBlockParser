# Equation Conformance Fixtures

These generated JSON fixtures capture the input/output behavior of
`Maybeka/mtef-mathml` v0.2.0's existing test suite. The Python implementation
does not run, compile, download, or embed Go.

- `mtef-v020-streams.json`: 31 distinct binary MTEF inputs, expected success or
  rejection, exact MathML, and structured diagnostics.
- `mtef-v020-nodes.json`: 771 distinct typed-node/layout-position cases and exact
  MathML outputs, including documented v3/v5 templates, matrices, scripts,
  accents, limits, sizes, font mappings and spacing regressions.

The original tests were run once in an ignored local copy to capture these
expectations before removing the Go implementation. Golden output is also
checked for XML validity. Live workbook tests independently cover the public
MathType fixture and locally available three-formula reference workbook.

The implementation and bundled font maps are ported from
https://github.com/Maybeka/mtef-mathml/tree/v0.2.0 . This does not introduce a
runtime dependency on that repository or on `mathtypejx`.
