import assert from 'node:assert/strict'
import test from 'node:test'
import * as rxjs from 'rxjs'
import { patchFormulaBuffer } from './patch-univer-formula-buffer.mjs'

function original(commonjs) {
  const imports = commonjs ? '' : 'import { BehaviorSubject, Observable, Subject, bufferWhen, combineLatest, distinctUntilChanged, filter, map, shareReplay } from "rxjs";\n'
  const buffer = commonjs
    ? '(0, rxjs.bufferWhen)(() => this.calculateStarted$.pipe((0, rxjs.filter)((calculateStarted) => calculateStarted)))'
    : 'bufferWhen(() => this.calculateStarted$.pipe(filter((calculateStarted) => calculateStarted)))'
  return `${imports}this.disposeWithMe(this._formulaChangeWithRange$.pipe(${buffer}).subscribe(options => options.forEach(handleRegister)));
this.disposeWithMe(this._formulaChangeWithRange$.pipe(rxjs.filter(() => this.calculateStarted$.getValue())).subscribe(handleRegister));`
}

for (const commonjs of [false, true]) {
  test(`${commonjs ? 'CommonJS' : 'ESM'} buffers startup changes once and registers subsequent changes directly`, () => {
    for (const alreadyStarted of [false, true]) {
      const source = new rxjs.Subject(), started = new rxjs.BehaviorSubject(alreadyStarted)
      const handled = [], subscriptions = []
      const patched = patchFormulaBuffer(original(commonjs), commonjs).replace(/^import[^\n]+\n/, '')
      const context = {_formulaChangeWithRange$: source, calculateStarted$: started, disposeWithMe: value => subscriptions.push(value)}
      const initialize = new Function('buffer', 'filter', 'take', 'rxjs', 'handleRegister', patched)
      initialize.call(context, rxjs.buffer, rxjs.filter, rxjs.take, rxjs, value => handled.push(value))
      source.next('early')
      assert.deepEqual(handled, alreadyStarted ? ['early'] : [])
      started.next(true)
      assert.deepEqual(handled, ['early'])
      assert.equal(subscriptions[0].closed, true)
      source.next('late')
      started.next(true)
      assert.deepEqual(handled, ['early', 'late'])
      subscriptions.forEach(value => value.unsubscribe())
    }
  })
}

test('patch is idempotent and rejects unexpected dependency layouts', () => {
  for (const commonjs of [false, true]) {
    const patched = patchFormulaBuffer(original(commonjs), commonjs)
    assert.equal(patchFormulaBuffer(patched, commonjs), patched)
    assert.throws(() => patchFormulaBuffer('unrelated source', commonjs), /expected exactly one/)
    assert.throws(() => patchFormulaBuffer(original(commonjs) + original(commonjs), commonjs), /expected exactly one/)
  }
})
