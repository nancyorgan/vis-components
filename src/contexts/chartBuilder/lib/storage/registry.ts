/** Storage adapter registry.
 *
 *  A single module-level slot holds the active {@link StorageContentAdapter}.
 *  It's a registry (not React context) because the persisted Jotai atoms in
 *  `store/atoms.ts` are defined at module scope and can't read context.
 *
 *  Contract: a host that wants non-default persistence (a hosted/cloud build)
 *  calls {@link setStorageAdapter} ONCE at boot, before the app renders. The
 *  open-source / local build leaves the default {@link localStorageAdapter}
 *  in place. */

import { localStorageAdapter, type StorageContentAdapter } from "./adapter"

let activeAdapter: StorageContentAdapter = localStorageAdapter

/** Install the content-storage adapter. Call once before render; later calls
 *  won't retroactively re-bootstrap atoms that have already mounted. */
export const setStorageAdapter = (adapter: StorageContentAdapter): void => {
	activeAdapter = adapter
}

/** The active content-storage adapter. Defaults to the browser-local one. */
export const getStorageAdapter = (): StorageContentAdapter => activeAdapter
