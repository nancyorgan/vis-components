import {
	DEFAULT_ANGLE_CONFIG,
	DEFAULT_AXIS_CONFIG,
	type ChannelConfigs,
	type DataLabelsConfig,
} from "./channelConfig"
import {
	DEFAULT_LEGEND_CHANNEL_CONFIG,
	QUANTITATIVE_LEGEND_CHANNELS,
	type LegendConfig,
} from "./labelsConfig"
import type { DatasetView, Encodings, Field } from "./types"

/** The default d3-format spec applied wherever a dollar-hinted field's
 * format is still "Auto": grouped, up to two decimals, trailing zeros
 * trimmed — "$1,234.56", "$20,000", "$0.5". Matches the mental model of the
 * Format dropdown's "Currency" preset without forcing ".00" onto round
 * axis ticks. */
export const DOLLAR_FORMAT_SPEC = "$,.2~f"

/** The default for a percent-hinted field (cells "14%" held in the view as
 * the fraction 0.14): d3's "%" type multiplies back by 100, up to two
 * decimals with trailing zeros trimmed — "14%", "12.5%", "14.55%". */
export const PERCENT_FORMAT_SPEC = ".2~%"

/** The default spec for each view-time format hint. */
export const FORMAT_HINT_SPECS: Record<
	NonNullable<Field["formatHint"]>,
	string
> = {
	dollar: DOLLAR_FORMAT_SPEC,
	percent: PERCENT_FORMAT_SPEC,
}

/** Field name -> default format spec, for every view field carrying a
 * format hint (tagged by the dollar / percent cell conversions). */
export type HintedFormats = ReadonlyMap<string, string>

export const hintedFormats = (view: DatasetView | undefined): HintedFormats => {
	const out = new Map<string, string>()
	for (const f of view?.fields ?? [])
		if (f.formatHint) out.set(f.name, FORMAT_HINT_SPECS[f.formatHint])
	return out
}

const isAuto = (spec: string | undefined): boolean => (spec ?? "").trim() === ""

/** Fold the hint defaults into the RENDER-side channel configs: any x / y /
 * r axis (or angle) whose mapped field carries a format hint and whose
 * `customFormat` is still "" (Auto) renders with that hint's spec.
 *
 * Read-time only — the STORED configs are never written, so the sidebar's
 * Format box keeps showing Auto, the theme-diff "changed" dot stays honest,
 * and any user-picked spec (non-empty) wins untouched. Identity-preserving
 * when nothing applies. */
export const applyFormatHintsToChannelConfigs = (
	configs: ChannelConfigs,
	encodings: Encodings,
	hinted: HintedFormats,
): ChannelConfigs => {
	if (hinted.size === 0) return configs
	let out = configs
	for (const ch of ["x", "y", "r"] as const) {
		// A positional axis without its own field can still be the MEASURE
		// axis: bar-family charts encode the value on `length`, and the
		// unmapped perpendicular axis renders it (vertical bars → y,
		// horizontal → x, radar spokes → r). Axes that don't render at all
		// ignore their config, so the fallback never mislabels anything.
		const field = encodings[ch]?.field ?? encodings.length?.field
		const spec = field ? hinted.get(field) : undefined
		if (!spec) continue
		const existing = configs[ch]
		if (!isAuto(existing?.customFormat)) continue
		if (out === configs) out = { ...configs }
		out[ch] = {
			...(existing ?? DEFAULT_AXIS_CONFIG),
			customFormat: spec,
		}
	}
	const angleField = encodings.angle?.field
	const angleSpec = angleField ? hinted.get(angleField) : undefined
	if (angleSpec) {
		const existing = configs.angle
		if (isAuto(existing?.customFormat)) {
			if (out === configs) out = { ...configs }
			out.angle = {
				...DEFAULT_ANGLE_CONFIG,
				...(existing ?? {}),
				customFormat: angleSpec,
			}
		}
	}
	return out
}

/** Same read-time defaulting for the quantitative legend channels: a
 * gradient bar / size / opacity legend over a hinted field formats its
 * break labels with the hint's spec while its per-channel format is still
 * "" (Auto). Identity-preserving when nothing applies. */
export const applyFormatHintsToLegendConfig = <
	T extends Pick<Partial<LegendConfig>, "channels">,
>(
	legendCfg: T,
	encodings: Encodings,
	hinted: HintedFormats,
): T => {
	if (hinted.size === 0) return legendCfg
	let channels = legendCfg.channels
	let changed = false
	for (const ch of QUANTITATIVE_LEGEND_CHANNELS) {
		const field = encodings[ch]?.field
		const spec = field ? hinted.get(field) : undefined
		if (!spec) continue
		const existing = channels?.[ch]
		if (!isAuto(existing?.format)) continue
		channels = {
			...(channels ?? {}),
			[ch]: {
				...(existing ?? DEFAULT_LEGEND_CHANNEL_CONFIG),
				format: spec,
			},
		}
		changed = true
	}
	return changed ? { ...legendCfg, channels } : legendCfg
}

/** Same read-time defaulting for data labels: a hinted field with no
 * explicit per-field format spec gets the hint's spec in `fieldFormats`.
 * Keyed by field NAME (like `fieldFormats` itself), so it covers single-
 * and multi-field labels alike. Identity-preserving when nothing applies. */
export const applyFormatHintsToDataLabels = <
	T extends Pick<Partial<DataLabelsConfig>, "fieldFormats">,
>(
	cfg: T,
	hinted: HintedFormats,
): T => {
	if (hinted.size === 0) return cfg
	let formats = cfg.fieldFormats
	let changed = false
	for (const [field, spec] of hinted) {
		if (!isAuto(formats?.[field])) continue
		formats = { ...(formats ?? {}), [field]: spec }
		changed = true
	}
	return changed ? { ...cfg, fieldFormats: formats } : cfg
}
