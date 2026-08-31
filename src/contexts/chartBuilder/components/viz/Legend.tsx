import { useAtomValue } from "jotai"
import { DEFAULT_OPACITY } from "../../lib/channelConfig"
import { isFlowModeId } from "../../lib/packedMeasure"
import { useChartModeDef } from "../../store/useChartModeDef"
import { DEFAULT_TOOLTIP_CONFIG } from "../../lib/labelsConfig"
import {
	DEFAULT_LEGEND_CONFIG,
	legendFontKey,
	legendSwatchOutlineColor,
	legendSwatchOutlineWidth,
	legendSwatchShape,
	legendSwatchSize,
	resolveGradientBarStyle,
	resolveLegendHidden,
	resolveTitleFont,
	titleAlignmentOf,
	type LegendChannel,
	type LegendConfig,
	type SwatchShapeChannel,
} from "../../lib/labelsConfig"
import { chunkColumns, planLegendSections } from "../../lib/legendSections"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentThemeIdAtom,
	currentTooltipConfigAtom,
	themeAtom,
	themesAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { LegendSection } from "./legend/LegendSection"
import { LegendColumns } from "./legend/swatches"

// Legend.tsx stays the import entry point for the legend: the per-channel
// renderers and swatch primitives live under `./legend/`, and the pure
// section planning in `lib/legendSections`. Re-exported here so external
// consumers (ChartCanvas, EmbedPage, smoke tests) keep one import path.
export { AreaLegend } from "./legend/AreaLegend"
export { CombinedGroupLegend } from "./legend/CombinedGroupLegend"
export { ShapeLegend } from "./legend/ShapeLegend"

/** Pixel offsets the chart wrapper must reserve on each side to make room
 *  for an inside-positioned legend that the user's coords pushed past the
 *  plot rectangle. ChartCanvas owns the computation; Legend just receives
 *  it and adjusts its calc() position so the user's `insideX/Y` map to the
 *  reduced plot. */
export type InsideExtras = {
	top: number
	right: number
	bottom: number
	left: number
}

type LegendOuterProps = {
	/** Set by ChartCanvas for `position === "inside"` — extra margin the
	 *  chart wrapper has reserved on each side because the legend would
	 *  otherwise overflow the canvas. The legend's calc() incorporates
	 *  these so the user's plot-normalized coord maps to the reduced
	 *  plot rectangle. */
	insideExtras?: InsideExtras
	/** Measurement callback ChartCanvas attaches when it needs the
	 *  legend's size to compute `insideExtras`. */
	insideMeasureRef?: (el: HTMLElement | null) => void
	/** Set by ChartCanvas for edge positions when the fixed aspect ratio
	 *  leaves slack: a pulling negative margin (plus relative z-index) that
	 *  moves the legend flush against the centered figure. Applied directly
	 *  to the OUTER element — a wrapper div would drop the root's
	 *  flex-sensitive classes (`flex-shrink-0`, `self-end`/`self-center`,
	 *  cross-axis stretch) and shift ratio-off layouts. Each position's pull
	 *  margin uses a side the position styles leave unset, so merging after
	 *  them never collides. */
	pullStyle?: React.CSSProperties
}

const ZERO_EXTRAS: InsideExtras = { top: 0, right: 0, bottom: 0, left: 0 }

