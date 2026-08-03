import type { TextColorRule } from "./channelConfig"

type Op = ">" | "<" | ">=" | "<=" | "==" | "!="

/** Pick out the first comparison operator that begins the trimmed condition.
 *  Longer operators (`>=`, `<=`, `==`, `!=`) take precedence over their
 *  single-character prefixes so `>=` doesn't parse as `>`. */
const matchOp = (s: string): { op: Op; rest: string } | null => {
	const two = s.slice(0, 2)
	if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
		return { op: two as Op, rest: s.slice(2) }
	}
	const one = s[0]
	if (one === ">" || one === "<") {
		return { op: one as Op, rest: s.slice(1) }
	}
	return null
}

/** Strip a single pair of matching surrounding quotes, so `=="A"` and `==A`
 *  both compare against the bare value `A`. */
const unquote = (s: string): string => {
	if (s.length >= 2) {
		const first = s[0]
		const last = s[s.length - 1]
		if ((first === '"' || first === "'") && first === last)
			return s.slice(1, -1)
	}
	return s
}

/** Parse a freeform condition string into an `(op, operand)` pair. The operand
 *  keeps both a numeric reading (`num`, `null` when non-numeric) and the raw
 *  string form (`text`, with surrounding quotes stripped) so callers can do
 *  either a numeric comparison or a categorical string match. Returns `null`
 *  when the input doesn't match — unparseable rules just don't fire.
 *
 *  Examples: `">0"` → {op:">", num:0}, `=="A"` → {op:"==", num:null, text:"A"}. */
export const parseRule = (
	condition: string
): { op: Op; num: number | null; text: string } | null => {
	const trimmed = condition.trim()
	if (trimmed === "") return null
	const m = matchOp(trimmed)
	if (!m) return null
	const rest = m.rest.trim()
	// Reject "> " on its own — an unfinished rule should never silently match.
	if (rest === "") return null
	const text = unquote(rest)
	const num = Number(text)
	return { op: m.op, num: Number.isFinite(num) ? num : null, text }
}

/** Walk `rules` top-to-bottom; first one whose comparison passes for `value`
 *  wins. Ordering operators (`>`, `<`, `>=`, `<=`) are numeric-only. Equality
 *  operators (`==`, `!=`) compare numerically when both sides are numbers, and
 *  otherwise fall back to a categorical string match — so a rule like `=="A"`
 *  fires for a categorical value `A`. Returns `null` for nullish / empty values
 *  (e.g. heatmap blank cells) so they never trigger a rule. */
export const resolveRuleColor = (
	rules: readonly TextColorRule[] | undefined,
	value: unknown
): string | null => {
	if (!rules || rules.length === 0) return null
	let text: string
	let num: number | null
	if (typeof value === "number") {
		num = Number.isFinite(value) ? value : null
		text = String(value)
	} else if (typeof value === "string" && value.trim() !== "") {
		text = value.trim()
		const parsed = Number(text)
		num = Number.isFinite(parsed) ? parsed : null
	} else {
		return null
	}
	for (const rule of rules) {
		const parsed = parseRule(rule.condition)
		if (!parsed) continue
		const { op } = parsed
		let passes = false
		if (op === "==" || op === "!=") {
			// Numeric equality when both sides read as numbers; else string match.
			const equal =
				num !== null && parsed.num !== null ? num === parsed.num : text === parsed.text
			passes = op === "==" ? equal : !equal
		} else if (num !== null && parsed.num !== null) {
			// Ordering comparisons are numeric-only.
			passes =
				op === ">"
					? num > parsed.num
					: op === "<"
						? num < parsed.num
						: op === ">="
							? num >= parsed.num
							: num <= parsed.num
		}
		if (passes) return rule.color
	}
	return null
}
