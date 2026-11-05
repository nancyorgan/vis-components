import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { DEFAULT_OPACITY, DEFAULT_SHAPE } from "../../lib/channelConfig"
import { isFlowModeId } from "../../lib/packedMeasure"
import { resolveStackMode } from "../../lib/stackMode"
import { useChartModeDef } from "../../store/useChartModeDef"
import { resolveSegmentPatternContext } from "../../lib/segmentPattern"
import { DEFAULT_TOOLTIP_CONFIG } from "../../lib/labelsConfig"
import {
	DEFAULT_LEGEND_CONFIG,
	legendFontKey,
	resolveLegendSwatchOutlineColor,
	resolveLegendSwatchSize,
	resolveRampLegendStyle,
	resolveGradientBarStyle,
	resolveLegendHidden,
	resolveTitleFont,
	shownLegendTitle,
	titleAlignmentOf,
	type LegendChannel,
	type LegendConfig,
} from "../../lib/labelsConfig"
import {
	chunkColumns,
	planLegendSections,
	sectionSwatchKey,
	sectionSwatchMembers,
} from "../../lib/legendSections"
import {
	isGlyphSection,
	resolveSectionOutlineWidth,
	resolveSectionSwatchShape,
	sectionOutlineWidthAuto,
} from "../../lib/legendSwatchControls"
import {
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	renderedLabelsAtom,
	currentLegendMinHeightAtom,
	currentLegendMinWidthAtom,
	legendSizeProbeWantedAtom,
	currentRenderedLegendHeightAtom,
	currentRenderedLegendWidthAtom,
	currentThemeIdAtom,
	currentTooltipConfigAtom,
	themeAtom,
	themesAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	renderLegendConfigAtom,
} from "../../store/renderConfigs"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { LegendSection } from "./legend/LegendSection"
import { LegendColumns } from "./legend/swatches"
import {
	applyLegendRowGap,
	measureLegendMinWidth,
	probeRowGapLine,
	rowGapMinHeight,
} from "./legend/sizeProbe"
import { liftLegendBox, measureLegendTitleGrowth } from "./legend/titleGrowth"
import { measureMaxLabelWidth } from "./plotCanvas/measureText"
import { useFontsVersion } from "./plotCanvas/useFontsVersion"

