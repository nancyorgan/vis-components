import type { Dataset, DatasetVersion, Field, Visual } from "../types"
import type { Migration } from "./versioning"

/** Per-entity migration arrays. The Nth entry upgrades a value stored at
 *  version N to a value at version N+1. Append new migrations to the end
 *  and bump the corresponding `*_VERSION` constant when shape changes.
 *
 *  Conventions:
 *   - Each migration takes `unknown` and returns `unknown`. They're
 *     untyped because the runtime shape at version N often differs from
 *     the current TypeScript shape. Casts inside the body are scoped to
 *     each migration; the consumer-facing `loadVersioned<T>` enforces
 *     the final-version type.
 *   - Migrations must be pure and idempotent-ish: running v0→v1 on data
 *     that's already in v1 shape should produce v1-shape output (no
 *     errors). This protects against the edge case where one entity's
 *     write succeeds and another fails, leaving a half-migrated store.
 *   - Never delete or reorder past entries — that invalidates the
 *     version contract. Future versions append. */

/** Bumps:
 *   v0 = pre-versioning (unwrapped JSON; no `_v` field). Existing user
 *        data lives here, so the v0→v1 migration must be tolerant of
 *        the existing on-disk shape. */
export const VISUALS_VERSION = 1
export const DATASETS_VERSION = 1
export const CHANNEL_CONFIGS_VERSION = 1
export const LABELS_VERSION = 1
export const LEGEND_VERSION = 2
export const TOOLTIP_VERSION = 1
export const DATA_LABELS_ENCODINGS_VERSION = 1
export const DATA_LABELS_CONFIG_VERSION = 1
export const ENCODINGS_VERSION = 1
export const THEMES_VERSION = 2
export const EMBED_INSTANCES_VERSION = 1
export const FIELD_OVERRIDES_VERSION = 1
export const FIELD_LEVEL_ORDERS_VERSION = 1
export const ANNOTATIONS_VERSION = 3
export const CAPTION_VERSION = 1
export const MAP_CONFIG_VERSION = 5

// ──────────────────────────────────────────────────────────────────────
// Visuals
// ──────────────────────────────────────────────────────────────────────

/** Visual at the pre-versioning ("v0") shape. Some fields the current
 *  `Visual` interface declares are missing — `migrateVisualV0ToV1`
 *  backfills them. Plus the channelConfigs scrub for the inadvertent
 *  saturation/brightness defaults left by an earlier "reset" bug. */
type V0Visual = {
	channelConfigs?: {
		defaultSaturation?: number | null
		defaultBrightness?: number | null
		[k: string]: unknown
	}
	createdAtVersionId?: string | null
	[k: string]: unknown
}

const migrateVisualV0ToV1 = (raw: V0Visual): Visual => {
	let v: V0Visual = raw
	if (!("createdAtVersionId" in v)) v = { ...v, createdAtVersionId: null }
	const cc = v.channelConfigs
	// Earlier "Reset to defaults" wrote literal HSL `s=1` / `l=0.5` and
	// called them neutral — they're not, they distort every mark's
	// color. Treat those exact values as "no default" and let the user
	// re-pick if they actually wanted them.
	if (cc?.defaultSaturation === 1 || cc?.defaultBrightness === 0.5) {
		const next = { ...cc }
		if (cc.defaultSaturation === 1) next.defaultSaturation = null
		if (cc.defaultBrightness === 0.5) next.defaultBrightness = null
		v = { ...v, channelConfigs: next }
	}
	return v as unknown as Visual
}

export const visualsMigrations: Migration[] = [
	// v0 -> v1: backfill versioning + scrub default sat/bri.
	(raw) => {
		if (!Array.isArray(raw)) return []
		return raw.map(migrateVisualV0ToV1)
	},
]

// ──────────────────────────────────────────────────────────────────────
// Datasets
// ──────────────────────────────────────────────────────────────────────

/** Pre-versioning dataset shape: single CSV upload, no `versions` array.
 *  Wrapped into a single-version `Dataset` so downstream code never has
 *  to special-case the legacy shape. */
type LegacyDataset = {
	id: string
	filename: string
	fields: Field[]
	rows: Array<Record<string, string>>
	createdAt: number
}

const isLegacyDataset = (raw: unknown): raw is LegacyDataset =>
	typeof raw === "object" &&
	raw !== null &&
	!("versions" in raw) &&
	"rows" in raw &&
	"filename" in raw

const migrateDatasetV0ToV1 = (raw: unknown): Dataset => {
	if (!isLegacyDataset(raw)) return raw as Dataset
	const versionId = `dv-${raw.id}`
	const version: DatasetVersion = {
		id: versionId,
		filename: raw.filename,
		rows: raw.rows,
		createdAt: raw.createdAt,
	}
	return {
		id: raw.id,
		name: raw.filename,
		fields: raw.fields,
		versions: [version],
		latestVersionId: versionId,
		createdAt: raw.createdAt,
	}
}

export const datasetsMigrations: Migration[] = [
	(raw) => {
		if (typeof raw !== "object" || raw === null) return {}
		const out: Record<string, Dataset> = {}
		for (const [id, value] of Object.entries(raw)) {
			out[id] = migrateDatasetV0ToV1(value)
		}
		return out
	},
]

// ──────────────────────────────────────────────────────────────────────
// Identity migrations
// ──────────────────────────────────────────────────────────────────────

/** For entities whose v0 (pre-versioning) shape is exactly the current
 *  TypeScript shape. The v0→v1 promotion is a no-op; the upgrade just
 *  adds the `_v` wrapper. New migrations append after this. */
