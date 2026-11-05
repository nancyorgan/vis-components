import {
	structureAnnotationKeys,
	structureChannelConfigKeys,
	structureDataLabelsKeys,
	structureVisualKeys,
} from "../savedKeyStructure"
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
export const VISUALS_VERSION = 13
export const DATASETS_VERSION = 1
export const CHANNEL_CONFIGS_VERSION = 7
export const LABELS_VERSION = 1
export const LEGEND_VERSION = 2
export const TOOLTIP_VERSION = 1
export const DATA_LABELS_ENCODINGS_VERSION = 1
export const DATA_LABELS_CONFIG_VERSION = 2
export const ENCODINGS_VERSION = 1
export const THEMES_VERSION = 3
export const EMBED_INSTANCES_VERSION = 1
export const FIELD_OVERRIDES_VERSION = 1
export const FIELD_LEVEL_ORDERS_VERSION = 1
export const FIELD_LEVEL_ORDER_SPECS_VERSION = 1
export const FIELD_ORDER_VERSION = 1
export const ANNOTATIONS_VERSION = 5
export const CAPTION_VERSION = 1
export const MAP_CONFIG_VERSION = 8
export const RESHAPE_CONFIG_VERSION = 1
export const DERIVED_VARIABLES_VERSION = 1
export const DATA_TABLE_VERSION = 3
export const ACCESSIBILITY_VERSION = 1
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
	// v4 -> v5: the "Cartesian" coordinate-system option was retired — it
	// shared a render path with "noMap" and only "geographic" ever changed
	// behavior — so embedded mapConfigs rewrite the stored value. (Saved
	// visuals carry their own mapConfig copy that never runs
	// mapConfigMigrations; this mirrors that chain's v7→v8 step.)
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((v) => {
			if (typeof v !== "object" || !v) return v
			const vis = v as Record<string, unknown>
			const mc = vis.mapConfig
			if (typeof mc !== "object" || !mc) return v
			if ((mc as Record<string, unknown>).coordSystem !== "cartesian") return v
			return { ...vis, mapConfig: { ...mc, coordSystem: "noMap" } }
		})
	},
	// v5 -> v6: `tickLabelAngle: 0` on the x / y / r axis configs clears to
	// absent. Until now 0 was the only "auto" value (a categorical x-axis
	// still auto-rotated at 0), so every stored 0 meant "let the renderer
	// decide". Now `null` / absent means auto and 0 is an explicit "keep the
	// labels level" — leaving the stored zeros alone would switch auto-rotate
	// off for every existing visual.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map(clearLegacyAutoTickLabelAngle)
	},
	// v6 -> v7: saved keys built by JOINING user values become structure —
	// a split label's per-variable styling (`labelId U+001F field`) moves
	// under `dataLabelsConfig.pieces[labelId][field]`, and grid facet panels
	// (`row|col`) become `{ row, col }` pairs in every facet scope and the
	// `gridPanelAxisOverrides[row][col]` map. A joined key reads as what it
	// isn't to anything inspecting stored content (the hosting firewall),
	// and is ambiguous when a value contains the joiner. Idempotent and
	// identity-preserving (`lib/savedKeyStructure.ts`), so a retry of a
	// partly written server migration re-accepts the visuals it already
	// wrote; the same function runs on every load and save, so a visual an
	// older build writes back in the old shape keeps loading.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		// One argument: a map index must not land in the `panels` slot.
		return raw.map((visual) => structureVisualKeys(visual))
	},
	// v7 -> v8: facet gaps are measured plot edge to plot edge instead of
	// cell edge to cell edge — see `measureFacetGapsFromPlotEdges`.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((visual) => measureFacetGapsFromPlotEdges(visual))
	},
	// v8 -> v9: custom-glyph shape references move from "one past the
	// built-in palette" (6) to the fixed `CUSTOM_GLYPH_BASE` — see
	// `rebaseCustomGlyphRefs`.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((visual) => rebaseCustomGlyphRefs(visual))
	},
	// v9 -> v10: the data table's Bold header / Striped rows / number
	// alignment start following the theme, and its old caption becomes the
	// title — see `migrateDataTableConfigV1ToV2`.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((v) => {
			if (typeof v !== "object" || !v) return v
			const vis = v as Record<string, unknown>
			if (!("dataTableConfig" in vis)) return v
			return { ...vis, dataTableConfig: migrateDataTableConfigV1ToV2(vis.dataTableConfig) }
		})
	},
	// v10 -> v11: the data table's Max rows defaults to 10 — see
	// `fillDataTableMaxRowsV2ToV3`.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((v) => {
			if (typeof v !== "object" || !v) return v
			const vis = v as Record<string, unknown>
			if (!("dataTableConfig" in vis)) return v
			return { ...vis, dataTableConfig: fillDataTableMaxRowsV2ToV3(vis.dataTableConfig) }
		})
	},
	// v11 -> v12: patterns tile over each mark's own fill; the theme-seeded
	// tile color / default-pattern ink every save stored become "follow the
	// mark" — see `followMarkFillForLegacyPatternDefaults`.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((v) => followMarkFillForLegacyPatternDefaultsInVisual(v))
	},
	// v12 -> v13: the radar spine's Color / Opacity slots fold into the
	// angle axis's spine (R position → Spine) — see `foldRadarSpineSlots`.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((v) => foldRadarSpineSlotsInVisual(v))
	},
]