// Legend.tsx stays the import entry point for the legend: the per-channel
// renderers and swatch primitives live under `./legend/`, and the pure
// section planning in `lib/legendSections`. Re-exported here so external
// consumers (ChartCanvas, EmbedPage, smoke tests) keep one import path.
export { AreaLegend } from "./legend/AreaLegend"
export { CombinedGroupLegend } from "./legend/CombinedGroupLegend"
export { PatternLegend } from "./legend/PatternLegend"
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
	const renderConfigs = useAtomValue(renderChannelConfigsAtom)
	const modeDef = useChartModeDef()
	// The Default shape only draws on marks in glyph modes (scatter, radar,
	// combo points) — elsewhere the Shape panel hides its picker, so a
	// stored choice (say, a star picked back when this was a scatter) must
	// not resurface in the Size / combined swatches. Those modes' fallback
	// glyph is the circle; the Legend panel's swatch-shape picker still
	// overrides it per section.
	const configs = useMemo(
		() =>
			modeDef.canvas.shapeRole === "glyph"
				? renderConfigs
				: { ...renderConfigs, defaultShape: DEFAULT_SHAPE },
		[renderConfigs, modeDef.canvas.shapeRole]
	)
	const labels = useAtomValue(renderedLabelsAtom)
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
		...useAtomValue(renderLegendConfigAtom),
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
	// Publish the inner box's rendered width so the sidebar's "Legend width"
	// input can show the auto width as its placeholder (and step from it).
	// Hooks stay above the early returns below. No deps: cheap, and the width changes with data, fonts, and every
	// legend option, so re-measuring after each render is the honest signal.
	const innerRef = useRef<HTMLDivElement | null>(null)
	const setRenderedWidth = useSetAtom(currentRenderedLegendWidthAtom)
	useEffect(() => {
		const el = innerRef.current
		if (!el) return
		const px = el.offsetWidth
		if (px > 0) setRenderedWidth(Math.round(px))
	})
	// Fixed "Legend height": solve the entry-row gap so the content fills the
	// box exactly (`legend/sizeProbe`). The same probes publish the natural
	// height (the "Legend height" placeholder) and — only while the Legend
	// panel is open — the smallest width / height the box can still shrink
	// to, which floor the sidebar steppers. No deps, like the measures around
	// it: every commit can change the content.
	const setRenderedHeight = useSetAtom(currentRenderedLegendHeightAtom)
	const setMinWidth = useSetAtom(currentLegendMinWidthAtom)
	const setMinHeight = useSetAtom(currentLegendMinHeightAtom)
	const probeMinSize = useAtomValue(legendSizeProbeWantedAtom)
	const fixedLegendHeight =
		legendCfg.height != null && legendCfg.height > 0
			? Math.round(legendCfg.height)
			: null
	useLayoutEffect(() => {
		const el = innerRef.current
		const outer = el?.parentElement
		if (!el || !outer) return
		if (probeMinSize) setMinWidth(measureLegendMinWidth(el, outer))
		const line = probeRowGapLine(el)
		if (line.h0 > 0) setRenderedHeight(line.h0)
		if (line.h0 > 0 && probeMinSize) setMinHeight(rowGapMinHeight(line))
		applyLegendRowGap(el, fixedLegendHeight, line)
	})
	// Wrapped section titles grow UP: the box lifts by the titles' extra
	// height (`measureLegendTitleGrowth`) so their bottom lines and the
	// entries hold the positions a single-line title gives them. A layout
	// effect, so the lift paints in the same frame as the wrap; no deps for
	// the same reason as the width measure above — the titles' rendered
	// height changes with text, fonts, fixed width and columns, so every
	// commit re-measures.
	const [titleGrowth, setTitleGrowth] = useState(0)
	// eslint-disable-next-line react-hooks/exhaustive-deps -- measures the DOM after every commit; React skips the re-render when the measured value is unchanged, so the setter can't chain
	useLayoutEffect(() => {
		const el = innerRef.current
		setTitleGrowth(el ? measureLegendTitleGrowth(el) : 0)
	})
	// The width budget below measures label / title text with canvas
	// `measureText`. Before a webfont arrives that measures the FALLBACK
	// face, which is often narrower than the real one — the column then
	// lands short and the last glyph clips. Subscribing to the fonts version
	// re-renders (and so re-plans) once the real face is in.
	useFontsVersion()
	// Fold the mode's default-hidden channels (e.g. the Size legend starts
	// off in flow / hierarchy modes) into the effective map so every
	// `legendCfg.hidden` read below is mode-aware. An explicit user toggle
	// (stored true OR false) still wins — see resolveLegendHidden.
	legendCfg.hidden = resolveLegendHidden(legendCfg.hidden, modeDef.legend)
	// Segment scatter (Length / Angle marks, no connection): the pattern
	// swatches mirror the marks — a segment stroked with the tile or
	// dashed, per the Pattern menu's Segments toggle. With a connection
	// mapped the line-chart dash overlay already owns the swatch.
	const segmentSwatch = encodings.connection?.field
		? null
		: resolveSegmentPatternContext({
				lengthRole: modeDef.canvas.lengthRole,
				encodings,
				channelConfigs: configs,
				patternMapped: !!encodings.pattern?.field,
			})

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
	// stack top. Grouped/overlaid bars lay out left-to-right in data order,
	// so the flip only applies when the chart actually stacks.
	const reverseCategorical =
		modeDef.legend.reverseCategoricalOrder &&
		resolveStackMode(configs, encodings) === "stack"

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
		swatchTheme: theme,
		measureText: measureMaxLabelWidth,
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
		alignSwatchColumn,
	} = plan
	const liftedOuterStyle = liftLegendBox(
		outerStyle,
		legendCfg.position,
		titleGrowth,
	)

	return (
		// data-legend-root: image export walks this subtree to recreate the
		// legend as SVG (see serializeEmbedCapture in captureThumbnail.ts).
		<div
			ref={insideMeasureRef}
			data-legend-root
			className={outerClass}
			style={
				pullStyle ? { ...liftedOuterStyle, ...pullStyle } : liftedOuterStyle
			}
		>
			<div ref={innerRef} className={innerClass} style={innerStyle}>
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
						// category rows to hover, and slots aren't the main marks. A
						// derived-source section (tree modes' Top-level group / depth)
						// carries its own sentinel key instead of a column name.
						const highlightField =
							legendHighlightEnabled &&
							(s.kind === "single" || s.kind === "combined") &&
							s.type !== "quantitative" &&
							s.type !== "temporal"
								? ((s.kind === "single" ? s.highlightField : undefined) ??
									s.field)
								: undefined
						const swatchKey = sectionSwatchKey(s)
						const swatchMembers = sectionSwatchMembers(s)
						// Sections a Size / Angle / Length channel leads have no
						// group channel (Color, Saturation, …) — those sort first.
						const auxLed =
							swatchKey === ("area" as string) ||
							swatchKey === ("angle" as string) ||
							swatchKey === ("length" as string)
						// A lone continuous Saturation / Brightness / Opacity legend
						// can draw as a gradient bar, like Color's.
						const rampSolo =
							s.type !== "quantitative" && s.type !== "temporal"
								? null
								: s.kind === "combined" && s.channels.length === 1
									? s.channels[0]
									: s.kind === "single"
										? s.channel
										: null
						const rampStyle =
							rampSolo === "saturation" ||
							rampSolo === "brightness" ||
							rampSolo === "opacity"
								? resolveRampLegendStyle(legendCfg, rampSolo, s.kind === "single")
								: null
						const node = (
							<LegendSection
								rampStyle={rampStyle}
								key={sectionKey}
								section={s}
								highlightField={highlightField}
								configs={configs}
								textFontSize={textFont.size}
								textWeight={textFont.weight}
								textItalic={textFont.italic}
								textUnderline={textFont.underline}
								entryTextAlign={legendCfg.textAlign ?? null}
								titleOverride={shownLegendTitle(
									labels,
									keyChannel as LegendChannel
								)}
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
								// ≥2 stacked legends: pin every section's entry block to
								// the legend's left edge (and the inner div publishes the
								// shared swatch-column width) so swatches line up with
								// each other vertically across the sections.
								alignEntriesStart={alignSwatchColumn}
								// The user's orientation governs how ENTRIES flow inside
								// this section, independently of how many columns the
								// sections are packed into. The lone exception is the
								// single-legend entry-wrap case (`entryColumns > 1`),
								// which needs stacked rows to have anything to wrap.
								orientation={
									entryColumns > 1 ? "vertical" : legendCfg.orientation
								}
								gradientLegendStyle={legendCfg.gradientLegendStyle ?? "bar"}
								gradientBarStyle={resolveGradientBarStyle(legendCfg, theme)}
								legendFillColor={legendCfg.shapeLegendFillColor}
								legendStrokeColor={legendCfg.shapeLegendStrokeColor}
								legendStrokeWidth={legendCfg.shapeLegendStrokeWidth}
								connectionMapped={
									!hideConnection && !!encodings.connection?.field
								}
								// Filled radar: swatches show the series POLYGON — its
								// separate "Polygon fill" pattern over the hue color, no
								// line-dash overlay (radar polygons don't dash).
								polygonPatternFill={
									modeDef.id === "radar" &&
									!!encodings.connection?.field &&
									configs.connection?.fillPolygon === true
								}
								segmentSwatch={segmentSwatch}
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
								// Swatch settings key on the section's LEAD channel
								// (sectionSwatchKey) — the key the Legend panel's
								// subsection edits. Per-visual choice, else the
								// theme's default; glyph sections (Size / Angle folded
								// in) default to the marks' own shape instead.
								hueSwatchShape={
									auxLed
										? (legendCfg.auxLegendSwatchShape ??
											configs.defaultShape ??
											0)
										: resolveSectionSwatchShape(
												legendCfg,
												theme,
												swatchKey,
												swatchMembers,
												configs.defaultShape ?? 0,
												{
													connection:
														!hideConnection && !!encodings.connection?.field,
												}
											)
								}
								hueSwatchSize={resolveLegendSwatchSize(
									legendCfg,
									theme,
									swatchKey
								)}
								// Shape-channel glyph radius — its own key, independent
								// of the section's lead channel, so the Shape swatch
								// size applies whether shape stands alone or folds into
								// a combined (e.g. Color · Shape) section.
								shapeSwatchSize={resolveLegendSwatchSize(
									legendCfg,
									theme,
									"shape"
								)}
								swatchOutline={(() => {
									// Width 0 = no outline; unset follows the section's
									// auto width (sectionOutlineWidthAuto), else the
									// theme's. An Outline-color member owns the stroke
									// COLOR (the renderer ignores `color` there) but the
									// width still applies — and 0 is honored, so the
									// object is passed even then. Channels on other
									// fields never switch the outline off. Auto color
									// depends on what the swatch DEPICTS: sections whose
									// fill is the hue scale (a mark stand-in) pipe the
									// marks' outline color (Color menu → Outline) so the
									// legend matches the chart; aux-painted sections
									// (opacity / saturation / brightness lead — fill = the
									// theme's legend-swatch color) stroke with the
									// theme's legend-swatch outline instead. Same chains
									// the panel displays.
									// Size / Angle / Length-led sections (no Color):
									// the shared Length · Angle · Size subsection's
									// flat fields own the glyph outline.
									if (auxLed)
										return {
											color: resolvedAuxSwatchStroke,
											width: legendCfg.auxLegendSwatchStrokeWidth ?? 1,
										}
									const key = swatchKey
									const width = resolveSectionOutlineWidth(
										legendCfg,
										theme,
										key,
										sectionOutlineWidthAuto(
											swatchMembers,
											s.type === "quantitative" || s.type === "temporal",
											configs.shape?.outlineWidth
										)
									)
									const auxPainted =
										key === "opacity" ||
										key === "saturation" ||
										key === "brightness"
									return width > 0 ||
										swatchMembers.includes("outlineHue") ||
										isGlyphSection(swatchMembers)
										? {
												color: resolveLegendSwatchOutlineColor(
													legendCfg,
													theme,
													key,
													auxPainted
														? resolvedAuxSwatchStroke
														: (configs.shape?.outlineColor ??
															theme.outlineColor ??
															"#cccccc")
												),
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
							rowList={false}
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
