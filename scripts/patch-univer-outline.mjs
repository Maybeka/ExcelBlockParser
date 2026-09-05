import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const target = resolve(process.cwd(), 'node_modules/@univerjs/sheets-ui/lib/es/index.js')
const source = await readFile(target, 'utf8')

function replaceOnce(input, search, replacement) {
  if (!input.includes(search)) throw new Error(`Univer outline patch is incompatible with @univerjs/sheets-ui 0.22.0: missing ${search.slice(0, 80)}`)
  return input.replace(search, replacement)
}

function upgradeV2ToV3(input) {
  let upgraded = input.replace('EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V2', 'EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V3')
  upgraded = replaceOnce(
    upgraded,
    'const rowCount = worksheet.getRowCount();',
    'const maxRowOutlineLevel = outlineGroups.reduce((max, group) => group.axis === "row" ? Math.max(max, group.level) : max, 1);\n\t\tconst isHiddenByCollapsedParent = (group) => outlineGroups.some((parent) => parent.axis === group.axis && parent.level < group.level && parent.start <= group.start && parent.end >= group.end && isCollapsed(parent));\n\t\tconst rowCount = worksheet.getRowCount();',
  )
  upgraded = replaceOnce(
    upgraded,
    'outlineGroups.filter((group) => group.axis === "row").map((group) => {',
    'outlineGroups.filter((group) => group.axis === "row" && !isHiddenByCollapsedParent(group)).map((group) => {',
  )
  upgraded = replaceOnce(
    upgraded,
    'Math.max(0, position.startX - 13 - Math.max(0, group.level - 1) * 14)',
    'Math.max(0, position.startX - 13 - Math.max(0, maxRowOutlineLevel - group.level) * 14)',
  )
  return upgraded
}

function upgradeV3ToV4(input) {
  let upgraded = input.replace('EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V3', 'EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V4')
  upgraded = replaceOnce(
    upgraded,
    'collapsed ? SetSpecificRowsVisibleCommand.id : SetRowHiddenCommand.id',
    'collapsed ? SetRowVisibleMutation.id : SetRowHiddenMutation.id',
  )
  upgraded = replaceOnce(
    upgraded,
    'collapsed ? SetSpecificColsVisibleCommand.id : SetColHiddenCommand.id',
    'collapsed ? SetColVisibleMutation.id : SetColHiddenMutation.id',
  )
  return upgraded
}

function upgradeV4ToV5(input) {
  let upgraded = input.replace('EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V4', 'EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V5')
  upgraded = replaceOnce(
    upgraded,
    '\t\tconst maxRowOutlineLevel = outlineGroups.reduce',
    `\t\tconst toggleOutlineGroup = (group, collapsed) => {
\t\t\tgroup.collapsed = !collapsed;
\t\t\tconst range = group.axis === "row" ? { startRow: group.start, endRow: group.end, startColumn: 0, endColumn: worksheet.getColumnCount() - 1 } : { startColumn: group.start, endColumn: group.end, startRow: 0, endRow: worksheet.getRowCount() - 1 };
\t\t\tconst commandId = group.axis === "row" ? collapsed ? SetRowVisibleMutation.id : SetRowHiddenMutation.id : collapsed ? SetColVisibleMutation.id : SetColHiddenMutation.id;
\t\t\tthis._commandService.executeCommand(commandId, { unitId: workbook.getUnitId(), subUnitId: worksheet.getSheetId(), ranges: [range], __excelBlockParserOutlineGroupId: group.id });
\t\t\tif (!collapsed) return;
\t\t\toutlineGroups.filter((child) => child.axis === group.axis && child.level > group.level && child.start >= group.start && child.end <= group.end && child.collapsed).forEach((child) => {
\t\t\t\tconst childRange = child.axis === "row" ? { startRow: child.start, endRow: child.end, startColumn: 0, endColumn: worksheet.getColumnCount() - 1 } : { startColumn: child.start, endColumn: child.end, startRow: 0, endRow: worksheet.getRowCount() - 1 };
\t\t\t\tconst childCommandId = child.axis === "row" ? SetRowHiddenMutation.id : SetColHiddenMutation.id;
\t\t\t\tthis._commandService.executeCommand(childCommandId, { unitId: workbook.getUnitId(), subUnitId: worksheet.getSheetId(), ranges: [childRange], __excelBlockParserOutlineGroupId: child.id });
\t\t\t});
\t\t};
\t\tconst maxRowOutlineLevel = outlineGroups.reduce`,
  )
  upgraded = replaceOnce(
    upgraded,
    `}, () => this._commandService.executeCommand(collapsed ? SetRowVisibleMutation.id : SetRowHiddenMutation.id, {
\t\t\t\tunitId: workbook.getUnitId(),
\t\t\t\tsubUnitId: worksheet.getSheetId(),
\t\t\t\tranges: [range],
\t\t\t\t__excelBlockParserOutlineGroupId: group.id
\t\t\t}));`,
    '}, () => toggleOutlineGroup(group, collapsed));',
  )
  upgraded = replaceOnce(
    upgraded,
    `}, () => this._commandService.executeCommand(collapsed ? SetColVisibleMutation.id : SetColHiddenMutation.id, {
\t\t\t\tunitId: workbook.getUnitId(),
\t\t\t\tsubUnitId: worksheet.getSheetId(),
\t\t\t\tranges: [range],
\t\t\t\t__excelBlockParserOutlineGroupId: group.id
\t\t\t}));`,
    '}, () => toggleOutlineGroup(group, collapsed));',
  )
  return upgraded
}

