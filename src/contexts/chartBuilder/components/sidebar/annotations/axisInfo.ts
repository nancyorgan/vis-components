import {
	baseToPercentX,
	baseToPercentY,
	isPixelSystem,
	percentToBaseX,
	percentToBaseY,
	percentToPixelX,
	percentToPixelY,
	pixelToPercentX,
	pixelToPercentY,
	type AnnotationCoordSystem,
} from "../../../lib/annotationPixels"
import type { RadiusUnit } from "../../../lib/annotationsConfig"
import { parseLocalDate } from "../../../lib/localDate"
import type { FieldType } from "../../../lib/types"

/** Resolved per-axis info used by the panel to pick number-input vs.
 *  category-dropdown for `values` mode. Mirrors the resolution PlotCanvas
 *  does at render time so the panel and the renderer agree on what each
 *  axis represents in the current chart mode. */
export type AxisInfo = {
	field: string | null
	type: FieldType | null
	categories: string[] | null
	/** Data min for numeric/temporal axes. Stored as a number (timestamp
	 *  in ms for temporal) so the percent↔values conversion below can lerp
	 *  uniformly. `null` when the axis is categorical or empty. */
	dataMin: number | null
	dataMax: number | null
}

/** Round `n` to a short, human-readable representation. Strips trailing
 *  zeros that JavaScript's float arithmetic introduces (e.g.,
 *  `12.34 / 100 * 100 = 12.339999999`) so the position-adjuster inputs
 *  don't fill up with noise after a blur/round-trip. */
export const cleanNumber = (n: number): number => {
	if (!Number.isFinite(n)) return n
	// `toPrecision(10)` keeps enough digits for any reasonable axis value
	// while parseFloat re-parses to drop trailing zeros from the string.
	return parseFloat(n.toPrecision(10))
}

/** Coerce a stored value to a number for percent-mode math. Strings
 *  (left over from a previous values-mode setting on a categorical
 *  axis) coerce to 0 here — the user's display in percent mode is
 *  meaningless on those anyway. */
