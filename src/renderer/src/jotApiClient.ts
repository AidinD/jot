import type { JotApi } from '@shared/types'

// Module-level dependency injection for the Jot data API, so the UI never
// references the `window.jot` global directly. The shell injects the api at
// startup - the standalone app injects `window.jot` (its preload bridge); Helm's
// embedded Jot tab injects its own implementation (in-process core, or a client
// connection to a host). This indirection is what lets the SAME UI mount in two
// shells (DECISIONS 2026-07-18 "one Jot, two mounts").
//
// A module singleton (one api per renderer) is enough - a renderer only ever
// shows one Jot data source. `window.capture` stays a standalone-shell concern
// (the popover commands), so it is NOT injected here.
let injected: JotApi | null = null

export function setJotApi(api: JotApi): void {
  injected = api
}

export function jotApi(): JotApi {
  if (injected === null) {
    throw new Error('Jot API not injected - call setJotApi(...) before rendering the UI.')
  }
  return injected
}
