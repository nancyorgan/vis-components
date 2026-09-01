import type { DatasetView, FieldType } from "./types"

/** A successfully parsed dollar/comma-formatted cell. `dollar` records
 * whether the cell carried a "$" — that's what drives the default dollar
 * FORMATTING downstream, while comma-only cells ("1,234") just convert. */
export type FormattedNumericCell = { value: number; dollar: boolean }

/** The bare numeric part of a formatted cell: either strictly-grouped
 * thousands ("1,234", "1,234,567.89") or an ungrouped number ("1234",
 * "1234.56", ".5"). Strict 3-digit grouping is what keeps "1,23" (a
 * European decimal comma) and "12,34,56" out. */
const NUM_RE = /^(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)$/

/** Parse a dollar- or comma-formatted cell ("$1,234.56", "-$1,234",
 * "$ 5", "($1,234)", "1,234") to its numeric value. Returns null for
 * anything else — including PLAIN numbers ("1234.5"), so callers can use
 * null to mean "not currency/comma formatted" rather than "not numeric".
 * A cell must carry a "$" or proper comma grouping to qualify. */
export const parseDollarCell = (raw: unknown): FormattedNumericCell | null => {
	if (typeof raw !== "string") return null
	let s = raw.trim()
	if (s === "") return null
	// Cheap gate before any regex work: formatted cells always carry a "$"
	// or a comma. This keeps the per-cell cost trivial on the plain numeric
	// columns the view conversion scans.
	if (!s.includes("$") && !s.includes(",")) return null
	// Accounting negative: "($1,234.56)" / "(1,234)".
	let parenNegative = false
	if (s.startsWith("(") && s.endsWith(")")) {
		parenNegative = true
		s = s.slice(1, -1).trim()
	}
	// Sign may sit before or after the "$" ("-$5" / "$-5"), never both, and
	// never combined with accounting parens.
	const m = /^([+-]?)\s*(\$?)\s*([+-]?)([\d.,][\d.,\s]*)$/.exec(s)
	if (!m) return null
	const [, signBefore, dollarSym, signAfter, numPart] = m
	if (signBefore !== "" && signAfter !== "") return null
	if (parenNegative && (signBefore !== "" || signAfter !== "")) return null
	const numeric = numPart.trim()
	if (!NUM_RE.test(numeric)) return null
	// Plain ungrouped number with no "$" — not a formatted cell.
	if (dollarSym === "" && !numeric.includes(",")) return null
	const n = Number(numeric.replace(/,/g, ""))
	if (!Number.isFinite(n)) return null
	const negative = parenNegative || signBefore === "-" || signAfter === "-"
	return { value: negative ? -n : n, dollar: dollarSym === "$" }
}

/** Convert dollar/comma-formatted cells ("$1,234.56") to plain numeric
 * strings ("1234.56") in every column that is EFFECTIVELY quantitative —
 * inferred quantitative (dollar columns infer that way, see
 * `inferFieldType`) or overridden to quantitative in the Fields panel.
 * Applied to the dataset VIEW at read time, chained after the percent-cell
 * conversion — the stored dataset keeps its original cells, so overriding
 * the field back to categorical restores the "$1,234.56" labels instantly.
 *
 * Columns where any converted cell carried a "$" get `formatHint: "dollar"`
 * on the VIEW's field entry — that's the cue for the render-side dollar
 * format defaults (see `dollarFormatDefaults.ts`). The hint lives only on
 * the derived view; stored dataset fields never carry it.
 *
 * Non-formatted cells in a converted column pass through untouched.
 * Pass-through (same object) when nothing converts, so the view keeps a
 * stable identity. */
export const applyDollarConversionToView = (
	view: DatasetView | undefined,
	overrides: Record<string, FieldType>,
): DatasetView | undefined => {
	if (!view) return undefined
	// name -> whether the column carried a "$" cell (drives the format hint)
	const convert = new Map<string, boolean>()
	for (const f of view.fields) {
		if ((overrides[f.name] ?? f.inferredType) !== "quantitative") continue
		let sawFormatted = false
		let sawDollar = false
		for (const row of view.rows) {
			const cell = parseDollarCell(row[f.name])
			if (!cell) continue
			sawFormatted = true
			if (cell.dollar) {
				sawDollar = true
				break // dollar found — hint decided, stop scanning
			}
		}
		if (sawFormatted) convert.set(f.name, sawDollar)
	}
	if (convert.size === 0) return view
	const rows = view.rows.map((row) => {
		let out = row
		for (const name of convert.keys()) {
			const cell = parseDollarCell(row[name])
			if (!cell) continue
			if (out === row) out = { ...row }
			out[name] = String(cell.value)
		}
		return out
	})
	const fields = view.fields.map((f) =>
		convert.get(f.name) ? { ...f, formatHint: "dollar" as const } : f,
	)
	return { ...view, fields, rows }
}
