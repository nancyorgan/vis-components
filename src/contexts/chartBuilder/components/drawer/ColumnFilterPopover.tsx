import { useEffect, useMemo, useRef, useState } from "react"
import { conformToFormat, type ColumnFormat } from "../../lib/cellFormat"
import {
	FILTER_OPS,
	emptyFilterFor,
	parseFilterDate,
	type ColumnFilter,
	type FilterCondition,
	type FilterOp,
} from "../../lib/columnFilter"
import { formatLocalDate } from "../../lib/localDate"
import type { FieldType } from "../../lib/types"

import { Checkbox } from "../../../../components/ui/Checkbox"
import { DateInput } from "../../../../components/ui/DateInput"
import { Input } from "../../../../components/ui/Input"
import { Segmented } from "../../../../components/ui/Segmented"
import { Select } from "../../../../components/ui/Select"

/** The Edit dialog's column filter, opened from a column header's filter
 *  icon. A categorical or ordinal column lists its categories, all checked,
 *  to uncheck the ones to take out; a quantitative or date column takes
 *  comparisons — one to start, more through "+ Add condition", joined by
 *  one AND / OR for the column.
 *
 *  Everything applies as it is chosen (the table behind filters live); a
 *  typed number applies on Enter or when the box is left. Whatever is still
 *  in the boxes applies when the popover closes — its Apply button, a
 *  click outside, Escape, or another column's icon. */

export const FILTER_POPOVER_WIDTH = 288
/** More categories than this get a search box… */
const SEARCH_FROM = 8
/** …and no more than this many are listed at once. */
const LIST_LIMIT = 300

type Props = {
	name: string
	type: FieldType
	/** The column's number format, so a typed "14" in a percent column
	 *  reads as "14%" — the same rewrite a typed cell gets. */
	format: ColumnFormat | null
	/** The filter the column has now, or null. */
	filter: ColumnFilter | null
	/** The column's categories with their row counts (a values filter). */
	values: ReadonlyArray<{ value: string; count: number }>
	x: number
	y: number
	onApply: (filter: ColumnFilter | null) => void
	onClose: () => void
}

const BLANK_LABEL = "(blank)"
const linkButton =
	"text-sm hover:text-stone-900 dark:hover:text-white vc-muted"

export const ColumnFilterPopover = ({
	name,
	type,
	format,
	filter,
	values,
	x,
	y,
	onApply,
	onClose,
}: Props) => {
	const [draft, setDraft] = useState<ColumnFilter>(
		() => filter ?? emptyFilterFor(type)
	)
	// The latest draft and callbacks, for the close handlers and the
	// apply-on-close below.
	const live = useRef({ draft, onApply, onClose })
	useEffect(() => {
		live.current = { draft, onApply, onClose }
	})
	const change = (next: ColumnFilter, apply: boolean) => {
		live.current.draft = next
		setDraft(next)
		if (apply) onApply(next)
	}

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			// A filter icon switches or closes the popover itself.
			if (target.closest("[data-grid-filter], [data-grid-filter-toggle]")) return
			live.current.onClose()
		}
		const close = () => live.current.onClose()
		window.addEventListener("mousedown", onDown)
		window.addEventListener("resize", close)
		return () => {
			window.removeEventListener("mousedown", onDown)
			window.removeEventListener("resize", close)
			// Closing: a number typed but not yet entered still counts.
			live.current.onApply(live.current.draft)
		}
	}, [])

	const panel = useRef<HTMLDivElement>(null)
	useEffect(() => {
		panel.current?.focus({ preventScroll: true })
	}, [])


	return (
		// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keydown is only the popover's own Escape, as on the grid's menu
		<div
			role="dialog"
			aria-label={`Filter ${name}`}
			data-grid-filter
			ref={panel}
			tabIndex={-1}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault()
					e.stopPropagation() // not the dialog's Escape
					onClose()
				}
			}}
			style={{ position: "fixed", left: x, top: y, width: FILTER_POPOVER_WIDTH }}
			className="z-30 flex flex-col gap-2 rounded border border-stone-200 bg-white p-3 text-sm shadow-lg outline-none dark:border-stone-700 dark:bg-stone-800"
		>
			<div className="flex items-baseline gap-2">
				<div className="min-w-0 flex-1 truncate font-medium vc-heading">
					Filter {name}
				</div>
				{/* Closing applies whatever is in the boxes (the effect above). */}
				<button type="button" className={linkButton} onClick={onClose}>
					apply
				</button>
			</div>
			{draft.kind === "values" ? (
				<ValuesFilter
					values={values}
					excluded={draft.excluded}
					onChange={(excluded) => change({ kind: "values", excluded }, true)}
				/>
			) : (
				<ConditionsFilter draft={draft} format={format} change={change} />
			)}
		</div>
	)
}

