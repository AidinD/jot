// @jot/core (in-progress) - the framework-agnostic Jot core: the data model,
// the storage seam, and the in-memory TodoStore with its change-event bus and
// external-file watch. NO electron, NO IPC - a shell (the standalone app, or
// Helm) injects the data dir + a StorageAdapter and wires it to a transport.
// See DECISIONS 2026-07-18 "Split into core + UI".
export * from './types'
export * from './storage'
export * from './store'
