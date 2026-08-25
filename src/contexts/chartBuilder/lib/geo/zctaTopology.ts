import type { GeometryCollection, Topology } from "topojson-specification"

/**
 * The ZCTA (ZIP Code Tabulation Area) topology loader SEAM.
 *
 * Unlike states/counties/countries, no ZCTA TopoJSON ships in the us-atlas /
 * world-atlas package family, and full-US ZCTA boundaries (~33k polygons) run
 * to several MB even aggressively simplified — far too large to inline into
 * the shareable single-file build for a level most charts never touch. So the
 * ZCTA level is fully plumbed (level detection, join, rendering, sidebar)
 * against this seam, and the DATA arrives one of three ways:
 *
 * 1. **Sidecar asset** (the supported route): `pnpm zcta` generates
 *    `public/geo/zcta-500k.json` from the public Census source (see
 *    tooling/build-zcta-topology.js). Vite copies public/ into dist/ as
 *    separate files, so the topology is FETCHED the first time a visual uses
 *    the level — never parsed at boot — and dist/index.html is unchanged in
 *    size. vite.config.ts turns the file's presence at build time into
 *    `__ZCTA_ASSET_PATH__`, so enabling ZIP maps is `pnpm zcta && pnpm build`
 *    with no code change, and a build without the file simply reports the
 *    level unavailable.
 * 2. **Runtime registration**: a host (or a test) calls
 *    `setZctaTopologyLoader` with its own async source (fetch, IndexedDB, a
 *    fixture). The override wins over everything below it.
 * 3. **Inlined asset** (escape hatch): a JSON file dropped at
 *    `src/contexts/chartBuilder/lib/geo/data/zcta*.json` is discovered by the
 *    `import.meta.glob` below and lazy-imported. Because
 *    vite-plugin-singlefile forces `inlineDynamicImports`, that chunk lands in
 *    dist/index.html as a top-level `JSON.parse` — the whole asset is parsed
 *    on EVERY boot and the shareable file grows by its full size. Only worth
 *    it for a build that must work offline from `file://`, where route 1
 *    can't fetch.
 *
 * A `file://` page can't fetch a sibling file (browsers treat it as
 * cross-origin), so route 1 reports unavailable there rather than failing on
 * first use — see `assetUrl` below.
 *
 * TOPOLOGY CONTRACT — whatever the source, the file must be a TopoJSON
 * `Topology` whose ZCTA features live in `objects.zctas`, or failing that in
 * its first (only) object (Census-derived conversions often keep the layer
 * name, e.g. `cb_2020_us_zcta520_500k`). Each feature must carry its 5-digit
 * ZCTA code as the feature `id`, or in one of the usual Census properties
 * (`ZCTA5CE20` / `ZCTA5CE10` / `GEOID20` / `GEOID10`) — see
 * `loadGeometry.buildZctaBundle`, which normalizes codes to 5-digit
 * zero-padded strings.
 */
export type ZctaTopology = Topology<Record<string, GeometryCollection>>

export type ZctaTopologyLoader = () => Promise<ZctaTopology>

// Build-time discovery of an OPTIONAL INLINED asset (route 3). `import.meta.glob`
// is lazy by default (each entry is a `() => import(...)` thunk), but
// vite-plugin-singlefile hoists the chunk into the main bundle — see the note
// on route 3 above. With no matching file (the normal case) this is `{}`.
const bundledSources = import.meta.glob<{ default: unknown }>(
	"./data/zcta*.json"
)

let overrideLoader: ZctaTopologyLoader | null = null

/** Register (or clear, with null) a runtime ZCTA topology source. Wins over
 *  both the sidecar asset and any inlined `data/zcta*.json`. Callers should
 *  register before the first ZCTA load; `loadGeometry` drops a failed zcta
 *  load from its cache, so a loader registered after a failed attempt still
 *  takes effect. */
export const setZctaTopologyLoader = (
	loader: ZctaTopologyLoader | null
): void => {
	overrideLoader = loader
}

/** Absolute URL of the sidecar asset this build serves, or null when there
 *  isn't one — either the build shipped without the file, or the page is on a
 *  protocol that can't fetch a sibling (`file://`, where the single-file build
 *  runs). Resolved against BASE_URL so a non-root deployment base works. */
const assetUrl = (): string | null => {
	if (__ZCTA_ASSET_PATH__ === null) return null
	const loc: Location | undefined = globalThis.location
	if (loc === undefined) return null
	if (loc.protocol !== "http:" && loc.protocol !== "https:") return null
	return new URL(`${import.meta.env.BASE_URL}${__ZCTA_ASSET_PATH__}`, loc.href)
		.href
}

/** Whether ANY ZCTA topology source exists (registered loader, sidecar asset,
 *  or inlined asset). Synchronous — used by the sidebar to explain an
 *  unavailable level without kicking off a load. */
export const zctaTopologyAvailable = (): boolean =>
	overrideLoader !== null ||
	assetUrl() !== null ||
	Object.keys(bundledSources).length > 0

/** Load the ZCTA topology from whichever source is present, in precedence
 *  order: registered loader, sidecar asset, inlined asset (first match in
 *  path order). Rejects with a descriptive error when no source exists. */
export const loadZctaTopology = async (): Promise<ZctaTopology> => {
	if (overrideLoader) return overrideLoader()

	const url = assetUrl()
	if (url !== null) {
		const response = await fetch(url)
		if (!response.ok) {
			throw new Error(
				`ZCTA boundary asset ${url} failed to load (HTTP ${response.status})`
			)
		}
		return (await response.json()) as ZctaTopology
	}

	const first = Object.keys(bundledSources).sort()[0]
	if (first === undefined) {
		throw new Error(
			"ZCTA boundaries are not available in this build: generate the asset " +
				"with `pnpm zcta` and rebuild, or register a source via " +
				"setZctaTopologyLoader()"
		)
	}
	const mod = await bundledSources[first]()
	return mod.default as ZctaTopology
}
