import { useLayoutEffect, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import type { ChannelConfigs } from "../../../lib/channelConfig"
import {
	type FontConfig,
	type GradientBarStyle,
	LEGEND_FRIENDLY_NAME,
	type LegendChannelConfig,
	type LegendSwatchShape,
	type QuantitativeLegendChannel,
} from "../../../lib/labelsConfig"
import { type SectionInfo, uniqueValues } from "../../../lib/legendSections"
import { applyHueScale, makeHueScale } from "../../../lib/scales"
import { currentFieldLevelOrdersAtom } from "../../../store/atoms"
import { useThemeInkFallback } from "../../../store/useThemeInkFallback"
import { AngleLegend } from "./AngleLegend"
import { AreaLegend } from "./AreaLegend"
import { CombinedGroupLegend } from "./CombinedGroupLegend"
import { ColorLegend } from "./ColorLegend"
import { LengthLegend } from "./LengthLegend"
import { OpacityLegend } from "./OpacityLegend"
import { PatternLegend } from "./PatternLegend"
import { ShapeLegend } from "./ShapeLegend"
import { DEFAULT_GRADIENT_BAR_STYLE } from "./swatches"

export type LegendSectionProps = {
	section: SectionInfo
	configs: ChannelConfigs
	textFontSize: number
	/** Body-text weight/italic/underline (mirror the title styling for
	 * legend swatch labels). `textWeight` unset = the browser default. */
	textWeight?: number
	textItalic?: boolean
	textUnderline?: boolean
	titleOverride?: string
	titleFont: FontConfig
	titleAlignment?: "left" | "center" | "right"
	/** Per-legend title x/y pixel nudge (mirrors chart/axis title offsets).
	 * `+x` shifts the title right, `+y` down. Applied as a CSS transform so
	 * it does not reflow the legend box. */
	titleOffset?: { x?: number; y?: number }
	reverseCategorical: boolean
	orientation: "vertical" | "horizontal"
	gradientLegendStyle?: "bar" | "swatches"
	/** Resolved gradient-bar display options (length / radius / ticks /
	 * label alignment) from the legend config. Only consulted when a
	 * quantitative color section renders in `"bar"` style. */
	gradientBarStyle?: GradientBarStyle
	legendFillColor?: string | null
	legendStrokeColor?: string | null
	connectionMapped?: boolean
	/** Per-quantitative-channel break + format overrides. Sparse: only
	 * channels the user has touched appear here; missing channels resolve
	 * to defaults via `resolveLegendChannelConfig`. */
	channelLegendCfgs?: Partial<Record<QuantitativeLegendChannel, LegendChannelConfig>>
	/** Color used for the length / angle / area / opacity legend
	 * swatches when they render as standalone sections. `null` / undefined
	 * uses the historical `#4f8eda`. */
	auxSwatchColor?: string | null
	/** Border (stroke) color for the area (size) legend swatch circles.
	 * `null` / undefined uses the historical white outline. */
	auxSwatchStroke?: string | null
	/** The theme's default legend-swatch color, WITHOUT the per-visual
	 * `auxLegendSwatchColor` override folded in. No-hue sections that don't
	 * host an aux-painted channel (e.g. a pattern-only legend) rest on this
	 * so they follow the theme but not another legend's swatch-color picker. */
	themeSwatchColor?: string | null
	/** Standalone-pattern swatch overrides (LegendConfig.patternLegendBgColor
	 * / patternLegendInkColor). Only consulted when the section draws pattern
	 * tiles WITHOUT a hue color — with hue mapped the swatch follows the hue
	 * scale as a faithful key. */
	patternLegendBgColor?: string | null
	patternLegendInkColor?: string | null
	/** Whether the chart mode (areas-x / areas-y / radar) exposes a separate
	 *  line/outline palette — drives the ColorLegend split-outline rendering.
	 *  Computed by the parent, where the chart mode is resolved (modeDef is
	 *  not in scope inside this component). */
	splitOutlineEligible?: boolean
	/** Hierarchy modes: the size (area) legend renders swatch radii in the
	 *  chart's TRUE proportions — value^exponent, zero-anchored — instead
	 *  of the min→max px range mapping. `0.5` = area-true; `1` = packed
	 *  circles' Scale-by-diameter. Undefined = historical mapping (bubble
	 *  charts). Computed by the parent, same reason as
	 *  `splitOutlineEligible`. */
	proportionalSizeExponent?: number
	/** `SHAPE_PALETTE` index drawn for each hue (color) legend swatch
	 *  instead of the default rectangle. `null` / undefined keeps the
	 *  rectangle. */
	hueSwatchShape?: LegendSwatchShape
	/** Symbol radius (px) for hue swatch shapes. `null` / undefined → 5. */
	hueSwatchSize?: number | null
	/** Glyph radius (px) for SHAPE-channel swatches (`swatchSizes.shape`),
	 *  consumed by the standalone shape legend and by combined sections that
	 *  draw per-category shape glyphs. `null` / undefined = default. */
	shapeSwatchSize?: number | null
	/** User-chosen outline drawn around color swatches (`swatchOutlineColor` /
	 *  `swatchOutlineWidth`). The parent resolves it to `null` when the
	 *  outline-color encoding is mapped — the swatch strokes are then a
	 *  faithful key for that encoding. */
	swatchOutline?: { color: string; width: number } | null
	/** Opacity applied to swatch graphics (not labels) so they match marks
	 *  drawn at the global `defaultOpacity` when opacity isn't encoded. `1`
	 *  when opacity IS encoded (the opacity legend shows the real values). */
	defaultSwatchOpacity?: number
	/** When >1, a categorical section's entry rows wrap across this many CSS
	 * columns instead of a single stack (the "one legend → N columns" case).
	 * Undefined / 1 keeps the classic single vertical list. */
	entryColumns?: number
	/** Encoded field name for legend-hover highlighting. When set, each
	 * categorical entry publishes `{ field, value }` on hover so the plots dim
	 * non-matching marks. Undefined disables the behavior for this section. */
	highlightField?: string
	/** ≥2 stacked legends: pin this section's entry block to the legend's
	 * left edge instead of following the title alignment, so the swatch
	 * columns of every section line up vertically (paired with the shared
	 * `--vc-legend-swatch-col` width the legend publishes). The title keeps
	 * its own alignment. */
	alignEntriesStart?: boolean
}

export const LegendSection = ({
	section,
	configs,
	textFontSize,
	textWeight,
	textItalic,
	textUnderline,
	titleOverride,
	titleFont,
	titleAlignment = "center",
	titleOffset,
	reverseCategorical,
	orientation,
	gradientLegendStyle = "bar",
	gradientBarStyle = DEFAULT_GRADIENT_BAR_STYLE,
	legendFillColor,
	legendStrokeColor,
	connectionMapped = false,
	channelLegendCfgs,
	auxSwatchColor,
	auxSwatchStroke,
	themeSwatchColor = null,
	patternLegendBgColor = null,
	patternLegendInkColor = null,
	splitOutlineEligible = false,
	proportionalSizeExponent,
	hueSwatchShape,
	hueSwatchSize,
	shapeSwatchSize = null,
	swatchOutline = null,
	defaultSwatchOpacity = 1,
	entryColumns,
	highlightField,
	alignEntriesStart = false,
}: LegendSectionProps) => {
	const { field, type, values } = section
	// User-pinned level ordering for this section's field (Fields reorder
	// UI). Passed to each categorical sub-legend so its entries list in the
	// same order the axis / marks already use.
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	// Cross-palette pattern-ink table — keeps swatch inks matching marks
	// whose hue override borrows a swatch from another theme palette.
	const themeInkFallback = useThemeInkFallback()
	const pinnedOrder = levelOrders[field]
	// Slot sections title with the feature's name ("Rug" / "Density Curve") by
	// default, not the field name — the section is "the rug, colored by <field>".
	const titleFallback =
		section.kind === "slot" ? LEGEND_FRIENDLY_NAME[section.legendKey] : field
	// Three-state legend title: `undefined` = not customized → field/feature
	// name; `""` = user cleared it → no header drawn; other = custom text.
	const header = titleOverride === undefined ? titleFallback : titleOverride
	const textAlign: "left" | "center" | "right" =
		titleAlignment === "left"
			? "left"
			: titleAlignment === "right"
				? "right"
				: "center"
	// A LEFT-aligned title lines up with the entry LABELS (the text beside
	// each swatch), not the swatch graphics — otherwise the title floats to
	// the left of the text column and reads misaligned. The label-start x is
	// measured from the rendered entries (first `.vc-swatch-cell` → its label
	// sibling) rather than computed, so every swatch kind / size / shared
	// swatch-column width stays exact; sections with no swatch column
	// (gradient bars, label-under-swatch groups) measure no cell and keep
	// indent 0. Exports capture live layout rects, so the indent carries
	// through unchanged.
	const entriesRef = useRef<HTMLDivElement | null>(null)
	const [titleIndent, setTitleIndent] = useState(0)
	useLayoutEffect(() => {
		if (titleAlignment !== "left") return
		const el = entriesRef.current
		if (!el) return
		const label = el.querySelector(".vc-swatch-cell")?.nextElementSibling
		setTitleIndent(
			label
				? Math.max(
						0,
						Math.round(
							label.getBoundingClientRect().left -
								el.getBoundingClientRect().left
						)
					)
				: 0
		)
		// The label-start x is (swatch column width + row gap): the column
		// tracks the section's swatch graphics (shape / size / area·length
		// ranges via `configs`) or, stacked with other legends, the shared
		// `--vc-legend-swatch-col` width — whose inputs all arrive through
		// these same props (`alignEntriesStart` flips with the stacking).
		// Text metrics don't move it, so font props aren't deps.
	}, [
		titleAlignment,
		section,
		configs,
		orientation,
		entryColumns,
		gradientLegendStyle,
		connectionMapped,
		hueSwatchShape,
		hueSwatchSize,
		shapeSwatchSize,
		alignEntriesStart,
	])
	// Children hug their own width (no flex stretch) so the alignment also
	// positions the swatch/gradient block relative to a WIDER title — a long
	// centered title gets the legend content centered beneath it instead of
	// pinned left. `textAlign` still aligns lines within a multi-line title.
	const alignItems: "flex-start" | "center" | "flex-end" =
		titleAlignment === "left"
			? "flex-start"
			: titleAlignment === "right"
				? "flex-end"
				: "center"
	// Each sub-legend honors `orientation` directly so its swatches lay
	// out in the right axis (vertical = stacked rows, horizontal = single
	// row) WITHOUT wrapping. No CSS override needed.
	const innerClass = ""
	return (
		// `gap-2.5` (10 px) puts a comfortable air-gap between the section
		// title and the legend content below it — `gap-1.5` (6 px) crowded
		// the title against the top of a gradient bar.
		<div className="flex flex-col gap-2.5" style={{ alignItems }}>
			{header !== "" && (
				<div
					className="font-medium"
					style={{
						fontSize: titleFont.size,
						fontFamily: titleFont.family,
						color: titleFont.color,
						textAlign,
						whiteSpace: "pre-line",
						paddingLeft:
							titleAlignment === "left" && titleIndent > 0
								? titleIndent
								: undefined,
						fontWeight: titleFont.weight ?? undefined,
						fontStyle: titleFont.italic ? "italic" : undefined,
						textDecoration: titleFont.underline ? "underline" : undefined,
						transform:
							titleOffset && (titleOffset.x || titleOffset.y)
								? `translate(${titleOffset.x ?? 0}px, ${titleOffset.y ?? 0}px)`
								: undefined,
					}}
				>
					{header}
				</div>
			)}
			<div
				ref={entriesRef}
				className={innerClass}
				style={{
					fontSize: textFontSize,
					fontWeight: textWeight ?? undefined,
					fontStyle: textItalic ? "italic" : undefined,
					textDecoration: textUnderline ? "underline" : undefined,
					// Multiple stacked legends: the entry block pins to the
					// legend's left edge (overriding the title-driven
					// `alignItems`) so every section's swatch column shares one
					// vertical axis. The title keeps its own alignment.
					alignSelf: alignEntriesStart ? "flex-start" : undefined,
				}}
			>
				{section.kind === "combined" && (
					<CombinedGroupLegend
						channels={section.channels}
						type={type}
						values={values}
						configs={configs}
						themeInkFallback={themeInkFallback}
						pinnedOrder={pinnedOrder}
						reverseCategorical={reverseCategorical}
						gradientLegendStyle={gradientLegendStyle}
						gradientBarStyle={gradientBarStyle}
						orientation={orientation}
						entryColumns={entryColumns}
						highlightField={highlightField}
						connectionMapped={connectionMapped}
						defaultSwatchOpacity={defaultSwatchOpacity}
						auxSwatchColor={auxSwatchColor}
						auxSwatchStroke={auxSwatchStroke}
						themeSwatchColor={themeSwatchColor}
						patternLegendBgColor={patternLegendBgColor}
						patternLegendInkColor={patternLegendInkColor}
						shapeLegendFillColor={legendFillColor}
						shapeLegendStrokeColor={legendStrokeColor}
						channelCfg={
							// Combined sections always include hue as the leading
							// visual cue, so the user's hue overrides drive the
							// quant break behavior. opacity-without-hue combined
							// legends are categorical-only today so this never
							// fires for them.
							channelLegendCfgs?.hue
						}
						swatchShape={hueSwatchShape}
						swatchSize={hueSwatchSize}
						shapeSwatchSize={shapeSwatchSize}
						swatchOutline={swatchOutline}
						// Area / radar: the fill (hue) and the line/outline use the
						// same field but separate palettes, so outline each swatch in
						// its line color. Same chain the renderer uses.
						splitOutline={
							splitOutlineEligible
								? {
										linePalette: configs.connection?.linePalette ?? null,
										lineColors: configs.connection?.lineColors ?? {},
										strokeOverride: configs.connection?.strokeColor ?? null,
									}
								: null
						}
					/>
				)}
				{section.kind === "single" && section.channel === "hue" && (
					<ColorLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						reverseCategorical={reverseCategorical}
						gradientLegendStyle={gradientLegendStyle}
						gradientBarStyle={gradientBarStyle}
						orientation={orientation}
						entryColumns={entryColumns}
						highlightField={highlightField}
						channelCfg={channelLegendCfgs?.hue}
						swatchShape={hueSwatchShape}
						swatchSize={hueSwatchSize}
						swatchOutline={swatchOutline}
						defaultSwatchOpacity={defaultSwatchOpacity}
						// Area + radar charts expose a separate line/outline
						// palette in the Hue panel. When non-null, ColorLegend
						// draws each categorical swatch outlined in the
						// matching stroke color so the user sees "filled with
						// X, outlined with Y" in the legend.
						splitOutline={
							splitOutlineEligible
								? {
										linePalette: configs.connection?.linePalette ?? null,
										lineColors:
											configs.connection?.lineColors ?? {},
										strokeOverride:
											configs.connection?.strokeColor ?? null,
									}
								: null
						}
					/>
				)}
				{section.kind === "slot" &&
					(() => {
						// Render the slot's categorical colors via ColorLegend by
						// pointing its hue inputs at the slot's own config + palette,
						// so the swatches match the colors the feature actually draws.
						//
						// Density curve: when BOTH fill and outline vary by the field
						// (and the curve is filled), each swatch shows the FILL color
						// outlined in the OUTLINE color — mirroring the rendered curve,
						// so neither mapping is hidden. Falls back to a single slot
						// (the rug, or one mapped density slot) otherwise.
						const isDensity = section.legendKey === "densityCurve"
						const fillCfg = configs.colorSlots?.densityCurveFill
						const strokeCfg = configs.colorSlots?.densityCurveStroke
						const densityFilled =
							configs.x?.histogram?.densityFill === true ||
							configs.y?.histogram?.densityFill === true
						const splitDensity =
							isDensity && !!fillCfg?.field && !!strokeCfg?.field && densityFilled
						const fillSlot = splitDensity
							? fillCfg
							: configs.colorSlots?.[section.slotKey]
						const outlineSlot = splitDensity ? strokeCfg : null
						const slotConfigs = {
							...configs,
							hue: fillSlot?.hue,
							categoricalPalette: fillSlot?.palette ?? configs.categoricalPalette,
							ordinalPalette: fillSlot?.palette ?? configs.ordinalPalette,
						}
						// Per-category outline colors for the swatch border, resolved
						// from the outline slot's scale (covers palette OR explicit
						// per-value colors).
						let splitOutline: Parameters<typeof ColorLegend>[0]["splitOutline"] =
							null
						if (outlineSlot) {
							const outlineScale = makeHueScale(
								values,
								type,
								outlineSlot.hue,
								outlineSlot.palette ?? undefined,
							)
							const lineColors: Record<string, string> = {}
							if (outlineScale.kind === "categorical") {
								for (const v of uniqueValues(values, type)) {
									const c = applyHueScale(outlineScale, v, type)
									if (c) lineColors[v] = c
								}
							}
							splitOutline = {
								linePalette: null,
								lineColors,
								strokeOverride: outlineSlot.singleColor ?? null,
							}
						}
						return (
							<ColorLegend
								type={type}
								values={values}
								configs={slotConfigs}
								pinnedOrder={pinnedOrder}
								reverseCategorical={reverseCategorical}
								gradientLegendStyle={gradientLegendStyle}
								gradientBarStyle={gradientBarStyle}
								orientation={orientation}
								entryColumns={entryColumns}
								channelCfg={undefined}
								swatchShape={hueSwatchShape}
								swatchSize={hueSwatchSize}
								swatchOutline={swatchOutline}
								defaultSwatchOpacity={defaultSwatchOpacity}
								splitOutline={splitOutline}
							/>
						)
					})()}
				{section.kind === "single" && section.channel === "shape" && (
					<ShapeLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						legendFillColor={legendFillColor}
						legendStrokeColor={legendStrokeColor}
						orientation={orientation}
						entryColumns={entryColumns}
						defaultSwatchOpacity={defaultSwatchOpacity}
						swatchSize={shapeSwatchSize}
						highlightField={highlightField}
					/>
				)}
				{section.kind === "single" && section.channel === "pattern" && (
					<PatternLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						reverseCategorical={reverseCategorical}
						orientation={orientation}
						entryColumns={entryColumns}
						defaultSwatchOpacity={defaultSwatchOpacity}
						highlightField={highlightField}
					/>
				)}
				{section.kind === "single" && section.channel === "area" && (
					<AreaLegend
						type={type}
						values={values}
						configs={configs}
						channelCfg={channelLegendCfgs?.area}
						swatchColor={auxSwatchColor}
						swatchStroke={auxSwatchStroke}
						orientation={orientation}
						defaultSwatchOpacity={defaultSwatchOpacity}
						proportionalSizeExponent={proportionalSizeExponent}
					/>
				)}
				{section.kind === "single" && section.channel === "opacity" && (
					<OpacityLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						reverseCategorical={reverseCategorical}
						channelCfg={channelLegendCfgs?.opacity}
						swatchColor={auxSwatchColor}
						orientation={orientation}
						entryColumns={entryColumns}
					/>
				)}
				{section.kind === "single" && section.channel === "length" && (
					<LengthLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						channelCfg={channelLegendCfgs?.length}
						swatchColor={auxSwatchColor}
						orientation={orientation}
					/>
				)}
				{section.kind === "single" && section.channel === "angle" && (
					<AngleLegend
						type={type}
						values={values}
						configs={configs}
						pinnedOrder={pinnedOrder}
						channelCfg={channelLegendCfgs?.angle}
						swatchColor={auxSwatchColor}
						orientation={orientation}
					/>
				)}
			</div>
		</div>
	)
}