/** One `ChannelConfigs` record, v6 → v7 of the draft slice (the visuals
 *  v12→v13 step). The radar spokes were styled from three places — thickness
 *  on `angle.spine`, color in the Color menu's "Radar spine" slot
 *  (`colorSlots.spine`, which overrode `angle.spine.color` at render time)
 *  and opacity in the Opacity menu's (`opacitySlots.spine`). They are now
 *  one control, R position → Spine, writing `angle.spine` alone; so a
 *  stored slot's color / level moves onto `angle.spine` (what it rendered
 *  as) and the slot is dropped. A level of 1 is the default and stays
 *  absent. Idempotent: a record with no spine slot comes back as-is (same
 *  reference). Bundle imports and seeds run it too (they carry no storage
 *  version). */
export const foldRadarSpineSlots = (raw: unknown): unknown => {
	if (typeof raw !== "object" || !raw) return raw
	const cc = raw as Record<string, unknown>
	const asRecord = (v: unknown): Record<string, unknown> | null =>
		typeof v === "object" && v !== null && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: null
	const colorSlots = asRecord(cc.colorSlots)
	const opacitySlots = asRecord(cc.opacitySlots)
	const colorSlot = colorSlots ? asRecord(colorSlots.spine) : null
	const opacitySlot = opacitySlots ? asRecord(opacitySlots.spine) : null
	const hasColor = !!colorSlots && "spine" in colorSlots
	const hasOpacity = !!opacitySlots && "spine" in opacitySlots
	if (!hasColor && !hasOpacity) return raw
	const next: Record<string, unknown> = { ...cc }
	const spine: Record<string, unknown> = {
		...asRecord(asRecord(cc.angle)?.spine),
	}
	if (colorSlot && typeof colorSlot.singleColor === "string") {
		spine.color = colorSlot.singleColor
	}
	const level = opacitySlot?.level
	if (typeof level === "number" && Number.isFinite(level) && level !== 1) {
		spine.opacity = level
	}
	if (Object.keys(spine).length > 0) {
		next.angle = { ...asRecord(cc.angle), spine }
	}
	if (hasColor) {
		const { spine: _dropped, ...rest } = colorSlots
		next.colorSlots = rest
	}
	if (hasOpacity) {
		const { spine: _dropped, ...rest } = opacitySlots
		next.opacitySlots = rest
	}
	return next
}

/** The same step over a whole visual (its `channelConfigs`). Returns the
 *  input reference when nothing changed. */
export const foldRadarSpineSlotsInVisual = <T>(visual: T): T => {
	if (typeof visual !== "object" || !visual) return visual
	const vis = visual as Record<string, unknown>
	const cc = vis.channelConfigs
	if (typeof cc !== "object" || !cc) return visual
	const next = foldRadarSpineSlots(cc)
	return next === cc ? visual : ({ ...vis, channelConfigs: next } as T)
}

