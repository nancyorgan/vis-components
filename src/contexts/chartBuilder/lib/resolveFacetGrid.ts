/** Compute an effective rows × cols grid given the total number of facets
 * and user-configured values (either of which may be null = auto).
 *
 * When the user pins one dimension we use `Math.ceil` for the other so an
 * uneven count (7 facets in 2 rows) wraps into a partially-empty row
 * rather than dropping panels.
 *
 * When both dimensions are auto, we pick a square-ish grid via
 * `cols = ceil(sqrt(n))`. That keeps panels reasonably sized as N grows
 * instead of stretching them across one ever-thinner row. */
export const resolveFacetGrid = (
	n: number,
	rows: number | null,
	cols: number | null
): { rows: number; cols: number } => {
	if (n <= 0) return { rows: 1, cols: 1 }
	if (rows != null && cols != null) {
		const r = Math.max(1, Math.min(rows, n))
		const c = Math.max(1, Math.min(cols, n))
		return { rows: r, cols: c }
	}
	if (rows != null) {
		const r = Math.max(1, Math.min(rows, n))
		return { rows: r, cols: Math.max(1, Math.ceil(n / r)) }
	}
	if (cols != null) {
		const c = Math.max(1, Math.min(cols, n))
		return { rows: Math.max(1, Math.ceil(n / c)), cols: c }
	}
	// Both auto — square-ish grid that wraps cleanly for any N.
	const c = Math.max(1, Math.ceil(Math.sqrt(n)))
	const r = Math.max(1, Math.ceil(n / c))
	return { rows: r, cols: c }
}

/** Partition rows by the cross-product of two categorical fields. Returns:
 *  - `rowValues`: unique row-axis values in dataset-encounter order
 *  - `colValues`: unique col-axis values in dataset-encounter order
 *  - `cellRows`: map from `${row}|${col}` keys to the rows matching that
 *    intersection. Cells with no data are present in the map with an
 *    empty array (caller can rely on every combination being a key).
 *
 *  Rows with null/undefined values in either field are skipped — they
 *  can't be assigned to any (row, col) cell. Non-string values are
 *  coerced via String() so the keys are uniformly comparable.
 *
 *  Used by the grid-mode facet renderer: when both `facetRow` and
 *  `facetCol` channels are mapped, the panel grid is the data-determined
 *  cross product of these two dimensions. */
export const resolveCrossProduct = (
	rows: ReadonlyArray<Record<string, unknown>>,
	rowField: string,
	colField: string
): {
	rowValues: string[]
	colValues: string[]
	cellRows: Map<string, Array<Record<string, unknown>>>
} => {
	const rowSet = new Set<string>()
	const colSet = new Set<string>()
	for (const row of rows) {
		const rv = row[rowField]
		const cv = row[colField]
		if (rv != null) rowSet.add(String(rv))
		if (cv != null) colSet.add(String(cv))
	}
	const rowValues = [...rowSet]
	const colValues = [...colSet]
	const cellRows = new Map<string, Array<Record<string, unknown>>>()
	for (const r of rowValues)
		for (const c of colValues) cellRows.set(`${r}|${c}`, [])
	for (const row of rows) {
		const rv = row[rowField]
		const cv = row[colField]
		if (rv == null || cv == null) continue
		cellRows.get(`${String(rv)}|${String(cv)}`)?.push(row)
	}
	return { rowValues, colValues, cellRows }
}
