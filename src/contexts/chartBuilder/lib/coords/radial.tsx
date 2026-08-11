import type { ReactNode } from "react"

import type {
	AngleConfig,
	AxisConfig,
	GridlineConfig,
} from "../channelConfig"
import {
	DEFAULT_GRIDLINE_CONFIG,
	DEFAULT_SPINE_CONFIG,
} from "../channelConfig"
import { estimateLongestLineWidth } from "../estimateMargins"
import type { FontConfig, TextFontConfig } from "../labelsConfig"
import {
	renderWrappedTickLabel,
	tickWrapMaxPx,
	wrapTickLabel,
} from "../tickLabelWrap"
import type { PlotInner } from "../plotLayout"
import { resolveTickFontSizePx } from "../fontUnit"
import type { AxisLayer, CoordSystem, RadialScales } from "./types"

export type RadialInput = {
	scales: RadialScales
	/** AxisConfig powering the r-axis (concentric grid rings + r-tick
	 *  labels). Spoke (radial line) color/thickness is read from
	 *  `angleAxisConfig.spine` instead — the spokes belong to the angular
	 *  axis. Mirrors how `cartesian()` consumes `xAxisConfig` / `yAxisConfig`. */
	rAxisConfig?: AxisConfig
	/** Angle-axis chrome — drives spoke (spine) color/thickness, perimeter
	 *  tick-label rotation, and tick-mark glyphs at each spoke. When
	 *  omitted, the renderer's built-in defaults apply. */
	angleAxisConfig?: AngleConfig
	tickFont: TextFontConfig
	rAxisTitleFont: FontConfig
	/** Title text for the r-axis. Rendered along the 12 o'clock spoke when
	 *  set; falls back to empty string. */
	rLabel: string
	showRAxis: boolean
	showRAxisTitle?: boolean
}

const SPOKE_LABEL_PADDING = 12
const R_TICK_LABEL_OFFSET = 6

/** Radial coord system: renders a disc with concentric grid rings at each
 *  r-tick and straight spokes at each angle-tick. Angle labels sit just
 *  outside the perimeter; r-tick labels sit along the 12 o'clock spoke.
 *
 *  Same layer semantics as `cartesian()` — rings + spokes render in the
 *  "back" layer (below marks), labels in the "front" layer (above marks).
 *
 *  Spoke styling (color, thickness) is driven by `angleAxisConfig.spine`,
 *  letting users style the radial-axis chrome from the Angle panel. The
 *  `rAxisConfig.spine` field is ignored (spokes aren't the r-axis spine
 *  in a polar coord system). */