/** One data-table config, v2 → v3. Max rows defaulted to null (every
 *  row) and every save stored that default, so a stored null is the
 *  backfill, not a choice: it becomes the new default, 10. Clearing the
 *  box at v3+ stores null again and is never re-filled. Shared by the
 *  visuals chain and the draft slice. */
const fillDataTableMaxRowsV2ToV3 = (raw: unknown): unknown => {
	if (typeof raw !== "object" || !raw) return raw
	const cfg = raw as Record<string, unknown>
	return cfg.maxRows === null ? { ...cfg, maxRows: 10 } : raw
}

/** The tile colors patterns used to sit on when no hue drove the fill: the
 *  system themes' pattern Background and the built-in `PatternConfig`
 *  default. Every save stored one of them, so neither is a choice. */
const LEGACY_PATTERN_TILE_COLORS = new Set(["#efefef", "#e2e8f0"])
const isLegacyPatternTileColor = (v: unknown): boolean =>
	typeof v === "string" && LEGACY_PATTERN_TILE_COLORS.has(v.toLowerCase())

/** One `ChannelConfigs` record, v5 → v6 of the draft slice (the visuals
 *  v11→v12 step). Patterns now tile over each mark's OWN fill — a patterned
 *  bar keeps its color — with `pattern.backgroundColor` an explicit
 *  override (`null` = follow the mark) and `defaultPatternInk` `null` =
 *  the palette-paired ink for the tile color, else the theme ink. Before,
 *  every save stored the theme-seeded gray tile and the theme-seeded ink
 *  (`defaultPatternInk` equal to the stored `patternInkColor` snapshot);
 *  neither was a choice, so both become `null`. A deliberately picked tile
 *  color (anything but the legacy grays) or ink (anything but the theme's)
 *  stays. Idempotent, and applied to bundle imports too (bundles carry no
 *  storage version). Returns the input reference when nothing changed. */
export const followMarkFillForLegacyPatternDefaults = (raw: unknown): unknown => {
	if (typeof raw !== "object" || !raw) return raw
	const cc = raw as Record<string, unknown>
	let next: Record<string, unknown> | null = null
	const pat = cc.pattern
	if (
		typeof pat === "object" &&
		pat &&
		isLegacyPatternTileColor((pat as Record<string, unknown>).backgroundColor)
	) {
		next = { ...cc, pattern: { ...(pat as Record<string, unknown>), backgroundColor: null } }
	}
	const ink = cc.defaultPatternInk
	const themeInk = cc.patternInkColor
	if (
		typeof ink === "string" &&
		typeof themeInk === "string" &&
		ink.toLowerCase() === themeInk.toLowerCase()
	) {
		next = { ...(next ?? cc), defaultPatternInk: null }
	}
	return next ?? raw
}

/** The same step over a whole visual (its `channelConfigs`). Returns the
 *  input reference when nothing changed. */
export const followMarkFillForLegacyPatternDefaultsInVisual = <T>(visual: T): T => {
	if (typeof visual !== "object" || !visual) return visual
	const vis = visual as Record<string, unknown>
	const cc = vis.channelConfigs
	if (typeof cc !== "object" || !cc) return visual
	const next = followMarkFillForLegacyPatternDefaults(cc)
	return next === cc ? visual : ({ ...vis, channelConfigs: next } as T)
}

/** One data-table config, v1 → v2.
 *  - Header bold, striped rows and number alignment were plain values
 *    (true / true / "right") backfilled onto every visual whether or not
 *    the table was ever touched; they are now nullable, null = follow the
 *    theme's Data tables defaults. A stored value equal to the old default
 *    is that backfill, not a choice, so it clears to null — otherwise a
 *    theme change would never reach an existing visual. A user's off /
 *    left / center stays (the v3→v4 map step's reasoning). Header bold
 *    has since become a header font WEIGHT: on clears (the theme's
 *    semibold), off pins 400 — what it rendered at.
 *  - The text that sat ABOVE the table was stored as `caption` (with
 *    `caption*` styling); it is the table's title now, and `caption` is a
 *    new line BELOW the table. A config with no `title` key is pre-split,
 *    so its caption fields move to the title ones. Idempotent: the moved
 *    config has a `title` key. Shared by the visuals chain and the draft
 *    slice. */