export const Legend = ({
	insideExtras = ZERO_EXTRAS,
	insideMeasureRef,
	pullStyle,
}: LegendOuterProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	// Legend-hover highlighting is on only when BOTH the "Show hover" master
	// toggle and its "highlight visual elements" sub-option are enabled (both
	// default on; back-compat undefined → on). When off, entries never publish
	// a hovered value, so the plots stay un-dimmed.
	const tooltipCfg = {
		...DEFAULT_TOOLTIP_CONFIG,
		...useAtomValue(currentTooltipConfigAtom),
	}
	const legendHighlightEnabled =
		(tooltipCfg.hoverEnabled ?? true) && (tooltipCfg.legendHighlight ?? true)
	// When opacity is NOT mapped to a field, every mark renders at the global
	// `defaultOpacity` (see ScatterPlot). Mirror that on the legend swatches so
	// a dialed-down opacity reads the same in the legend as on the chart. When
	// opacity IS encoded, marks vary per-value and the opacity channel gets its
	// own legend section — leave the other swatches fully opaque.
	const opacityFieldMapped = !!encodings.opacity?.field
	const defaultSwatchOpacity = opacityFieldMapped
		? 1
		: (configs.defaultOpacity ?? DEFAULT_OPACITY)
	// Prefer the LIVE theme from `themesAtom` (Settings-edited values
	// take effect immediately); fall back to the legacy `themeAtom` only
	// when the chart's themeId isn't in `themesAtom`.
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const liveTheme = allThemes.find((t) => t.id === currentThemeId)
	const theme = liveTheme ?? storedTheme
	const legendCfg: LegendConfig = {
		...DEFAULT_LEGEND_CONFIG,
		...useAtomValue(currentLegendConfigAtom),
	}
	// Effective auxiliary swatch color: per-visual override wins, theme
	// default is the fallback (every theme defines `legendSwatchColor`).
	const resolvedAuxSwatchColor =
		legendCfg.auxLegendSwatchColor ?? theme.legendSwatchColor
	// Size-swatch border: per-visual override wins, else the theme default
	// (`?? "#ffffff"` keeps the historical white outline for saved themes
	// predating the `legendSwatchStroke` field).
	const resolvedAuxSwatchStroke =
		legendCfg.auxLegendSwatchStroke ?? theme.legendSwatchStroke ?? "#ffffff"
	const dataset = useCurrentDatasetView()
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const modeDef = useChartModeDef()
	// Fold the mode's default-hidden channels (e.g. the Size legend starts
	// off in flow / hierarchy modes) into the effective map so every
	// `legendCfg.hidden` read below is mode-aware. An explicit user toggle
	// (stored true OR false) still wins — see resolveLegendHidden.
	legendCfg.hidden = resolveLegendHidden(legendCfg.hidden, modeDef.legend)

	if (!dataset) return null
	// The legend renders whenever ≥1 section ends up visible; per-channel
	// hide toggles in the sidebar control visibility. `legendCfg.enabled`
	// is vestigial — kept on the type for back-compat with saved visuals
	// but no longer consulted.

	// In geographic modes (choropleth) the connection channel is the region
	// key — which feature each row is — not a visual series. Suppress any
	// connection-driven legend treatment so the user doesn't see a meaningless
	// per-region legend (and no line-dash overlay logic, which is a line-chart
	// concept that has no meaning on a map).
	const hideConnection = modeDef.legend.hideConnectionInThisMode
	// In stacked bars, the first-encountered value goes at the BOTTOM of the
	// stack, so reading the legend top-down would land at the bottom slice
	// first. Flip categorical legend order in bar mode so legend top matches
	// stack top.
	const reverseCategorical = modeDef.legend.reverseCategoricalOrder

	// Section planning + legend-box sizing are pure — see
	// `lib/legendSections.planLegendSections`. `null` = nothing to render.
	const plan = planLegendSections({
		encodings,
		configs,
		dataset,
		overrides,
		labels,
		legendCfg,
		modeDef,
		insideExtras,
		levelOrders,
	})
	if (!plan) return null
	const {
		sections,
		textFont,
		outerClass,
		outerStyle,
		innerClass,
		innerStyle,
		sectionLayoutClass,
		columnsApply,
		packSections,
		effectiveCols,
		entryColumns,
	} = plan

	return (
		// data-legend-root: image export walks this subtree to recreate the
		// legend as SVG (see serializeEmbedCapture in captureThumbnail.ts).
		<div
			ref={insideMeasureRef}
			data-legend-root
			className={outerClass}
			style={pullStyle ? { ...outerStyle, ...pullStyle } : outerStyle}
		>
			<div className={innerClass} style={innerStyle}>
				{(() => {
					const sectionNodes = sections.map((s) => {
						// Pick a channel key for font / title override lookups. A
						// section split out of a shared-field group carries its own
						// `titleChannel`; combined sections otherwise fall back to
						// their first mapped group channel; slot sections use their
						// slot key (a LegendChannel).
						const keyChannel =
							s.kind === "single"
								? (s.titleChannel ?? s.channel)
								: s.kind === "combined"
									? (s.titleChannel ?? s.channels[0])
									: s.legendKey
						const perLegendFont = resolveTitleFont(
							labels.baseFont,
							"legend",
							labels.fontOverrides?.[legendFontKey(keyChannel as LegendChannel)]
						)
						const sectionKey =
							s.kind === "single"
								? `single:${s.channel}`
								: s.kind === "combined"
									? `combined:${s.field}:${s.titleChannel ?? s.channels[0]}`
									: `slot:${s.legendKey}`
						// Categorical sections publish their field so each entry can
						// highlight matching marks on hover. Quantitative / temporal
						// (gradient) and slot sections opt out — there are no discrete
						// category rows to hover, and slots aren't the main marks.
						const highlightField =
							legendHighlightEnabled &&
							(s.kind === "single" || s.kind === "combined") &&
							s.type !== "quantitative" &&
							s.type !== "temporal"
								? s.field
								: undefined
						const node = (
							<LegendSection
								key={sectionKey}
								section={s}
								highlightField={highlightField}
								configs={configs}
								textFontSize={textFont.size}
								textWeight={textFont.weight}
								textItalic={textFont.italic}
								textUnderline={textFont.underline}
								titleOverride={
									labels.legendTitles?.[
										keyChannel as keyof typeof labels.legendTitles
									]
								}
								titleFont={perLegendFont}
								titleAlignment={titleAlignmentOf(
									labels,
									legendFontKey(keyChannel as LegendChannel)
								)}
								titleOffset={
									labels.titleOffsets?.[
										legendFontKey(keyChannel as LegendChannel)
									]
								}
								reverseCategorical={reverseCategorical}
								// The user's orientation governs how ENTRIES flow inside
								// this section, independently of how many columns the
								// sections are packed into. The lone exception is the
								// single-legend entry-wrap case (`entryColumns > 1`),
								// which needs stacked rows to have anything to wrap.
								orientation={
									entryColumns > 1 ? "vertical" : legendCfg.orientation
								}
								gradientLegendStyle={legendCfg.gradientLegendStyle ?? "bar"}
								gradientBarStyle={resolveGradientBarStyle(legendCfg)}
								legendFillColor={legendCfg.shapeLegendFillColor}
								legendStrokeColor={legendCfg.shapeLegendStrokeColor}
								connectionMapped={
									!hideConnection && !!encodings.connection?.field
								}
								channelLegendCfgs={legendCfg.channels}
								auxSwatchColor={resolvedAuxSwatchColor}
								auxSwatchStroke={resolvedAuxSwatchStroke}
								themeSwatchColor={theme.legendSwatchColor ?? null}
								patternLegendBgColor={legendCfg.patternLegendBgColor ?? null}
								patternLegendInkColor={legendCfg.patternLegendInkColor ?? null}
								splitOutlineEligible={
									modeDef.id === "areas-x" ||
									modeDef.id === "areas-y" ||
									modeDef.id === "radar"
								}
								proportionalSizeExponent={
									// Packed circles honor the Area Scale-by option (√ or
									// linear); treemap / sunburst are inherently
									// area-proportional so always √. Chord / sankey marks are
									// one-dimensional (ribbon / link WIDTH ∝ value), so their
									// size reads linearly. Other modes keep the min→max range
									// mapping their marks actually use.
									modeDef.id === "packed-circles"
										? configs.area?.sizeBy === "diameter"
											? 1
											: 0.5
										: modeDef.id === "treemap" || modeDef.id === "sunburst"
											? 0.5
											: isFlowModeId(modeDef.id)
												? 1
												: undefined
								}
								hueSwatchShape={legendSwatchShape(
									legendCfg,
									// Sections keyed by a non-swatch-shape channel (shape /
									// length / …) just resolve to null — no entry is ever
									// written for those keys.
									keyChannel as SwatchShapeChannel
								)}
								hueSwatchSize={legendSwatchSize(
									legendCfg,
									keyChannel as SwatchShapeChannel
								)}
								// Shape-channel glyph radius — its own key, independent
								// of the section's lead channel, so the Shape swatch
								// size applies whether shape stands alone or folds into
								// a combined (e.g. Color · Shape) section.
								shapeSwatchSize={legendSwatchSize(legendCfg, "shape")}
								swatchOutline={(() => {
									// Width 0 / unset = no outline. The user's swatch
									// outline also stays inert while the outline-color
									// encoding is mapped — those strokes are a faithful
									// key for that encoding. Resolved per section (keyed
									// like the swatch shape, legacy globals as fallback).
									// Auto color depends on what the swatch DEPICTS:
									// sections whose fill is the hue scale (a mark
									// stand-in) pipe the marks' outline color (Color
									// menu → Outline) so the legend matches the chart;
									// aux-painted sections (opacity / saturation /
									// brightness lead — fill = the theme's legend-swatch
									// color) stroke with the theme's legend-swatch
									// outline instead, since a mark stroke has nothing
									// to do with those swatches. Same chains the panel
									// displays.
									const key = keyChannel as SwatchShapeChannel
									const width = legendSwatchOutlineWidth(legendCfg, key) ?? 0
									const auxLed =
										key === "opacity" ||
										key === "saturation" ||
										key === "brightness"
									return width > 0 && !encodings.outlineHue?.field
										? {
												color:
													legendSwatchOutlineColor(legendCfg, key) ??
													(auxLed
														? resolvedAuxSwatchStroke
														: (configs.shape?.outlineColor ??
															theme.outlineColor ??
															"#cccccc")),
												width,
											}
										: null
								})()}
								defaultSwatchOpacity={defaultSwatchOpacity}
								entryColumns={entryColumns}
							/>
						)
						return node
					})
					// ≥2 legends + >1 column: distribute whole sections into
					// content-hugging flex columns (balanced by count). Otherwise the
					// sections stack in a single column — and a lone legend asked for
					// columns already laid its own entries out in them.
					return packSections ? (
						<LegendColumns
							groups={chunkColumns(sectionNodes, effectiveCols)}
							stackGapClass="gap-4"
						/>
					) : (
						<div className={columnsApply ? undefined : sectionLayoutClass}>
							{sectionNodes}
						</div>
					)
				})()}
			</div>
		</div>
	)
}
