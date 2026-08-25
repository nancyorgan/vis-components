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
export const VISUALS_VERSION = 4
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
export const ANNOTATIONS_VERSION = 4
export const CAPTION_VERSION = 1
export const MAP_CONFIG_VERSION = 7
export const RESHAPE_CONFIG_VERSION = 1
export const USER_FONTS_VERSION = 1

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

// ──────────────────────────────────────────────────────────────────────
// Visuals v1 → v2: reset font sizes to theme defaults (px → pt switch)
// ──────────────────────────────────────────────────────────────────────

/** 2026-08-11: font-size numbers changed meaning from px to pt (see
 *  lib/fontUnit.ts), so sizes chosen under the px regime render a third
 *  larger. Rather than rescale every stored number (×0.75 → fractional
 *  sizes forever), saved visuals RESET their font sizes to their theme's
 *  defaults. The one exception: data labels whose SIZE is encoded to a
 *  variable (field or nesting depth) keep their configured range — those
 *  are variably sized by data, not a fixed choice.
 *
 *  Defaults are frozen inline per this file's conventions (they must not
 *  drift with future edits to the live default objects). */

type ThemeFontSizesV2 = {
	titlePrimarySize: number
	titleSubtitleSize: number
	titleSecondarySize: number
	textFontSize: number
	textEncodingFontSize: number
	dataLabelsFontSize: number
}

/** The light system theme's sizes at migration time — the fallback for
 *  visuals whose themeId no longer resolves. */
const V2_FALLBACK_THEME_SIZES: ThemeFontSizesV2 = {
	titlePrimarySize: 20,
	titleSubtitleSize: 14,
	titleSecondarySize: 13,
	textFontSize: 12,
	textEncodingFontSize: 11,
	dataLabelsFontSize: 11,
}

/** Hardcoded (non-theme-fed) default at migration time. */
const V2_CAPTION_FONT_SIZE = 13

const numOr = (v: unknown, fallback: number): number =>
	typeof v === "number" && Number.isFinite(v) ? v : fallback

/** Mirrors versioning.ts's safeStorage — null when unavailable (SSR,
 *  privacy modes). */
