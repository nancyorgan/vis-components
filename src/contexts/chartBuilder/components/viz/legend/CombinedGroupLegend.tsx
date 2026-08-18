import {
	DEFAULT_FILL,
	DEFAULT_SHAPE_CONFIG,
	type LineDashPattern,
} from "../../../lib/channelConfig"
import { GlyphMark, resolveGlyph, stripNudge } from "../../../lib/customGlyphs"
import { DASH_CYCLE, dashArrayFor } from "../../../lib/dashPatterns"
import type { GradientBarStyle, LegendSwatchShape } from "../../../lib/labelsConfig"
import {
	buildLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "../../../lib/legendBreaks"
import {
	type GroupChannel,
	orderCategories,
	sampleRampCssStops,
	uniqueValues,
} from "../../../lib/legendSections"
import {
	inkForHueColor,
	inkPaletteForHue,
	patternCategoriesFor,
	resolvePatternForMark,
} from "../../../lib/patterns"
import {
	applyAreaScale,
	applyHueScale,
	makeAngleScale,
	makeAreaScale,
	makeBrightnessScale,
	makeHueScale,
	makeLengthScale,
	makeOpacityScale,
	makeSaturationScale,
	makeShapeIndexer,
	modulateColor,
	outlinePaletteForHueType,
} from "../../../lib/scales"
import { resolveRuleColor } from "../../../lib/textColorRules"
import {
	ComposedSwatch,
	DEFAULT_GRADIENT_BAR_STYLE,
	EntryHoverWrap,
	GradientBarRamp,
	renderEntryList,
} from "./swatches"
import type { ReversibleLegendProps } from "./types"

type CombinedGroupLegendProps = ReversibleLegendProps & {
	channels: ReadonlyArray<GroupChannel>
	/** When the section's only group channel is hue and the field is
	 * quantitative, this controls whether the legend renders as a
	 * gradient bar or as five sampled swatches. Mirrors HueLegend's
	 * behavior — `CombinedGroupLegend` is the renderer that actually
	 * fires for hue-only quantitative encodings (hue is a group channel,
	 * so it always routes through the combined branch). */
	gradientLegendStyle?: "bar" | "swatches"
	/** Resolved gradient-bar display options (length / radius / ticks /
	 * label alignment). Only consulted when the bar branch fires. */
	gradientBarStyle?: GradientBarStyle
	/** Drives the gradient bar's orientation: `vertical` lays the bar
	 * top-to-bottom (hi-on-top) so it visually matches stacked swatches;
	 * `horizontal` lays it left-to-right. Mirrors the swatch flow direction
	 * the legend's parent picks based on its position + orientation
	 * settings. */
	orientation?: "vertical" | "horizontal"
	/** True when a connection encoding is mapped — line chart context.
	 *  Triggers a dash-line overlay on combined swatches so the legend
	 *  reflects both the shape pattern fill and the line dash style. */
	connectionMapped?: boolean
	/** Hue-legend swatch shape (`SHAPE_PALETTE` index). Reshapes the color
	 *  swatches when no per-mark shape encoding is present. `null` /
	 *  undefined keeps the default rectangle. */
	swatchShape?: LegendSwatchShape
	/** Symbol radius (px) for the swatch shape. `null` / undefined → 5. */
	swatchSize?: number | null
	/** Aux-swatch fill/stroke from the Legend "Size" submenu
	 *  (`auxLegendSwatchColor` / `auxLegendSwatchStroke`). Used for the
	 *  area/angle glyphs when the section has NO hue color to inherit —
	 *  mirroring the standalone `AreaLegend`. When hue drives the color the
	 *  glyph keeps the hue scale as a faithful key and these are ignored. */
	auxSwatchColor?: string | null
	auxSwatchStroke?: string | null
	/** The theme's default legend-swatch color WITHOUT the per-visual
	 *  `auxLegendSwatchColor` override folded in — the resting color for
	 *  no-hue sections that don't host an aux-painted channel (pattern-only
	 *  legends), so they follow the theme but not the aux picker. */
	themeSwatchColor?: string | null
	/** Standalone-pattern swatch overrides (Legend panel → Swatches →
	 *  Pattern group). Background replaces the tile bg the no-hue pattern
	 *  swatches draw on (auto = the Pattern menu's Background → #e2e8f0);
	 *  ink replaces the DEFAULT pattern color (auto = near-black). Inert
	 *  when hue shares the section; per-category ink overrides still win. */
	patternLegendBgColor?: string | null
	patternLegendInkColor?: string | null
	/** Shape-swatch fill/stroke from the Legend "Shape swatch" submenu
	 *  (`shapeLegendFillColor` / `shapeLegendStrokeColor`). Used for the shape
	 *  glyph fill/stroke when shape shares the combined section and there's NO
	 *  hue color to inherit — mirroring the standalone `ShapeLegend`. Takes
	 *  precedence over the aux-swatch color since the glyph IS a shape. When hue
	 *  drives the color the glyph keeps the hue scale as a faithful key and
	 *  these are ignored. */
	shapeLegendFillColor?: string | null
	shapeLegendStrokeColor?: string | null
	/** Opacity for swatch graphics, matching marks at the global default
	 *  opacity when opacity isn't encoded. Folds into each entry's opacity
	 *  unless the opacity channel is itself part of the combined group. */
	defaultSwatchOpacity?: number
	/** Area / radar split outline: when set, each categorical swatch is
	 *  bordered in its line color (resolved per category via the same chain as
	 *  the renderer: per-value override → line palette → global stroke), so the
	 *  legend reflects "filled with X, outlined with Y". `null` = no border. */
	splitOutline?: {
		linePalette: ReadonlyArray<string> | null
		lineColors: Record<string, string>
		strokeOverride: string | null
	} | null
	/** User-chosen outline drawn around every color swatch (the Legend panel's
	 *  "Swatch outline" controls). Applies only where no encoded stroke — a
	 *  shape/outline descriptor or the area/radar `splitOutline` — already
	 *  claims the border. `null` = none. */
	swatchOutline?: { color: string; width: number } | null
}

// Exported so smoke tests can prop-drive the component without spinning
// up the full Legend / Jotai tree. Internal callers stay unchanged.
export const CombinedGroupLegend = ({
	channels,
	type,
	values,
	configs,
	pinnedOrder,
	reverseCategorical,
	gradientLegendStyle = "bar",
	gradientBarStyle = DEFAULT_GRADIENT_BAR_STYLE,
	orientation = "vertical",
	connectionMapped = false,
	channelCfg,
	swatchShape,
	swatchSize,
	auxSwatchColor = null,
	auxSwatchStroke = null,
	themeSwatchColor = null,
	patternLegendBgColor = null,
	patternLegendInkColor = null,
	shapeLegendFillColor = null,
	shapeLegendStrokeColor = null,
	defaultSwatchOpacity = 1,
	splitOutline = null,
	swatchOutline = null,
	entryColumns,
	highlightField,
}: CombinedGroupLegendProps) => {
	const hasHue = channels.includes("hue")
	const hasOutline = channels.includes("outlineHue")
	const hasSat = channels.includes("saturation")
	const hasBri = channels.includes("brightness")
	const hasPat = channels.includes("pattern")
	const hasOp = channels.includes("opacity")
	const hasShape = channels.includes("shape")

	const hueDomain =
		(type === "quantitative" || type === "temporal") && hasHue
			? (resolveLegendDomain(values, type, channelCfg) ?? undefined)
			: undefined
	const hueScale = hasHue
		? makeHueScale(
				values,
				type,
				configs.hue,
				type === "ordinal"
					? (configs.ordinalPalette ?? configs.categoricalPalette)
					: configs.categoricalPalette,
				hueDomain,
			)
		: null
	// Outline-color scale (`outlineHue` channel). Drives the swatch STROKE,
	// independently of hue (fill). When outline is the only color channel in
	// the section, it also becomes the gradient/quant color via `colorScale`.
	const outlineScale = hasOutline
		? makeHueScale(
				values,
				type,
				configs.outlineHue,
				outlinePaletteForHueType(type, configs),
				type === "quantitative" || type === "temporal"
					? (resolveLegendDomain(values, type, channelCfg) ?? undefined)
					: undefined,
			)
		: null
	// The scale that drives a continuous gradient / quant swatch color when a
	// single color channel owns the section. Hue wins when both are present
	// (it's the fill); outline stands in for a solo outline-color section.
	const colorScale = hueScale ?? outlineScale
	const satScale = hasSat
		? makeSaturationScale(values, type, configs.saturation)
		: null
	const briScale = hasBri
		? makeBrightnessScale(values, type, configs.brightness)
		: null
	const opScale = hasOp ? makeOpacityScale(values, type, configs.opacity) : null
	// Area (size) channel in an ORDINAL combined section. Quantitative area is
	// handled by the shape-glyph path below; an ordinal area field falls
	// through to the categorical renderer, where each category's swatch should
	// be sized by its rank radius (mirroring the standalone AreaLegend). Area
	// only accepts quantitative / ordinal fields, so `type === "ordinal"` is
	// the exact non-quant case that reaches here.
	const areaSizeScale =
		channels.includes("area") && type === "ordinal"
			? makeAreaScale(values, type, configs.area)
			: null
	const areaRadiusFor = (v: string): number | null =>
		areaSizeScale ? applyAreaScale(areaSizeScale, v, type) : null
	const patCategories = hasPat ? patternCategoriesFor(values, type) : null
	// Standalone-pattern tile background: the legend override wins, then the
	// Pattern menu's chart-wide Background, then the historical gray. Only
	// consumed when hue does NOT drive the swatch (see `bg` in buildEntry).
	const patBg =
		patternLegendBgColor ?? configs.pattern?.backgroundColor ?? "#e2e8f0"
	// Line dash overlay only meaningful when connection is mapped AND a
	// pattern field shares this section's variable. Auto-cycle through
	// DASH_CYCLE by category position; per-category overrides win.
	// Mirrors `dashFromPatternField` in ScatterPlot.renderConnectionLines.
	const dashOverrides = configs.pattern?.dashOverrides ?? {}
	const showDash = connectionMapped && hasPat && patCategories !== null
	const dashFor = (v: string, idx: number): LineDashPattern => {
		const override = dashOverrides[v]
		if (override === "none") return "solid"
		if (typeof override === "number") {
			return DASH_CYCLE[override % DASH_CYCLE.length] ?? "solid"
		}
		return DASH_CYCLE[idx % DASH_CYCLE.length] ?? "solid"
	}
	const defaultFill = configs.defaultFill ?? DEFAULT_FILL
	// When no hue color drives the swatch, the user's Legend swatch pickers
	// choose the fill: the "Shape swatch" fill wins (the combined glyph IS a
	// shape), then the "Size" aux-swatch color (which itself carries the
	// theme's `legendSwatchColor` default), then the mark's default fill. This
	// keeps the shared-field shape+size legend in sync with the standalone
	// ShapeLegend / AreaLegend pickers instead of silently using defaultFill.
	// The aux color only applies when this section actually hosts a channel
	// it paints (opacity / saturation / brightness / size / length / angle) —
	// a pattern-led section has its own color story (pattern bg + ink) and
	// must not follow another legend's swatch-color picker.
	const hostsAuxPaintedChannel =
		hasOp ||
		hasSat ||
		hasBri ||
		channels.includes("area") ||
		channels.includes("length") ||
		channels.includes("angle")
	const noHueSwatchFill =
		shapeLegendFillColor ??
		(hostsAuxPaintedChannel ? auxSwatchColor : themeSwatchColor) ??
		defaultFill
	// Area / radar split-outline: resolve each category's line color the same
	// way AreaPlot/RadarPlot do (per-value override → line palette by category
	// position → global stroke). Discovery order matches the renderer's group
	// iteration. Returns null when no split outline applies or it equals fill.
	const splitOutlineOrder = splitOutline ? uniqueValues(values, type) : []
	const splitOutlineStrokeFor = (v: string, fill: string): string | null => {
		if (!splitOutline) return null
		const override = splitOutline.lineColors[v]
		if (override) return override === fill ? null : override
		const palette = splitOutline.linePalette
		if (palette && palette.length > 0) {
			const c = palette[splitOutlineOrder.indexOf(v) % palette.length]
			if (c) return c === fill ? null : c
		}
		const g = splitOutline.strokeOverride
		if (g) return g === fill ? null : g
		return null
	}
	// Shape index resolver — only built when shape is part of the combined
	// section. Mirrors what `ShapeLegend` does: `makeShapeIndexer` returns
	// a function from category-value → palette index. Fill / stroke
	// overrides are read directly from `configs.shape` per category.
	const shapeIndexer = hasShape
		? makeShapeIndexer(values, type, configs.shape)
		: null
	const shapeFillOverrides = configs.shape?.fillOverrides ?? {}
	const shapeStrokeOverrides = configs.shape?.strokeOverrides ?? {}
	const shapeOutlineColor =
		configs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor

	const buildEntry = (v: string) => {
		let color = hasHue ? defaultFill : noHueSwatchFill
		if (hueScale) {
			const c = applyHueScale(hueScale, v, type)
			if (c) color = c
		}
		const satU = satScale ? satScale(v) : null
		const briU = briScale ? briScale(v) : null
		if (satU !== null || briU !== null) {
			color = modulateColor(color, satU, briU)
		}
		const opacity = opScale ? (opScale(v) ?? 1) : defaultSwatchOpacity
		let pattern: Parameters<typeof ComposedSwatch>[0]["pattern"] = null
		if (patCategories) {
			const catIdx = patCategories.indexOf(v)
			if (catIdx !== -1) {
				// No-hue pattern tiles modulate their background by the
				// category's sat/bri level, mirroring the marks (see
				// `modulatedPatternBg` in lib/resolveLayerColor) — otherwise a
				// sat/bri + pattern combined section shows only the pattern.
				// With hue mapped, `color` already carries the modulation.
				const bg = hasHue ? color : modulateColor(patBg, satU, briU)
				// Mirror ScatterPlot's preferredInk lookup so the legend
				// swatch's ink matches the mark's ink when the categorical
				// palette pairs a hue color with a custom pattern ink. A
				// standalone (no-hue) pattern section instead offers its own
				// default-ink override; per-category inks still win inside
				// `resolvePatternForMark`.
				const huePalette = inkPaletteForHue(configs, type)
				const preferredInk = hasHue
					? inkForHueColor(bg, huePalette.palette, huePalette.inks)
					: (patternLegendInkColor ?? null)
				const resolved = resolvePatternForMark(
					v,
					catIdx,
					bg,
					configs.pattern,
					preferredInk
				)
				if (resolved !== null) {
					pattern = {
						bg: resolved.bgColor,
						ink: resolved.inkColor,
						paletteIdx: resolved.paletteIdx,
						svgId: resolved.svgId,
					}
				} else if (!hasHue && !showDash) {
					// PATTERN_NONE is a legitimate category — "this one has no
					// pattern marks". Its swatch is a plain tile in the pattern
					// BACKGROUND color (what the mark actually draws, sat/bri
					// modulation included), not the section's base swatch
					// color. Hue-mapped sections keep the hue color; the dash
					// overlay keeps the base color for its line + point glyph.
					color = bg
				}
			}
		}
		// Build the shape descriptor when shape is in the combined section.
		// Hue acts as the FILL (so each category's swatch shows its color
		// in the right shape). Per-category overrides win — including the
		// literal "none" → outline-only.
		// Outline-color scale value for this category (the `outlineHue`
		// channel). Per-category shape stroke overrides still win on top.
		const outlineScaleColor =
			outlineScale ? applyHueScale(outlineScale, v, type) : null
		// Conditional outline rules override the scale color when this
		// category's outline value matches a rule, mirroring ScatterPlot
		// (resolveRuleColor over `configs.shape.outlineColorRules`). Sits
		// below per-category stroke overrides and above the scale color.
		const outlineRuleColor = hasOutline
			? resolveRuleColor(configs.shape?.outlineColorRules, v)
			: null
		let shape: Parameters<typeof ComposedSwatch>[0]["shape"]
		if (shapeIndexer) {
			const fillOverride = shapeFillOverrides[v]
			const strokeOverride = shapeStrokeOverrides[v]
			shape = {
				idx: shapeIndexer(v),
				glyph: resolveGlyph(shapeIndexer(v), configs.shape?.customGlyphs),
				fill: fillOverride === "none" ? "none" : (fillOverride ?? color),
				stroke:
					strokeOverride ??
					outlineRuleColor ??
					outlineScaleColor ??
					(hasHue ? color : (shapeLegendStrokeColor ?? shapeOutlineColor)),
			}
		} else if (hasOutline) {
			// No shape channel, but outline color IS encoded — draw a glyph so the
			// varying stroke color is visible. The user's swatch-shape / size
			// picker for the Outline section drives the glyph (a SHAPE_PALETTE
			// index, or "line"); falls back to the default shape. Fill follows the
			// hue color when hue is also shown (matching the marks); outline-only
			// (no hue) stays unfilled so the swatch reads as a stroke.
			const glyphIdx =
				typeof swatchShape === "number"
					? swatchShape
					: (configs.defaultShape ?? 0)
			shape = {
				idx: glyphIdx,
				glyph: resolveGlyph(glyphIdx, configs.shape?.customGlyphs),
				fill: hasHue ? color : "none",
				stroke: outlineRuleColor ?? outlineScaleColor ?? shapeOutlineColor,
				size: swatchSize ?? undefined,
				line: swatchShape === "line",
			}
		}
		// Line dash overlay — in line chart context, draw a horizontal
		// stroke across the swatch so users can see both the shape
		// pattern fill AND the line's dash style at a glance. The dash
		// is drawn on top of a white underlay band so it stays legible
		// regardless of the swatch's pattern fill.
		let dash: Parameters<typeof ComposedSwatch>[0]["dash"] = null
		if (showDash && patCategories) {
			const catIdx = patCategories.indexOf(v)
			if (catIdx !== -1) {
				const dashStyle = dashFor(v, catIdx)
				dash = {
					strokeDashArray: dashArrayFor(dashStyle),
					// Hue color matches what the actual polyline strokes
					// look like in the chart.
					stroke: color,
				}
			}
		}
		// Size the glyph by the area channel (ordinal combined section). Force a
		// glyph so the varying radius is visible — reuse the shape descriptor
		// when one exists (shape / outline channel), else synthesize the
		// default (or the user's swatch-shape) glyph filled with the category
		// color. Mirrors the quantitative shape-glyph path's size composition.
		const areaR = areaRadiusFor(v)
		if (areaR !== null) {
			const areaGlyphIdx =
				typeof swatchShape === "number"
					? swatchShape
					: (configs.defaultShape ?? 0)
			shape = shape
				? { ...shape, size: areaR }
				: {
						idx: areaGlyphIdx,
						glyph: resolveGlyph(areaGlyphIdx, configs.shape?.customGlyphs),
						fill: hasHue ? color : noHueSwatchFill,
						stroke:
							outlineRuleColor ??
							outlineScaleColor ??
							(hasHue ? color : shapeOutlineColor),
						size: areaR,
						line: swatchShape === "line",
					}
		}
		// Area / radar line color → swatch border. Only when there's no per-mark
		// `shape` descriptor (that already carries its own stroke); for the
		// rectangle / swatch-shape glyph the border shows the line color. The
		// user's Swatch outline fills in when no encoded stroke claims the border.
		const splitStroke = shape ? null : splitOutlineStrokeFor(v, color)
		const outlineStroke =
			splitStroke ?? (shape ? null : (swatchOutline?.color ?? null))
		const outlineWidth = splitStroke ? null : (swatchOutline?.width ?? null)
		return { color, opacity, pattern, shape, dash, outlineStroke, outlineWidth }
	}

	const hasLength = channels.includes("length")
	const hasAngle = channels.includes("angle")
	const hasArea = channels.includes("area")
	const isQuant = type === "quantitative" || type === "temporal"

	// Shape-glyph combined legend: when area / angle (and/or shape) share
	// the section with hue on a quantitative field — but length isn't in
	// the mix — render each break as a shape glyph that composes EVERY
	// visual encoding the chart uses for that break:
	//   - glyph     = configs.defaultShape (square / circle / etc.)
	//   - size      = areaScale(break) when area is mapped, else default radius
	//   - rotation  = angleScale(break) when angle is mapped, else 0
	//   - fill      = hueScale(break) when hue is mapped, else fallback
	//   - stroke    = configs.shape.outlineColor
	// This matches what the chart actually draws for marks at that value,
	// so the legend reads as a faithful key.
	if (isQuant && !hasLength && (hasArea || hasAngle)) {
		const merged = resolveLegendChannelConfig(channelCfg)
		const stops = resolveLegendBreaks(values, type, channelCfg, 5, 2)
		if (stops.length === 0) return null
		const dataExt = legendDataExtent(values, type)
		const customFmt = buildLegendFormatter(merged.format)
		const fallbackFmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "")
		const rawFmt = customFmt ?? fallbackFmt
		const fmt = (v: number, i: number) =>
			decorateOpenEndLabel(rawFmt(v), i, stops, dataExt)
		const domainOverride =
			resolveLegendDomain(values, type, channelCfg) ?? undefined
		const areaScale = hasArea
			? makeAreaScale(values, type, configs.area, domainOverride)
			: null
		const angleScale = hasAngle
			? makeAngleScale(values, type, configs.angle, domainOverride)
			: null
		const FALLBACK_R = 8
		const shapeIdx = configs.defaultShape ?? 0
		// Swatches render centered — strip any creation-time nudge.
		const shapeGlyph = stripNudge(
			resolveGlyph(shapeIdx, configs.shape?.customGlyphs)
		)
		const strokeColor =
			configs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
		const strokeWidth = configs.shape?.outlineWidth ?? 1
		// When no hue drives the glyph color, the Legend "Size" submenu's aux
		// swatch fill/stroke apply — mirroring the standalone AreaLegend so a
		// combined size legend honors the same picker. With hue present the
		// glyph keeps the hue scale as a faithful key.
		// Shape sharing the section makes the glyph a shape swatch, so its
		// "Shape swatch" fill/stroke win over the aux (Size) swatch color.
		const noHueFill =
			(hasShape ? shapeLegendFillColor : null) ?? auxSwatchColor ?? "#4f8eda"
		const noHueStroke =
			(hasShape ? shapeLegendStrokeColor : null) ?? auxSwatchStroke ?? strokeColor
		const maxR = stops.reduce((m, v) => {
			const r = areaScale ? (applyAreaScale(areaScale, v, type) ?? FALLBACK_R) : FALLBACK_R
			return Math.max(m, r)
		}, FALLBACK_R)
		const colWidth = Math.max(24, Math.ceil(maxR * 2) + 4)
		if (orientation === "horizontal") {
			// Single row: each stop becomes a column with the glyph above
			// its label.
			const cellH = Math.max(24, Math.ceil(maxR * 2) + 4)
			return (
				<div className="flex flex-row flex-nowrap items-end gap-3">
					{stops.map((v, i) => {
						const color = hueScale
							? (applyHueScale(hueScale, v, type) ?? "#4f8eda")
							: noHueFill
						const r = areaScale
							? (applyAreaScale(areaScale, v, type) ?? FALLBACK_R)
							: FALLBACK_R
						const rad = angleScale ? (angleScale(v) ?? 0) : 0
						const deg = (rad * 180) / Math.PI
						const cellW = Math.max(24, Math.ceil(r * 2) + 4)
						return (
							<div
								key={v}
								className="flex flex-shrink-0 flex-col items-center gap-1"
							>
								<svg width={cellW} height={cellH} aria-hidden="true">
									<GlyphMark
										glyph={shapeGlyph}
										r={r}
										transform={`translate(${cellW / 2},${cellH / 2})${deg ? ` rotate(${deg})` : ""}`}
										fill={color}
										fillOpacity={0.85 * defaultSwatchOpacity}
										stroke={hueScale ? strokeColor : noHueStroke}
										strokeWidth={strokeWidth}
									/>
								</svg>
								<span>{fmt(v, i)}</span>
							</div>
						)
					})}
				</div>
			)
		}
		return (
			<div className="flex flex-col gap-1">
				{stops.map((v, i) => {
					const color = hueScale
						? (applyHueScale(hueScale, v, type) ?? "#4f8eda")
						: noHueFill
					const r = areaScale
						? (applyAreaScale(areaScale, v, type) ?? FALLBACK_R)
						: FALLBACK_R
					const rad = angleScale ? (angleScale(v) ?? 0) : 0
					const deg = (rad * 180) / Math.PI
					const rowH = Math.max(24, Math.ceil(r * 2) + 4)
					return (
						<div key={v} className="flex items-center gap-2">
							<svg
								width={colWidth}
								height={rowH}
								aria-hidden="true"
								className="flex-shrink-0"
							>
								<GlyphMark
									glyph={shapeGlyph}
									r={r}
									transform={`translate(${colWidth / 2},${rowH / 2})${deg ? ` rotate(${deg})` : ""}`}
									fill={color}
									fillOpacity={0.85 * defaultSwatchOpacity}
									stroke={hueScale ? strokeColor : noHueStroke}
									strokeWidth={strokeWidth}
								/>
							</svg>
							<span className="min-w-0 truncate">{fmt(v, i)}</span>
						</div>
					)
				})}
			</div>
		)
	}

	// Vector-field combined legend: when length is mapped on the shared
	// field, the chart's marks become LINE SEGMENTS (not glyphs) — so the
	// legend matches with one line-segment swatch per break. Length
	// dominates because it geometrically replaces the shape glyph.
	if (isQuant && hasLength) {
		const merged = resolveLegendChannelConfig(channelCfg)
		const stops = resolveLegendBreaks(values, type, channelCfg, 5, 2)
		if (stops.length === 0) return null
		const dataExt = legendDataExtent(values, type)
		const customFmt = buildLegendFormatter(merged.format)
		const fallbackFmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "")
		const rawFmt = customFmt ?? fallbackFmt
		const fmt = (v: number, i: number) =>
			decorateOpenEndLabel(rawFmt(v), i, stops, dataExt)
		const domainOverride =
			resolveLegendDomain(values, type, channelCfg) ?? undefined
		const lengthScale = hasLength
			? makeLengthScale(values, type, configs.length, domainOverride)
			: null
		const angleScale = hasAngle
			? makeAngleScale(values, type, configs.angle, domainOverride)
			: null
		const FALLBACK_LEN = 16
		// Reserve the same horizontal slot for every row's swatch (the
		// widest segment across all stops) so labels line up vertically.
		// Row HEIGHT stays per-row — short segments sit in compact rows;
		// long ones get a taller row only when their rotation actually
		// needs the vertical space. Uniform-square SVGs would force every
		// row to the worst-case height even when the segment is short.
		const maxLen = stops.reduce(
			(m, v) =>
				Math.max(
					m,
					lengthScale ? (lengthScale(v) ?? FALLBACK_LEN) : FALLBACK_LEN,
				),
			FALLBACK_LEN,
		)
		const colWidth = Math.max(24, Math.ceil(maxLen) + 4)
		return (
			<div className="flex flex-col gap-1">
				{stops.map((v, i) => {
					const color = hueScale
						? (applyHueScale(hueScale, v, type) ?? "#4f8eda")
						: "#4f8eda"
					const len = lengthScale ? (lengthScale(v) ?? FALLBACK_LEN) : FALLBACK_LEN
					const rad = angleScale ? (angleScale(v) ?? 0) : 0
					const half = Math.max(6, len / 2)
					const dx = Math.cos(rad) * half
					const dy = Math.sin(rad) * half
					// Row height tracks the segment's actual vertical extent —
					// near-horizontal lines stay compact; only steeply-tilted
					// lines need taller rows.
					const rowH = Math.max(24, Math.ceil(Math.abs(dy) * 2) + 4)
					const cy = rowH / 2
					const cx = colWidth / 2
					return (
						<div key={v} className="flex items-center gap-2">
							<svg
								width={colWidth}
								height={rowH}
								aria-hidden="true"
								className="flex-shrink-0"
							>
								<line
									x1={cx - dx}
									y1={cy + dy}
									x2={cx + dx}
									y2={cy - dy}
									stroke={color}
									strokeWidth={2.5}
									strokeOpacity={defaultSwatchOpacity}
									strokeLinecap="round"
								/>
							</svg>
							<span className="min-w-0 truncate">{fmt(v, i)}</span>
						</div>
					)
				})}
			</div>
		)
	}

	if (isQuant) {
		// Sample numeric stops along the value range. We use these for both
		// the swatch list and the gradient strip so the two render paths
		// stay in sync (same values, same colors). Custom user breaks win;
		// otherwise breakCount evenly spans the data extent (or the user's
		// chosen domain when they've set custom breaks elsewhere).
		const merged = resolveLegendChannelConfig(channelCfg)
		const stops = resolveLegendBreaks(values, type, channelCfg, 5, 2)
		const lo = stops[0]
		const hi = stops.at(-1)
		if (lo === undefined || hi === undefined) return null
		const dataExt = legendDataExtent(values, type)
		const customFmt = buildLegendFormatter(merged.format)
		const fallbackFmt = (n: number) =>
			type === "temporal"
				? new Date(n).toLocaleDateString()
				: Number.isFinite(n)
					? n.toFixed(2)
					: String(n)
		const rawFmt = customFmt ?? fallbackFmt
		const fmt = (v: number, i: number) =>
			decorateOpenEndLabel(rawFmt(v), i, stops, dataExt)
		// Gradient bar mode is only meaningful when hue is the ONLY mapped
		// group channel — once saturation / brightness / pattern / opacity
		// pile on, the per-stop visual differs in more than just hue and a
		// continuous strip can't represent that. Fall back to swatches.
		const onlyColor =
			channels.length === 1 &&
			(channels[0] === "hue" || channels[0] === "outlineHue") &&
			colorScale !== null
		if (gradientLegendStyle === "bar" && onlyColor && colorScale) {
			const gradientStops = stops.map((val, i) => ({
				t: (val - lo) / (hi - lo || 1),
				color: applyHueScale(colorScale, val, type) ?? "#888",
				label: fmt(val, i),
				key: i,
			}))
			return (
				<GradientBarRamp
					stops={gradientStops}
					cssStops={sampleRampCssStops(colorScale, lo, hi, type)}
					orientation={orientation}
					barStyle={gradientBarStyle}
				/>
			)
		}
		if (orientation === "horizontal") {
			return (
				<div className="flex flex-row flex-nowrap items-center gap-3">
					{stops.map((s, i) => {
						const entry = buildEntry(String(s))
						return (
							<div
								key={s}
								className="flex flex-shrink-0 flex-row items-center gap-1.5"
							>
								<ComposedSwatch {...entry} swatchShape={swatchShape} swatchSize={swatchSize} />
								<span className="whitespace-nowrap">{fmt(s, i)}</span>
							</div>
						)
					})}
				</div>
			)
		}
		return (
			<div className="flex flex-col gap-1">
				{stops.map((s, i) => {
					const entry = buildEntry(String(s))
					return (
						<div key={s} className="flex items-center gap-2">
							<ComposedSwatch {...entry} swatchShape={swatchShape} swatchSize={swatchSize} />
							<span className="min-w-0 truncate">{fmt(s, i)}</span>
						</div>
					)
				})}
			</div>
		)
	}

	const rawUnique = orderCategories(uniqueValues(values, type), type, pinnedOrder)
	const unique = reverseCategorical ? [...rawUnique].reverse() : rawUnique
	// When area sizes the swatches, their SVG widths vary by category, which
	// would ragged-left the labels in a stacked list. Reserve a fixed column
	// (the widest swatch) and center each swatch in it so labels align.
	const areaSwatchColWidth = areaSizeScale
		? Math.max(
				16,
				(Math.max(...unique.map((v) => areaRadiusFor(v) ?? 5)) + 3) * 2,
			)
		: null
	if (orientation === "horizontal") {
		return (
			<div className="flex flex-row flex-nowrap items-center gap-3">
				{unique.map((v) => {
					const entry = buildEntry(v)
					return (
						<EntryHoverWrap key={v} field={highlightField} value={v}>
							<div className="flex flex-shrink-0 flex-row items-center gap-1.5">
								<ComposedSwatch {...entry} swatchShape={swatchShape} swatchSize={swatchSize} />
								<span className="whitespace-nowrap" title={v}>
									{v}
								</span>
							</div>
						</EntryHoverWrap>
					)
				})}
			</div>
		)
	}
	return renderEntryList(
		unique.map((v) => {
			const entry = buildEntry(v)
			const swatch = (
				<ComposedSwatch {...entry} swatchShape={swatchShape} swatchSize={swatchSize} />
			)
			return (
				<EntryHoverWrap key={v} field={highlightField} value={v}>
					<div className="flex items-center gap-2">
						{areaSwatchColWidth != null ? (
							<div
								className="flex flex-shrink-0 justify-center"
								style={{ width: areaSwatchColWidth }}
							>
								{swatch}
							</div>
						) : (
							swatch
						)}
						<span className="min-w-0 truncate" title={v}>
							{v}
						</span>
					</div>
				</EntryHoverWrap>
			)
		}),
		entryColumns,
	)
}
