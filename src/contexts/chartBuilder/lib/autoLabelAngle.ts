import { charWidthFactor } from "./estimateMargins"

/** Threshold above which a label is considered "too wide to fit" in its
 *  band — 90% of band width leaves a small gap so labels that JUST fit
 *  don't trigger rotation. */
const FIT_THRESHOLD = 0.9

/** Default auto-rotation angle (degrees, negative = tilt up-left).
 *  -45 is the conventional choice: enough to clear adjacent labels
 *  without forcing the bottom chrome to grow as much as a full -90°. */
const AUTO_ANGLE_DEG = -45

/** Resolve the tick-label angle for a categorical x-axis. If the user
 *  has set an explicit angle (anything non-zero) we honor it. Otherwise
 *  we estimate whether the longest label would overlap its neighbors
 *  at the available band width, and rotate to AUTO_ANGLE_DEG when it
 *  would.
 *
 *  Used in two places:
 *   - PlotCanvas (per panel input) so the layout solver reserves enough
 *     bottom chrome for the rotated labels.
 *   - Axes.tsx (at render time) so the labels actually draw rotated.
 *
 *  Both call sites pass the same band-width estimate, so the rendered
 *  angle and the reserved chrome agree. */
export const autoLabelAngleFor = ({
	labels,
	bandWidthPx,
	fontSize,
	userAngle,
	wrapEnabled,
}: {
	labels: readonly string[]
	bandWidthPx: number
	fontSize: number
	userAngle: number | undefined
	/** True when the axis has "Wrap text" on — wrapping is then the
	 *  overflow strategy, so the auto-rotate stays off (an explicit
	 *  user angle still wins). */
	wrapEnabled?: boolean
}): number => {
	if (userAngle !== undefined && userAngle !== 0) return userAngle
	if (wrapEnabled) return 0
	if (labels.length === 0 || bandWidthPx <= 0) return 0
	const longest = labels.reduce(
		(m, l) => (l.length > m ? l.length : m),
		0,
	)
	const longestWidthPx = longest * fontSize * charWidthFactor
	if (longestWidthPx > bandWidthPx * FIT_THRESHOLD) return AUTO_ANGLE_DEG
	return 0
}
