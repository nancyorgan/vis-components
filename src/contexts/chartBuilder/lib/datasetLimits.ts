/** Dataset upload size thresholds. The browser is the real constraint — a
 *  large dataset is slow to parse, render, and (in server mode) transfer —
 *  so the guard applies in local and server mode alike. The server enforces
 *  the hard limit independently (server/src/limits.ts; a test keeps the two
 *  in sync). */

export const DATASET_WARN_BYTES = 25 * 1024 * 1024
export const DATASET_REJECT_BYTES = 100 * 1024 * 1024

export type DatasetSizeIssue = "warn" | "reject" | null

export const datasetSizeIssue = (bytes: number): DatasetSizeIssue =>
	bytes > DATASET_REJECT_BYTES
		? "reject"
		: bytes > DATASET_WARN_BYTES
			? "warn"
			: null

const asMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

export const datasetRejectMessage = (bytes: number): string =>
	`This file is ${asMb(bytes)} — above the ${asMb(DATASET_REJECT_BYTES)} ` +
	`limit. Try reducing rows or columns, or splitting the data.`

export const datasetWarnMessage = (bytes: number): string =>
	`This file is ${asMb(bytes)}. Datasets over ${asMb(DATASET_WARN_BYTES)} ` +
	`can make charts slow to load and render in the browser.`

/** Charting-cost thresholds. Unlike the byte limits above, crossing one never
 *  blocks an upload and never changes the data — wanting every distinct value
 *  on an axis is legitimate, and silently binning or capping would misrepresent
 *  what the user handed us. The cost is real, though: the browser draws one
 *  mark per row and one band per distinct category, so a quantitative column
 *  with thousands of distinct values on a category axis can lock the main
 *  thread for seconds. Import is the earliest honest moment to say so — it is
 *  the point where pre-aggregating is still cheap, rather than a discovery made
 *  halfway through building a chart. */
export const DATASET_WARN_ROWS = 50_000
export const DATASET_WARN_DISTINCT_VALUES = 5_000

/** Above this row count the per-column scan is skipped: it would cost a full
 *  pass per column to tell the user something the row-count fact (which always
 *  fires by then) already covers. */
const DISTINCT_SCAN_ROW_CAP = 200_000

/** Whether `name` holds more than `limit` distinct non-blank values. Counts
 *  only up to the threshold — the caller needs the yes/no, and stopping early
 *  keeps memory bounded on a high-cardinality column. */
const exceedsDistinct = (
	rows: ReadonlyArray<Record<string, string>>,
	name: string,
	limit: number
): boolean => {
	const seen = new Set<string>()
	for (const row of rows) {
		const value = row[name]
		if (value === undefined || value === "") continue
		seen.add(value)
		if (seen.size > limit) return true
	}
	return false
}

const andList = (parts: string[]): string =>
	parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`

/** Advisory note for a parsed upload whose shape will make charting slow, or
 *  null when it looks fine. Purely informational — the caller shows it and
 *  imports the data either way. */
export const datasetPerformanceWarning = (
	fields: ReadonlyArray<{ name: string }>,
	rows: ReadonlyArray<Record<string, string>>
): string | null => {
	const facts: string[] = []
	if (rows.length > DATASET_WARN_ROWS) {
		facts.push(`${rows.length.toLocaleString()} rows`)
	}
	if (rows.length <= DISTINCT_SCAN_ROW_CAP) {
		const wide = fields.filter((f) =>
			exceedsDistinct(rows, f.name, DATASET_WARN_DISTINCT_VALUES)
		)
		const over = `over ${DATASET_WARN_DISTINCT_VALUES.toLocaleString()} distinct values`
		if (wide.length === 1) facts.push(`${over} in \`${wide[0].name}\``)
		else if (wide.length > 1) facts.push(`${over} in ${wide.length} columns`)
	}
	if (facts.length === 0) return null
	return (
		`This data set has ${andList(facts)}. Data sets of this size may be ` +
		`slow. Consider pre-aggregating data separately before importing.`
	)
}
