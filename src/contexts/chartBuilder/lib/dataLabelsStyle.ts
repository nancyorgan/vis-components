// Data-labels styling shared between the overlay layer (DataLabelsLayer —
// scatter/bars/areas/pies, where labels are positioned by chart scales)
// and the layout-placed label paths (the hierarchy renderers, where the
// pack/treemap/partition layout decides WHERE labels sit but the Data
// Labels section decides their text, color, and size). Pure functions —
// no React, no atoms — so both consumers resolve identically and the
// pieces unit-test without a renderer.

import { extent } from "d3-array"
import {
	DATA_LABELS_SINGLE_COLOR_ID,
	type ChannelConfigs,
	type DataLabelsConfig,
	type HueConfig,
} from "./channelConfig"
import { buildLabelHueConfig } from "./dataLabelsHue"
import { ptToPx } from "./fontUnit"
import { labelEntry } from "./labelPieces"
import {
	applyFormatAffixes,
	buildTickFormatter,
	parseFormatSpec,
} from "./formatTick"
import { COUNTRY_NAME_FORMAT, fullCountryName } from "./geo/countryNames"
import { resolveRuleColor, type RuleRows } from "./textColorRules"
import type { DataLabelsEncodings, FieldType } from "./types"

/** Format a numeric label respecting the user's `decimals` setting. */
export const formatLabel = (
	raw: unknown,
	decimals: number | null
): string | null => {
	if (raw === undefined || raw === null) return null
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return decimals === null ? String(raw) : raw.toFixed(decimals)
	}
	const str = String(raw)
	if (str === "") return null
	if (decimals !== null) {
		const n = Number(str)
		if (Number.isFinite(n)) return n.toFixed(decimals)
	}
	return str
}

/** Format one field's value for a multi-field label. A per-field d3 format
 * spec (`.1%`, `$,.0f`, …) wins — reusing the axis formatter so percent /
 * currency / grouping all work and numeric strings coerce. With no spec it
 * falls back to the shared `decimals` behavior. Returns "" for empty values
 * so a token collapses to nothing rather than "null" (or a bare suffix). */
export const formatField = (
	raw: unknown,
	spec: string | undefined,
	decimals: number | null
): string => {
	const parts = parseFormatSpec(spec ?? "")
	const inner = parts.spec.trim()
	// "Full country name": resolve any recognizable country value (atlas
	// short name, variant, ISO code) to its long form; unrecognized values
	// print as-is. A LABEL-only spec — offered in the Label-format dropdown
	// on countries-level geo charts — so it routes here, before the d3
	// spec formatters, and never touches the axis tick path.
	if (inner.toLowerCase() === COUNTRY_NAME_FORMAT) {
		const s = raw == null ? "" : String(raw)
		if (s.trim() === "") return ""
		return applyFormatAffixes(parts, fullCountryName(s) ?? s)
	}
	// Any Before / After text in the stored format wraps the spec's output,
	// or the `decimals` fallback while the spec is Auto.
	const fmt = buildTickFormatter(
		{ customFormat: spec ?? "" },
		"quantitative",
		(v) => formatLabel(v, decimals) ?? ""
	)
	return fmt(raw)
}

/** Format a single-field label value: the field's `fieldFormats` spec wins,
 * falling back to `decimals`. Returns null (skip the label) for missing /
 * empty values — spec formatting only applies to present values, so a null
 * measure never renders as "0%". Shared by the single-field segment path
 * and the aggregating renderers' pre-formatted slice anchors. */
export const formatSingleLabel = (
	raw: unknown,
	spec: string | undefined | null,
	decimals: number | null
): string | null => {
	if (raw === undefined || raw === null) return null
	const text = formatField(raw, spec ?? undefined, decimals)
	return text === "" ? null : text
}

/** Matches `{Field}` tokens; captures the inner field name (no braces). */
const TOKEN_RE = /\{([^{}]+)\}/g

/** One piece of a composed label. `field` is the source field name for a
 *  value piece (so callers can color it per `fieldColors`), or `null` for
 *  literal text (separators, parens, the space in "A (B)"). */
export type LabelSegment = { text: string; field: string | null }

