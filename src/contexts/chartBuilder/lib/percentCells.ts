import type { DatasetView, FieldType } from "./types"

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
 * in every column the user has overridden to quantitative in the Fields
 * panel. Applied to the dataset VIEW at read time (chained after the
 * wide→long reshape) — the stored dataset keeps its original cells, so
 * clearing the override restores the percent strings instantly.
 *
 * Only override-driven: a column containing "%" always infers categorical,
 * so inferred-quantitative columns never need converting. Non-percent cells
 * in a converted column pass through untouched. Pass-through (same object)
 * when nothing converts, so the view keeps a stable identity. */
export const applyPercentConversionToView = (
	view: DatasetView | undefined,
	overrides: Record<string, FieldType>
): DatasetView | undefined => {
	if (!view) return undefined
	const convertFields = view.fields
		.map((f) => f.name)
		.filter(
			(name) =>
				overrides[name] === "quantitative" &&
				view.rows.some((r) => parsePercentCell(r[name]) !== null)
		)
	if (convertFields.length === 0) return view
	const rows = view.rows.map((row) => {
		let out = row
		for (const name of convertFields) {
			const n = parsePercentCell(row[name])
			if (n === null) continue
			if (out === row) out = { ...row }
			out[name] = String(n)
		}
		return out
	})
	return { ...view, rows }
}