const CAPTION_TO_TITLE_V2: ReadonlyArray<readonly [string, string]> = [
	["caption", "title"],
	["captionFontFamily", "titleFontFamily"],
	["captionFontSize", "titleFontSize"],
	["captionColor", "titleColor"],
	["captionFontWeight", "titleFontWeight"],
	["captionAlign", "titleAlign"],
]
const migrateDataTableConfigV1ToV2 = (raw: unknown): unknown => {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw
	const c = { ...(raw as Record<string, unknown>) }
	// Bold header → a header weight. On was the theme's semibold (follow
	// it); off rendered at the regular 400, so it pins that.
	if ("headerBold" in c) {
		if (c.headerBold === false) c.headerFontWeight = 400
		delete c.headerBold
	}
	if (c.striped === true) c.striped = null
	if (c.numberAlign === "right") c.numberAlign = null
	if (!("title" in c)) {
		for (const [from, to] of CAPTION_TO_TITLE_V2) {
			c[to] = c[from] ?? null
			c[from] = null
		}
	}
	return c
}

/** Where custom-glyph shape references began before the base became a
 *  fixed constant: one past the six built-in symbols of the time. */
const LEGACY_CUSTOM_GLYPH_BASE = 6
/** `CUSTOM_GLYPH_BASE` (lib/customGlyphs) frozen at migration time, per
 *  this file's conventions. */
const V9_CUSTOM_GLYPH_BASE = 1000

/** The visuals v8→v9 step for one visual-shaped record. Custom glyphs
 *  used to start at shape index 6 (`SHAPE_PALETTE.length`), so appending
 *  any built-in symbol would have turned every saved custom-glyph
 *  reference into that symbol. The base is now a fixed constant far past
 *  the palette; a stored `defaultShape` or per-category
 *  shape override in the old custom range `[6, 1000)` moves up by the
 *  difference. Idempotent — a rebased reference is already ≥ 1000 and
 *  passes through, and a record with nothing to move comes back as the
 *  same reference — so it is also safe on the unversioned intake paths
 *  (seed bundles, library-bundle imports). Built-in indices (< 6) are
 *  untouched; nothing else stores a custom-glyph index (legend and
 *  data-label swatch shapes, theme defaults are built-ins only). */
export const rebaseCustomGlyphRefs = <T>(visual: T): T => {
	if (typeof visual !== "object" || !visual) return visual
	const vis = visual as Record<string, unknown>
	const cc = vis.channelConfigs
	if (typeof cc !== "object" || !cc) return visual
	const next = rebaseCustomGlyphRefsInConfigs(cc as Record<string, unknown>)
	return next === cc ? visual : ({ ...vis, channelConfigs: next } as T)
}

const rebaseGlyphIndex = (v: unknown): unknown =>
	typeof v === "number" &&
	Number.isInteger(v) &&
	v >= LEGACY_CUSTOM_GLYPH_BASE &&
	v < V9_CUSTOM_GLYPH_BASE
		? v - LEGACY_CUSTOM_GLYPH_BASE + V9_CUSTOM_GLYPH_BASE
		: v

/** Same step over a bare `ChannelConfigs` record (the editor's persisted
 *  draft slice, channelConfigs v4→v5). Returns the input reference when
 *  nothing changed. */