/** The label broken into ordered segments, honoring single- vs multi-field
 * mode. This is the structured form of `buildLabelText` — it exists so the
 * renderer can color each variable's segment independently. Returns null
 * when nothing renders.
 *
 * Single mode: one segment for `value.field` (or `fallbackField` when
 * unmapped), formatted via `cfg.fieldFormats[field]` (falling back to
 * `decimals`) — the same per-field spec store multi mode uses, so a
 * format set in one mode carries over to the other.
 *
 * Multi mode (`value.multiField`): the template (empty = fields comma-joined)
 * split into literal runs and `{Field}` tokens. A token naming a selected
 * field becomes a value segment formatted via `cfg.fieldFormats[field]`
 * (falling back to `decimals`); a token naming a non-selected field is kept
 * literal so typos stay visible. */
export const buildLabelSegments = (
	row: Record<string, unknown>,
	value: DataLabelsEncodings["value"],
	cfg: Pick<DataLabelsConfig, "decimals" | "labelTemplate" | "fieldFormats">,
	fallbackField: string | null = null
): LabelSegment[] | null => {
	if (value.multiField) {
		const fields = value.fields ?? []
		if (fields.length === 0) return null
		const template = cfg.labelTemplate?.trim()
			? cfg.labelTemplate
			: fields.map((f) => `{${f}}`).join(", ")
		const selected = new Set(fields)
		const segments: LabelSegment[] = []
		let last = 0
		for (const m of template.matchAll(TOKEN_RE)) {
			const idx = m.index ?? 0
			if (idx > last)
				segments.push({ text: template.slice(last, idx), field: null })
			const name = m[1] ?? ""
			if (selected.has(name)) {
				segments.push({
					text: formatField(row[name], cfg.fieldFormats?.[name], cfg.decimals),
					field: name,
				})
			} else {
				// Token for a non-selected field → literal (surfaces typos).
				segments.push({ text: m[0], field: null })
			}
			last = idx + m[0].length
		}
		if (last < template.length)
			segments.push({ text: template.slice(last), field: null })
		if (segments.map((s) => s.text).join("").trim() === "") return null
		return segments
	}
	const field = value.field ?? fallbackField
	if (!field) return null
	const text = formatSingleLabel(
		row[field],
		cfg.fieldFormats?.[field],
		cfg.decimals
	)
	if (text === null) return null
	return [{ text, field }]
}

/** The text one label renders — the segments of `buildLabelSegments` joined.
 * Kept as a thin wrapper so width-measurement / single-color callers don't
 * need to know about segments. Returns null when nothing renders. */
export const buildLabelText = (
	row: Record<string, unknown>,
	value: DataLabelsEncodings["value"],
	cfg: Pick<DataLabelsConfig, "decimals" | "labelTemplate" | "fieldFormats">,
	fallbackField: string | null = null
): string | null => {
	const segments = buildLabelSegments(row, value, cfg, fallbackField)
	if (!segments) return null
	const joined = segments.map((s) => s.text).join("")
	const trimmed = joined.trim()
	return trimmed === "" ? null : trimmed
}

/** Linear-interpolate a numeric raw value into the user's [sizeMin,
 * sizeMax] range. Returns `cfg.fontSize` when no size encoding is
 * meaningful (no field mapped, or non-numeric value). Config sizes are
 * POINTS; the returned size is px (see lib/fontUnit) — ready for render
 * and measurement alike. */
export const resolveLabelSize = (
	raw: unknown,
	cfg: DataLabelsConfig,
	allValues: number[]
): number => {
	if (raw === undefined) return ptToPx(cfg.fontSize)
	const n = typeof raw === "number" ? raw : Number(raw)
	if (!Number.isFinite(n)) return ptToPx(cfg.fontSize)
	if (allValues.length === 0) return ptToPx(cfg.fontSize)
	const [lo, hi] = extent(allValues) as [number, number]
	if (lo === hi) return ptToPx((cfg.sizeMin + cfg.sizeMax) / 2)
	const t = (n - lo) / (hi - lo)
	return ptToPx(cfg.sizeMin + t * (cfg.sizeMax - cfg.sizeMin))
}

/** The inputs `makeHueScale` needs to color labels by the mapped hue
 * field: the HueConfig (palette / gradient shape) and the custom palette
 * colors. Encapsulates the inherit-from-chart fallback: when the user
 * mapped a categorical hue field but picked no Data Labels palette,
 * labels take the CHART's palette (ordinal palette for ordinal fields)
 * so they match the marks without redundant setup. The explicit "None
 * (single color)" pick suppresses that fallback — every label uses the
 * single `cfg.color`, signalled here by a null hueConfig. */