if (source.includes('EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V5')) process.exit(0)

if (source.includes('EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V2')) {
  await writeFile(target, upgradeV4ToV5(upgradeV3ToV4(upgradeV2ToV3(source))))
  process.exit(0)
}

if (source.includes('EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V3')) {
  await writeFile(target, upgradeV4ToV5(upgradeV3ToV4(source)))
  process.exit(0)
}

if (source.includes('EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V4')) {
  await writeFile(target, upgradeV4ToV5(source))
  process.exit(0)
}

if (source.includes('EXCEL_BLOCK_PARSER_OUTLINE_PATCH')) {
  let upgraded = source.replace('EXCEL_BLOCK_PARSER_OUTLINE_PATCH', 'EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V2')
  upgraded = replaceOnce(
    upgraded,
    'ranges: [range]\n\t\t\t}));\n\t\t}) : hiddenRowRanges.map',
    'ranges: [range],\n\t\t\t\t__excelBlockParserOutlineGroupId: group.id\n\t\t\t}));\n\t\t}) : hiddenRowRanges.map',
  )
  upgraded = replaceOnce(
    upgraded,
    'ranges: [range]\n\t\t\t}));\n\t\t}) : hiddenColRanges.map',
    'ranges: [range],\n\t\t\t\t__excelBlockParserOutlineGroupId: group.id\n\t\t\t}));\n\t\t}) : hiddenColRanges.map',
  )
  await writeFile(target, upgradeV2ToV3(upgraded))
  process.exit(0)
}

let patched = source
if (!patched.includes('SetRowHeightCommand, SetRowHiddenCommand, SetRowHiddenMutation,')) {
  patched = replaceOnce(
    patched,
    'SetRowHeightCommand, SetRowHiddenMutation, SetRowVisibleMutation,',
    'SetRowHeightCommand, SetRowHiddenCommand, SetRowHiddenMutation, SetRowVisibleMutation,',
  )
}
patched = replaceOnce(
  patched,
  '_defineProperty(this, "_unhideType", void 0);',
  '_defineProperty(this, "_unhideType", void 0);\n\t\t_defineProperty(this, "_outlineToggle", false);\n\t\t_defineProperty(this, "_collapsed", false);',
)
patched = replaceOnce(
  patched,
  'if (props.type !== void 0) this._unhideType = props.type;\n\t\tif (props.hovered !== void 0) this._hovered = props.hovered;',
  'if (props.type !== void 0) this._unhideType = props.type;\n\t\tif (props.outlineToggle !== void 0) this._outlineToggle = props.outlineToggle;\n\t\tif (props.collapsed !== void 0) this._collapsed = props.collapsed;\n\t\tif (props.hovered !== void 0) this._hovered = props.hovered;',
)
patched = replaceOnce(
  patched,
  'width: this._size * (this._unhideType === 1 ? 2 : 1),\n\t\t\theight: this._size * (this._unhideType === 0 ? 2 : 1)',
  'width: this._outlineToggle ? this._size : this._size * (this._unhideType === 1 ? 2 : 1),\n\t\t\theight: this._outlineToggle ? this._size : this._size * (this._unhideType === 0 ? 2 : 1)',
)
patched = replaceOnce(
  patched,
  '\t_draw(ctx) {\n\t\tif (this._unhideType === 0) this._drawOnRow(ctx);\n\t\telse this._drawOnCol(ctx);\n\t}\n\t_drawOnRow(ctx) {',
  `\t_draw(ctx) {
\t\tif (this._outlineToggle) {
\t\t\tthis._drawOutlineToggle(ctx);
\t\t\treturn;
\t\t}
\t\tif (this._unhideType === 0) this._drawOnRow(ctx);
\t\telse this._drawOnCol(ctx);
\t}
\t_drawOutlineToggle(ctx) {
\t\tRect.drawWith(ctx, {
\t\t\twidth: this._size,
\t\t\theight: this._size,
\t\t\tstroke: HEADER_MENU_SHAPE_TRIANGLE_FILL,
\t\t\tfill: this._hovered ? HEADER_MENU_BACKGROUND_COLOR : \"rgba(255, 255, 255, 0.92)\"
\t\t});
\t\tctx.save();
\t\tctx.strokeStyle = HEADER_MENU_SHAPE_TRIANGLE_FILL;
\t\tctx.lineWidth = 1.5;
\t\tctx.beginPath();
\t\tctx.moveTo(3, this._size / 2);
\t\tctx.lineTo(this._size - 3, this._size / 2);
\t\tif (this._collapsed) {
\t\t\tctx.moveTo(this._size / 2, 3);
\t\t\tctx.lineTo(this._size / 2, this._size - 3);
\t\t}
\t\tctx.stroke();
\t\tctx.restore();
\t}
\t_drawOnRow(ctx) {`,
)