export const toNumber = (v: number | string): number => {
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** A stored value-mode coordinate on a temporal axis as epoch ms. Numbers
 *  already are (the date box and the percent↔values toggle both write ms);
 *  a string — a date typed into an older build, or hand-edited config —
 *  parses as a local date. NaN when neither reads as a date. */
export const temporalCoordMs = (v: number | string): number =>
	typeof v === "number" ? v : parseLocalDate(v)

/** Convert a stored percent coord (0–1) to a data-mode value using the
 *  axis info. Categorical axes pick the category at that position;
 *  numeric/temporal lerp between data min and max. Returns the original
 *  value unchanged when conversion isn't possible (no axis info). */
export const percentToValue = (
	percent: number,
	axis: AxisInfo,
): number | string => {
	if (axis.categories && axis.categories.length > 0) {
		const idx = Math.max(
			0,
			Math.min(
				axis.categories.length - 1,
				Math.round(percent * (axis.categories.length - 1)),
			),
		)
		return axis.categories[idx] ?? ""
	}
	if (axis.dataMin !== null && axis.dataMax !== null) {
		const lerped = axis.dataMin + percent * (axis.dataMax - axis.dataMin)
		return cleanNumber(lerped)
	}
	return percent
}

/** Inverse of `percentToValue` — convert a data-mode value back to its
 *  0–1 position on the axis so the percent boxes show the live numbers
 *  after a toggle. */
export const valueToPercent = (
	value: number | string,
	axis: AxisInfo,
): number => {
	if (axis.categories && axis.categories.length > 0) {
		const idx = axis.categories.indexOf(String(value))
		if (idx < 0) return 0
		return axis.categories.length <= 1
			? 0.5
			: idx / (axis.categories.length - 1)
	}
	if (axis.dataMin !== null && axis.dataMax !== null) {
		const num =
			axis.type === "temporal"
				? temporalCoordMs(value)
				: typeof value === "number"
					? value
					: Number(value)
		if (!Number.isFinite(num)) return 0
		if (axis.dataMax === axis.dataMin) return 0.5
		return (num - axis.dataMin) / (axis.dataMax - axis.dataMin)
	}
	return typeof value === "number" ? value : 0
}

/** Whether a values-mode radius measured against `axis` counts in data
 *  units. True for quantitative and numeric-ordinal axes — the ones whose
 *  position scale is linear, so `scale(center + radius)` means something.
 *  Categorical / string-ordinal (a point scale) and temporal axes have no
 *  unit a radius could count in; there the circle's own `radiusUnit`
 *  applies. Mirrors the renderer's check in `circleAnnotationGeometry.ts`. */
export const hasDataUnits = (axis: AxisInfo): boolean =>
	axis.type === "quantitative" ||
	(axis.type === "ordinal" && axis.categories === null)

/** Convert a percent-mode radius (fraction of the radius-axis extent) to a
 *  data-unit radius along that axis. Falls back to the raw fraction when the
 *  axis has no data units, or no numeric span yet (empty data). */
export const radiusToValues = (fraction: number, axis: AxisInfo): number => {
	if (!hasDataUnits(axis) || axis.dataMin === null || axis.dataMax === null)
		return fraction
	return cleanNumber(fraction * (axis.dataMax - axis.dataMin))
}

/** Inverse of `radiusToValues` — data-unit radius back to a 0–1 fraction of
 *  the axis extent so the percent box shows a sensible number after toggling. */
export const radiusToPercent = (units: number, axis: AxisInfo): number => {
	if (!hasDataUnits(axis) || axis.dataMin === null || axis.dataMax === null)
		return units
	const span = axis.dataMax - axis.dataMin
	if (span === 0) return 0
	return cleanNumber(units / span)
}

/** Convert a radius between its two axis-free units — a fraction of the
 *  radius axis's plot extent and on-screen px — so the px / % toggle beside
 *  the radius box keeps the circle the same size. Leaves the number alone
 *  before the first layout pass (no extent to convert against). */
export const convertRadiusUnit = (
	value: number,
	from: RadiusUnit,
	to: RadiusUnit,
	extentPx: number | null,
): number => {
	if (from === to || extentPx === null || extentPx <= 0) return value
	return to === "px"
		? Math.round(value * extentPx)
		: cleanNumber(value / extentPx)
}

/** Suggestion (placeholder) label for the Nth annotation of a kind:
 *  "Rectangle", "Rectangle 2", "Rectangle 3", … Shown as light placeholder
 *  text so the user can tell the shapes apart, but is nudged to type a more
 *  descriptive name (which replaces the suggestion). */
export const nameSuggestion = (base: string, index: number): string =>
	`${base} ${index + 1}`

/** The rendered plot rect's size, from `currentRenderedPanelInnerDimsAtom`.
 *  Null before the first layout pass — pixel conversions then leave the
 *  stored number alone rather than guess an extent. */
export type PlotDims = { widthPx: number; heightPx: number } | null

const extentOf = (dims: PlotDims, dim: "x" | "y"): number | null =>
	dims === null ? null : dim === "x" ? dims.widthPx : dims.heightPx

/** Convert one stored coordinate between the three coordinate systems so
 *  the annotation stays where it is when the user switches "Adjust by".
 *  Every path goes through the bottom-left percent (0–1) form (the percent
 *  corners offset from it by one plot extent, no plot size needed): values ↔ percent via the
 *  axis's data span (or category index), pixels ↔ percent via the plot's
 *  extent on that axis (pixels count from the chosen corner, +x right and
 *  +y up; the pixel corners convert between each other through percent
 *  too). */
export const convertCoord = (
	value: number | string,
	from: AnnotationCoordSystem,
	to: AnnotationCoordSystem,
	axis: AxisInfo,
	dim: "x" | "y",
	dims: PlotDims,
): number | string => {
	if (from === to) return value
	const extent = extentOf(dims, dim)
	const toPercent = (): number => {
		if (from === "values") return valueToPercent(value, axis)
		if (isPixelSystem(from)) {
			if (extent === null) return toNumber(value)
			return dim === "x"
				? pixelToPercentX(toNumber(value), extent, from)
				: pixelToPercentY(toNumber(value), extent, from)
		}
		return dim === "x"
			? percentToBaseX(toNumber(value), from)
			: percentToBaseY(toNumber(value), from)
	}
	const fraction = toPercent()
	if (to === "values") return percentToValue(fraction, axis)
	if (isPixelSystem(to)) {
		if (extent === null) return cleanNumber(fraction)
		return cleanNumber(
			Math.round(
				dim === "x"
					? percentToPixelX(fraction, extent, to)
					: percentToPixelY(fraction, extent, to),
			),
		)
	}
	return cleanNumber(
		dim === "x" ? baseToPercentX(fraction, to) : baseToPercentY(fraction, to),
	)
}

/** `convertCoord` for a circle's radius: a fraction of the radius axis's
 *  extent (percent), data units along it (values), or on-screen px. When
 *  the radius axis has no data units, a values-mode radius is in `unit`
 *  (the circle's `radiusUnit`) instead — see `hasDataUnits`. */
export const convertRadius = (
	value: number,
	from: AnnotationCoordSystem,
	to: AnnotationCoordSystem,
	axis: AxisInfo,
	extentPx: number | null,
	unit: RadiusUnit,
): number => {
	if (from === to) return value
	// The axis-free unit a values-mode radius is in on this axis; null when
	// it counts in data units.
	const valuesUnit: RadiusUnit | null = hasDataUnits(axis) ? null : unit
	const fraction =
		from === "values"
			? valuesUnit === null
				? radiusToPercent(value, axis)
				: convertRadiusUnit(value, valuesUnit, "percent", extentPx)
			: isPixelSystem(from)
				? convertRadiusUnit(value, "px", "percent", extentPx)
				: value
	if (to === "values")
		return valuesUnit === null
			? radiusToValues(fraction, axis)
			: convertRadiusUnit(fraction, "percent", valuesUnit, extentPx)
	if (isPixelSystem(to)) return convertRadiusUnit(fraction, "percent", "px", extentPx)
	return cleanNumber(fraction)
}