export const labelHueScaleParts = (
	cfg: DataLabelsConfig,
	hueFieldType: FieldType,
	chartChannelConfigs: ChannelConfigs
): { hueConfig: HueConfig | null; customPalette: string[] | undefined } => {
	const isQuant = hueFieldType === "quantitative" || hueFieldType === "temporal"
	const singleColorLabels = cfg.paletteId === DATA_LABELS_SINGLE_COLOR_ID
	if (singleColorLabels && !isQuant) {
		return { hueConfig: null, customPalette: undefined }
	}
	const fallbackPalette =
		!isQuant && !singleColorLabels && cfg.palette.length === 0
			? hueFieldType === "ordinal"
				? (chartChannelConfigs.ordinalPalette ??
					chartChannelConfigs.categoricalPalette)
				: chartChannelConfigs.categoricalPalette
			: undefined
	const hueConfig: HueConfig | null =
		buildLabelHueConfig(cfg, hueFieldType) ??
		// Categorical fallback: synthesize a minimal HueConfig so
		// `makeHueScale` builds a categorical scale that uses the inherited
		// palette from the chart.
		(!isQuant && fallbackPalette
			? { kind: "categorical", colors: {}, stackMode: "overlay" }
			: null)
	const customPalette = isQuant
		? undefined
		: cfg.palette.length > 0
			? cfg.palette
			: (fallbackPalette ?? undefined)
	return { hueConfig, customPalette }
}

/** A variable's resolved text properties for one label segment — the
 *  per-field overrides (`fieldFonts[field]`) laid over the layer-wide
 *  values. A literal segment (no field) or an unconfigured field resolves
 *  to the layer-wide values exactly. */
export type ResolvedLabelFont = {
	fontFamily: string
	fontWeight: number
	italic: boolean
	underline: boolean
}

export const resolveFieldFont = (
	cfg: Pick<
		DataLabelsConfig,
		"fontFamily" | "fontWeight" | "italic" | "underline" | "fieldFonts" | "pieces"
	>,
	field: string | null
): ResolvedLabelFont => {
	const ov = labelEntry(cfg, "fieldFonts", field)
	return {
		fontFamily: ov?.fontFamily ?? cfg.fontFamily,
		fontWeight: ov?.fontWeight ?? cfg.fontWeight,
		italic: ov?.italic ?? cfg.italic ?? false,
		underline: ov?.underline ?? cfg.underline ?? false,
	}
}

/** One PIECE's text properties: its own `fieldFonts` entry laid over the
 *  label's resolved font (not the layer's), so a piece that only sets a
 *  weight keeps the label's family. */
export const resolveFieldFontOver = (
	cfg: Pick<DataLabelsConfig, "fieldFonts" | "pieces">,
	key: string | null,
	base: ResolvedLabelFont
): ResolvedLabelFont => {
	const ov = labelEntry(cfg, "fieldFonts", key)
	if (!ov) return base
	return {
		fontFamily: ov.fontFamily ?? base.fontFamily,
		fontWeight: ov.fontWeight ?? base.fontWeight,
		italic: ov.italic ?? base.italic,
		underline: ov.underline ?? base.underline,
	}
}

/** A variable's font size in PX for one label segment: its `fieldSizes`
 *  entry (points, converted here) when set, else the label's own size —
 *  `basePx`, which the caller resolved from the default size or the mapped
 *  Size scale. Literal segments always take `basePx`. */
export const resolveFieldSizePx = (
	cfg: Pick<DataLabelsConfig, "fieldSizes" | "pieces">,
	field: string | null,
	basePx: number
): number => {
	const pt = labelEntry(cfg, "fieldSizes", field)
	return pt != null && Number.isFinite(pt) ? ptToPx(pt) : basePx
}

/** One resolved text-background style — what a rect behind the text draws
 *  with. `null` = no background. */
export type ResolvedLabelBackground = {
	color: string
	radius: number
	padX: number
	padY: number
	/** Border stroke; `borderWidth` 0 = no border. */
	borderColor: string
	borderWidth: number
}

/** Fallback padding (px) for the text-background rect when the config
 *  hasn't set explicit values — matches the historical baked-in look. */
export const DEFAULT_BG_PAD_X = 3
export const DEFAULT_BG_PAD_Y = 1.5
/** Border color a text-background rect strokes with when the config sets a
 *  border thickness but no color. */
