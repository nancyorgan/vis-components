import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { combine as c } from "../../../../lib/cls"
import {
	addColumn,
	addRow,
	applySort,
	clearRect,
	columnWidths,
	deleteColumns,
	deleteRows,
	freshColumnName,
	inRect,
	makeChangedLookup,
	nextSort,
	normalizeRange,
	parseClipboardBlock,
	pasteBlock,
	rectToTsv,
	setCell,
	type CellRange,
	type CellRef,
	type Grid,
} from "../../lib/editGrid"

/** The Edit dialog's table of cells. Spreadsheet manners, deliberately the
 *  plain ones: click a cell to select it, drag (or Shift+click, or
 *  Shift+arrows) for a range, click a row number or a column name for the
 *  whole row or column; double-click, Enter or just typing edits the cell;
 *  ⌘C / ⌘X / ⌘V move tab-separated blocks to and from the clipboard, so a
 *  block pastes straight in from a spreadsheet; Delete blanks the
 *  selection; ⌘Z / ⇧⌘Z undo and redo. A column's sort control reorders
 *  what is SHOWN only (`lib/editGrid.ts`). Column names are not edited
 *  here — a variable is renamed in the Fields panel — so a new column
 *  keeps its "Column N" name until then. Rows render through a window
 *  (`ROW_HEIGHT` each) so a large data set opens instantly.
 *
 *  Keyboard events land on a visually hidden textarea (`proxy`) that holds
 *  focus whenever cells are selected and none is being edited: that is
 *  what makes the browser's native copy / cut / paste events fire for the
 *  selection without a text selection on the page. */

export const ROW_HEIGHT = 28
const HEADER_HEIGHT = 32
const GUTTER_WIDTH = 48
/** The "+" column past the last header, which adds a column. */
const ADD_WIDTH = 32
/** Room for the delete menu so it never opens off the right edge. */
const MENU_WIDTH = 176
const OVERSCAN = 12

/** A plain undo stack over whole grids. Every change the grid commits is one
 *  undo step (one cell, one paste, one sort). */
export const useGridHistory = (seed: Grid) => {
	const [state, setState] = useState<{ grid: Grid; past: Grid[]; future: Grid[] }>(
		() => ({ grid: seed, past: [], future: [] })
	)
	const commit = useCallback((next: Grid | ((grid: Grid) => Grid)) => {
		setState((s) => {
			const grid = typeof next === "function" ? next(s.grid) : next
			if (grid === s.grid) return s
			return { grid, past: [...s.past, s.grid], future: [] }
		})
	}, [])
	const undo = useCallback(() => {
		setState((s) => {
			const grid = s.past.at(-1)
			if (!grid) return s
			return { grid, past: s.past.slice(0, -1), future: [s.grid, ...s.future] }
		})
	}, [])
	const redo = useCallback(() => {
		setState((s) => {
			const [grid, ...future] = s.future
			if (!grid) return s
			return { grid, past: [...s.past, s.grid], future }
		})
	}, [])
	return {
		grid: state.grid,
		commit,
		undo,
		redo,
		canUndo: state.past.length > 0,
		canRedo: state.future.length > 0,
	}
}

type Editing = { kind: "cell"; pos: number; col: number; value: string }

type DragMode = "cells" | "rows" | "cols"

type Props = {
	grid: Grid
	/** The grid as opened, for the changed-cell outlines. */
	seed: Grid
	commit: (next: Grid | ((grid: Grid) => Grid)) => void
	undo: () => void
	redo: () => void
	canUndo: boolean
	canRedo: boolean
}

