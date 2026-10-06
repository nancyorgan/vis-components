import { format as d3Format, formatSpecifier } from "d3-format"
import { timeFormat } from "d3-time-format"

import type { AxisConfig } from "./channelConfig"
import type { FieldType } from "./types"

/** For an SI-prefix spec (d3 type `s`, e.g. `.2s` → "3.0k"), a formatter
 * for the value 0 that prints a plain "0" (keeping any `$` / sign / fill from
 * the spec). d3 applies `s` precision as SIGNIFICANT digits, so zero — which
 * has no prefix to absorb them — comes out as "0.0" / "0.00" next to "3k"
 * ticks. `null` for every other spec type. */
const zeroFormatterForSiSpec = (spec: string): ((v: number) => string) | null => {
	const parsed = formatSpecifier(spec)
	if (parsed.type !== "s") return null
	parsed.type = "f"
	parsed.precision = 0
	return d3Format(parsed.toString())
}

const safeFormat = (spec: string): ((v: unknown) => string) => {
	try {
		const f = d3Format(spec)
		const zero = zeroFormatterForSiSpec(spec)
		const fmtNumber = (n: number) => (zero && n === 0 ? zero(n) : f(n))
		return (v) => {
			if (typeof v === "number") return fmtNumber(v)
			// Categorical/ordinal scales hand us domain entries as strings even
			// when the underlying values are numeric (CSV imports, bin labels
			// like "1", "2", "3"). Coerce so users can apply `$,.2f` etc. to
			// numeric-looking ordinal bins.
			if (typeof v === "string" && v.trim() !== "") {
				const n = Number(v)
				if (Number.isFinite(n)) return fmtNumber(n)
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

export type ValueFormatter = (v: unknown) => string

/** A stored format string, split into the spec proper and the literal text
 * wrapped around every formatted value. */
export type FormatSpecParts = {
	/** Text printed before each value — "$", "~", "+". Kept verbatim. */
	prefix: string
	/** The format spec itself: "" = Auto, `literal`, a d3-format /
	 * d3-time-format spec, or a label-only sentinel like `country-name`. */
	spec: string
	/** Text printed after each value — "%", " units" (leading space and
	 * all). Kept verbatim. */
	suffix: string
}

/**
 * Split the Format box's text into spec + affixes. The text is what the
 * user typed, read with these rules, first match wins:
 *
 * 1. `prefix{spec}suffix` — the explicit form: text before the first `{`
 *    is the prefix, text after the last `}` the suffix, the spec sits
 *    between (may be empty: `{}%` wraps the Auto labels). Neither d3
 *    grammar uses braces, so nothing is misread.
 * 2. A d3-time-format spec (`%Y years`) is used whole — that grammar
 *    already prints its own literal text.
 * 3. The word `literal` anywhere: text before it is the prefix, text after
 *    it the suffix — `literal%` → "3%", `literal units` → "3 units",
 *    `€literal` → "€3".
 * 4. Otherwise the text up to the first whitespace is the spec and the
 *    rest is the suffix — `,.0f kg` → "1,234 kg". (d3-format specs never
 *    contain whitespace.)
 * 5. Anything else is a bare spec with no affixes — every preset value and
 *    every format stored before this grammar existed parses unchanged.
 *
 * Leading whitespace before the spec is ignored; affix text is otherwise
 * kept verbatim — the space in `literal units` is how "3 units" gets its
 * gap, and `literal%` has none.
 */
export const parseFormatSpec = (raw: string): FormatSpecParts => {
	const open = raw.indexOf("{")
	const close = raw.lastIndexOf("}")
	if (open !== -1 && close > open) {
		return {
			prefix: raw.slice(0, open),
			spec: raw.slice(open + 1, close),
			suffix: raw.slice(close + 1),
		}
	}
	const text = raw.trimStart()
	if (isTimeFormatSpec(text)) return { prefix: "", spec: text, suffix: "" }
	const lit = text.toLowerCase().indexOf(LITERAL_FORMAT)
	if (lit !== -1) {
		return {
			prefix: text.slice(0, lit),
			spec: LITERAL_FORMAT,
			suffix: text.slice(lit + LITERAL_FORMAT.length),
		}
	}
	const ws = text.search(/\s/)
	if (ws !== -1) return { prefix: "", spec: text.slice(0, ws), suffix: text.slice(ws) }
	return { prefix: "", spec: text, suffix: "" }
}

/** Build a stored format string from parts, using the explicit braced form
 * whenever an affix is set (so it re-parses by rule 1 regardless of what
 * the spec or affixes contain). With no affixes the spec is stored bare,
 * so Auto stays "" and presets stay their verbatim d3 strings. Used where
 * code — not the user — writes a format (the dollar / percent hints). */
export const composeFormatSpec = ({ prefix, spec, suffix }: FormatSpecParts): string =>
	prefix === "" && suffix === "" ? spec : `${prefix}{${spec}}${suffix}`

/** Wrap one formatted value in the affixes. Empty text stays empty, so a
 * missing value never renders as a bare "%" or " units". */
export const applyFormatAffixes = (parts: FormatSpecParts, text: string): string =>
	text === "" ? "" : `${parts.prefix}${text}${parts.suffix}`

/** Spec-only formatter for the INNER spec (affixes already stripped):
 * null for Auto, else literal / time / numeric routing. */
const innerFormatter = (spec: string): ValueFormatter | null => {
	const trimmed = spec.trim()
	if (trimmed === "") return null
	// Literal: stringify as-is, bypassing both formatters. Must come before the
	// time/numeric routing so a numeric axis can opt out of any coercion.
	if (trimmed.toLowerCase() === LITERAL_FORMAT) return (v) => String(v ?? "")
	return isTimeFormatSpec(trimmed) ? safeTimeFormat(trimmed) : safeFormat(trimmed)
}

const literalFormatter: ValueFormatter = (v) => String(v ?? "")

/**
 * Build a tick formatter for the given axis config + field type.
 *
 * Returns `null` when the stored format is fully Auto — no spec AND no
 * affixes — and no `fallback` was given; the caller then uses the scale's
 * default tick format. Pass the caller's own automatic formatter as
 * `fallback` and the result is always a function: the fallback itself when
 * nothing is set, and the fallback WRAPPED in the affixes for an
 * affixes-only format like `{}%` (Auto ticks 0 / 5 / 10 → "0%", "5%",
 * "10%"). Without a fallback an affixes-only format wraps the literal value.
 *
 * The spec itself decides whether to use d3-format or d3-time-format, so
 * picking a temporal preset on a quantitative axis (or vice versa) still
 * produces sensible labels as long as values are coercible.
 */
export function buildTickFormatter(
	config: Pick<AxisConfig, "customFormat">,
	type: FieldType,
	fallback: ValueFormatter
): ValueFormatter
export function buildTickFormatter(
	config: Pick<AxisConfig, "customFormat">,
	type: FieldType,
	fallback?: ValueFormatter
): ValueFormatter | null
export function buildTickFormatter(
	// Only the format spec is consulted — `Pick` so non-axis callers (the
	// chord ring axis, data labels, legends) can pass a bare `{ customFormat }`.
	config: Pick<AxisConfig, "customFormat">,
	_type: FieldType,
	fallback?: ValueFormatter
): ValueFormatter | null {
	const parts = parseFormatSpec(config.customFormat)
	const inner = innerFormatter(parts.spec)
	const affixed = parts.prefix !== "" || parts.suffix !== ""
	if (!inner && !affixed) return fallback ?? null
	const base = inner ?? fallback ?? literalFormatter
	if (!affixed) return base
	return (v) => applyFormatAffixes(parts, base(v))
}

/**
 * Variant for callers whose automatic text is only known per value — the
 * histogram binner picks an edge's precision from the bin width it has just
 * computed. The returned formatter takes the value AND the caller's
 * automatic rendering of it, and uses the latter only while the spec is
 * Auto. `null` when the stored format is fully Auto (nothing to apply).
 */
export const buildTickFormatterWithAuto = (
	config: Pick<AxisConfig, "customFormat">
): ((v: unknown, auto: string) => string) | null => {
	const parts = parseFormatSpec(config.customFormat)
	const inner = innerFormatter(parts.spec)
	const affixed = parts.prefix !== "" || parts.suffix !== ""
	if (!inner && !affixed) return null
	return (v, auto) => applyFormatAffixes(parts, inner ? inner(v) : auto)
}
