/**
 * Generates test Excel files for manual QA of excel-block-parser.
 * Usage: node examples/generate-test-data.mjs [--performance]
 * Output: examples/test_data.xlsx, test_data_v2.xlsx, multi_sheet.xlsx, empty.xlsx, m2_integration.xlsx
 * Optional: examples/performance_50000.xlsx (exactly 50,000 cells)
 */
import ExcelJS from 'exceljs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function writeWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer();
  await writeFile(resolve(__dirname, filename), buffer);
  console.log(`  ✓ ${filename}`);
}

// ──── 1. test_data.xlsx ──────────────────────────────────────────────────────
async function generateTestData() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // Headers row 1: Name | Age | Score | City | Active
  ws.columns = [
    { header: 'Name', key: 'name', width: 14 },
    { header: 'Age', key: 'age', width: 8 },
    { header: 'Score', key: 'score', width: 10 },
    { header: 'City', key: 'city', width: 14 },
    { header: 'Active', key: 'active', width: 10 },
  ];

  const rows = [
    ['Alice',   25, 88.5,   'New York',  true],
    ['Bob',     30, 72.0,   'London',    false],
    ['Charlie', 28, 91.2,   'Tokyo',     true],
    ['Diana',   22, 65.8,   'Paris',     true],
    ['Eve',     35, 77.3,   'Berlin',    false],
    ['Frank',   27, 83.0,   'Sydney',    true],
    ['Grace',   31, 95.5,   'Toronto',   true],
    ['Hank',    29, 60.0,   'Dubai',     false],
    ['Ivy',     24, 99.9,   'Mumbai',    true],
    ['Jack',    33, 71.4,   'Seoul',     false],
  ];

  ws.addRows(rows);

  // Style header row
  ws.getRow(1).font = { bold: true };

  await writeWorkbook(wb, 'test_data.xlsx');
}

// ──── 2. test_data_v2.xlsx ───────────────────────────────────────────────────
async function generateTestDataV2() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // Modified: "Email" inserted after "Name", "City" removed, "Score" → "Points",
  //           data shifted down 3 rows (rows 1-3 are blank/metadata)
  ws.columns = [
    { header: '',      key: 'blank1',      width: 8 },
    { header: 'Name',  key: 'name',        width: 14 },
    { header: 'Email', key: 'email',       width: 24 },
    { header: 'Age',   key: 'age',         width: 8 },
    { header: 'Points', key: 'points',     width: 10 },
    { header: 'Active', key: 'active',     width: 10 },
  ];

  // Rows 1-3: blank/metadata to simulate row shift
  ws.addRow(['',           '',       '',                     '',    '',     '']);
  ws.addRow(['(metadata)', '',       '',                     '',    '',     '']);
  ws.addRow(['(metadata)', '',       '',                     '',    '',     ''  ]);
  ws.getRow(1).font = { italic: true, color: { argb: 'FF999999' } };
  ws.getRow(2).font = { italic: true, color: { argb: 'FF999999' } };
  ws.getRow(3).font = { italic: true, color: { argb: 'FF999999' } };

  // Header row 4
  ws.addRow(['', 'Name', 'Email',            'Age', 'Points', 'Active']);
  ws.getRow(4).font = { bold: true };

  // Data rows 5-14
  const rows = [
    ['', 'Alice',   'alice@test.com',   25, 88.5,  true],
    ['', 'Bob',     'bob@test.com',     30, 72.0,  false],
    ['', 'Charlie', 'charlie@test.com', 28, 91.2,  true],
    ['', 'Diana',   'diana@test.com',   22, 65.8,  true],
    ['', 'Eve',     'eve@test.com',     35, 77.3,  false],
    ['', 'Frank',   'frank@test.com',   27, 83.0,  true],
    ['', 'Grace',   'grace@test.com',   31, 95.5,  true],
    ['', 'Hank',    'hank@test.com',    29, 60.0,  false],
    ['', 'Ivy',     'ivy@test.com',     24, 99.9,  true],
    ['', 'Jack',    'jack@test.com',    33, 71.4,  false],
  ];
  ws.addRows(rows);

  await writeWorkbook(wb, 'test_data_v2.xlsx');
}

