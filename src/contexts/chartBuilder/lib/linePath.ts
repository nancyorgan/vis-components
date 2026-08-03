import { line as d3Line, curveCardinal } from "d3-shape"

export interface LinePoint {
	x: number
	y: number
}

/** Build an SVG path `d` string through `points`, with optional smoothing.
 *
 *  `smoothing` in [0, 1] controls corner rounding via a cardinal spline's
 *  tension: 0 → straight segments through every point (tension 1, visually
 *  identical to a polyline), 1 → loosest rounded curve (tension 0). The curve
 *  always passes through every data point; higher amounts round the corners
 *  more and can overshoot slightly on sharp turns. Callers keep drawing a
 *  plain `<polyline>` when `smoothing` is 0, so this is only invoked for the
 *  smoothed case — but it degrades to straight lines regardless, so it is
 *  safe to call unconditionally.
 *
 *  Returns "" when there are fewer than two points (nothing to draw). */
export function buildLinePath(
	points: ReadonlyArray<LinePoint>,
	smoothing: number
): string {
	if (points.length < 2) return ""
	const tension = 1 - Math.min(1, Math.max(0, smoothing))
	const gen = d3Line<LinePoint>()
		.x((p) => p.x)
		.y((p) => p.y)
		.curve(curveCardinal.tension(tension))
	return gen(points as LinePoint[]) ?? ""
}
