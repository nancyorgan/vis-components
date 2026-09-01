import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { effectiveDerivedName } from "../../lib/derivedVariables"
import { compareByType } from "../../lib/drawOrder"
import type { Field, FieldType } from "../../lib/types"
import {
	currentDerivedVariablesAtom,
	derivedVariableEditorAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

const MAX_ROWS_RENDERED = 500
const MIN_COL_WIDTH = 40
const MAX_COL_WIDTH = 800

type SortState = { field: string; dir: "asc" | "desc" } | null

// The column comparator lives in lib/drawOrder.ts now — shared with the
// Aesthetics "Draw order" mark sort so both rank values identically.
// Re-exported so the existing unit-test import path keeps working.
export { compareByType }

/** True when every non-empty cell in the column has the exact same character
 * length (e.g. state abbreviations "CA", "NY", "TX"). Used to decide whether
 * to center-align categorical columns — centered text reads cleaner when
 * every row is the same width. */
export const isUniformLength = (
	rows: ReadonlyArray<Record<string, string>>,
	fieldName: string
): boolean => {
	const lens = new Set<number>()
	for (const r of rows) {
		const v = r[fieldName]
		if (v == null || v === "") continue
		lens.add(String(v).length)
		if (lens.size > 1) return false
	}
	return lens.size === 1
}

/** Classify a column for rendering. `numericish` columns get
 * right-alignment + a monospaced font + tabular-nums so digits visually stack
 * on the decimal point. `uniform` centers same-width categorical values.
 * Everything else is left-aligned. */
type ColumnAlignment = "numericish" | "uniform" | "default"

const classifyColumn = (
	rows: ReadonlyArray<Record<string, string>>,
	fieldName: string,
	fieldType: FieldType
): ColumnAlignment => {
	if (fieldType === "quantitative" || fieldType === "temporal") {
		return "numericish"
	}
	if (isUniformLength(rows, fieldName)) return "uniform"
	return "default"
}

const alignmentClasses = (alignment: ColumnAlignment): string => {
	switch (alignment) {
		case "numericish": {
			return "text-right font-mono tabular-nums"
		}
		case "uniform": {
			return "text-center"
		}
		default: {
			return "text-left"
		}
	}
}

/** The text a cell shows. Dollar/comma columns are stored in the view as
 * plain numbers ("1234.56") so scales and formulas can read them; the tray
 * renders them back through the field's `displayCells` map so the column
 * still reads the way it was imported ("$1,234.56"). Cells that weren't
 * converted have no entry and show their stored value. */
const displayCell = (field: Field, value: string | undefined): string => {
	if (value == null) return ""
	const display = field.displayCells
	if (!display || !Object.hasOwn(display, value)) return value
	return display[value] ?? value
}

export const DataTable = () => {
	const dataset = useCurrentDatasetView()
	const setDerivedEditor = useSetAtom(derivedVariableEditorAtom)
	// View column name → derived-variable id, so the header ƒ marker can
	// reopen that variable in the editor popup.
	const derivedConfig = useAtomValue(currentDerivedVariablesAtom)
	const derivedIdByName = useMemo(
		() =>
			new Map(
				derivedConfig.variables.map((v, i) => [
					effectiveDerivedName(v, i),
					v.id,
				])
			),
		[derivedConfig]
	)
	const [sort, setSort] = useState<SortState>(null)
	// Per-column width overrides keyed by field name. Unset entries fall back
	// to the browser's auto-sizing (which honors `whitespace-nowrap` plus
	// padding). State only — not persisted; the data tray is preview UI.
	const [colWidths, setColWidths] = useState<Record<string, number>>({})
	// Drag state for the resize handles. Tracked in a ref so the move handler
	// can read it without re-binding listeners on every render.
	const dragRef = useRef<{
		field: string
		startX: number
		startWidth: number
	} | null>(null)

	useEffect(() => {
		const onMove = (e: PointerEvent) => {
			const drag = dragRef.current
			if (!drag) return
			const delta = e.clientX - drag.startX
			const next = Math.max(
				MIN_COL_WIDTH,
				Math.min(MAX_COL_WIDTH, drag.startWidth + delta)
			)
			setColWidths((prev) => ({ ...prev, [drag.field]: next }))
		}
		const onUp = () => {
			dragRef.current = null
			document.body.style.userSelect = ""
		}
		window.addEventListener("pointermove", onMove)
		window.addEventListener("pointerup", onUp)
		return () => {
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", onUp)
		}
	}, [])

	const startResize = useCallback(
		(field: string, startX: number, startWidth: number) => {
			dragRef.current = { field, startX, startWidth }
			// Suppress text selection while dragging so the cursor doesn't
			// highlight cells under the pointer.
			document.body.style.userSelect = "none"
		},
		[]
	)

	const rowsSource = useMemo(() => dataset?.rows ?? [], [dataset])

	const alignmentByField = useMemo<Map<string, ColumnAlignment>>(() => {
		const m = new Map<string, ColumnAlignment>()
		if (!dataset) return m
		for (const f of dataset.fields) {
			m.set(f.name, classifyColumn(rowsSource, f.name, f.inferredType))
		}
		return m
	}, [dataset, rowsSource])

	const sortedRows = useMemo(() => {
		if (!dataset || !sort) return rowsSource
		const field = dataset.fields.find((f) => f.name === sort.field)
		if (!field) return rowsSource
		const cmp = (a: Record<string, string>, b: Record<string, string>) =>
			compareByType(
				a[sort.field] ?? "",
				b[sort.field] ?? "",
				field.inferredType
			)
		const sorted = [...rowsSource].sort(cmp)
		return sort.dir === "desc" ? sorted.reverse() : sorted
	}, [rowsSource, sort, dataset])

	if (!dataset) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-sm text-stone-600 dark:text-stone-400">
				No data set loaded. Upload a CSV from the sidebar.
			</div>
		)
	}

	const rows = sortedRows.slice(0, MAX_ROWS_RENDERED)
	const truncated = sortedRows.length > MAX_ROWS_RENDERED

	// Click cycles: unsorted → asc → desc → unsorted.
	const onHeaderClick = (fieldName: string) => {
		setSort((prev) => {
			if (!prev || prev.field !== fieldName) {
				return { field: fieldName, dir: "asc" }
			}
			if (prev.dir === "asc") return { field: fieldName, dir: "desc" }
			return null
		})
	}

	return (
		<div className="min-w-full">
			<table
				className="min-w-full text-left text-sm"
				style={{ tableLayout: "auto" }}
			>
				<thead className="sticky top-0 z-[1] bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
					<tr>
						{dataset.fields.map((f) => {
							const alignment = alignmentByField.get(f.name) ?? "default"
							const isActive = sort?.field === f.name
							const width = colWidths[f.name]
							return (
								<th
									key={f.name}
									scope="col"
									style={
										width
											? {
													width,
													minWidth: width,
													maxWidth: width,
													overflow: "hidden",
												}
											: { overflow: "hidden" }
									}
									className={`relative border-r border-b border-stone-200 px-3 py-2 font-medium whitespace-nowrap dark:border-stone-700 ${alignmentClasses(
										alignment
									)}`}
								>
									{/* `flex` lets the sort button shrink + clip the field name
									 * when the column is narrow, instead of leaking past the th's
									 * right edge into the neighboring header. The ƒ marker is its
									 * own SIBLING button (a button can't nest a button): clicking
									 * it reopens the derived-variable editor, clicking the name
									 * still sorts. */}
									<div className="flex w-full items-center gap-1 overflow-hidden">
										{f.derived && (
											<button
												type="button"
												onClick={() => {
													const id = derivedIdByName.get(f.name)
													if (id) setDerivedEditor({ mode: "edit", id })
												}}
												title={`Edit the derived variable ${f.name}`}
												aria-label={`Edit derived variable ${f.name}`}
												className="flex-shrink-0 font-serif text-xs italic text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
											>
												ƒ
											</button>
										)}
										<button
											type="button"
											onClick={() => onHeaderClick(f.name)}
											className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden hover:text-stone-900 dark:hover:text-white"
											title={f.name}
										>
											<span className="min-w-0 flex-1 truncate text-left">
												{f.name}
											</span>
											{isActive && (
												<span
													aria-hidden="true"
													className="flex-shrink-0 text-xs"
												>
													{sort?.dir === "asc" ? "▲" : "▼"}
												</span>
											)}
										</button>
									</div>
									{/* Resize handle — thin grab strip at the column's right edge.
									 *  pointerdown captures the starting position and width, then
									 *  the window-level pointermove from `useEffect` updates state. */}
									<span
										role="separator"
										aria-orientation="vertical"
										aria-label={`Resize ${f.name} column`}
										onPointerDown={(e) => {
											e.preventDefault()
											const th = (e.currentTarget as HTMLElement)
												.parentElement as HTMLElement | null
											const startWidth =
												width ?? th?.offsetWidth ?? MIN_COL_WIDTH
											startResize(f.name, e.clientX, startWidth)
										}}
										onDoubleClick={() => {
											// Double-click clears the override so the column auto-sizes
											// again. Quick way out of an over-shrunk column without
											// hunting for the right pixel.
											setColWidths((prev) => {
												const { [f.name]: _, ...rest } = prev
												return rest
											})
										}}
										className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize bg-transparent select-none hover:bg-blue-400/40"
									/>
								</th>
							)
						})}
						{/* The "+ new derived variable" column. Rendered AFTER the
						 * field map, so it always sits to the right of every column —
						 * including freshly created derived ones (they join
						 * `dataset.fields`), leaving the + in place for the next
						 * variable. Fixed-width and handle-less: it's a button cell,
						 * not a data column. */}
						<th
							scope="col"
							style={{ width: 32, minWidth: 32 }}
							className="border-b border-stone-200 px-0 py-2 text-center dark:border-stone-700"
						>
							<button
								type="button"
								onClick={() => setDerivedEditor({ mode: "new" })}
								title="New derived variable"
								aria-label="New derived variable"
								className="w-full text-base leading-none font-medium text-stone-500 hover:text-indigo-600 dark:text-stone-400 dark:hover:text-indigo-400"
							>
								+
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr
							// eslint-disable-next-line react/no-array-index-key -- rows are static snapshots of CSV
							key={i}
							className="odd:bg-white even:bg-stone-50 dark:odd:bg-stone-900 dark:even:bg-stone-900/50"
						>
							{dataset.fields.map((f) => {
								const alignment = alignmentByField.get(f.name) ?? "default"
								const width = colWidths[f.name]
								return (
									<td
										key={f.name}
										style={
											width
												? {
														width,
														minWidth: width,
														maxWidth: width,
														overflow: "hidden",
														textOverflow: "ellipsis",
													}
												: undefined
										}
										className={`border-r border-b border-stone-100 px-3 py-1.5 whitespace-nowrap text-stone-700 dark:border-stone-800 dark:text-stone-200 ${alignmentClasses(
											alignment
										)}`}
									>
										{displayCell(f, row[f.name])}
									</td>
								)
							})}
							{/* Filler cell under the "+" header so row borders and
							 * striping stay clean across the full table width. */}
							<td className="border-b border-stone-100 dark:border-stone-800" />
						</tr>
					))}
				</tbody>
			</table>
			{truncated && (
				<div className="border-t border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-900/50 dark:text-stone-400">
					Showing first {MAX_ROWS_RENDERED} of {sortedRows.length} rows.
				</div>
			)}
		</div>
	)
}
