import { format as d3Format } from "d3-format"
import { timeFormat } from "d3-time-format"

import type { AxisConfig } from "./channelConfig"
import type { FieldType } from "./types"

const safeFormat = (spec: string): ((v: unknown) => string) => {
	try {
		const f = d3Format(spec)
		return (v) => {
			if (typeof v === "number") return f(v)
			// Categorical/ordinal scales hand us domain entries as strings even
			// when the underlying values are numeric (CSV imports, bin labels
			// like "1", "2", "3"). Coerce so users can apply `$,.2f` etc. to
			// numeric-looking ordinal bins.
			if (typeof v === "string" && v.trim() !== "") {
				const n = Number(v)
				if (Number.isFinite(n)) return f(n)
			}
			return String(v ?? "")
		}
	} catch {
		return (v) => String(v ?? "")
	}
}

const safeTimeFormat = (spec: string): ((v: unknown) => string) => {
	try {
		const f = timeFormat(spec)
		return (v) => {
			if (v instanceof Date) return f(v)
			// Plenty of pipelines (CSV imports, JSON dates) hand us a numeric
			// or string timestamp instead of a Date. Coerce if it parses to a
			// valid Date so the temporal preset still applies — otherwise the
			// user picks "%Y" and sees raw numbers, which reads as broken.
			if (typeof v === "number" || typeof v === "string") {
				const d = new Date(v)
				if (!Number.isNaN(d.getTime())) return f(d)
			}
			return String(v ?? "")
		}
	} catch {
		return (v) => String(v ?? "")
	}
}

/** d3-time-format specs contain at least one `%<letter>` directive. The
 * `%`-suffix used by d3-format (e.g. ".0%") sits at the end of the spec and
 * isn't followed by a letter, so this disambiguates cleanly. */
const isTimeFormatSpec = (spec: string): boolean => /%[a-zA-Z]/.test(spec)

/** Sentinel `customFormat` spec meaning "print the value verbatim" — no
 * numeric grouping, no date coercion. It's the escape hatch for a numeric
 * field (years, IDs, codes) whose values must NOT be reinterpreted: picking a
 * temporal preset like `%Y` would otherwise coerce a bare `2020` through
 * `new Date(2020)` (2020ms past epoch → 1969/1970), collapsing every tick. */
export const LITERAL_FORMAT = "literal"

/**
 * Build a tick formatter for the given axis config + field type. Returns `null`
 * when the caller should fall back to the scale's default tick format — that's
 * the case whenever `customFormat` is empty (the dropdown's "Auto" option).
 *
 * The spec itself decides whether to use d3-format or d3-time-format, so
 * picking a temporal preset on a quantitative axis (or vice versa) still
 * produces sensible labels as long as values are coercible.
 */
export const buildTickFormatter = (
	// Only the format spec is consulted — `Pick` so non-axis callers (the
	// chord ring axis) can pass a bare `{ customFormat }`.
	config: Pick<AxisConfig, "customFormat">,
	_type: FieldType
): ((v: unknown) => string) | null => {
	const spec = config.customFormat.trim()
	if (spec === "") return null
	// Literal: stringify as-is, bypassing both formatters. Must come before the
	// time/numeric routing so a numeric axis can opt out of any coercion.
	if (spec.toLowerCase() === LITERAL_FORMAT) return (v) => String(v ?? "")
	return isTimeFormatSpec(spec) ? safeTimeFormat(spec) : safeFormat(spec)
}