const rebaseCustomGlyphRefsInConfigs = (
	cc: Record<string, unknown>,
): Record<string, unknown> => {
	let next: Record<string, unknown> | null = null
	const defaultShape = rebaseGlyphIndex(cc.defaultShape)
	if (defaultShape !== cc.defaultShape) next = { ...cc, defaultShape }
	const shape = cc.shape
	if (typeof shape === "object" && shape) {
		const overrides = (shape as Record<string, unknown>).overrides
		if (typeof overrides === "object" && overrides) {
			let moved: Record<string, unknown> | null = null
			for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
				const rebased = rebaseGlyphIndex(v)
				if (rebased !== v) moved = { ...(moved ?? (overrides as Record<string, unknown>)), [k]: rebased }
			}
			if (moved) {
				next = { ...(next ?? cc), shape: { ...shape, overrides: moved } }
			}
		}
	}
	return next ?? cc
}

/** What the chrome between two panels added to a cell-edge gap: a shared
 *  axis puts 28px (right margin + spine) between columns and ~20–40px
 *  between rows, so one flat shift keeps old layouts close to how they
 *  drew. Un-shared axes carried tick labels too, so those land a little
 *  tighter. */
const LEGACY_FACET_GAP_SHIFT = 30

/** The visuals v7→v8 step for one visual-shaped record. Facet gaps used to
 *  be measured between whole cells (plot rect + axis chrome), so 0 still
 *  left margins and labels between the plots; they now run plot edge to
 *  plot edge (0 = touching). A stored gap grows by
 *  {@link LEGACY_FACET_GAP_SHIFT}; an absent one picks up the new default,
 *  which moved by the same amount. Idempotent through the `gapsFrom`
 *  marker — a marked config comes back as-is (same reference) — so it is
 *  also safe on the unversioned intake paths (seed bundles, library-bundle
 *  imports), which apply it to every visual. */
export const measureFacetGapsFromPlotEdges = <T>(visual: T): T => {
	if (typeof visual !== "object" || !visual) return visual
	const vis = visual as Record<string, unknown>
	const cc = vis.channelConfigs
	if (typeof cc !== "object" || !cc) return visual
	const next = measureFacetGapsFromPlotEdgesInConfigs(cc as Record<string, unknown>)
	return next === cc ? visual : ({ ...vis, channelConfigs: next } as T)
}

/** Same step over a bare `ChannelConfigs` record (the editor's persisted
 *  draft slice, channelConfigs v3→v4). */
const measureFacetGapsFromPlotEdgesInConfigs = (
	cc: Record<string, unknown>,
): Record<string, unknown> => {
	const facet = cc.facet
	if (typeof facet !== "object" || !facet) return cc
	const f = facet as Record<string, unknown>
	if (f.gapsFrom === "plot") return cc
	const next: Record<string, unknown> = { ...f, gapsFrom: "plot" }
	for (const key of ["gapX", "gapY"] as const) {
		const gap = f[key]
		if (typeof gap === "number" && Number.isFinite(gap)) {
			next[key] = gap + LEGACY_FACET_GAP_SHIFT
		}
	}
	return { ...cc, facet: next }
}

/** The v5→v6 step for one visual-shaped record: drop `tickLabelAngle: 0`
 *  from each axis config under `channelConfigs`. Exported for the paths
 *  that take in visuals WITHOUT a storage version — seed bundles and
 *  library-bundle imports — which would otherwise carry a pre-v6 zero
 *  straight into a v6 library as "forced level". Idempotent: a record
 *  with no zeros comes back as-is (same reference). The radar `angle`
 *  config has its own `tickLabelAngle`, where 0 was and still is a real
 *  angle; it is deliberately untouched. */
export const clearLegacyAutoTickLabelAngle = <T>(visual: T): T => {
	if (typeof visual !== "object" || !visual) return visual
	const vis = visual as Record<string, unknown>
	const cc = vis.channelConfigs
	if (typeof cc !== "object" || !cc) return visual
	const next = clearLegacyAutoTickLabelAngleInConfigs(cc as Record<string, unknown>)
	return next === cc ? visual : ({ ...vis, channelConfigs: next } as T)
}

/** Same step over a bare `ChannelConfigs` record (the editor's persisted
 *  draft slice, channelConfigs v1→v2). Returns the input reference when
 *  nothing changed. */