export const EditDataGrid = ({
	grid,
	seed,
	commit,
	undo,
	redo,
	canUndo,
	canRedo,
}: Props) => {
	const [rawSelection, setSelection] = useState<CellRange | null>(
		grid.order.length > 0 && grid.columns.length > 0
			? { anchor: { pos: 0, col: 0 }, focus: { pos: 0, col: 0 } }
			: null
	)
	const [editing, setEditingState] = useState<Editing | null>(null)
	// Mirrors `editing` for handlers that run in the same tick (a blur and a
	// keydown both trying to commit), so only one of them does.
	const editingRef = useRef<Editing | null>(null)
	const setEditing = (next: Editing | null) => {
		editingRef.current = next
		setEditingState(next)
	}
	const drag = useRef<DragMode | null>(null)
	// The right-click menu at a viewport point: rows from a row number,
	// columns from a column name, both from a cell.
	const [menu, setMenu] = useState<{
		x: number
		y: number
		offers: "rows" | "cols" | "both"
	} | null>(null)
	const proxy = useRef<HTMLTextAreaElement>(null)
	const scroller = useRef<HTMLDivElement>(null)
	const [scrollTop, setScrollTop] = useState(0)
	const [viewportHeight, setViewportHeight] = useState(0)

	const rowCount = grid.order.length
	const colCount = grid.columns.length
	const lastPos = rowCount - 1
	const lastCol = colCount - 1
	const widths = useMemo(() => columnWidths(grid), [grid])
	const tableWidth = GUTTER_WIDTH + ADD_WIDTH + widths.reduce((a, b) => a + b, 0)
	const changed = useMemo(() => makeChangedLookup(seed), [seed])

	// A selection that outlives the rows or columns it covered (a delete,
	// an undo) is clamped rather than dropped, so the keyboard still has a
	// place to go.
	const selection = useMemo<CellRange | null>(() => {
		if (!rawSelection || rowCount === 0 || colCount === 0) return null
		const clamp = (ref: CellRef): CellRef => ({
			pos: Math.min(ref.pos, lastPos),
			col: Math.min(ref.col, lastCol),
		})
		return { anchor: clamp(rawSelection.anchor), focus: clamp(rawSelection.focus) }
	}, [rawSelection, rowCount, colCount, lastPos, lastCol])
	const rect = selection ? normalizeRange(selection) : null

	// --- Windowing ---------------------------------------------------------
	useLayoutEffect(() => {
		const el = scroller.current
		if (!el) return
		const measure = () => setViewportHeight(el.clientHeight)
		measure()
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
		ro?.observe(el)
		return () => ro?.disconnect()
	}, [])
	// With no layout (tests), show a generous window rather than nothing.
	const visibleRows =
		viewportHeight > 0 ? Math.ceil(viewportHeight / ROW_HEIGHT) : 100
	const firstPos = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
	const endPos = Math.min(rowCount, firstPos + visibleRows + 2 * OVERSCAN)
	const topSpacer = firstPos * ROW_HEIGHT
	const bottomSpacer = (rowCount - endPos) * ROW_HEIGHT

	const focusProxy = () => {
		const el = proxy.current
		if (el && document.activeElement !== el) el.focus({ preventScroll: true })
	}

	// Keep the focus cell in view as the keyboard moves it.
	const focusCell = selection?.focus
	useEffect(() => {
		const el = scroller.current
		if (!el || !focusCell) return
		const top = focusCell.pos * ROW_HEIGHT
		const bottom = top + ROW_HEIGHT
		const viewTop = el.scrollTop
		const viewBottom = viewTop + el.clientHeight - HEADER_HEIGHT
		if (el.clientHeight > 0) {
			if (top < viewTop) el.scrollTop = top
			else if (bottom > viewBottom) el.scrollTop = bottom - el.clientHeight + HEADER_HEIGHT
		}
		const left = GUTTER_WIDTH + widths.slice(0, focusCell.col).reduce((a, b) => a + b, 0)
		const right = left + (widths[focusCell.col] ?? 0)
		if (el.clientWidth > 0) {
			if (left - GUTTER_WIDTH < el.scrollLeft) el.scrollLeft = left - GUTTER_WIDTH
			else if (right > el.scrollLeft + el.clientWidth)
				el.scrollLeft = right - el.clientWidth
		}
	}, [focusCell, widths])

	// --- Selection -----------------------------------------------------------
	const select = (cell: CellRef, extend: boolean) =>
		setSelection((prev) =>
			extend && prev ? { anchor: prev.anchor, focus: cell } : { anchor: cell, focus: cell }
		)
	const selectRow = (pos: number, extend: boolean) =>
		setSelection((prev) =>
			extend && prev
				? { anchor: prev.anchor, focus: { pos, col: lastCol } }
				: { anchor: { pos, col: 0 }, focus: { pos, col: lastCol } }
		)
	const selectCol = (col: number, extend: boolean) =>
		setSelection((prev) =>
			extend && prev
				? { anchor: prev.anchor, focus: { pos: lastPos, col } }
				: { anchor: { pos: 0, col }, focus: { pos: lastPos, col } }
		)
	const moveFocus = (dPos: number, dCol: number, extend: boolean, jump = false) => {
		setSelection((prev) => {
			const from = prev?.focus ?? { pos: 0, col: 0 }
			const pos = jump
				? dPos < 0
					? 0
					: dPos > 0
						? lastPos
						: from.pos
				: Math.max(0, Math.min(lastPos, from.pos + dPos))
			const col = jump
				? dCol < 0
					? 0
					: dCol > 0
						? lastCol
						: from.col
				: Math.max(0, Math.min(lastCol, from.col + dCol))
			const next = { pos, col }
			return extend && prev ? { anchor: prev.anchor, focus: next } : { anchor: next, focus: next }
		})
	}

	useEffect(() => {
		const onUp = () => {
			drag.current = null
		}
		window.addEventListener("mouseup", onUp)
		return () => window.removeEventListener("mouseup", onUp)
	}, [])

	// --- Editing -------------------------------------------------------------
	const startEdit = (pos: number, col: number, value: string) => {
		setEditing({ kind: "cell", pos, col, value })
	}
	/** Commit the cell being edited. Reads the ref so a blur and a keydown
	 *  in the same tick can't both commit. */
	const commitEdit = () => {
		const e = editingRef.current
		if (!e) return
		editingRef.current = null
		setEditing(null)
		commit((g) => setCell(g, e.pos, e.col, e.value))
	}
	const cancelEdit = () => {
		editingRef.current = null
		setEditing(null)
	}

	// --- Clipboard ------------------------------------------------------------
	const selectionTsv = () => (rect ? rectToTsv(grid, rect) : "")
	const onCopy = (e: React.ClipboardEvent) => {
		if (!rect) return
		e.clipboardData?.setData("text/plain", selectionTsv())
		e.preventDefault()
	}
	const onCut = (e: React.ClipboardEvent) => {
		if (!rect) return
		onCopy(e)
		commit((g) => clearRect(g, rect))
	}
	const onPaste = (e: React.ClipboardEvent) => {
		if (!rect) return
		const text = e.clipboardData?.getData("text/plain") ?? ""
		e.preventDefault()
		const block = parseClipboardBlock(text)
		const result = pasteBlock(grid, rect, block)
		if (result.grid === grid) return
		commit(result.grid)
		setSelection({
			anchor: { pos: result.rect.top, col: result.rect.left },
			focus: { pos: result.rect.bottom, col: result.rect.right },
		})
	}

	// --- Keys on the proxy (cells selected, nothing being edited) ---------------
	const onProxyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const mod = e.metaKey || e.ctrlKey
		const key = e.key
		// Native copy / cut / paste fire after this; Safari only fires copy
		// when the focused box has a text selection, so give it one.
		if (mod && (key === "c" || key === "x" || key === "C" || key === "X")) {
			const el = e.currentTarget
			el.value = selectionTsv()
			el.select()
			return
		}
		if (mod && (key === "v" || key === "V")) return
		if (mod && (key === "z" || key === "Z")) {
			e.preventDefault()
			if (e.shiftKey) redo()
			else undo()
			return
		}
		if (mod && (key === "y" || key === "Y")) {
			e.preventDefault()
			redo()
			return
		}
		if (mod && (key === "a" || key === "A")) {
			e.preventDefault()
			if (rowCount > 0 && colCount > 0)
				setSelection({ anchor: { pos: 0, col: 0 }, focus: { pos: lastPos, col: lastCol } })
			return
		}
		e.currentTarget.value = ""
		if (key === "ContextMenu" || (key === "F10" && e.shiftKey)) {
			e.preventDefault()
			openMenuAtFocus()
			return
		}
		switch (key) {
			case "ArrowUp":
				e.preventDefault()
				moveFocus(-1, 0, e.shiftKey, mod)
				return
			case "ArrowDown":
				e.preventDefault()
				moveFocus(1, 0, e.shiftKey, mod)
				return
			case "ArrowLeft":
				e.preventDefault()
				moveFocus(0, -1, e.shiftKey, mod)
				return
			case "ArrowRight":
				e.preventDefault()
				moveFocus(0, 1, e.shiftKey, mod)
				return
			case "Tab":
				e.preventDefault()
				moveFocus(0, e.shiftKey ? -1 : 1, false)
				return
			case "Enter":
			case "F2":
				e.preventDefault()
				if (focusCell)
					startEdit(
						focusCell.pos,
						focusCell.col,
						grid.rows[grid.order[focusCell.pos] ?? -1]?.cells[focusCell.col] ?? ""
					)
				return
			case "Delete":
			case "Backspace":
				e.preventDefault()
				if (rect) commit((g) => clearRect(g, rect))
				return
			case "Escape":
				if (selection) {
					// Drop the selection; a second Escape closes the dialog.
					e.preventDefault()
					e.stopPropagation()
					setSelection(null)
				}
				return
			default:
				break
		}
		if (key.length === 1 && !mod && !e.altKey && focusCell) {
			// Typing over a cell starts editing it with what was typed.
			e.preventDefault()
			startEdit(focusCell.pos, focusCell.col, key)
		}
	}

	// --- Keys inside the cell editor ---------------------------------------
	const onEditorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		const ed = editingRef.current
		if (!ed) return
		if (e.key === "Escape") {
			e.preventDefault()
			e.stopPropagation() // not the dialog's Escape
			cancelEdit()
			focusProxy()
			return
		}
		if (e.key === "Enter" || e.key === "Tab" || e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault()
			commitEdit()
			focusProxy()
			if (e.key === "Tab") moveFocus(0, e.shiftKey ? -1 : 1, false)
			else if (e.key === "Enter") moveFocus(e.shiftKey ? -1 : 1, 0, false)
			else moveFocus(e.key === "ArrowUp" ? -1 : 1, 0, false)
		}
	}

	// --- Toolbar actions -----------------------------------------------------------
	/** Append a row and land on it — in the column the user clicked on the
	 *  blank line, or the first one from the "+" button. */
	const onAddRow = (col = 0) => {
		commitEdit()
		commit((g) => addRow(g))
		const pos = rowCount
		setSelection({ anchor: { pos, col }, focus: { pos, col } })
		focusProxy()
	}
	const onAddColumn = () => {
		commitEdit()
		commit((g) => addColumn(g, freshColumnName(grid)))
		// The new column comes in selected; its name is changed in the Fields panel.
		const col = colCount
		setSelection({ anchor: { pos: 0, col }, focus: { pos: rowCount - 1, col } })
		focusProxy()
	}
	const onDeleteRows = () => {
		setMenu(null)
		if (!rect) return
		commitEdit()
		commit((g) => deleteRows(g, rect.top, rect.bottom))
		setSelection(null)
		focusProxy()
	}
	const onDeleteColumns = () => {
		setMenu(null)
		if (!rect) return
		commitEdit()
		commit((g) => deleteColumns(g, rect.left, rect.right))
		setSelection(null)
		focusProxy()
	}

	const selectedRows = rect ? rect.bottom - rect.top + 1 : 0
	const selectedCols = rect ? rect.right - rect.left + 1 : 0

	// --- Delete menu -----------------------------------------------------------
	// Right-clicking a row number, a column name or a cell opens the menu
	// for the selection; a right-click outside the selection moves the
	// selection there first, so the menu always names what it will delete.
	const openMenuAt = (x: number, y: number, offers: "rows" | "cols" | "both") => {
		commitEdit()
		setMenu({
			x: Math.max(0, Math.min(x, window.innerWidth - MENU_WIDTH)),
			y: Math.max(0, Math.min(y, window.innerHeight - 96)),
			offers,
		})
	}
	const onRowContextMenu = (pos: number) => (e: React.MouseEvent) => {
		e.preventDefault()
		if (!rect || pos < rect.top || pos > rect.bottom) selectRow(pos, false)
		openMenuAt(e.clientX, e.clientY, "rows")
	}
	const onColContextMenu = (col: number) => (e: React.MouseEvent) => {
		e.preventDefault()
		if (!rect || col < rect.left || col > rect.right) selectCol(col, false)
		openMenuAt(e.clientX, e.clientY, "cols")
	}
	const onCellContextMenu = (pos: number, col: number) => (e: React.MouseEvent) => {
		e.preventDefault()
		if (!rect || !inRect(rect, pos, col)) select({ pos, col }, false)
		openMenuAt(e.clientX, e.clientY, "both")
	}
	/** The keyboard's way in (Shift+F10 / the Menu key): below the focus cell. */
	const openMenuAtFocus = () => {
		const el = scroller.current
		if (!el || !focusCell) return
		const box = el.getBoundingClientRect()
		const left =
			GUTTER_WIDTH + widths.slice(0, focusCell.col).reduce((a, b) => a + b, 0)
		openMenuAt(
			box.left + left - el.scrollLeft,
			box.top + HEADER_HEIGHT + (focusCell.pos + 1) * ROW_HEIGHT - el.scrollTop,
			"both"
		)
	}
	useEffect(() => {
		if (!menu) return
		const close = () => setMenu(null)
		// Any click outside the menu, or a resize, dismisses it.
		const onDown = (e: MouseEvent) => {
			if (!(e.target as HTMLElement).closest("[data-grid-menu]")) close()
		}
		window.addEventListener("mousedown", onDown)
		window.addEventListener("resize", close)
		return () => {
			window.removeEventListener("mousedown", onDown)
			window.removeEventListener("resize", close)
		}
	}, [menu])

	const menuItem =
		"block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 focus:bg-stone-100 focus:outline-none dark:hover:bg-stone-700 dark:focus:bg-stone-700 vc-text"
	const toolButton =
		"text-sm transition-colors hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-inherit dark:hover:text-white vc-muted"

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-3">
				<button type="button" className={toolButton} onClick={undo} disabled={!canUndo}>
					Undo
				</button>
				<button type="button" className={toolButton} onClick={redo} disabled={!canRedo}>
					Redo
				</button>
			</div>
			<div className="relative">
				<textarea
					ref={proxy}
					aria-label="Selected cells"
					tabIndex={0}
					onKeyDown={onProxyKeyDown}
					onCopy={onCopy}
					onCut={onCut}
					onPaste={onPaste}
					// Pinned inside the grid's box, so focusing it never scrolls
					// the dialog, and transparent rather than display:none, so it
					// can hold focus.
					className="absolute top-0 left-0 h-px w-px resize-none opacity-0"
					// eslint-disable-next-line jsx-a11y/no-autofocus -- the grid is what the user opened this dialog to edit
					autoFocus
				/>
				<div
					ref={scroller}
					onScroll={(e) => {
						setScrollTop(e.currentTarget.scrollTop)
						setMenu(null)
					}}
					// Scroll anchoring would chase the spacer rows as the window
					// moves and re-scroll the box in a loop; the window math owns
					// the scroll position.
					style={{ overflowAnchor: "none" }}
					className="h-[52vh] min-h-[160px] overflow-auto rounded-sm border border-stone-200 select-none dark:border-stone-700"
				>
					<table
						role="grid"
						aria-label="Data to edit"
						data-tip="edit-grid"
						aria-rowcount={rowCount + 1}
						aria-colcount={colCount + 1}
						className="border-separate border-spacing-0 text-sm"
						style={{ tableLayout: "fixed", width: tableWidth }}
					>
						<colgroup>
							<col style={{ width: GUTTER_WIDTH }} />
							{widths.map((w, i) => (
								<col key={grid.columns[i]?.key ?? i} style={{ width: w }} />
							))}
							<col style={{ width: ADD_WIDTH }} />
						</colgroup>
						<thead>
							<tr role="row" style={{ height: HEADER_HEIGHT }}>
								<th
									scope="col"
									className="sticky top-0 left-0 z-[3] border-r border-b border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-800"
								/>
								{grid.columns.map((column, col) => {
									const sorted = grid.sort?.col === col ? grid.sort.dir : null
									const whole = rect !== null && col >= rect.left && col <= rect.right
									return (
										<th
											key={column.key}
											scope="col"
											role="columnheader"
											aria-sort={
												sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
											}
											title={column.name}
											onContextMenu={onColContextMenu(col)}
											onMouseDown={(e) => {
												if (e.button !== 0) return
												if ((e.target as HTMLElement).closest("button")) return
												e.preventDefault()
												commitEdit()
												drag.current = "cols"
												selectCol(col, e.shiftKey)
												focusProxy()
											}}
											onMouseEnter={() => {
												if (drag.current === "cols") selectCol(col, true)
											}}
											className={c(
												"sticky top-0 z-[2] border-r border-b border-stone-200 bg-stone-100 px-2 text-left font-medium whitespace-nowrap text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300",
												whole && "bg-indigo-100 dark:bg-indigo-900/50"
											)}
										>
											<div className="flex items-center gap-1">
												<span className="min-w-0 flex-1 truncate">{column.name}</span>
												<button
													type="button"
													aria-label={`Sort by ${column.name}`}
													title={
														sorted === null
															? "Sort ascending"
															: sorted === "asc"
																? "Sort descending"
																: "Clear sort"
													}
													onClick={() => {
														commitEdit()
														commit((g) => applySort(g, nextSort(g.sort, col)))
													}}
													className={c(
														"flex-shrink-0 px-0.5 text-xs leading-none",
														sorted
															? "text-vc-brand-text dark:text-vc-electric-indigo-300"
															: "text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
													)}
												>
													{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "⇅"}
												</button>
											</div>
										</th>
									)
								})}
								<th
									scope="col"
									className="sticky top-0 z-[2] border-b border-stone-200 bg-stone-100 p-0 text-center dark:border-stone-700 dark:bg-stone-800"
								>
									<button
										type="button"
										onClick={onAddColumn}
										aria-label="Add column"
										data-tip="edit-add-column"
										title="Add column"
										className="h-full w-full text-base leading-none font-medium hover:text-brand-500 dark:hover:text-indigo-400 vc-muted"
									>
										+
									</button>
								</th>
							</tr>
						</thead>
						<tbody>
							{topSpacer > 0 && (
								<tr aria-hidden="true" style={{ height: topSpacer }}>
									<td colSpan={colCount + 2} />
								</tr>
							)}
							{grid.order.slice(firstPos, endPos).map((rowIndex, i) => {
								const pos = firstPos + i
								const row = grid.rows[rowIndex]
								if (!row) return null
								const wholeRow = rect !== null && pos >= rect.top && pos <= rect.bottom
								return (
									<tr key={row.key} role="row" aria-rowindex={pos + 2} style={{ height: ROW_HEIGHT }}>
										<th
											scope="row"
											onContextMenu={onRowContextMenu(pos)}
											onMouseDown={(e) => {
												if (e.button !== 0) return
												e.preventDefault()
												commitEdit()
												drag.current = "rows"
												selectRow(pos, e.shiftKey)
												focusProxy()
											}}
											onMouseEnter={() => {
												if (drag.current === "rows") selectRow(pos, true)
											}}
											className={c(
												"sticky left-0 z-[1] border-r border-b border-stone-200 bg-stone-100 px-1 text-center text-xs font-normal tabular-nums text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400",
												wholeRow && "bg-indigo-100 dark:bg-indigo-900/50"
											)}
										>
											{pos + 1}
										</th>
										{grid.columns.map((column, col) => {
											const value = row.cells[col] ?? ""
											const selected = rect !== null && inRect(rect, pos, col)
											const isFocus = focusCell?.pos === pos && focusCell.col === col
											const isEditing =
												editing?.kind === "cell" && editing.pos === pos && editing.col === col
											const numeric =
												column.type === "quantitative" || column.type === "temporal"
											const isChanged = changed(grid, pos, col)
											return (
												<td
													key={column.key}
													role="gridcell"
													aria-selected={selected}
													aria-colindex={col + 2}
													{...(isChanged ? { "data-edited": "true" } : {})}
													onContextMenu={onCellContextMenu(pos, col)}
													onMouseDown={(e) => {
														if (e.button !== 0 || isEditing) return
														e.preventDefault()
														commitEdit()
														drag.current = "cells"
														select({ pos, col }, e.shiftKey)
														focusProxy()
													}}
													onMouseEnter={() => {
														if (drag.current === "cells") select({ pos, col }, true)
													}}
													onDoubleClick={() => {
														if (isEditing) return
														commitEdit()
														startEdit(pos, col, value)
													}}
													className={c(
														"border-r border-b border-stone-100 px-2 whitespace-nowrap text-stone-700 dark:border-stone-800 dark:text-stone-200",
														numeric ? "text-right font-mono tabular-nums" : "text-left",
														selected && "bg-indigo-100 dark:bg-indigo-900/50",
														isFocus && !isEditing && "vc-grid-focus",
														isChanged && "vc-edited-cell",
														!isEditing && "overflow-hidden text-ellipsis"
													)}
												>
													{isEditing ? (
														<input
															aria-label="Cell value"
															value={editing.value}
															onChange={(e) =>
																setEditing({ kind: "cell", pos, col, value: e.target.value })
															}
															onKeyDown={onEditorKeyDown}
															onBlur={commitEdit}
															className={c(
																"w-full bg-transparent outline-none select-text",
																numeric && "text-right font-mono tabular-nums"
															)}
															// eslint-disable-next-line jsx-a11y/no-autofocus -- the box replaces the cell the user just chose to edit
															autoFocus
														/>
													) : (
														value
													)}
												</td>
											)
										})}
										<td />
									</tr>
								)
							})}
							{bottomSpacer > 0 && (
								<tr aria-hidden="true" style={{ height: bottomSpacer }}>
									<td colSpan={colCount + 2} />
								</tr>
							)}
							{/* The blank line under the data: its "+" (or a click in
							  * any of its cells) adds a row and lands there. */}
							<tr role="row" aria-rowindex={rowCount + 2} style={{ height: ROW_HEIGHT }}>
								<th
									scope="row"
									className="sticky left-0 z-[1] border-r border-stone-200 bg-stone-100 p-0 text-center dark:border-stone-700 dark:bg-stone-800"
								>
									<button
										type="button"
										onClick={() => onAddRow()}
										aria-label="Add row"
										title="Add row"
										className="h-full w-full text-base leading-none font-medium hover:text-brand-500 dark:hover:text-indigo-400 vc-muted"
									>
										+
									</button>
								</th>
								{grid.columns.map((column, col) => (
									<td
										key={column.key}
										onMouseDown={(e) => {
											if (e.button !== 0) return
											e.preventDefault()
											onAddRow(col)
										}}
										className="cursor-cell border-r border-stone-100 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-900/40"
									/>
								))}
								<td />
							</tr>
						</tbody>
					</table>
				</div>
				{menu && rect && (
					<div
						role="menu"
						aria-label="Selection"
						data-grid-menu
						tabIndex={-1}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault()
								e.stopPropagation() // not the dialog's Escape
								setMenu(null)
								focusProxy()
							}
						}}
						style={{ position: "fixed", left: menu.x, top: menu.y, width: MENU_WIDTH }}
						className="z-30 rounded border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
					>
						{menu.offers !== "cols" && (
							<button
								type="button"
								role="menuitem"
								onClick={onDeleteRows}
								className={menuItem}
								// eslint-disable-next-line jsx-a11y/no-autofocus -- the menu the user just opened takes focus, as a native one does
								autoFocus
							>
								{selectedRows !== 1 ? `Delete ${selectedRows} rows` : "Delete row"}
							</button>
						)}
						{menu.offers !== "rows" && (
							<button
								type="button"
								role="menuitem"
								onClick={onDeleteColumns}
								className={menuItem}
								// eslint-disable-next-line jsx-a11y/no-autofocus -- as above, when this is the first item
								autoFocus={menu.offers === "cols"}
							>
								{selectedCols !== 1 ? `Delete ${selectedCols} columns` : "Delete column"}
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
