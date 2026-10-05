import { charWidthFactor } from "./estimateMargins"

/** Minimum clear gap (in em) two ADJACENT unrotated labels must keep
 *  between their nearest edges before we consider them "fitting". A
 *  quarter-em is the narrowest gap that still reads as a space between
 *  words; anything tighter and neighbors read as one run of text. */
const MIN_GAP_EM = 0.25

/** Default auto-rotation angle (degrees, negative = tilt up-left).
 *  -45 is the conventional choice: enough to clear adjacent labels
 *  without forcing the bottom chrome to grow as much as a full -90°. */
export const AUTO_ANGLE_DEG = -45

/** Resolve the tick-label angle for a categorical x-axis.
 *
 *  `userAngle` is the stored `AxisConfig.tickLabelAngle`: `null` /
 *  `undefined` means "auto" (this heuristic decides), and ANY number —
 *  including 0 — is an explicit choice that wins outright. So a user who
 *  sees the auto -45° and wants the labels level stores 0 and gets it.
 *
 *  Auto decides by checking each pair of NEIGHBORING labels: two centered
 *  labels collide when half of one plus half of the next plus a minimum
 *  gap exceeds the spacing between their ticks. Only neighbors matter —
 *  one wide label beside short ones fits where it wouldn't beside another
 *  wide one — which is why this is not "widest label vs band width" (that
 *  rule rotated far more axes than needed). Widths come from
 *  `labelWidthsPx` when the caller measured them (canvas `measureText`
 *  in the rendered font); otherwise from the char-count estimate.
 *
 *  Used in two places:
 *   - PlotCanvas (per panel input) so the layout solver reserves enough
 *     bottom chrome for the rotated labels. There tick spacing is the
 *     uniform `bandWidthPx` estimate.
 *   - Axes.tsx (at render time) so the labels actually draw rotated.
 *     There the real tick `positionsPx` give the exact spacing (strided
 *     axes keep the last tick, so the final gap can differ).
 *
 *  Both call sites pass the same labels, in axis order, so the rendered
 *  angle and the reserved chrome agree. */
export const autoLabelAngleFor = ({
	labels,
	bandWidthPx,
	positionsPx,
	fontSize,
	userAngle,
	wrapEnabled,
	labelWidthsPx,
}: {
	labels: readonly string[]
	/** Uniform tick spacing, used when `positionsPx` isn't supplied. */
	bandWidthPx: number
	/** Actual tick centers (px) in the same order as `labels`; when given,
	 *  neighbor spacing is taken from these instead of `bandWidthPx`. */
	positionsPx?: readonly number[]
	fontSize: number
	/** Stored angle: null / undefined = auto; any number is explicit. */
	userAngle: number | null | undefined
	/** True when the axis has "Wrap text" on — wrapping is then the
	 *  overflow strategy, so the auto-rotate stays off. */
	wrapEnabled?: boolean
	/** Measured width (px) of each label, same order as `labels`. Entries
	 *  that are missing or 0 (no canvas available) fall back to the
	 *  char-count estimate. */
	labelWidthsPx?: readonly number[]
}): number => {
	if (userAngle !== undefined && userAngle !== null) return userAngle
	if (wrapEnabled) return 0
	if (labels.length < 2) return 0
	const usePositions =
		positionsPx !== undefined && positionsPx.length === labels.length
	if (!usePositions && bandWidthPx <= 0) return 0
	const widthOf = (i: number): number => {
		const measured = labelWidthsPx?.[i]
		if (measured !== undefined && measured > 0) return measured
		return labels[i].length * fontSize * charWidthFactor
	}
	const minGap = fontSize * MIN_GAP_EM
	let prev = widthOf(0)
	for (let i = 1; i < labels.length; i++) {
		const next = widthOf(i)
		const spacing = usePositions
			? Math.abs(positionsPx[i] - positionsPx[i - 1])
			: bandWidthPx
		if (prev / 2 + next / 2 + minGap > spacing) return AUTO_ANGLE_DEG
		prev = next
	}
	return 0
}
