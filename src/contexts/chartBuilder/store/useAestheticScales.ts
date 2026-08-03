import { useMemo } from "react"
import { useAtomValue } from "jotai"
import type { ColorSlotKey, OpacitySlotKey } from "../lib/channelConfig"
import { COLOR_SLOT_REGISTRY } from "../lib/colorSlots"
import { OPACITY_SLOT_REGISTRY } from "../lib/opacitySlots"
import { effectiveType } from "../lib/fieldType"
import { resolveLegendDomain } from "../lib/legendBreaks"
import { patternCategoriesFor } from "../lib/patterns"
import {
	makeAngleScale,
	makeAreaScale,
	makeBrightnessScale,
	makeHueScale,
	makeLengthScale,
	makeOpacityScale,
	makeSaturationScale,
	makeShapeIndexer,
	outlinePaletteForHueType,
	type HueScale,
	type UnitScale,
} from "../lib/scales"
import type { Encodings, FieldType } from "../lib/types"

import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentLegendConfigAtom,
} from "./atoms"
import { useCurrentDatasetView } from "./useCurrentDatasetView"

export type AestheticFieldInfo = {
	name: string
	type: FieldType
}

/** Aesthetic scales for the current encodings, always built from the full
 * dataset rows. Each entry is `null` when the corresponding channel isn't
 * mapped. Callers destructure only what they need.
 *
 * The "full dataset" invariant is load-bearing: if a plot facets by the same
 * field that drives hue, each panel's filtered rows would produce a hue scale
 * with a single-value domain and every panel would render `palette[0]`. The
 * hook enforces this by reading `dataset.rows` itself — there is no way to
 * pass "filtered rows" in. */
export type AestheticScales = {
	hue: { scale: HueScale; field: AestheticFieldInfo } | null
	/** Color scale for mark *outline* (stroke) color, driven by the
	 * `outlineHue` channel. Independent of `hue` (which drives fill). */
	outlineHue: { scale: HueScale; field: AestheticFieldInfo } | null
	saturation: { scale: UnitScale; field: AestheticFieldInfo } | null
	brightness: { scale: UnitScale; field: AestheticFieldInfo } | null
	opacity: { scale: UnitScale; field: AestheticFieldInfo } | null
	area: {
		scale: ReturnType<typeof makeAreaScale>
		field: AestheticFieldInfo
	} | null
	shape: {
		idx: ReturnType<typeof makeShapeIndexer>
		field: AestheticFieldInfo
	} | null
	length: {
		scale: ReturnType<typeof makeLengthScale>
		field: AestheticFieldInfo
	} | null
	angle: {
		scale: ReturnType<typeof makeAngleScale>
		field: AestheticFieldInfo
	} | null
	pattern: { categories: string[]; field: AestheticFieldInfo } | null
	/** Color scales for the generic color slots (line / rug / violin / stem /
	 * spine). Each entry is present only when that slot maps a field; renderers
	 * fall back to the slot's single color (or a legacy field) otherwise. */
	colorSlots: Partial<
		Record<ColorSlotKey, { scale: HueScale; field: AestheticFieldInfo } | null>
	>
	/** Opacity scales for the per-part opacity slots (border / rug / line /
	 * violin / stem / spine). Each entry is present only when that slot maps a
	 * field; renderers fall back to the slot's static level otherwise. */
	opacitySlots: Partial<
		Record<OpacitySlotKey, { scale: UnitScale; field: AestheticFieldInfo } | null>
	>
}

const NULL_SCALES: AestheticScales = {
	hue: null,
	outlineHue: null,
	saturation: null,
	brightness: null,
	opacity: null,
	area: null,
	shape: null,
	length: null,
	angle: null,
	pattern: null,
	colorSlots: {},
	opacitySlots: {},
}

