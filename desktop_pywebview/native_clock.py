"""Macrotask pump for hidden native behavior tests, never production startup."""

ZERO_DELAY_TASK_PUMP = r"""(() => {
  if (window.__nativeZeroDelayClock) return;
  window.__nativeZeroDelayClock = true;
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const tasks = new Map();
  const channel = new MessageChannel();
  const run = id => {
    const callback = tasks.get(id);
    if (!callback) return;
    tasks.delete(id);
    nativeClearTimeout(id);
    callback();
  };
  channel.port1.onmessage = event => run(event.data);
  window.setTimeout = (callback, delay, ...args) => {
    if (typeof callback !== 'function' || Number(delay) > 0) {
      return nativeTimeout(callback, delay, ...args);
    }
    const id = nativeTimeout(() => run(id), delay);
    tasks.set(id, () => callback.apply(window, args));
    channel.port2.postMessage(id);
    return id;
  };
  window.clearTimeout = id => {
    tasks.delete(id);
    nativeClearTimeout(id);
  };
})()"""
