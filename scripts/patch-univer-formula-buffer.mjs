import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const marker = 'EXCEL_BLOCK_PARSER_FORMULA_BUFFER_PATCH_V1'

export function patchFormulaBuffer(source, commonjs = false) {
  const original = commonjs
    ? 'this._formulaChangeWithRange$.pipe((0, rxjs.bufferWhen)(() => this.calculateStarted$.pipe((0, rxjs.filter)((calculateStarted) => calculateStarted))))'
    : 'this._formulaChangeWithRange$.pipe(bufferWhen(() => this.calculateStarted$.pipe(filter((calculateStarted) => calculateStarted))))'
  const replacement = commonjs
    ? 'this._formulaChangeWithRange$.pipe((0, rxjs.buffer)(this.calculateStarted$.pipe((0, rxjs.filter)((calculateStarted) => calculateStarted), (0, rxjs.take)(1))), (0, rxjs.take)(1))'
    : 'this._formulaChangeWithRange$.pipe(buffer(this.calculateStarted$.pipe(filter((calculateStarted) => calculateStarted), take(1))), take(1))'
  if (source.includes(marker) && source.includes(replacement)) return source
  if (source.split(original).length !== 2) throw new Error('Univer formula buffer patch: expected exactly one startup buffer')
  let patched = source.replace(original, `/* ${marker} */ ${replacement}`)
  if (!commonjs) {
    const imports = 'BehaviorSubject, Observable, Subject, bufferWhen, combineLatest, distinctUntilChanged, filter, map, shareReplay'
    if (!patched.includes(imports)) throw new Error('Univer formula buffer patch: incompatible RxJS imports')
    patched = patched.replace(imports, 'BehaviorSubject, Observable, Subject, buffer, combineLatest, distinctUntilChanged, filter, map, shareReplay, take')
  }
  return patched
}

export async function patchInstalledFormulaBuffers(root = process.cwd()) {
  for (const variant of ['index.js', 'es/index.js', 'cjs/index.js']) {
    const path = resolve(root, 'node_modules/@univerjs/engine-formula/lib', variant)
    const source = await readFile(path, 'utf8')
    const patched = patchFormulaBuffer(source, variant.startsWith('cjs/'))
    if (patched !== source) await writeFile(path, patched)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await patchInstalledFormulaBuffers()
}