export const useAestheticScales = (): AestheticScales => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const legendCfg = useAtomValue(currentLegendConfigAtom)
	const dataset = useCurrentDatasetView()

	return useMemo<AestheticScales>(() => {
		if (!dataset) return NULL_SCALES
		const rows = dataset.rows
		// The chart's color/size encoding has to honor the user's chosen
		// break domain too — not just the legend display — so the legend
		// labels match what the marks actually look like. Pull each
		// channel's domain + clamp setting once and feed it into each
		// scale builder below.
		const legendChannelCfgs = legendCfg.channels ?? {}

		const build = (channel: keyof AestheticScales) => {
			// Every key of AestheticScales is also a valid EncodingChannel
			// (hue/saturation/brightness/opacity/area/shape/length/angle/pattern).
			// Defensive optional chaining tolerates stale persisted encodings
			// missing newly-added channel keys.
			const field = encodings[channel as keyof Encodings]?.field ?? null
			if (!field) return null
			const type = effectiveType(dataset, field, overrides)
			const values = rows.map((r) => r[field])
			return { field: { name: field, type } as AestheticFieldInfo, values }
		}

		// Color slots store their field INSIDE the slot config (not in
		// `encodings`), so build them from `channelConfigs.colorSlots` rather
		// than `build()`. Same full-dataset invariant: read `rows` directly.
		const buildSlot = (key: ColorSlotKey) => {
			const field = channelConfigs.colorSlots?.[key]?.field ?? null
			if (!field) return null
			const type = effectiveType(dataset, field, overrides)
			return {
				field: { name: field, type } as AestheticFieldInfo,
				values: rows.map((r) => r[field]),
			}
		}

		const hue = build("hue")
		const outlineHue = build("outlineHue")
		const saturation = build("saturation")
		const brightness = build("brightness")
		const opacity = build("opacity")
		const area = build("area")
		const shape = build("shape")
		const length = build("length")
		const angle = build("angle")
		const pattern = build("pattern")

		const hueLegendCfg = legendChannelCfgs.hue
		const hueDomain = hue
			? (resolveLegendDomain(hue.values, hue.field.type, hueLegendCfg) ??
				undefined)
			: undefined
		const opacityLegendCfg = legendChannelCfgs.opacity
		const opacityDomain = opacity
			? (resolveLegendDomain(
					opacity.values,
					opacity.field.type,
					opacityLegendCfg,
				) ?? undefined)
			: undefined
		const areaLegendCfg = legendChannelCfgs.area
		const areaDomain = area
			? (resolveLegendDomain(area.values, area.field.type, areaLegendCfg) ??
				undefined)
			: undefined
		const lengthLegendCfg = legendChannelCfgs.length
		const lengthDomain = length
			? (resolveLegendDomain(
					length.values,
					length.field.type,
					lengthLegendCfg,
				) ?? undefined)
			: undefined
		const angleLegendCfg = legendChannelCfgs.angle
		const angleDomain = angle
			? (resolveLegendDomain(angle.values, angle.field.type, angleLegendCfg) ??
				undefined)
			: undefined

		const colorSlots: AestheticScales["colorSlots"] = {}
		for (const def of COLOR_SLOT_REGISTRY) {
			const built = buildSlot(def.key)
			if (!built) continue
			const slotCfg = channelConfigs.colorSlots?.[def.key]
			// Only some slots are legend candidates (line/rug/violin*); the cast
			// tolerates non-candidate keys (stem/spine), which simply have no
			// per-channel break config.
			const slotLegendCfg =
				legendChannelCfgs[def.key as keyof typeof legendChannelCfgs]
			const slotDomain =
				resolveLegendDomain(built.values, built.field.type, slotLegendCfg) ??
				undefined
			colorSlots[def.key] = {
				scale: makeHueScale(
					built.values,
					built.field.type,
					slotCfg?.hue,
					slotCfg?.palette ?? undefined,
					slotDomain
				),
				field: built.field,
			}
		}

		// Opacity slots store their field inside the slot config (like color
		// slots). Build an opacity scale per mapped slot; renderers fall back to
		// the slot's static level when there's no scale.
		const opacitySlotsScales: AestheticScales["opacitySlots"] = {}
		for (const def of OPACITY_SLOT_REGISTRY) {
			const field = channelConfigs.opacitySlots?.[def.key]?.field ?? null
			if (!field) continue
			const type = effectiveType(dataset, field, overrides)
			opacitySlotsScales[def.key] = {
				scale: makeOpacityScale(
					rows.map((r) => r[field]),
					type,
					channelConfigs.opacitySlots?.[def.key]?.opacity
				) as UnitScale,
				field: { name: field, type },
			}
		}

		return {
			hue: hue
				? {
						scale: makeHueScale(
							hue.values,
							hue.field.type,
							channelConfigs.hue,
							// Pick the ordinal palette for ordinal hue fields so
							// theme-supplied sequential palettes drive the
							// rendering; fall back to the categorical palette
							// when no ordinal palette is configured.
							hue.field.type === "ordinal"
								? (channelConfigs.ordinalPalette ??
									channelConfigs.categoricalPalette)
								: channelConfigs.categoricalPalette,
							hueDomain,
						),
						field: hue.field,
					}
				: null,
			outlineHue: outlineHue
				? {
						scale: makeHueScale(
							outlineHue.values,
							outlineHue.field.type,
							channelConfigs.outlineHue,
							outlinePaletteForHueType(outlineHue.field.type, channelConfigs),
						),
						field: outlineHue.field,
					}
				: null,
			saturation: saturation
				? {
						scale: makeSaturationScale(
							saturation.values,
							saturation.field.type,
							channelConfigs.saturation
						) as UnitScale,
						field: saturation.field,
					}
				: null,
			brightness: brightness
				? {
						scale: makeBrightnessScale(
							brightness.values,
							brightness.field.type,
							channelConfigs.brightness
						) as UnitScale,
						field: brightness.field,
					}
				: null,
			opacity: opacity
				? {
						scale: makeOpacityScale(
							opacity.values,
							opacity.field.type,
							channelConfigs.opacity,
							opacityDomain,
						) as UnitScale,
						field: opacity.field,
					}
				: null,
			area: area
				? {
						scale: makeAreaScale(
							area.values,
							area.field.type,
							channelConfigs.area,
							areaDomain,
						),
						field: area.field,
					}
				: null,
			shape: shape
				? {
						idx: makeShapeIndexer(
							shape.values,
							shape.field.type,
							channelConfigs.shape
						),
						field: shape.field,
					}
				: null,
			length: length
				? {
						scale: makeLengthScale(
							length.values,
							length.field.type,
							channelConfigs.length,
							lengthDomain,
						),
						field: length.field,
					}
				: null,
			angle: angle
				? {
						scale: makeAngleScale(
							angle.values,
							angle.field.type,
							channelConfigs.angle,
							angleDomain,
						),
						field: angle.field,
					}
				: null,
			pattern: pattern
				? {
						categories: patternCategoriesFor(
							pattern.values,
							pattern.field.type
						),
						field: pattern.field,
					}
				: null,
			colorSlots,
			opacitySlots: opacitySlotsScales,
		}
	}, [dataset, encodings, overrides, channelConfigs, legendCfg])
}
