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
import type { DatasetView, Encodings } from "./types"

/** The default d3-format spec applied wherever a dollar-hinted field's
 * format is still "Auto": grouped, up to two decimals, trailing zeros
 * trimmed — "$1,234.56", "$20,000", "$0.5". Matches the mental model of the
 * Format dropdown's "Currency" preset without forcing ".00" onto round
 * axis ticks. */
export const DOLLAR_FORMAT_SPEC = "$,.2~f"

/** The view fields tagged "dollar" by `applyDollarConversionToView`. */
export const dollarFieldSet = (
	view: DatasetView | undefined,
): ReadonlySet<string> => {
	const out = new Set<string>()
	for (const f of view?.fields ?? [])
		if (f.formatHint === "dollar") out.add(f.name)
	return out
}

const isAuto = (spec: string | undefined): boolean => (spec ?? "").trim() === ""

/** Fold the dollar default into the RENDER-side channel configs: any x / y /
 * r axis (or angle) whose mapped field carries the dollar hint and whose
 * `customFormat` is still "" (Auto) renders with `DOLLAR_FORMAT_SPEC`.
 *
 * Read-time only — the STORED configs are never written, so the sidebar's
 * Format box keeps showing Auto, the theme-diff "changed" dot stays honest,
 * and any user-picked spec (non-empty) wins untouched. Identity-preserving
 * when nothing applies. */
export const applyDollarDefaultsToChannelConfigs = (
	configs: ChannelConfigs,
	encodings: Encodings,
	dollarFields: ReadonlySet<string>,
): ChannelConfigs => {
	if (dollarFields.size === 0) return configs
	let out = configs
	for (const ch of ["x", "y", "r"] as const) {
		// A positional axis without its own field can still be the MEASURE
		// axis: bar-family charts encode the value on `length`, and the
		// unmapped perpendicular axis renders it (vertical bars → y,
		// horizontal → x, radar spokes → r). Axes that don't render at all
		// ignore their config, so the fallback never mislabels anything.
		const field = encodings[ch]?.field ?? encodings.length?.field
		if (!field || !dollarFields.has(field)) continue
		const existing = configs[ch]
		if (!isAuto(existing?.customFormat)) continue
		if (out === configs) out = { ...configs }
		out[ch] = {
			...(existing ?? DEFAULT_AXIS_CONFIG),
			customFormat: DOLLAR_FORMAT_SPEC,
		}
	}
	const angleField = encodings.angle?.field
	if (angleField && dollarFields.has(angleField)) {
		const existing = configs.angle
		if (isAuto(existing?.customFormat)) {
			if (out === configs) out = { ...configs }
			out.angle = {
				...DEFAULT_ANGLE_CONFIG,
				...(existing ?? {}),
				customFormat: DOLLAR_FORMAT_SPEC,
			}
		}
	}
	return out
}

/** Same read-time defaulting for the quantitative legend channels: a
 * gradient bar / size / opacity legend over a dollar-hinted field formats
 * its break labels with `DOLLAR_FORMAT_SPEC` while its per-channel format
 * is still "" (Auto). Identity-preserving when nothing applies. */
export const applyDollarDefaultsToLegendConfig = <
	T extends Pick<Partial<LegendConfig>, "channels">,
>(
	legendCfg: T,
	encodings: Encodings,
	dollarFields: ReadonlySet<string>,
): T => {
	if (dollarFields.size === 0) return legendCfg
	let channels = legendCfg.channels
	let changed = false
	for (const ch of QUANTITATIVE_LEGEND_CHANNELS) {
		const field = encodings[ch]?.field
		if (!field || !dollarFields.has(field)) continue
		const existing = channels?.[ch]
		if (!isAuto(existing?.format)) continue
		channels = {
			...(channels ?? {}),
			[ch]: {
				...(existing ?? DEFAULT_LEGEND_CHANNEL_CONFIG),
				format: DOLLAR_FORMAT_SPEC,
			},
		}
		changed = true
	}
	return changed ? { ...legendCfg, channels } : legendCfg
}

/** Same read-time defaulting for data labels: a dollar-hinted field with no
 * explicit per-field format spec gets `DOLLAR_FORMAT_SPEC` in
 * `fieldFormats`. Keyed by field NAME (like `fieldFormats` itself), so it
 * covers single- and multi-field labels alike. Identity-preserving when
 * nothing applies. */
export const applyDollarDefaultsToDataLabels = <
	T extends Pick<Partial<DataLabelsConfig>, "fieldFormats">,
>(
	cfg: T,
	dollarFields: ReadonlySet<string>,
): T => {
	if (dollarFields.size === 0) return cfg
	let formats = cfg.fieldFormats
	let changed = false
	for (const field of dollarFields) {
		if (!isAuto(formats?.[field])) continue
		formats = { ...(formats ?? {}), [field]: DOLLAR_FORMAT_SPEC }
		changed = true
	}
	return changed ? { ...cfg, fieldFormats: formats } : cfg
}
