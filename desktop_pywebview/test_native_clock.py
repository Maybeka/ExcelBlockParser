import json
import subprocess
import unittest

from desktop_pywebview.native_clock import ZERO_DELAY_TASK_PUMP


class NativeClockTests(unittest.TestCase):
    def check_js(self, assertions):
        harness = """
          const assert = require('node:assert/strict');
          const timers = new Map(), messages = [];
          let nextId = 1;
          global.MessageChannel = class {
            constructor() {
              this.port1 = {};
              this.port2 = {postMessage: id => messages.push(() => this.port1.onmessage({data: id}))};
            }
          };
          global.window = {
            setTimeout: (callback, delay, ...args) => {
              const id = nextId++;
              timers.set(id, {callback, delay, args});
              return id;
            },
            clearTimeout: id => timers.delete(id),
          };
        """
        subprocess.run(['node', '-e', harness + f'eval({json.dumps(ZERO_DELAY_TASK_PUMP)});' + assertions],
                       check=True, capture_output=True, text=True, timeout=10)

    def test_async_arguments_this_and_single_delivery(self):
        self.check_js("""
          const values = [];
          const id = window.setTimeout(function(value) { assert.equal(this, window); values.push(value); }, 0, 'first');
          assert.equal(typeof id, 'number');
          assert.deepEqual(values, []);
          const native = timers.get(id);
          messages.shift()();
          native.callback();
          assert.deepEqual(values, ['first']);
          assert.equal(timers.has(id), false);
        """)

    def test_cancel_and_positive_or_string_timers(self):
        self.check_js("""
          const id = window.setTimeout(() => assert.fail('cancelled callback'), 0);
          window.clearTimeout(id);
          messages.shift()();
          assert.equal(timers.has(id), false);
          const positive = window.setTimeout(() => {}, 25, 'argument');
          assert.deepEqual(timers.get(positive).args, ['argument']);
          assert.equal(timers.get(positive).delay, 25);
          const string = window.setTimeout('original()', 0);
          assert.equal(timers.get(string).callback, 'original()');
          assert.equal(messages.length, 0);
        """)

    def test_native_firing_first_and_fifo_nested_tasks(self):
        self.check_js("""
          const values = [];
          const id = window.setTimeout(() => values.push('native'), 0);
          timers.get(id).callback();
          messages.shift()();
          assert.deepEqual(values, ['native']);
          window.setTimeout(() => { values.push('first'); window.setTimeout(() => values.push('nested'), 0); }, 0);
          window.setTimeout(() => values.push('second'), 0);
          while (messages.length) messages.shift()();
          assert.deepEqual(values, ['native', 'first', 'second', 'nested']);
          assert.equal(timers.size, 0);
        """)

    def test_idempotent_install_and_callback_error_cleanup(self):
        self.check_js(f"""
          const timeout = window.setTimeout;
          eval({json.dumps(ZERO_DELAY_TASK_PUMP)});
          assert.equal(window.setTimeout, timeout);
          window.setTimeout(() => {{ throw new Error('test error'); }}, 0);
          assert.throws(messages.shift(), /test error/);
          assert.equal(timers.size, 0);
        """)