const oldControllerBody = `\t\tconst hiddenRowRanges = worksheet.getHiddenRows();
\t\tconst hiddenColRanges = worksheet.getHiddenCols();
\t\tconst { scene } = this._getSheetObject();
\t\tconst rowCount = worksheet.getRowCount();
\t\tconst rowShapes = hiddenRowRanges.map((range) => {
\t\t\tconst { startRow, endRow } = range;
\t\t\tconst position = getCoordByCell(startRow, 0, scene, skeleton);
\t\t\tconst hasPrevious = startRow !== 0;
\t\t\tconst hasNext = endRow !== rowCount - 1;
\t\t\treturn new HeaderUnhideShape(HEADER_UNHIDE_CONTROLLER_SHAPE, {
\t\t\t\ttype: 0,
\t\t\t\thovered: false,
\t\t\t\thasPrevious,
\t\t\t\thasNext,
\t\t\t\ttop: position.startY - (hasPrevious ? 12 : 0),
\t\t\t\tleft: position.startX - 12
\t\t\t}, () => this._commandService.executeCommand(SetSpecificRowsVisibleCommand.id, {
\t\t\t\tunitId: workbook.getUnitId(),
\t\t\t\tsubUnitId: worksheet.getSheetId(),
\t\t\t\tranges: [range]
\t\t\t}));
\t\t});
\t\tconst colCount = worksheet.getColumnCount();
\t\tconst colShapes = hiddenColRanges.map((range) => {
\t\t\tconst { startColumn, endColumn } = range;
\t\t\tconst position = getCoordByCell(0, startColumn, scene, skeleton);
\t\t\tconst hasPrevious = startColumn !== 0;
\t\t\tconst hasNext = endColumn !== colCount - 1;
\t\t\treturn new HeaderUnhideShape(HEADER_UNHIDE_CONTROLLER_SHAPE, {
\t\t\t\ttype: 1,
\t\t\t\thovered: false,
\t\t\t\thasPrevious,
\t\t\t\thasNext,
\t\t\t\ttop: 20 - 12,
\t\t\t\tleft: position.startX - (hasPrevious ? 12 : 0)
\t\t\t}, () => this._commandService.executeCommand(SetSpecificColsVisibleCommand.id, {
\t\t\t\tunitId: workbook.getUnitId(),
\t\t\t\tsubUnitId: worksheet.getSheetId(),
\t\t\t\tranges: [range]
\t\t\t}));
\t\t});`

