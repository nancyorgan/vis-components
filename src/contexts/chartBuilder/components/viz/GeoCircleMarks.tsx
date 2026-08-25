import {
	NEUTRAL_HIGHLIGHT,
	type MarkHighlight,
} from "../../store/useLegendHighlight"

/** One projected circle mark (a bubble-map bubble or a dot-map dot). The
 *  renderer resolves position / radius / colors per its own rules; this layer
 *  only owns the shared paint order + hover wiring. `fillOpacity` is optional
 *  — the bubble map never sets it (slot colors render at full opacity), the
 *  dot map sets it on the opacity-only measure path. */
export type GeoCircleMark = {
	key: string
	px: number
	py: number
	r: number
	fill: string
	fillOpacity?: number | undefined
	stroke: string
	row: Record<string, unknown>
}

type GeoCircleMarksProps = {
	marks: GeoCircleMark[]
	/** Single outline width for all marks (0 hides the border). */
	outlineWidth: number
	/** Optional legend-hover highlight per mark (the geo scaffold's
	 *  `markHighlight`): fades non-matching circles and recolors / outlines the
	 *  matching ones. Omit → every circle renders untouched. */
	highlightFor?: (row: Record<string, unknown>) => MarkHighlight
	/** Hover handler factory (the scaffold's) — wired to both onMouseEnter and
	 *  onMouseMove for a follow-cursor tooltip feel. */
	hoverHandler: (row: Record<string, unknown>) => (e: React.MouseEvent) => void
	/** Paint marks exactly in array order instead of the default
	 *  largest-first sort. Set when the user picked an explicit Draw order in
	 *  Aesthetics — the caller passes the marks pre-sorted. */
	preserveOrder?: boolean
}

/**
 * Interactive circle layer shared by GeoSymbolPlot (bubbles at region
 * centroids) and GeoPointPlot (dots at projected lon/lat). By default paints
 * the LARGEST circles first so the smaller ones land on top and stay
 * hoverable / visible (only meaningful when area-sized, but harmless for
 * uniform dots); an explicit Draw order setting overrides this via
 * `preserveOrder`.
 */
export const GeoCircleMarks = ({
	marks,
	outlineWidth,
	hoverHandler,
	preserveOrder,
	highlightFor,
}: GeoCircleMarksProps) => (
	<g>
		{(preserveOrder ? marks : [...marks].sort((a, b) => b.r - a.r))
			.map((m) => {
				const onHover = hoverHandler(m.row)
				// Legend-hover highlight, applied exactly like ScatterPlot's glyphs:
				// element opacity for the fade, fill / stroke overrides for the
				// recolor + outline emphasis. Geometry is untouched.
				const mh = highlightFor ? highlightFor(m.row) : NEUTRAL_HIGHLIGHT
				return (
					<circle
						key={m.key}
						cx={m.px}
						cy={m.py}
						r={m.r}
						fill={mh.fill ?? m.fill}
						fillOpacity={m.fillOpacity}
						stroke={mh.outline ?? m.stroke}
						strokeWidth={
							mh.outline
								? Math.max(outlineWidth, mh.outlineWidth)
								: outlineWidth
						}
						opacity={mh.opacityMul === 1 ? undefined : mh.opacityMul}
						onMouseEnter={onHover}
						onMouseMove={onHover}
					/>
				)
			})}
	</g>
)