const clearLegacyAutoTickLabelAngleInConfigs = (
	cc: Record<string, unknown>,
): Record<string, unknown> => {
	let next: Record<string, unknown> | null = null
	for (const axis of ["x", "y", "r"] as const) {
		const ac = cc[axis]
		if (typeof ac !== "object" || !ac) continue
		if ((ac as Record<string, unknown>).tickLabelAngle !== 0) continue
		const { tickLabelAngle: _zero, ...rest } = ac as Record<string, unknown>
		next = { ...(next ?? cc), [axis]: rest }
	}
	return next ?? cc
}

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

/** Migrations for ONE dataset body. The datasets store migrates at two
 *  shapes — the legacy whole-record blob (`Record<id, Dataset>`) and the
 *  per-dataset body keys (`Dataset`) — so the per-body steps are the single
 *  source of truth and the record-shaped array below is DERIVED by mapping
 *  each step over the record's entries. Bumping DATASETS_VERSION means
 *  appending HERE, never to `datasetsMigrations` directly: a step written
 *  for only one of the two shapes would corrupt every stored dataset read
 *  through the other. */
export const datasetBodyMigrations: Migration[] = [
	(raw) => migrateDatasetV0ToV1(raw),
]

export const datasetsMigrations: Migration[] = datasetBodyMigrations.map(
	(step) => (raw) => {
		if (typeof raw !== "object" || raw === null) return {}
		const out: Record<string, unknown> = {}
		for (const [id, value] of Object.entries(raw)) {
			out[id] = step(value)
		}
		return out
	}
)

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
export const channelConfigsMigrations: Migration[] = [
	...identityMigrations,
	// v1 -> v2: stored `tickLabelAngle: 0` → absent (auto). Mirrors the
	// visuals v5→v6 step for the editor's persisted draft slice.
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		return clearLegacyAutoTickLabelAngleInConfigs(raw as Record<string, unknown>)
	},
	// v2 -> v3: grid per-panel axis bounds move off joined `row|col` keys
	// (the visuals v6→v7 step, for the draft slice). The slice loads on its
	// own, without the encodings that say whether the chart is a grid, so
	// only the unambiguous row-only / col-only keys move here; a full-grid
	// key stays readable through `gridPanelAxisOverride`'s fallback and is
	// moved by the next save, which structures the whole visual.
	(raw) => structureChannelConfigKeys(raw, false),
	// v3 -> v4: facet gaps measure plot edge to plot edge (the visuals
	// v7→v8 step, for the draft slice).
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		return measureFacetGapsFromPlotEdgesInConfigs(raw as Record<string, unknown>)
	},
	// v4 -> v5: custom-glyph shape references rebase onto the fixed
	// `CUSTOM_GLYPH_BASE` (the visuals v8→v9 step, for the draft slice).
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		return rebaseCustomGlyphRefsInConfigs(raw as Record<string, unknown>)
	},
	// v5 -> v6: legacy pattern tile color / default ink → follow the mark
	// (the visuals v11→v12 step, for the draft slice).
	(raw) => followMarkFillForLegacyPatternDefaults(raw),
	// v6 -> v7: radar spine Color / Opacity slots fold into `angle.spine`
	// (the visuals v12→v13 step, for the draft slice).
	(raw) => foldRadarSpineSlots(raw),
]
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
 *  for configs persisted before the no-data pattern option shipped. v7→v8
 *  rewrites `coordSystem: "cartesian"` → `"noMap"` — the Cartesian option was
 *  retired (it shared a render path with "noMap"; only "geographic" ever
 *  changed behavior). Every step leaves every other field untouched. */
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
	(raw) => {
		if (typeof raw !== "object" || !raw) return raw
		const o = raw as Record<string, unknown>
		// v7→v8: the retired "cartesian" option folds into "noMap" (behaviorally
		// identical; only "geographic" activates anything). Idempotent — any
		// other value passes through untouched.
		return o.coordSystem === "cartesian" ? { ...o, coordSystem: "noMap" } : o
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
export const derivedVariablesMigrations = identityMigrations
export const dataTableMigrations: Migration[] = [
	...identityMigrations,
	// v1 -> v2: the visuals v9→v10 step, for the draft slice.
	(raw) => migrateDataTableConfigV1ToV2(raw),
	// v2 -> v3: the visuals v10→v11 step, for the draft slice.
	(raw) => fillDataTableMaxRowsV2ToV3(raw),
]
export const accessibilityMigrations = identityMigrations
export const dataLabelsEncodingsMigrations = identityMigrations
/** Data Labels config v1 → v2: split-piece entries move under `pieces` and
 *  grid facet scopes become pairs (the visuals v6→v7 step, for the draft
 *  slice — see `channelConfigsMigrations` for why full-grid scope keys wait
 *  for the next save). */
export const dataLabelsConfigMigrations: Migration[] = [
	...identityMigrations,
	(raw) => structureDataLabelsKeys(raw, false),
]
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
	// v2 -> v3: the theme's pattern Background "#EFEFEF" becomes null — see
	// `followMarkFillForLegacyThemePatternBackground`.
	(raw) => {
		if (!Array.isArray(raw)) return raw
		return raw.map((entry) => followMarkFillForLegacyThemePatternBackground(entry))
	},
]

