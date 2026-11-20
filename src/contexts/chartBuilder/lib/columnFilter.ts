/** Column filters: which rows a column keeps.
 *
 *  Set from the Edit dialog's column headers (`EditDataGrid`), saved as a
 *  data version that records them (`VersionTransform.filter`), and re-run
 *  over a fresh import when the chain is replayed (`lib/versionReplay.ts`)
 *  — a filter is a function of the data, like a reshape, not a patch on
 *  particular cells.
 *
 *  Two kinds, by the column's type:
 *  - categorical / ordinal → `values`: the categories taken OUT. Stored as
 *    exclusions, so a category that only turns up in a later import stays.
 *  - quantitative / temporal → `conditions`: comparisons joined by one AND
 *    or OR for the whole column. A condition with no usable value is
 *    ignored; a cell that isn't a number (or a date) fails every condition.
 *
 *  Pure. A filter carries everything it needs to run (`as` says how to read
 *  the cells), so it evaluates the same wherever the rows come from. */

import { parseDollarCell } from "./dollarCells"
import { parseLocalDate } from "./localDate"
import { parsePercentCell } from "./percentCells"
import type { FieldType } from "./channelNames"

export type FilterOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq"

export type FilterCondition = { op: FilterOp; value: string }

export type ColumnFilter =
	| { kind: "values"; excluded: string[] }
	| {
			kind: "conditions"
			/** How cells and condition values are read. */
			as: "number" | "date"
			/** What joins the conditions — one choice for the column. */
			join: "and" | "or"
			conditions: FilterCondition[]
	  }

/** A filter bound to the column it reads, by the field's current name. */
export type FieldFilter = { field: string; filter: ColumnFilter }

/** The stand-in "filename" of a version a filter made — what the version
 *  list shows where an upload would show its file name. */
export const FILTERED_DATA_FILENAME = "Filtered data"
/** Same, for the version made by taking a filtered version's filters off
 *  again: the full rows it was filtered from. */
export const UNFILTERED_DATA_FILENAME = "Unfiltered data"

/** The comparisons, shown as their symbols (numbers and dates alike);
 *  `name` is the symbol in words, for screen readers. */
export const FILTER_OPS: ReadonlyArray<{
	op: FilterOp
	label: string
	name: string
}> = [
	{ op: "gt", label: ">", name: "greater than" },
	{ op: "gte", label: "≥", name: "greater than or equal to" },
	{ op: "lt", label: "<", name: "less than" },
	{ op: "lte", label: "≤", name: "less than or equal to" },
	{ op: "eq", label: "=", name: "equal to" },
	{ op: "neq", label: "≠", name: "not equal to" },
]

/** The filter a column of this type starts with: nothing filtered. */
export const emptyFilterFor = (type: FieldType): ColumnFilter =>
	type === "quantitative"
		? { kind: "conditions", as: "number", join: "and", conditions: [{ op: "gt", value: "" }] }
		: type === "temporal"
			? { kind: "conditions", as: "date", join: "and", conditions: [{ op: "gt", value: "" }] }
			: { kind: "values", excluded: [] }

/** A cell (or a typed condition value) as a number, in any spelling a
 *  column can hold: "1234.5", "$1,234.50", "(1,234)", "14%" (→ 0.14). */
export const parseFilterNumber = (raw: string): number | null => {
	const s = raw.trim()
	if (s === "") return null
	const pct = parsePercentCell(s)
	if (pct !== null) return pct
	const formatted = parseDollarCell(s)
	if (formatted) return formatted.value
	const n = Number(s)
	return Number.isFinite(n) ? n : null
}

/** A cell (or condition value) as a calendar DAY — local midnight — so
 *  "on 2024-03-05" matches a cell stamped later that day. */
export const parseFilterDate = (raw: string): number | null => {
	const s = raw.trim()
	if (s === "") return null
	const ms = parseLocalDate(s)
	if (!Number.isFinite(ms)) return null
	const d = new Date(ms)
	d.setHours(0, 0, 0, 0)
	return d.getTime()
}

const readerFor = (as: "number" | "date") =>
	as === "number" ? parseFilterNumber : parseFilterDate

const compare = (op: FilterOp, cell: number, value: number): boolean => {
	switch (op) {
		case "gt":
			return cell > value
		case "gte":
			return cell >= value
		case "lt":
			return cell < value
		case "lte":
			return cell <= value
		case "eq":
			return cell === value
		case "neq":
			return cell !== value
	}
}

