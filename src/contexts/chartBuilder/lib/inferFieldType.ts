import type { FieldType } from "./types"

const SAMPLE_SIZE = 50

const isNumeric = (value: string): boolean => {
	if (value.trim() === "") return false
	const n = Number(value)
	return Number.isFinite(n)
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"

/** Recognized date shapes. A value must MATCH one of these before we trust
 * `new Date()` — otherwise JS's permissive parser would mis-read any string
 * with a number in it as a date (e.g. `new Date("MS-DRG 235")` → year 235,
 * `"Region 5"` → 2001, `"Sales 2023"` → 2023), tagging plain categories as
 * temporal. */
const DATE_PATTERNS: RegExp[] = [
	// ISO date / datetime: 2024-01, 2024-01-01, 2024-01-01T12:00:00(.123)?(Z|+hh:mm)
	/^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?\s*(z|[+-]\d{2}:?\d{2})?)?$/i,
	// Slash dates: Y/M/D or M/D/Y (2- or 4-digit components)
	/^\d{1,4}\/\d{1,2}\/\d{1,4}$/,
	// Month name + year, optional day: "Mar 2024", "March 1, 2024", "Jan 1 2024"
	new RegExp(`^(${MONTHS})[a-z]*\\.?(\\s+\\d{1,2},?)?\\s+\\d{4}$`, "i"),
	// Day + month name + year: "1 Mar 2024", "1 March 2024"
	new RegExp(`^\\d{1,2}\\s+(${MONTHS})[a-z]*\\.?\\s+\\d{4}$`, "i"),
]

const isTemporal = (value: string): boolean => {
	const v = value.trim()
	if (v === "") return false
	// Reject pure numbers — they'd otherwise parse as timestamps via Date.
	if (isNumeric(v)) return false
	// Require a recognized date shape before trusting Date parsing — JS's Date
	// string parser is far too permissive on arbitrary text.
	if (!DATE_PATTERNS.some((re) => re.test(v))) return false
	return !Number.isNaN(new Date(v).getTime())
}

export const inferFieldType = (values: string[]): FieldType => {
	const sample = values
		.filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
		.slice(0, SAMPLE_SIZE)

	if (sample.length === 0) return "categorical"

	if (sample.every(isTemporal)) return "temporal"
	if (sample.every(isNumeric)) return "quantitative"
	return "categorical"
}