const ValuesFilter = ({
	values,
	excluded,
	onChange,
}: {
	values: ReadonlyArray<{ value: string; count: number }>
	excluded: string[]
	onChange: (excluded: string[]) => void
}) => {
	const [query, setQuery] = useState("")
	const out = useMemo(() => new Set(excluded), [excluded])
	const matched = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (q === "") return values
		return values.filter((v) =>
			(v.value === "" ? BLANK_LABEL : v.value).toLowerCase().includes(q)
		)
	}, [values, query])
	const listed = matched.slice(0, LIST_LIMIT)

	const toggle = (value: string, keep: boolean) => {
		const next = new Set(out)
		if (keep) next.delete(value)
		else next.add(value)
		onChange([...next])
	}
	/** Select or deselect everything the search matches. */
	const setAll = (keep: boolean) => {
		const next = new Set(out)
		for (const v of matched) {
			if (keep) next.delete(v.value)
			else next.add(v.value)
		}
		onChange([...next])
	}

	return (
		<>
			{values.length > SEARCH_FROM && (
				<Input
					aria-label="Search categories"
					placeholder="Search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
			)}
			<div className="flex gap-3">
				<button type="button" className={linkButton} onClick={() => setAll(true)}>
					Select all
				</button>
				<button type="button" className={linkButton} onClick={() => setAll(false)}>
					Deselect all
				</button>
			</div>
			<div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
				{listed.map((v) => (
					<Checkbox
						key={v.value}
						label={
							<>
								{v.value === "" ? BLANK_LABEL : v.value}{" "}
								<span className="vc-muted tabular-nums">({v.count})</span>
							</>
						}
						checked={!out.has(v.value)}
						onChange={(keep) => toggle(v.value, keep)}
					/>
				))}
				{matched.length === 0 && <div className="vc-muted">No categories match.</div>}
				{matched.length > LIST_LIMIT && (
					<div className="vc-muted">
						Showing the first {LIST_LIMIT} of {matched.length}. Search to narrow the
						list.
					</div>
				)}
			</div>
		</>
	)
}

const ConditionsFilter = ({
	draft,
	format,
	change,
}: {
	draft: Extract<ColumnFilter, { kind: "conditions" }>
	format: ColumnFormat | null
	change: (next: ColumnFilter, apply: boolean) => void
}) => {
	const setCondition = (
		index: number,
		patch: Partial<FilterCondition>,
		apply: boolean
	) =>
		change(
			{
				...draft,
				conditions: draft.conditions.map((c, i) =>
					i === index ? { ...c, ...patch } : c
				),
			},
			apply
		)
	const remove = (index: number) =>
		change(
			{ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) },
			true
		)
	const add = () =>
		change(
			{ ...draft, conditions: [...draft.conditions, { op: "lt", value: "" }] },
			false
		)

	return (
		<>
			<div className="vc-muted">Keep rows where the value is</div>
			{draft.conditions.map((condition, i) => (
				// The list only grows at the end and shrinks by index, and a row
				// holds no state of its own beyond what the draft carries.
				// eslint-disable-next-line react/no-array-index-key
				<div key={i} className="flex flex-col gap-2">
					{i > 0 && (
						<Segmented
							ariaLabel="Join conditions with"
							value={draft.join}
							segments={[
								{ key: "and", label: "AND" },
								{ key: "or", label: "OR" },
							]}
							onChange={(join) => change({ ...draft, join }, true)}
							className="!self-center"
						/>
					)}
					<div className="flex items-center gap-1">
						<Select
							aria-label="Comparison"
							value={condition.op}
							onChange={(e) =>
								setCondition(i, { op: e.target.value as FilterOp }, true)
							}
							className="w-16 flex-shrink-0"
						>
							{FILTER_OPS.map((o) => (
								<option key={o.op} value={o.op} aria-label={o.name}>
									{o.label}
								</option>
							))}
						</Select>
						{draft.as === "date" ? (
							<DateInput
								aria-label="Date"
								value={parseFilterDate(condition.value)}
								onChange={(ms) =>
									setCondition(
										i,
										{ value: ms === null ? "" : formatLocalDate(ms) },
										true
									)
								}
								className="min-w-0 flex-1"
							/>
						) : (
							<Input
								aria-label="Value"
								inputMode="decimal"
								placeholder="Number"
								value={condition.value}
								onChange={(e) => setCondition(i, { value: e.target.value }, false)}
								onBlur={(e) =>
									setCondition(
										i,
										{ value: conformToFormat(e.target.value, format) },
										true
									)
								}
								onKeyDown={(e) => {
									if (e.key !== "Enter") return
									e.preventDefault()
									setCondition(
										i,
										{ value: conformToFormat(e.currentTarget.value, format) },
										true
									)
								}}
								className="w-0 flex-1"
							/>
						)}
						{draft.conditions.length > 1 && (
							<button
								type="button"
								aria-label="Remove condition"
								title="Remove condition"
								onClick={() => remove(i)}
								className="flex-shrink-0 px-1 text-base leading-none hover:text-stone-900 dark:hover:text-white vc-muted"
							>
								×
							</button>
						)}
					</div>
				</div>
			))}
			<button type="button" className={`${linkButton} self-end`} onClick={add}>
				+ Add condition
			</button>
		</>
	)
}