const safeLocalStorageV2 = (): Storage | null => {
	try {
		// eslint-disable-next-line no-restricted-globals
		return typeof localStorage === "undefined" ? null : localStorage
	} catch {
		return null
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

/** Build the id → font-sizes map from a raw themes list. Shared by the
 *  localStorage reader below and the example-seed path (whose bundle
 *  carries its own themes). */
export const themeFontSizesFromListV2 = (
	list: unknown
): Map<string, ThemeFontSizesV2> => {
	const out = new Map<string, ThemeFontSizesV2>()
	if (!Array.isArray(list)) return out
	for (const entry of list) {
		if (!isRecord(entry) || typeof entry.id !== "string") continue
		out.set(entry.id, {
			titlePrimarySize: numOr(entry.titlePrimarySize, 20),
			titleSubtitleSize: numOr(entry.titleSubtitleSize, 14),
			titleSecondarySize: numOr(entry.titleSecondarySize, 13),
			textFontSize: numOr(entry.textFontSize, 12),
			textEncodingFontSize: numOr(entry.textEncodingFontSize, 11),
			// Sparse Theme field (data-label font defaults became theme-driven
			// the same week); absent → the built-in default.
			dataLabelsFontSize: numOr(entry.dataLabelsFontSize, 11),
		})
	}
	return out
}

/** Read the stored themes' font sizes directly from localStorage (the
 *  migration runs inside `loadVersioned(visuals)`, which has no context
 *  argument — and importing storage.ts here would be a module cycle).
 *  Handles both the `{_v, data}` envelope and the bare legacy array;
 *  anything unreadable just means every visual gets the fallback sizes.
 *  `store` is injectable for tests (mirrors versioning.test's shims). */
export const readThemeFontSizesV2 = (
	store?: Pick<Storage, "getItem"> | null
): Map<string, ThemeFontSizesV2> => {
	try {
		const source = store !== undefined ? store : safeLocalStorageV2()
		const raw = source?.getItem("vis-components:themes") ?? null
		if (raw === null) return new Map()
		const parsed: unknown = JSON.parse(raw)
		const list = isRecord(parsed) && Array.isArray(parsed.data)
			? parsed.data
			: Array.isArray(parsed)
				? parsed
				: []
		return themeFontSizesFromListV2(list)
	} catch {
		// Unreadable themes → fallback sizes for everyone. Not fatal.
		return new Map()
	}
}

/** Remove `size` from a Partial<FontConfig>-shaped override, dropping the
 *  override entirely when nothing else remains. */
const stripOverrideSize = (
	override: unknown
): Record<string, unknown> | undefined => {
	if (!isRecord(override)) return undefined
	if (!("size" in override)) return override
	const { size: _size, ...rest } = override
	return Object.keys(rest).length > 0 ? rest : undefined
}

/** Strip a tickLabelFont's size in place (returns the axis config with the
 *  override's size removed, or the input untouched when nothing applies). */
const stripTickLabelFontSize = (axisCfg: unknown): unknown => {
	if (!isRecord(axisCfg) || !isRecord(axisCfg.tickLabelFont)) return axisCfg
	const stripped = stripOverrideSize(axisCfg.tickLabelFont)
	const next = { ...axisCfg }
	if (stripped === undefined) delete next.tickLabelFont
	else next.tickLabelFont = stripped
	return next
}

export const resetVisualFontSizesV1ToV2 = (
	raw: unknown,
	themes: Map<string, ThemeFontSizesV2>
): unknown => {
	if (!isRecord(raw)) return raw
	const v = { ...raw }
	const t =
		(typeof v.themeId === "string" ? themes.get(v.themeId) : undefined) ??
		V2_FALLBACK_THEME_SIZES

	// Labels: base font sizes back to the theme; per-label size overrides
	// cleared (family / color / weight / style tweaks survive).
	if (isRecord(v.labelsConfig)) {
		const lc = { ...v.labelsConfig }
		if (isRecord(lc.baseFont)) {
			const baseFont = { ...lc.baseFont }
			if (isRecord(baseFont.titles)) {
				baseFont.titles = {
					...baseFont.titles,
					primarySize: t.titlePrimarySize,
					subtitleSize: t.titleSubtitleSize,
					secondarySize: t.titleSecondarySize,
				}
			}
			if (isRecord(baseFont.text)) {
				baseFont.text = { ...baseFont.text, size: t.textFontSize }
			}
			lc.baseFont = baseFont
		} else if (isRecord(lc.font)) {
			// Pre-baseFont legacy shape: one flat font whose `size` seeds the
			// load-time derivation of all title sizes (migrateLabelsConfig).
			lc.font = { ...lc.font, size: t.textFontSize }
		}
		if (isRecord(lc.fontOverrides)) {
			const overrides: Record<string, unknown> = {}
			for (const [slot, override] of Object.entries(lc.fontOverrides)) {
				const stripped = stripOverrideSize(override)
				if (stripped !== undefined) overrides[slot] = stripped
			}
			lc.fontOverrides = overrides
		}
		v.labelsConfig = lc
	}

	// Channel configs: per-axis tick-label size overrides cleared; the text
	// encoding's font size back to the theme.
	if (isRecord(v.channelConfigs)) {
		const cc = { ...v.channelConfigs }
		for (const axis of ["x", "y", "r"] as const) {
			if (isRecord(cc[axis])) cc[axis] = stripTickLabelFontSize(cc[axis])
		}
		if (isRecord(cc.connection) && isRecord(cc.connection.chordAxis)) {
			cc.connection = {
				...cc.connection,
				chordAxis: stripTickLabelFontSize(cc.connection.chordAxis),
			}
		}
		if (isRecord(cc.text)) {
			cc.text = { ...cc.text, fontSize: t.textEncodingFontSize }
		}
		v.channelConfigs = cc
	}

	// Data labels: reset the fixed font size UNLESS size is encoded to a
	// variable (field or measureSource) — then the whole size config is the
	// user's variable mapping and stays untouched.
	const sizeEnc = isRecord(v.dataLabelsEncodings)
		? v.dataLabelsEncodings.size
		: undefined
	const sizeEncoded =
		isRecord(sizeEnc) && (sizeEnc.field != null || sizeEnc.measureSource != null)
	if (isRecord(v.dataLabelsConfig) && !sizeEncoded) {
		v.dataLabelsConfig = {
			...v.dataLabelsConfig,
			fontSize: t.dataLabelsFontSize,
		}
	}

	// Caption + rectangle-annotation text back to their fixed defaults.
	if (isRecord(v.captionConfig)) {
		v.captionConfig = { ...v.captionConfig, fontSize: V2_CAPTION_FONT_SIZE }
	}
	if (isRecord(v.annotationsConfig) && Array.isArray(v.annotationsConfig.rectangles)) {
		v.annotationsConfig = {
			...v.annotationsConfig,
			rectangles: v.annotationsConfig.rectangles.map((r: unknown) => {
				if (!isRecord(r) || !("textFontSize" in r)) return r
				const { textFontSize: _tfs, ...rest } = r
				return rest
			}),
		}
	}

	return v
}

export const visualsMigrations: Migration[] = [
	// v0 -> v1: backfill versioning + scrub default sat/bri.
	(raw) => {
		if (!Array.isArray(raw)) return []
		return raw.map(migrateVisualV0ToV1)
	},
	// v1 -> v2: reset font sizes to theme defaults after the px→pt switch.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		const themes = readThemeFontSizesV2()
		return raw.map((v) => resetVisualFontSizesV1ToV2(v, themes))
	},
	// v2 -> v3: the SAME reset, re-run. The v2 pass could land before the
	// user finished re-tuning their theme's sizes for the pt convention
	// (the migration bakes whatever the themes store said at that boot);
	// re-running against the now-tuned theme heals those libraries. The
	// reset is idempotent, so libraries whose v2 pass was already right
	// come through unchanged.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		const themes = readThemeFontSizesV2()
		return raw.map((v) => resetVisualFontSizesV1ToV2(v, themes))
	},
	// v3 -> v4: one-time reset of mapConfig.showNoDataRegions to true. The
	// default flipped (regions absent from the dataset now paint with the
	// no-data fill, matching matched-but-blank rows), and nearly every stored
	// `false` is the old backfilled default rather than a user choice — so
	// saved visuals reset rather than keep it. The toggle remains; turning it
	// off again persists at v4+ and is never re-flipped. Visuals without a
	// mapConfig pick the new default up via the restore-time default-merge.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((v) => {
			if (typeof v !== "object" || !v) return v
			const vis = v as Record<string, unknown>
			const mc = vis.mapConfig
			if (typeof mc !== "object" || !mc) return v
			return {
				...vis,
				mapConfig: { ...mc, showNoDataRegions: true },
			}
		})
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
 *  center-on-region control shipped. v4→v5 backfills `customViewport`
 *  (default null). v5→v6 RESETS `showNoDataRegions` to true — the default
 *  flipped so regions absent from the dataset paint with the no-data fill,
 *  and pre-v6 `false` values are overwhelmingly the old backfilled default,
 *  not user choices (turning it off again persists at v6+ and is never
 *  re-flipped). v6→v7 backfills `noDataPattern` (null) + `noDataPatternInk`
 *  for configs persisted before the no-data pattern option shipped. Every
 *  step leaves every other field untouched. */
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
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		const o = raw as Record<string, unknown>
		// v5→v6: deliberate one-time RESET (not a backfill — see the doc comment
		// above): showNoDataRegions becomes true regardless of the stored value.
		return { ...o, showNoDataRegions: true }
	},
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		const o = raw as Record<string, unknown>
		// v6→v7 backfills the no-data pattern fields (default: no pattern,
		// stone-400 ink) for configs persisted before the no-data pattern
		// option shipped. Only fill when absent — idempotent, no-clobber.
		return {
			...o,
			noDataPattern: "noDataPattern" in o ? o.noDataPattern : null,
			noDataPatternInk:
				typeof o.noDataPatternInk === "string" ? o.noDataPatternInk : "#a8a29e",
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
export const reshapeConfigMigrations = identityMigrations
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
export const userFontsMigrations = identityMigrations
export const fieldOverridesMigrations = identityMigrations
export const fieldLevelOrdersMigrations = identityMigrations
/** Annotations v1 → v2: backfill the `circles` list for configs saved before
 *  circle annotations shipped. v2 → v3: same for the `lineSegments` list.
 *  v3 → v4: same for the `texts` list (free-standing text labels).
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
	(raw) => {
		if (typeof raw !== "object" || raw === null) return raw
		const o = raw as Record<string, unknown>
		return { ...o, texts: Array.isArray(o.texts) ? o.texts : [] }
	},
]
