// Data-labels styling shared between the overlay layer (DataLabelsLayer —
// scatter/bars/areas/pies, where labels are positioned by chart scales)
// and the layout-placed label paths (the hierarchy renderers, where the
// pack/treemap/partition layout decides WHERE labels sit but the Data
// Labels section decides their text, color, and size). Pure functions —
// no React, no atoms — so both consumers resolve identically and the
// pieces unit-test without a renderer.

import {
	DATA_LABELS_SINGLE_COLOR_ID,
	type ChannelConfigs,
	type DataLabelsConfig,
	type HueConfig,
} from "./channelConfig"
import { buildLabelHueConfig } from "./dataLabelsHue"
import { buildTickFormatter } from "./formatTick"
import { resolveRuleColor } from "./textColorRules"
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
 * so a token collapses to nothing rather than "null". */
export const formatField = (
	raw: unknown,
	spec: string | undefined,
	decimals: number | null
): string => {
	const trimmed = spec?.trim()
	if (trimmed) {
		const fmt = buildTickFormatter({ customFormat: trimmed }, "quantitative")
		if (fmt) return fmt(raw)
	}
	return formatLabel(raw, decimals) ?? ""
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
 * sizeMax] pixel range. Returns `cfg.fontSize` when no size encoding is
 * meaningful (no field mapped, or non-numeric value). */
export const resolveLabelSize = (
	raw: unknown,
	cfg: DataLabelsConfig,
	allValues: number[]
): number => {
	if (raw === undefined) return cfg.fontSize
	const n = typeof raw === "number" ? raw : Number(raw)
	if (!Number.isFinite(n)) return cfg.fontSize
	if (allValues.length === 0) return cfg.fontSize
	const lo = Math.min(...allValues)
	const hi = Math.max(...allValues)
	if (lo === hi) return (cfg.sizeMin + cfg.sizeMax) / 2
	const t = (n - lo) / (hi - lo)
	return cfg.sizeMin + t * (cfg.sizeMax - cfg.sizeMin)
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

/** One label's fill through the Data Labels precedence chain:
 * per-category override → conditional numeric rule → hue-scale color →
 * the single fallback `cfg.color`. `hueColor` arrives pre-resolved (the
 * caller owns the scale); `labelValue` is the RAW value backing the
 * label (rules compare against the number, not its formatted string). */
export const resolveLabelFill = (
	cfg: DataLabelsConfig,
	hueValue: unknown,
	hueColor: string | null,
	labelValue: unknown
): string => {
	const overrideKey = hueValue === undefined ? null : String(hueValue ?? "")
	const overrideColor =
		overrideKey && cfg.colorOverrides[overrideKey]
			? cfg.colorOverrides[overrideKey]
			: null
	const ruleColor = resolveRuleColor(cfg.textColorRules, labelValue)
	return overrideColor ?? ruleColor ?? hueColor ?? cfg.color
}
