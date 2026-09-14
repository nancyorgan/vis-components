import type { DatasetView, Field, FieldType } from "./types"

/** Parse a percent-formatted cell ("14%", "-2.5 %", "1e2%") to its numeric
 * fraction (0.14, -0.025, 1). Returns null for anything that isn't a finite
 * number followed by a percent sign — including bare numbers, so callers can
 * use null to mean "not percent-formatted" rather than "not numeric". */
export const parsePercentCell = (raw: unknown): number | null => {
	if (typeof raw !== "string") return null
	const s = raw.trim()
	if (!s.endsWith("%")) return null
	const numeric = s.slice(0, -1).trim()
	if (numeric === "") return null
	const n = Number(numeric)
	if (!Number.isFinite(n)) return null
	// toPrecision(15) scrubs the float noise from `/ 100`
	// (14.55 / 100 === 0.14550000000000002) without losing real digits.
	return Number((n / 100).toPrecision(15))
}

/** Convert percent-formatted cells ("14%") to their numeric fraction ("0.14")
 * in every column that is EFFECTIVELY quantitative — inferred quantitative
 * (percent columns infer that way, see `inferFieldType`) or overridden to
 * quantitative in the Fields panel. Applied to the dataset VIEW at read time
 * (chained after the wide→long reshape, before the dollar conversion) — the
 * stored dataset keeps its original cells, so overriding the field back to
 * categorical restores the "14%" labels instantly.
 *
 * Converted columns get `formatHint: "percent"` on the VIEW's field entry —
 * the cue for the render-side percent format defaults (see
 * `formatHintDefaults.ts`) — and `displayCells` (converted value -> original
 * cell text) so the data tray can show the column exactly as imported. Both
 * live only on the derived view; stored dataset fields never carry them.
 *
 * Non-percent cells in a converted column pass through untouched.
 * Pass-through (same object) when nothing converts, so the view keeps a
 * stable identity. */
export const applyPercentConversionToView = (
	view: DatasetView | undefined,
	overrides: Record<string, FieldType>
): DatasetView | undefined => {
	if (!view) return undefined
	const convertFields = view.fields
		.filter(
			(f) =>
				(overrides[f.name] ?? f.inferredType) === "quantitative" &&
				view.rows.some((r) => parsePercentCell(r[f.name]) !== null)
		)
		.map((f) => f.name)
	if (convertFields.length === 0) return view
	// Converted numeric string -> original cell text, per column (see the
	// matching note in `applyDollarConversionToView`: keyed by VALUE so it
	// survives sorting and later view stages; first spelling wins).
	const displays = new Map<string, Map<string, string>>()
	const rows = view.rows.map((row) => {
		let out = row
		for (const name of convertFields) {
			const raw = row[name]
			const n = parsePercentCell(raw)
			if (n === null) continue
			if (out === row) out = { ...row }
			const text = String(n)
			out[name] = text
			let column = displays.get(name)
			if (!column) {
				column = new Map<string, string>()
				displays.set(name, column)
			}
			if (!column.has(text)) column.set(text, String(raw).trim())
		}
		return out
	})
	const converted = new Set(convertFields)
	const fields = view.fields.map((f) => {
		if (!converted.has(f.name)) return f
		const next: Field = { ...f, formatHint: "percent" }
		const column = displays.get(f.name)
		// A plain record, not the Map: `Field` stays JSON-shaped (it shares a
		// type with the stored, hashed dataset fields).
		if (column) next.displayCells = Object.fromEntries(column)
		return next
	})
	return { ...view, fields, rows }
}
