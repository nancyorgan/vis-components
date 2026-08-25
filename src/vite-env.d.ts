/// <reference types="vite/client" />

/** Injected at compile time via `define` in vite.config.ts. */
declare const __APP_VERSION__: string
/** ISO timestamp of when the bundle was built (dev: server start). */
declare const __BUILD_DATE__: string
/** Path (relative to the app base) of the optional ZIP/ZCTA boundary asset
 *  this build serves as a sidecar file, or null when it ships without ZIP
 *  maps. See vite.config.ts and lib/geo/zctaTopology.ts. */
declare const __ZCTA_ASSET_PATH__: string | null