/** One theme, v2 → v3: its pattern Background "#EFEFEF" — the former
 *  system default, carried into every theme copied from one — becomes
 *  null, so new visuals tile patterns over each mark's own fill. Any other
 *  color is a deliberate override and stays. Idempotent; bundle imports
 *  (unversioned) run it too. Returns the input reference when unchanged. */
export const followMarkFillForLegacyThemePatternBackground = <T>(entry: T): T => {
	if (!entry || typeof entry !== "object") return entry
	const obj = entry as Record<string, unknown>
	return isLegacyPatternTileColor(obj.patternBackgroundColor)
		? ({ ...obj, patternBackgroundColor: null } as T)
		: entry
}
export const embedInstancesMigrations = identityMigrations
export const userFontsMigrations = identityMigrations
export const fieldOverridesMigrations = identityMigrations
export const fieldLevelOrdersMigrations = identityMigrations
export const fieldLevelOrderSpecsMigrations = identityMigrations
export const fieldOrderMigrations = identityMigrations
/** Annotations v1 → v2: backfill the `circles` list for configs saved before
 *  circle annotations shipped. v2 → v3: same for the `lineSegments` list.
 *  v3 → v4: same for the `texts` list (free-standing text labels).
 *  v4 → v5: grid facet scopes become `{ row, col }` pairs (the visuals
 *  v6→v7 step, for the draft slice — see `channelConfigsMigrations` for why
 *  full-grid keys wait for the next save).
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
	(raw) => structureAnnotationKeys(raw, false),
]

/** The content-schema registry for the adapter-backed collections, keyed by
 *  the API's collection segment.
 *
 *  The localStorage path reaches migrations through `loadVersioned`, which
 *  reads the `{_v,data}` envelope off each key. A remote backend stores bare
 *  items with no envelope, so `httpAdapter` needs the same (currentVersion,
 *  migrations) pair looked up by collection instead — that's this table.
 *
 *  **Bumping a version means adding its migration here too**, or server-stored
 *  data silently stays a schema behind. `folders` is absent on purpose: the
 *  frontend reads folders unversioned (`loadFolders` is a bare `safeGet`); if
 *  folders ever gain a version, add them here and to
 *  `CONTENT_VERSION_COLLECTIONS` in server/src/db.ts. */
export const CONTENT_MIGRATIONS: Record<
	string,
	{ currentVersion: number; migrations: Migration[] }
> = {
	visuals: { currentVersion: VISUALS_VERSION, migrations: visualsMigrations },
	datasets: { currentVersion: DATASETS_VERSION, migrations: datasetsMigrations },
	"embed-instances": {
		currentVersion: EMBED_INSTANCES_VERSION,
		migrations: embedInstancesMigrations,
	},
	themes: { currentVersion: THEMES_VERSION, migrations: themesMigrations },
	fonts: { currentVersion: USER_FONTS_VERSION, migrations: userFontsMigrations },
}