/** The conditions that have a value to compare against. */
const usableConditions = (
	filter: Extract<ColumnFilter, { kind: "conditions" }>
): Array<{ op: FilterOp; value: number }> => {
	const read = readerFor(filter.as)
	return filter.conditions.flatMap((c) => {
		const value = read(c.value)
		return value === null ? [] : [{ op: c.op, value }]
	})
}

/** Whether the filter can take any row out: a category is deselected, or
 *  a condition has a value. This is what colors the header's icon. */
export const isFilterActive = (filter: ColumnFilter | undefined | null): boolean => {
	if (!filter) return false
	if (filter.kind === "values") return filter.excluded.length > 0
	return usableConditions(filter).length > 0
}

/** The filter as a test over one cell's text. */
export const compileFilter = (filter: ColumnFilter): ((cell: string) => boolean) => {
	if (filter.kind === "values") {
		if (filter.excluded.length === 0) return () => true
		const excluded = new Set(filter.excluded)
		return (cell) => !excluded.has(cell)
	}
	const conditions = usableConditions(filter)
	if (conditions.length === 0) return () => true
	const read = readerFor(filter.as)
	const any = filter.join === "or"
	return (cell) => {
		const n = read(cell)
		if (n === null) return false
		return any
			? conditions.some((c) => compare(c.op, n, c.value))
			: conditions.every((c) => compare(c.op, n, c.value))
	}
}

/** The filter with what does nothing dropped — conditions without a usable
 *  value, repeated exclusions — or null when nothing is left. What is
 *  stored on the grid and recorded on a version. */
export const normalizeFilter = (filter: ColumnFilter): ColumnFilter | null => {
	if (filter.kind === "values") {
		const excluded = [...new Set(filter.excluded)]
		return excluded.length > 0 ? { kind: "values", excluded } : null
	}
	const read = readerFor(filter.as)
	const conditions = filter.conditions.filter((c) => read(c.value) !== null)
	return conditions.length > 0 ? { ...filter, conditions } : null
}

export const sameFilter = (
	a: ColumnFilter | null | undefined,
	b: ColumnFilter | null | undefined
): boolean => {
	if (!a || !b) return !a && !b
	if (a.kind === "values")
		return (
			b.kind === "values" &&
			a.excluded.length === b.excluded.length &&
			a.excluded.every((v, i) => v === b.excluded[i])
		)
	return (
		b.kind === "conditions" &&
		a.as === b.as &&
		a.join === b.join &&
		a.conditions.length === b.conditions.length &&
		a.conditions.every(
			(c, i) => c.op === b.conditions[i]?.op && c.value === b.conditions[i]?.value
		)
	)
}

/** At most this many removed categories are named; the rest are counted. */
const DESCRIBE_VALUES_LIMIT = 8

/** One column's filter in words, for the version list and the exported
 *  list of changes: "“Region” without South, West" or
 *  "“Sales” ≥ $3,000 AND < $5,000". */
export const describeFieldFilter = ({ field, filter }: FieldFilter): string => {
	const name = `“${field}”`
	if (filter.kind === "values") {
		const shown = filter.excluded
			.slice(0, DESCRIBE_VALUES_LIMIT)
			.map((v) => (v === "" ? "(blank)" : v))
		const more = filter.excluded.length - shown.length
		return `${name} without ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`
	}
	const symbol = new Map(FILTER_OPS.map((o) => [o.op, o.label]))
	const parts = filter.conditions.map((c) => `${symbol.get(c.op) ?? c.op} ${c.value}`)
	return `${name} ${parts.join(filter.join === "or" ? " OR " : " AND ")}`
}

export const sameFieldFilters = (
	a: readonly FieldFilter[],
	b: readonly FieldFilter[]
): boolean =>
	a.length === b.length &&
	a.every((f, i) => f.field === b[i]?.field && sameFilter(f.filter, b[i]?.filter))

/** The rows every filter keeps. Same reference when no filter can take a
 *  row out. A filter on a column the rows don't have keeps nothing a
 *  condition could pass — callers check the columns first. */
export const filterRows = <R extends Record<string, string>>(
	rows: R[],
	filters: readonly FieldFilter[]
): R[] => {
	const tests = filters
		.filter((f) => isFilterActive(f.filter))
		.map((f) => ({ field: f.field, test: compileFilter(f.filter) }))
	if (tests.length === 0) return rows
	return rows.filter((row) => tests.every((t) => t.test(row[t.field] ?? "")))
}

/** The filters after a field rename. Same reference when none reads it. */
export const renameFieldInFilters = (
	filters: FieldFilter[],
	oldName: string,
	newName: string
): FieldFilter[] =>
	filters.some((f) => f.field === oldName)
		? filters.map((f) => (f.field === oldName ? { ...f, field: newName } : f))
		: filters