export const DEFAULT_BG_BORDER_COLOR = "#999999"

/** The LAYER-wide text background (`null` when the toggle is off).
 *  `vizBackground` is the chart's own background — the color a null
 *  `textBackgroundColor` inherits. */
export const resolveLayerBackground = (
	cfg: Pick<
		DataLabelsConfig,
		| "textBackground"
		| "textBackgroundColor"
		| "textBackgroundRadius"
		| "textBackgroundPadX"
		| "textBackgroundPadY"
		| "textBackgroundBorderColor"
		| "textBackgroundBorderWidth"
	>,
	vizBackground: string
): ResolvedLabelBackground | null =>
	cfg.textBackground
		? {
				color: cfg.textBackgroundColor ?? vizBackground,
				radius: cfg.textBackgroundRadius ?? 0,
				padX: cfg.textBackgroundPadX ?? DEFAULT_BG_PAD_X,
				padY: cfg.textBackgroundPadY ?? DEFAULT_BG_PAD_Y,
				borderColor: cfg.textBackgroundBorderColor ?? DEFAULT_BG_BORDER_COLOR,
				borderWidth: cfg.textBackgroundBorderWidth ?? 0,
			}
		: null

/** A variable's text background for one label segment: its
 *  `fieldBackgrounds` entry decides on / off (null = follow the layer
 *  toggle) and overrides any styling key it sets; everything else falls
 *  back to the layer-wide values. Literal segments (no field) take the
 *  layer background. */
export const resolveFieldBackground = (
	cfg: Pick<
		DataLabelsConfig,
		| "textBackground"
		| "textBackgroundColor"
		| "textBackgroundRadius"
		| "textBackgroundPadX"
		| "textBackgroundPadY"
		| "textBackgroundBorderColor"
		| "textBackgroundBorderWidth"
		| "fieldBackgrounds"
	>,
	field: string | null,
	vizBackground: string
): ResolvedLabelBackground | null => {
	const ov = field ? cfg.fieldBackgrounds?.[field] : undefined
	const shown = ov?.textBackground ?? cfg.textBackground ?? false
	if (!shown) return null
	return {
		color: ov?.textBackgroundColor ?? cfg.textBackgroundColor ?? vizBackground,
		radius: ov?.textBackgroundRadius ?? cfg.textBackgroundRadius ?? 0,
		padX: ov?.textBackgroundPadX ?? cfg.textBackgroundPadX ?? DEFAULT_BG_PAD_X,
		padY: ov?.textBackgroundPadY ?? cfg.textBackgroundPadY ?? DEFAULT_BG_PAD_Y,
		borderColor:
			ov?.textBackgroundBorderColor ??
			cfg.textBackgroundBorderColor ??
			DEFAULT_BG_BORDER_COLOR,
		borderWidth:
			ov?.textBackgroundBorderWidth ?? cfg.textBackgroundBorderWidth ?? 0,
	}
}

/** Two resolved backgrounds draw identically (both off, or same style). */
export const sameBackground = (
	a: ResolvedLabelBackground | null,
	b: ResolvedLabelBackground | null
): boolean =>
	a === b ||
	(a !== null &&
		b !== null &&
		a.color === b.color &&
		a.radius === b.radius &&
		a.padX === b.padX &&
		a.padY === b.padY &&
		a.borderColor === b.borderColor &&
		a.borderWidth === b.borderWidth)

/** One label's fill through the Data Labels precedence chain:
 * per-category override → conditional numeric rule → hue-scale color →
 * the single fallback `cfg.color`. `hueColor` arrives pre-resolved (the
 * caller owns the scale); `labelValue` is the RAW value backing the
 * label (rules compare against the number, not its formatted string);
 * `ruleRows` are the mark's dataset rows, for `{Variable}` rules. */
export const resolveLabelFill = (
	cfg: DataLabelsConfig,
	hueValue: unknown,
	hueColor: string | null,
	labelValue: unknown,
	ruleRows?: RuleRows
): string => {
	const overrideKey = hueValue === undefined ? null : String(hueValue ?? "")
	const overrideColor =
		overrideKey && cfg.colorOverrides[overrideKey]
			? cfg.colorOverrides[overrideKey]
			: null
	const ruleColor = resolveRuleColor(cfg.textColorRules, labelValue, ruleRows)
	return overrideColor ?? ruleColor ?? hueColor ?? cfg.color
}