export const radial = (input: RadialInput): CoordSystem => {
	const { scales, rAxisConfig, angleAxisConfig, tickFont } = input
	const gridlines: GridlineConfig =
		rAxisConfig?.gridlines ?? DEFAULT_GRIDLINE_CONFIG
	const spokeColor =
		angleAxisConfig?.spine?.color ?? DEFAULT_SPINE_CONFIG.color
	const spokeThickness =
		angleAxisConfig?.spine?.thickness ?? DEFAULT_SPINE_CONFIG.thickness
	const spokeOpacity = angleAxisConfig?.spine?.opacity ?? 1
	// R-tick label font. The per-axis `tickLabelFont` override (family / size
	// / color / weight / italic / underline, set from the r-axis panel) layers
	// over the global Text encoding font; each unset field inherits the global.
	// `color` resolves through the legacy `tickLabelColor` for back-compat.
	// Only the r-tick numbers along the 12 o'clock spoke use this — the
	// perimeter angle labels belong to the angle channel and keep `tickFont`.
	const rTickFont = rAxisConfig?.tickLabelFont
	const rTickLabelColor =
		rTickFont?.color ?? rAxisConfig?.tickLabelColor ?? tickFont.color
	const rTickFamily = rTickFont?.family ?? tickFont.family
	const rTickSize = resolveTickFontSizePx(rTickFont?.size, tickFont.size)
	const rTickWeight = rTickFont?.weight ?? tickFont.weight
	const rTickItalic = rTickFont?.italic ?? tickFont.italic
	const rTickUnderline = rTickFont?.underline ?? tickFont.underline
	const labelRotation = angleAxisConfig?.tickLabelAngle ?? 0

	return {
		kind: "radial",
		scales,
		renderAxes: (layer: AxisLayer, _inner: PlotInner): ReactNode => {
			void _inner
			const { center, maxRadius, angleTicks, rTicks, rGridRadii } = scales
			if (layer === "back") {
				if (!input.showRAxis) return null
				return (
					<g aria-hidden>
						{gridlines.enabled &&
							rGridRadii.map((radius, i) => (
								<circle
									// eslint-disable-next-line react/no-array-index-key -- rings are positional; radii can repeat at degenerate scales
									key={`ring-${i}`}
									cx={center.cx}
									cy={center.cy}
									r={radius}
									fill="none"
									stroke={gridlines.color}
									strokeWidth={gridlines.thickness}
								/>
							))}
						{angleTicks.map((t) => {
							const x = center.cx + Math.sin(t.angle) * maxRadius
							const y = center.cy - Math.cos(t.angle) * maxRadius
							return (
								<line
									key={`spoke-${t.label}`}
									x1={center.cx}
									y1={center.cy}
									x2={x}
									y2={y}
									stroke={spokeColor}
									strokeWidth={spokeThickness}
									strokeOpacity={spokeOpacity}
								/>
							)
						})}
					</g>
				)
			}
			// Front layer: angle perimeter labels and r-tick labels.
			if (!input.showRAxis) return null
			return (
				<g aria-hidden>
					{angleTicks.map((t) => {
						const labelRadius = maxRadius + SPOKE_LABEL_PADDING
						const x = center.cx + Math.sin(t.angle) * labelRadius
						const y = center.cy - Math.cos(t.angle) * labelRadius
						// Pick horizontal anchor so labels read away from the spoke.
						const sinV = Math.sin(t.angle)
						const anchor =
							sinV > 0.1 ? "start" : sinV < -0.1 ? "end" : "middle"
						const transform =
							labelRotation === 0
								? undefined
								: `rotate(${labelRotation}, ${x}, ${y})`
						return (
							<text
								key={`alabel-${t.label}`}
								x={x}
								y={y}
								transform={transform}
								fontFamily={tickFont.family}
								fontSize={tickFont.size}
								fontWeight={tickFont.weight}
								fontStyle={tickFont.italic ? "italic" : undefined}
								textDecoration={
									tickFont.underline ? "underline" : undefined
								}
								fill={tickFont.color}
								textAnchor={anchor}
								dominantBaseline="middle"
							>
								{t.label}
							</text>
						)
					})}
					{(() => {
						// "Wrap text" on the r-axis: fold long labels to the same
						// fixed max width the y-axis uses (the 12 o'clock spoke has
						// no per-tick slot). Centered on the tick radius, matching
						// the single-line baseline-middle anchoring.
						const wrappedRTicks = rTicks.map((t) => ({
							...t,
							label:
								rAxisConfig?.wrapTickLabels === true
									? wrapTickLabel(t.label, tickWrapMaxPx(rTickSize), rTickSize)
									: t.label,
						}))
						// Single-line labels align within the shared label column
						// right of the spoke (as wide as the widest label line);
						// wrapped blocks keep their within-block line alignment.
						const rColumnWidth = wrappedRTicks.reduce(
							(w, t) =>
								Math.max(w, estimateLongestLineWidth(t.label, rTickSize)),
							0
						)
						return wrappedRTicks.map((t) => {
						const x = center.cx + R_TICK_LABEL_OFFSET
						const y = center.cy - t.radius
						const label = t.label
						return (
							<text
								key={`rlabel-${t.label}`}
								x={x}
								y={y}
								fontFamily={rTickFamily}
								fontSize={rTickSize}
								fontWeight={rTickWeight}
								fontStyle={rTickItalic ? "italic" : undefined}
								textDecoration={
									rTickUnderline ? "underline" : undefined
								}
								fill={rTickLabelColor}
								textAnchor="start"
								dominantBaseline="middle"
							>
								{renderWrappedTickLabel({
									label,
									x,
									blockAnchor: "start",
									align: rAxisConfig?.wrapTickLabelAlign,
									fontSize: rTickSize,
									verticallyCentered: true,
									columnWidth: rColumnWidth,
								})}
							</text>
						)
						})
					})()}
				</g>
			)
		},
	}
}
