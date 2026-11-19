import { densityCurveGroupField } from "../../../lib/colorSlots"
import { effectiveType } from "../../../lib/fieldType"
import {
	LEGEND_FRIENDLY_NAME,
	resolveRampLegendStyle,
	RAMP_LEGEND_CHANNELS,
	type RampLegendChannel,
	type EncodingLegendChannel,
	type LegendChannel,
	type SwatchShapeChannel,
} from "../../../lib/labelsConfig"
import { swatchSizePatch } from "../../../lib/legendEdits"
import { legendSwatchControls, type SwatchMember } from "../../../lib/legendSwatchControls"
import { type LegendPanelBase } from "./useLegendPanelBase"

/** Fallbacks when neither the legend config nor the theme provides a swatch
 *  color — one definition so the aux and shape pickers can't drift. */
export const DEFAULT_SWATCH_FILL = "#4f8eda"
export const DEFAULT_SWATCH_STROKE = "#ffffff"

// Group channels that can lead a swatch-drawing section, in the
// renderer's GROUP_CHANNELS order.
export const swatchGroupChannels = [
	"hue",
	"outlineHue",
	"saturation",
	"brightness",
	"pattern",
	"opacity",
] as const
export type SwatchGroupChannel = (typeof swatchGroupChannels)[number]

/** Which swatch subsections the panel offers and what each one controls —
 *  mirrors how the Legend groups channels into sections, so the panel never
 *  offers a control for a swatch that isn't drawn. Pure: everything comes
 *  from the base model. */
