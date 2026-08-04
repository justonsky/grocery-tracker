// Polyfills global `indexedDB` for the node test environment — the outbox
// core talks to IndexedDB via `idb`, same as it does in a real browser.
import 'fake-indexeddb/auto'
