import ExcelJS from 'exceljs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const directory = resolve(root, '.tmp/pywebview-drawing-fixtures')
await mkdir(directory, { recursive: true })
const workbook = new ExcelJS.Workbook()
const image = workbook.addImage({
  buffer: await readFile(resolve(root, 'build/icon-transparent.png')),
  extension: 'png',
})
workbook.addWorksheet('Image').addImage(image, { tl: { col: 1, row: 1 }, ext: { width: 48, height: 48 } })
await workbook.xlsx.writeFile(resolve(directory, 'image.xlsx'))
console.log('Prepared pywebview embedded-image fixture')