export const planLegendSwatches = (base: LegendPanelBase) => {
	const {
		merged,
		update,
		theme,
		encodings,
		overrides,
		dataset,
		configs,
		renderConfigs,
		modeDef,
		effHidden,
		mappedLegendChannels,
		rugLegendMapped,
		densityCurveLegendMapped,
		coalescedSlots,
		quantChannelGroups,
		opacityMeasureActive,
		hueDerivedActive,
		hueField,
		hueType,
	} = base

	// Visibility flags for the "always-rendered" sub-sections — only show
	// them when their channel is actually mapped and not hidden, so users
	// editing a vector field (length + angle only) don't see Shape swatch
	// and Hue gradient-style controls cluttering the panel.
	const showGradientLegendStyle =
		mappedLegendChannels.includes("hue") &&
		!effHidden.hue &&
		(hueType === "quantitative" || hueType === "temporal")
	const showShapeSwatch =
		mappedLegendChannels.includes("shape") && !effHidden.shape
	// The hue swatch-shape picker only matters when the color legend renders
	// discrete swatches: a categorical/ordinal hue legend, or a
	// quantitative/temporal one the user has switched to "swatches" style. A
	// plain gradient bar has no swatches to reshape, so the picker stays
	// hidden there.
	const rendersSwatches = (t: ReturnType<typeof effectiveType> | undefined) =>
		t === "categorical" ||
		t === "ordinal" ||
		((t === "quantitative" || t === "temporal") &&
			(merged.gradientLegendStyle ?? "bar") === "swatches")
	// Every legend section that draws discrete swatches gets its own
	// swatch-shape picker, keyed by the channel that LEADS the section in the
	// renderer (Legend.tsx's GROUP_CHANNELS order): channels sharing a field
	// collapse into one combined section that reads its shape from its first
	// channel — so a pattern on hue's field is covered by the Color picker,
	// while a standalone pattern gets a Pattern picker of its own.
	const outlineHueField = encodings.outlineHue?.field ?? null
	const outlineHueType =
		outlineHueField && dataset
			? effectiveType(dataset, outlineHueField, overrides)
			: undefined
	const rugField = configs.colorSlots?.rug?.field ?? null
	const rugType =
		rugField && dataset ? effectiveType(dataset, rugField, overrides) : undefined
	const rugRendersSwatches =
		rugLegendMapped &&
		!effHidden.rug &&
		!coalescedSlots.includes("rug") &&
		rendersSwatches(rugType)
	const combineLegendSections = merged.combineSameVariable !== false
	// Group channels that can lead a swatch-drawing section, in the
	// renderer's GROUP_CHANNELS order.
	// Mapped + visible (per the "Legends shown" toggles).
	const swatchChannelActive = (ch: SwatchGroupChannel): boolean =>
		mappedLegendChannels.includes(ch) && !effHidden[ch]
	const leadsSwatchSection = (ch: SwatchGroupChannel): boolean => {
		if (!swatchChannelActive(ch)) return false
		const field = encodings[ch]?.field
		if (!field) return false
		// With combining off every channel emits its own section.
		if (!combineLegendSections) return true
		// A visible shape channel on the same field turns the combined
		// section's swatches into per-category shape glyphs, which ignore the
		// swatch shape — don't offer an inert picker.
		if (showShapeSwatch && encodings.shape?.field === field) return false
		// The first group channel on the field keys the section; later ones
		// are covered by that channel's picker.
		return !swatchGroupChannels
			.slice(0, swatchGroupChannels.indexOf(ch))
			.some((prev) => swatchChannelActive(prev) && encodings[prev]?.field === field)
	}
	// Every swatch-group channel folded into the section `ch` leads — the
	// group's header names them all ("Brightness · Pattern") so a combined
	// section's controls aren't mislabeled as the lead channel alone.
	const swatchSectionMembers = (ch: SwatchGroupChannel): SwatchGroupChannel[] => {
		const field = encodings[ch]?.field
		if (!field || !combineLegendSections) return [ch]
		return swatchGroupChannels.filter(
			(c) => swatchChannelActive(c) && encodings[c]?.field === field
		)
	}
	// The glyph the marks draw when no Shape field varies it — same mode
	// rule Legend.tsx applies (the Default shape only draws in glyph modes).
	const marksShape =
		modeDef.canvas.shapeRole === "glyph" ? (renderConfigs.defaultShape ?? 0) : 0
	// EVERY channel the renderer folds into the section on `field` that
	// `lead` leads — group channels plus Shape / Length / Angle / Size, in
	// the renderer's GROUP_CHANNELS order. legendSwatchControls turns this
	// into the subsection's rows, so the panel offers exactly the swatch
	// properties no member encodes.
	const sectionMembersOf = (
		field: string | null | undefined,
		lead: SwatchMember
	): SwatchMember[] => {
		if (!field || !combineLegendSections) return [lead]
		const order: SwatchMember[] = [
			...swatchGroupChannels,
			"shape",
			"length",
			"angle",
			"area",
		]
		return order.filter(
			(c) =>
				c === lead ||
				(mappedLegendChannels.includes(c as EncodingLegendChannel) &&
					!effHidden[c as LegendChannel] &&
					encodings[c as keyof typeof encodings]?.field === field &&
					(c !== "shape" || showShapeSwatch))
		)
	}
	// Line-chart context for the rule (a Pattern member draws the dash
	// overlay) — the same test Legend.tsx hands the renderer.
	const swatchCtx = {
		connection:
			!modeDef.legend.hideConnectionInThisMode && !!encodings.connection?.field,
	}
	const isQuantField = (field: string | null | undefined): boolean => {
		if (!field || !dataset) return false
		const t = effectiveType(dataset, field, overrides)
		return t === "quantitative" || t === "temporal"
	}
	// A quantitative color section falls back to discrete swatches — even in
	// "bar" gradient style — when another group channel shares its field (a
	// composed per-stop visual can't render as a continuous gradient strip).
	const quantForcedToSwatches = (field: string | null): boolean =>
		!!field &&
		combineLegendSections &&
		((["saturation", "brightness", "pattern", "opacity"] as const).some(
			(c) => swatchChannelActive(c) && encodings[c]?.field === field
		) ||
			// Size / Angle on the field draw per-stop glyphs (the combined
			// legend's glyph path), whatever the gradient style.
			(["area", "angle"] as const).some(
				(c) =>
					mappedLegendChannels.includes(c) &&
					!effHidden[c] &&
					encodings[c]?.field === field
			))
	const hueRendersSwatches =
		mappedLegendChannels.includes("hue") &&
		!effHidden.hue &&
		// A derived tree hue (Top-level group / depth) has no field type but
		// renders discrete swatches, so the swatch controls apply to it too.
		(hueDerivedActive ||
			rendersSwatches(hueType) ||
			((hueType === "quantitative" || hueType === "temporal") &&
				quantForcedToSwatches(hueField)))
	const outlineHueRendersSwatches =
		mappedLegendChannels.includes("outlineHue") &&
		!effHidden.outlineHue &&
		(rendersSwatches(outlineHueType) ||
			((outlineHueType === "quantitative" || outlineHueType === "temporal") &&
				quantForcedToSwatches(outlineHueField)))
	// Lone continuous Saturation / Brightness / Opacity legends (a field no
	// other legend channel shares, or the Count / Density opacity ramp): like
	// Color, each can draw as a gradient bar or as swatches
	// (resolveRampLegendStyle — the same chain Legend.tsx renders with).
	const opacityMeasureLegend =
		opacityMeasureActive && !encodings.opacity?.field && !effHidden.opacity
	const rampChannels = RAMP_LEGEND_CHANNELS.filter((ch) => {
		if (ch === "opacity" && opacityMeasureLegend) return true
		if (!mappedLegendChannels.includes(ch) || effHidden[ch]) return false
		const f = encodings[ch]?.field
		return isQuantField(f) && sectionMembersOf(f, ch).length === 1
	})
	const rampStyleOf = (ch: RampLegendChannel) =>
		resolveRampLegendStyle(merged, ch, ch === "opacity" && opacityMeasureLegend)
	const setRampStyle = (ch: RampLegendChannel, style: "bar" | "swatches") => {
		const next = { ...merged.gradientLegendStyles }
		// Sparse: the legend's historical look is stored as unset.
		if (style === resolveRampLegendStyle({}, ch, ch === "opacity" && opacityMeasureLegend))
			delete next[ch]
		else next[ch] = style
		update({ gradientLegendStyles: next })
	}
	const rampBarChannels = rampChannels.filter((ch) => rampStyleOf(ch) === "bar")
	// Any legend drawing a gradient bar → the shared bar settings apply.
	const anyGradientBar =
		(showGradientLegendStyle && (merged.gradientLegendStyle ?? "bar") === "bar") ||
		rampBarChannels.length > 0
	// The shape channel never emits a swatch-shape section (its glyphs ARE the
	// encoding) — it gets its own "Shape swatch" subsection below instead.
	const swatchShapeSections: Exclude<SwatchShapeChannel, "shape">[] = [
		...(hueRendersSwatches && leadsSwatchSection("hue")
			? (["hue"] as const)
			: []),
		...(outlineHueRendersSwatches && leadsSwatchSection("outlineHue")
			? (["outlineHue"] as const)
			: []),
		...(["saturation", "brightness", "pattern", "opacity"] as const).filter(
			(ch) =>
				leadsSwatchSection(ch) &&
				!(ch !== "pattern" && rampBarChannels.includes(ch))
		),
		...(rugRendersSwatches ? (["rug"] as const) : []),
	]
	// Swatch shape / size / outline entries are SPARSE against the theme:
	// picking the theme's own value drops the entry (so the subsection's dot
	// clears and a later theme edit flows through), anything else is stored
	// explicitly — the rectangle as "rect", since a stored null means
	// "follow the theme". Hue's legacy global fields are cleared alongside
	// so they can't shine through a dropped entry.
	const setSwatchSize = (ch: SwatchShapeChannel, size: number) =>
		update(swatchSizePatch(merged, ch, size, theme))
	const setSwatchOutlineColor = (ch: SwatchShapeChannel, color: string) =>
		update({
			swatchOutlineColors: { ...merged.swatchOutlineColors, [ch]: color },
		})
	const resetSwatchOutlineColor = (ch: SwatchShapeChannel) => {
		// Back to the theme's default (its own color, else auto: pipe in the
		// marks' outline color). An explicit null entry is needed to override
		// a legacy GLOBAL color; otherwise keep the stored map sparse.
		const next = { ...merged.swatchOutlineColors }
		if (merged.swatchOutlineColor != null) next[ch] = null
		else delete next[ch]
		update({ swatchOutlineColors: next })
	}
	// The standalone-swatch color picker appears for channels in
	// {length, angle, area, opacity} that are mapped + visible AND aren't
	// sharing a field with hue (those get their color from the hue
	// gradient, so the swatch picker doesn't apply). The subheader's
	// text names exactly the channels that USE the color — e.g. just
	// "Length" when length stands alone, "Length · Angle" when both do.
	const visibleHueField =
		mappedLegendChannels.includes("hue") && !effHidden.hue
			? hueField
			: null
	const auxSwatchableChannels: EncodingLegendChannel[] = ["length", "angle", "area", "opacity"]
	const auxSwatchActiveChannels = auxSwatchableChannels.filter((ch) => {
		if (!mappedLegendChannels.includes(ch)) return false
		if (effHidden[ch]) return false
		// Field-mapped opacity carries its own Swatch color row inside the
		// "Swatches" section (its per-section group), so it drops out of this
		// shared subsection. Only the measure-mapped (Count / Density) opacity
		// ramp — which has no group there — still needs this picker.
		if (ch === "opacity" && encodings.opacity?.field) return false
		// Sharing a field with the visible hue channel means the swatch
		// inherits color from the gradient — the picker would have no
		// visible effect, so leave it out of the header.
		const f = encodings[ch]?.field
		if (f && visibleHueField && f === visibleHueField) return false
		// Likewise any other group channel (Saturation, Pattern, …) on the
		// field: the section is that channel's, and its own subsection
		// carries the swatch rows (legendSwatchControls) — a second picker
		// here would edit settings that section doesn't read.
		if (
			f &&
			combineLegendSections &&
			swatchGroupChannels.some(
				(g) => swatchChannelActive(g) && encodings[g]?.field === f
			)
		)
			return false
		return true
	})
	// "Combine legends with same variables": when on (the default), an aux
	// channel that shares the SHAPE channel's field folds into a single
	// "Size · Shape swatch" subsection whose fill / stroke (the shape
	// channel's — it wins in the combined glyph) governs the merged swatch.
	// Those channels drop out of the standalone aux-swatch header so the user
	// isn't offered a second, no-effect color picker for the same swatch.
	const shapeField = showShapeSwatch ? (encodings.shape?.field ?? null) : null
	const auxSharingShapeField =
		combineLegendSections && shapeField
			? auxSwatchActiveChannels.filter((ch) => encodings[ch]?.field === shapeField)
			: []
	// Every channel the Shape legend section depicts, and the rows it gets
	// (legendSwatchControls): Color on the field owns the fill, Pattern
	// tiles it, Outline color owns the stroke color, Size the radius.
	const shapeMembers: SwatchMember[] = sectionMembersOf(shapeField, "shape")
	const shapeControls = legendSwatchControls(shapeMembers)
	// ≥2 members → the combined renderer (its defaults differ from the
	// standalone Shape legend's).
	const shapeSectionCombined = shapeMembers.length > 1
	// Aux channels shown in their OWN swatch subsection = the active ones not
	// folded into the Shape swatch above.
	const auxSwatchDisplayChannels = auxSwatchActiveChannels.filter(
		(ch) => !auxSharingShapeField.includes(ch)
	)
	// Quantitative legends that draw discrete swatches keep their break rows
	// (swatch count + custom breaks) in their swatch subsection — the group
	// section their field leads, or the shared Length · Angle · Size one.
	// Label format then keeps only the number format for them; gradient
	// bars (no swatch subsection) keep their breaks there.
	const swatchBreakFields = new Set<string>(
		[
			...swatchShapeSections
				.filter((ch) => ch !== "rug")
				.map((ch) => encodings[ch as keyof typeof encodings]?.field),
			...auxSwatchDisplayChannels.map(
				(ch) => encodings[ch as keyof typeof encodings]?.field
			),
		].filter((f): f is string => !!f && isQuantField(f))
	)
	const auxBreakFields = [
		...new Set(
			auxSwatchDisplayChannels
				.map((ch) => encodings[ch as keyof typeof encodings]?.field)
				.filter((f): f is string => !!f && isQuantField(f))
		),
	]
	const breaksSet = (field: string | null | undefined): boolean =>
		!!field &&
		(quantChannelGroups
			.find((g) => g.field === field)
			?.channels.some((c) => (merged.channels?.[c]?.breaks?.length ?? 0) > 0) ??
			false)
	const showAuxSwatchColor = auxSwatchDisplayChannels.length > 0
	const auxSwatchHeader = auxSwatchDisplayChannels
		.map((ch) => LEGEND_FRIENDLY_NAME[ch])
		.join(" · ")
	const resolvedAuxSwatchColor =
		merged.auxLegendSwatchColor ?? theme.legendSwatchColor ?? DEFAULT_SWATCH_FILL
	// The swatch border only applies to the area (size) legend — its swatch
	// is a filled circle. Length / angle swatches are lines and opacity
	// swatches are borderless, so only surface the border control when the
	// area channel is among the active aux swatches.
	const showAuxSwatchStroke = auxSwatchDisplayChannels.includes("area")
	const resolvedAuxSwatchStroke =
		merged.auxLegendSwatchStroke ?? theme.legendSwatchStroke ?? DEFAULT_SWATCH_STROKE
	// No-hue pattern tiles (a section with Pattern but no Color — pattern-,
	// saturation-, brightness-, opacity-, outline- or shape-led): the tiles
	// ARE the fill, defaulting to the Pattern menu's Background (else gray)
	// under a near-black ink — offer both as legend-side overrides.
	// Per-category ink overrides from the Pattern menu still win in the
	// renderer. Shared by every swatch subsection whose fill control is
	// "pattern" (legendSwatchControls).
	// Header for the shape swatch subsection: when a same-field aux channel
	// (e.g. Size) merged in, name both — "Size · Shape" — so it's clear this
	// one control drives the combined legend's swatch.
	const shapeSwatchHeader = shapeMembers
		.map((ch) => LEGEND_FRIENDLY_NAME[ch as LegendChannel])
		.join(" · ")
	// The combine toggle only makes sense when ≥2 legend channels actually
	// share a field; otherwise there's nothing to combine. The rug and
	// density-curve slot legends count too — they fold into a same-field
	// Color legend (or into each other) under the same toggle.
	const sharedVariableExists = (() => {
		const byField = new Map<string, number>()
		const count = (f: string | null | undefined) => {
			if (f) byField.set(f, (byField.get(f) ?? 0) + 1)
		}
		for (const ch of mappedLegendChannels) {
			if (effHidden[ch as LegendChannel]) continue
			count(encodings[ch]?.field)
		}
		if (rugLegendMapped && !effHidden.rug) count(configs.colorSlots?.rug?.field)
		if (densityCurveLegendMapped && !effHidden.densityCurve) {
			count(densityCurveGroupField(renderConfigs))
		}
		for (const n of byField.values()) if (n >= 2) return true
		return false
	})()

	return {
		showGradientLegendStyle,
		showShapeSwatch,
		combineLegendSections,
		swatchSectionMembers,
		marksShape,
		sectionMembersOf,
		swatchCtx,
		isQuantField,
		rampChannels,
		rampStyleOf,
		setRampStyle,
		rampBarChannels,
		anyGradientBar,
		swatchShapeSections,
		setSwatchSize,
		setSwatchOutlineColor,
		resetSwatchOutlineColor,
		rugField,
		shapeMembers,
		shapeControls,
		shapeSectionCombined,
		auxSwatchDisplayChannels,
		swatchBreakFields,
		auxBreakFields,
		breaksSet,
		showAuxSwatchColor,
		auxSwatchHeader,
		resolvedAuxSwatchColor,
		showAuxSwatchStroke,
		resolvedAuxSwatchStroke,
		shapeSwatchHeader,
		sharedVariableExists,
	}
}