const newControllerBody = `\t\tconst hiddenRowRanges = worksheet.getHiddenRows();
\t\tconst hiddenColRanges = worksheet.getHiddenCols();
\t\tconst { scene } = this._getSheetObject();
\t\t// EXCEL_BLOCK_PARSER_OUTLINE_PATCH: project-owned groups remain visible
\t\t// after expansion, so they can be collapsed again without reloading.
\t\tconst outlineConfig = worksheet.__excelBlockParserOutlineGroups;
\t\tconst outlineGroups = (outlineConfig === null || outlineConfig === void 0 ? void 0 : outlineConfig.enabled) && Array.isArray(outlineConfig.groups) ? outlineConfig.groups : [];
\t\tconst isCollapsed = (group) => {
\t\t\tconst ranges = group.axis === \"row\" ? hiddenRowRanges : hiddenColRanges;
\t\t\treturn ranges.some((range) => group.axis === \"row\" ? range.startRow <= group.start && range.endRow >= group.end : range.startColumn <= group.start && range.endColumn >= group.end);
\t\t};
\t\tconst rowCount = worksheet.getRowCount();
\t\tconst rowShapes = outlineGroups.length ? outlineGroups.filter((group) => group.axis === \"row\").map((group) => {
\t\t\tconst range = { startRow: group.start, endRow: group.end, startColumn: 0, endColumn: worksheet.getColumnCount() - 1 };
\t\t\tconst position = getCoordByCell(group.start, 0, scene, skeleton);
\t\t\tconst collapsed = isCollapsed(group);
\t\t\treturn new HeaderUnhideShape(HEADER_UNHIDE_CONTROLLER_SHAPE, {
\t\t\t\ttype: 0,
\t\t\t\toutlineToggle: true,
\t\t\t\tcollapsed,
\t\t\t\thovered: false,
\t\t\t\ttop: position.startY - 6,
\t\t\t\tleft: Math.max(0, position.startX - 13 - Math.max(0, group.level - 1) * 14)
\t\t\t}, () => this._commandService.executeCommand(collapsed ? SetSpecificRowsVisibleCommand.id : SetRowHiddenCommand.id, {
\t\t\t\tunitId: workbook.getUnitId(),
\t\t\t\tsubUnitId: worksheet.getSheetId(),
\t\t\t\tranges: [range]
\t\t\t}));
\t\t}) : hiddenRowRanges.map((range) => {
\t\t\tconst { startRow, endRow } = range;
\t\t\tconst position = getCoordByCell(startRow, 0, scene, skeleton);
\t\t\tconst hasPrevious = startRow !== 0;
\t\t\tconst hasNext = endRow !== rowCount - 1;
\t\t\treturn new HeaderUnhideShape(HEADER_UNHIDE_CONTROLLER_SHAPE, { type: 0, hovered: false, hasPrevious, hasNext, top: position.startY - (hasPrevious ? 12 : 0), left: position.startX - 12 }, () => this._commandService.executeCommand(SetSpecificRowsVisibleCommand.id, { unitId: workbook.getUnitId(), subUnitId: worksheet.getSheetId(), ranges: [range] }));
\t\t});
\t\tconst colCount = worksheet.getColumnCount();
\t\tconst colShapes = outlineGroups.length ? outlineGroups.filter((group) => group.axis === \"column\").map((group) => {
\t\t\tconst range = { startColumn: group.start, endColumn: group.end, startRow: 0, endRow: worksheet.getRowCount() - 1 };
\t\t\tconst position = getCoordByCell(0, group.start, scene, skeleton);
\t\t\tconst collapsed = isCollapsed(group);
\t\t\treturn new HeaderUnhideShape(HEADER_UNHIDE_CONTROLLER_SHAPE, {
\t\t\t\ttype: 1,
\t\t\t\toutlineToggle: true,
\t\t\t\tcollapsed,
\t\t\t\thovered: false,
\t\t\t\ttop: Math.max(1, 3 + Math.max(0, group.level - 1) * 12),
\t\t\t\tleft: position.startX - 6
\t\t\t}, () => this._commandService.executeCommand(collapsed ? SetSpecificColsVisibleCommand.id : SetColHiddenCommand.id, {
\t\t\t\tunitId: workbook.getUnitId(),
\t\t\t\tsubUnitId: worksheet.getSheetId(),
\t\t\t\tranges: [range]
\t\t\t}));
\t\t}) : hiddenColRanges.map((range) => {
\t\t\tconst { startColumn, endColumn } = range;
\t\t\tconst position = getCoordByCell(0, startColumn, scene, skeleton);
\t\t\tconst hasPrevious = startColumn !== 0;
\t\t\tconst hasNext = endColumn !== colCount - 1;
\t\t\treturn new HeaderUnhideShape(HEADER_UNHIDE_CONTROLLER_SHAPE, { type: 1, hovered: false, hasPrevious, hasNext, top: 20 - 12, left: position.startX - (hasPrevious ? 12 : 0) }, () => this._commandService.executeCommand(SetSpecificColsVisibleCommand.id, { unitId: workbook.getUnitId(), subUnitId: worksheet.getSheetId(), ranges: [range] }));
\t\t});`

const newControllerBodyV2 = newControllerBody
  .replace('EXCEL_BLOCK_PARSER_OUTLINE_PATCH', 'EXCEL_BLOCK_PARSER_OUTLINE_PATCH_V2')
  .replace(
    'ranges: [range]\n\t\t\t}));\n\t\t}) : hiddenRowRanges.map',
    'ranges: [range],\n\t\t\t\t__excelBlockParserOutlineGroupId: group.id\n\t\t\t}));\n\t\t}) : hiddenRowRanges.map',
  )
  .replace(
    'ranges: [range]\n\t\t\t}));\n\t\t}) : hiddenColRanges.map',
    'ranges: [range],\n\t\t\t\t__excelBlockParserOutlineGroupId: group.id\n\t\t\t}));\n\t\t}) : hiddenColRanges.map',
  )

const newControllerBodyV5 = upgradeV4ToV5(upgradeV3ToV4(upgradeV2ToV3(newControllerBodyV2)))

patched = replaceOnce(patched, oldControllerBody, newControllerBodyV5)
await writeFile(target, patched)
