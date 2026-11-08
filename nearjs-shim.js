// Minimal `process` shim for the browser build of near-api-js.
// near-api-js and its deps read process.env, process.nextTick, process.pid
// and a few deprecation flags at load time; browsers have no `process`
// global, so without this the bundle throws "process is not defined" and
// window.nearApiJs never appears. Injected by esbuild (--inject) when the
// bundle is built; see the build command in nearjs-entry.js.
export const process = {
  env: { NODE_ENV: "production" },
  nextTick: function (fn) { setTimeout(fn, 0); },
  pid: 0,
  noDeprecation: false,
  throwDeprecation: false,
  traceDeprecation: false,
  versions: {},
};