// ──── 3. multi_sheet.xlsx ────────────────────────────────────────────────────
async function generateMultiSheet() {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Products
  const ws1 = wb.addWorksheet('Products');
  ws1.columns = [
    { header: 'ID',    key: 'id',       width: 8 },
    { header: 'Name',  key: 'name',     width: 20 },
    { header: 'Price', key: 'price',    width: 12 },
    { header: 'Category', key: 'cat',   width: 14 },
  ];
  ws1.getRow(1).font = { bold: true };
  ws1.addRows([
    ['P001', 'Widget A',   19.99, 'Electronics'],
    ['P002', 'Gadget B',   34.50, 'Home'],
    ['P003', 'Tool C',     12.75, 'Hardware'],
    ['P004', 'Device D',   89.00, 'Electronics'],
    ['P005', 'Supply E',    5.49, 'Office'],
    ['P006', 'Part F',     45.00, 'Hardware'],
    ['P007', 'Kit G',      27.80, 'Home'],
    ['P008', 'Module H',   99.99, 'Electronics'],
  ]);

  // Sheet 2: Orders
  const ws2 = wb.addWorksheet('Orders');
  ws2.columns = [
    { header: 'OrderID', key: 'oid',        width: 12 },
    { header: 'Product', key: 'product',    width: 14 },
    { header: 'Qty',     key: 'qty',        width: 8 },
    { header: 'Date',    key: 'date',       width: 14 },
    { header: 'Status',  key: 'status',     width: 12 },
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.addRows([
    ['ORD-001', 'Widget A',  3, '2026-01-15', 'Shipped'],
    ['ORD-002', 'Gadget B',  1, '2026-02-01', 'Delivered'],
    ['ORD-003', 'Tool C',    5, '2026-02-10', 'Pending'],
    ['ORD-004', 'Device D',  2, '2026-03-05', 'Shipped'],
    ['ORD-005', 'Supply E', 10, '2026-03-20', 'Cancelled'],
    ['ORD-006', 'Widget A',  1, '2026-04-01', 'Delivered'],
    ['ORD-007', 'Kit G',     4, '2026-04-12', 'Shipped'],
    ['ORD-008', 'Part F',    2, '2026-05-01', 'Processing'],
    ['ORD-009', 'Module H',  1, '2026-05-10', 'Pending'],
    ['ORD-010', 'Gadget B',  3, '2026-05-20', 'Delivered'],
  ]);

  await writeWorkbook(wb, 'multi_sheet.xlsx');
}

// ──── 4. empty.xlsx ──────────────────────────────────────────────────────────
async function generateEmpty() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // Headers but no data
  ws.columns = [
    { header: 'A', key: 'a', width: 10 },
    { header: 'B', key: 'b', width: 10 },
    { header: 'C', key: 'c', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };

  await writeWorkbook(wb, 'empty.xlsx');
}

// ──── 5. M2 integration fixture ─────────────────────────────────────────────
async function generateM2Integration() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = 'Quarterly report';
  ws.addRow(['Name', 'Status', 'Count', 'Unused']);
  ws.addRow(['Alice', 'active', 2, '']);
  ws.addRow(['Bob', 'inactive', 3, '']);
  ws.addRow(['', '', '', '']);

  const regions = wb.addWorksheet('Regions');
  regions.addRows([
    ['Group A', ''],
    ['One', 'Two'],
    ['', ''],
    ['Group B', ''],
    ['Three', 'Four'],
  ]);
  await writeWorkbook(wb, 'm2_integration.xlsx');
}

async function generatePerformanceFixture() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Records');
  const columnCount = 10;
  const dataRowCount = 4_999;
  ws.addRow(Array.from({ length: columnCount }, (_, index) => `column${index + 1}`));
  for (let row = 1; row <= dataRowCount; row++) {
    ws.addRow(Array.from({ length: columnCount }, (_, column) => column === 0 ? row : `value-${row}-${column}`));
  }
  await writeWorkbook(wb, 'performance_50000.xlsx');
}

// ──── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Generating test Excel files in examples/ ...\n');
  await generateTestData();
  await generateTestDataV2();
  await generateMultiSheet();
  await generateEmpty();
  await generateM2Integration();
  if (process.argv.includes('--performance')) await generatePerformanceFixture();
  console.log(`\nDone. ${process.argv.includes('--performance') ? 'All 6 files' : 'All 5 files'} generated.`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