export const identityMigrations: Migration[] = [(raw) => raw]

// Re-using identityMigrations means new versions append per entity in
// the future. Each entity's migrations array is INDEPENDENT — sharing
// the same reference here is fine because the array itself is never
// mutated (always replaced with a new array if a migration is added).
export const channelConfigsMigrations = identityMigrations
/** mapConfig v0 (pre-versioning) shape matched the original `MapConfig`, so
 *  the v0→v1 promotion is the identity. v1→v2 backfills `showNoDataRegions`
 *  (default off) for configs persisted before the "fill regions not in the
 *  dataset" toggle shipped. v2→v3 backfills `showBasemap` (default on) for
 *  configs persisted before the Phase 3 basemap backdrop toggle shipped. v3→v4
 *  backfills `focusRegion` (default "auto") for configs persisted before the
 *  center-on-region control shipped. Each step leaves every other field
 *  untouched. */
export const mapConfigMigrations: Migration[] = [
	identityMigrations[0],
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		const o = raw as Record<string, unknown>
		// Backfill only when absent — idempotent, and preserves a value that
		// already migrated (matches the annotations/legend migration style).
		return {
			...o,
			showNoDataRegions:
				typeof o.showNoDataRegions === "boolean" ? o.showNoDataRegions : false,
		}
	},
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		const o = raw as Record<string, unknown>
		// Backfill only when absent — idempotent, preserving an already-set
		// value (same no-clobber style as the v1→v2 backfill above).
		return {
			...o,
			showBasemap: typeof o.showBasemap === "boolean" ? o.showBasemap : true,
		}
	},
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		const o = raw as Record<string, unknown>
		// Backfill only when absent — idempotent, preserving an already-set value
		// (same no-clobber style as the earlier backfills).
		return {
			...o,
			focusRegion: typeof o.focusRegion === "string" ? o.focusRegion : "auto",
		}
	},
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		const o = raw as Record<string, unknown>
		// v4→v5 backfills `customViewport` (default null) for configs persisted
		// before the drag-to-center custom focus shipped. Only fill when the key
		// is absent so an already-set viewport survives.
		return {
			...o,
			customViewport: "customViewport" in o ? o.customViewport : null,
		}
	},
]
export const labelsMigrations = identityMigrations
/** v1 stored `insideX`/`insideY` as pixel offsets from the chart's top-left.
 *  v2 redefines them as plot-area-normalized coords (0–1 inside the spines,
 *  (0,0) bottom-left). The conversion can't be derived without knowing the
 *  chart's pixel size at migration time, so we just reset persisted values
 *  to the new default — users who customized inside coords will see the
 *  legend snap back to the top-left of the plot. */
export const legendMigrations: Migration[] = [
	identityMigrations[0],
	(raw) => {
		if (typeof raw !== "object" || raw === null) return raw
		const o = raw as Record<string, unknown>
		return { ...o, insideX: 0.02, insideY: 0.98 }
	},
]
export const tooltipMigrations = identityMigrations
export const captionMigrations = identityMigrations
export const dataLabelsEncodingsMigrations = identityMigrations
export const dataLabelsConfigMigrations = identityMigrations
export const encodingsMigrations = identityMigrations
/** Themes v1 → v2: backfill the `ordinalPalettes` list and
 *  `defaultOrdinalPaletteId` for themes saved before the ordinal palette
 *  feature shipped (spec §4.1). Each saved theme gets the seeded "blues"
 *  ramp so ordinal hue fields render legibly without user intervention. */
const DEFAULT_ORDINAL_PALETTE_V2 = {
	id: "blues",
	name: "Blues (light→dark)",
	colors: [
		"#deebf7",
		"#c6dbef",
		"#9ecae1",
		"#6baed6",
		"#4292c6",
		"#2171b5",
	],
} as const

export const themesMigrations: Migration[] = [
	(raw) => raw,
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((entry) => {
			if (!entry || typeof entry !== "object") return entry
			const obj = entry as Record<string, unknown>
			const ordinalPalettes = Array.isArray(obj.ordinalPalettes)
				? (obj.ordinalPalettes as unknown[])
				: [DEFAULT_ORDINAL_PALETTE_V2]
			const defaultOrdinalPaletteId =
				typeof obj.defaultOrdinalPaletteId === "string"
					? obj.defaultOrdinalPaletteId
					: DEFAULT_ORDINAL_PALETTE_V2.id
			return { ...obj, ordinalPalettes, defaultOrdinalPaletteId }
		})
	},
]
export const embedInstancesMigrations = identityMigrations
export const fieldOverridesMigrations = identityMigrations
export const fieldLevelOrdersMigrations = identityMigrations
/** Annotations v1 → v2: backfill the `circles` list for configs saved before
 *  circle annotations shipped. v2 → v3: same for the `lineSegments` list.
 *  Each step is idempotent — re-running on an already-shaped value leaves the
 *  existing array untouched. */
export const annotationsMigrations: Migration[] = [
	identityMigrations[0],
	(raw) => {
		if (typeof raw !== "object" || raw === null) return raw
		const o = raw as Record<string, unknown>
		return { ...o, circles: Array.isArray(o.circles) ? o.circles : [] }
	},
	(raw) => {
		if (typeof raw !== "object" || raw === null) return raw
		const o = raw as Record<string, unknown>
		return {
			...o,
			lineSegments: Array.isArray(o.lineSegments) ? o.lineSegments : [],
		}
	},
]
