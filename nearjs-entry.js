// Browser entry for near-api-js (v5.1.1, same as the node scripts).
// Bundled with esbuild into site/near-api-js.bundle.js; exposes window.nearApiJs
// so the Create-your-DAO page can deploy a group's round contract with a
// fresh keypair generated in the browser. Testnet only.
// Build (from ~/workspace/egbe):
//   npx --yes esbuild@0.28.2 nearjs-entry.js --bundle --minify --platform=browser \
//     --format=iife --define:global=window --inject:./nearjs-shim.js \
//     --outfile=site/near-api-js.bundle.js
// The --define:global=window flag is REQUIRED: near-api-js references bare
// `global` at load time, and without it the bundle throws "global is not
// defined" in the browser and window.nearApiJs never appears (caught by the
// headless check 2026-11-08; the first build without the flag was broken).
// The --inject:./nearjs-shim.js flag is REQUIRED for the same reason for
// bare `process` (process.env, process.nextTick, process.pid): without it
// the bundle throws "process is not defined" instead.
import { connect, keyStores, KeyPair } from 'near-api-js';
window.nearApiJs = { connect, keyStores, KeyPair };
