import { useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { effectiveDerivedName } from "../../lib/derivedVariables"
import {
	alphabeticalLevelOrder,
	orderLevelsByField,
} from "../../lib/orderLevelsByField"
import { applyLevelOrder, smartSortCategories } from "../../lib/smartSort"
import type { Field, FieldType } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	datasetIndexAtom,
	derivedVariableEditorAtom,
} from "../../store/atoms"
import { originalFieldName } from "../../lib/renameField"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import {
	useRenameDerivedVariable,
	useRenameField,
} from "../../store/useRenameField"
import { Disclosure } from "@headlessui/react"

import { DisclosureChevron } from "../../../../components/ui/Chevron"
import { SelectInput } from "../../../../components/ui/SelectInput"

const TYPE_OPTIONS: ReadonlyArray<{ value: FieldType; label: FieldType }> = [
	{ value: "quantitative", label: "quantitative" },
	{ value: "categorical", label: "categorical" },
	{ value: "temporal", label: "temporal" },
	{ value: "ordinal", label: "ordinal" },
]

const TYPE_BADGE_CLASSES: Record<FieldType, string> = {
	quantitative:
		"bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
	categorical:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
	temporal:
		"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
	ordinal:
		"bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
}

const TYPE_ABBR: Record<FieldType, string> = {
	quantitative: "Q",
	categorical: "C",
	temporal: "T",
	ordinal: "O",
}

export const FieldList = () => {
	const [overrides, setOverrides] = useAtom(currentFieldOverridesAtom)
	const [levelOrders, setLevelOrders] = useAtom(
		currentFieldLevelOrdersAtom
	)
	const derivedConfig = useAtomValue(currentDerivedVariablesAtom)
	const setDerivedEditor = useSetAtom(derivedVariableEditorAtom)
	const dataset = useCurrentDatasetView()
	// Rename targets are DATASET fields only. With a reshape applied the view
	// also shows the two minted columns (variable/value) — those are renamed
	// through the Reshape panel's own name boxes, not here.
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const datasetFieldNames = new Set(
		(datasetId ? (datasetIndex[datasetId]?.fields ?? []) : []).map(
			(f) => f.name
		)
	)

	if (!dataset) {
		return (
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Upload a CSV to see its fields.
			</p>
		)
	}

	// Every field with its EFFECTIVE type (override ?? inferred): the reorder
	// panel derives both its "Order by" candidates (quant/temporal) and its
	// scope-variable list (any field) from this.
	const effectiveFields = dataset.fields.map((f) => ({
		name: f.name,
		type: overrides[f.name] ?? f.inferredType,
	}))

	return (
		<ul className="flex flex-col gap-1">
			{dataset.fields.map((field) => {
				const effective = overrides[field.name] ?? field.inferredType
				const reorderable =
					effective === "categorical" || effective === "ordinal"
				// The variable minting this column, so the ƒ pill can reopen it
				// in the editor popup.
				const derivedVariable = field.derived
					? derivedConfig.variables.find(
							(v, i) => effectiveDerivedName(v, i) === field.name
						)
					: undefined
				return (
					<li
						key={field.name}
						className="flex flex-col gap-1 rounded-md border border-stone-200 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-800"
					>
						<Disclosure>
							{({ open }) => (
								<>
									<div className="flex items-center justify-between gap-2">
										{datasetFieldNames.has(field.name) ? (
											<FieldNameEditor field={field} />
										) : field.derived ? (
											<DerivedFieldName field={field} />
										) : (
											<span
												className="min-w-0 flex-1 truncate text-sm text-stone-800 dark:text-stone-200"
												title={field.name}
											>
												{field.name}
											</span>
										)}
										{derivedVariable ? (
											<button
												type="button"
												onClick={() =>
													setDerivedEditor({
														mode: "edit",
														id: derivedVariable.id,
													})
												}
												aria-label={`Edit derived variable ${field.name}`}
												title="Derived variable — click to edit the calculation"
												className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-indigo-100 font-serif text-sm font-bold italic text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
											>
												ƒ
											</button>
										) : field.derived ? (
											<span
												aria-label="Derived variable"
												title="Derived variable — computed from other variables"
												className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-indigo-100 font-serif text-sm font-bold italic text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
											>
												ƒ
											</span>
										) : null}
										<span
											className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-sm font-bold ${TYPE_BADGE_CLASSES[effective]}`}
											title={effective}
										>
											{TYPE_ABBR[effective]}
										</span>
										<SelectInput
											label={`Type for ${field.name}`}
											labelClassName="sr-only"
											value={effective}
											options={TYPE_OPTIONS}
											onChange={(next) =>
												setOverrides((prev) => ({
													...prev,
													[field.name]: next,
												}))
											}
											className="contents"
										/>
										{reorderable && (
											<Disclosure.Button
												className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
												aria-label={`Reorder levels of ${field.name}`}
												title="Reorder levels"
											>
												<DisclosureChevron open={open} />
											</Disclosure.Button>
										)}
									</div>
									{reorderable && (
										<Disclosure.Panel>
											<LevelReorderPanel
												field={field.name}
												type={effective}
												effectiveFields={effectiveFields}
												pinnedOrder={levelOrders[field.name]}
												setPinnedOrder={(next) =>
													setLevelOrders((prev) => {
														if (next === null) {
															const { [field.name]: _, ...rest } = prev
															return rest
														}
														return { ...prev, [field.name]: next }
													})
												}
											/>
										</Disclosure.Panel>
									)}
								</>
							)}
						</Disclosure>
					</li>
				)
			})}
		</ul>
	)
}

/** Click-to-edit rename control for one dataset field. The whole name is the
 * click target (a pencil appears on hover as the affordance cue); Enter/blur
 * commits, Escape cancels. Committing an EMPTIED box is clear-to-default:
 * a renamed field reverts to its original (upload) column name — a full
 * rename-back, configs and all — and a never-renamed field just closes the
 * editor. A refused rename (collision) keeps the editor open with the
 * reason inline. The rename itself — dataset field list, alias bookkeeping,
 * config rewrite across this and sibling visuals — is `useRenameField`. */
const FieldNameEditor = ({ field }: { field: Field }) => {
	const renameField = useRenameField()
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(field.name)
	const [error, setError] = useState<string | null>(null)

	const startEditing = () => {
		setDraft(field.name)
		setError(null)
		setEditing(true)
	}

	const cancel = () => {
		setDraft(field.name)
		setError(null)
		setEditing(false)
	}

	const commit = async () => {
		const trimmed = draft.trim()
		// Emptied box = revert to the original uploaded name. When the field
		// was never renamed (or already carries the original), there's nothing
		// to revert — just close the editor.
		const target = trimmed === "" ? originalFieldName(field) : trimmed
		if (target === field.name) {
			cancel()
			return
		}
		const result = await renameField(field.name, target)
		if (result.ok) {
			setError(null)
			setEditing(false)
		} else {
			setError(result.error)
		}
	}

	if (!editing) {
		const original = originalFieldName(field)
		return (
			<button
				type="button"
				onClick={startEditing}
				title={
					original !== field.name
						? `${field.name} (originally “${original}”) — click to rename. Clear the name to revert.`
						: `${field.name} — click to rename`
				}
				aria-label={`Rename ${field.name}`}
				className="group flex min-w-0 flex-1 items-center gap-1 text-left text-sm text-stone-800 dark:text-stone-200"
			>
				<span className="min-w-0 truncate">{field.name}</span>
				<svg
					viewBox="0 0 16 16"
					width={11}
					height={11}
					aria-hidden
					className="flex-shrink-0 text-stone-400 opacity-0 group-hover:opacity-100 dark:text-stone-500"
				>
					<path
						d="M11.7 1.6l2.7 2.7-9.2 9.2-3.4.7.7-3.4 9.2-9.2z"
						fill="currentColor"
					/>
				</svg>
			</button>
		)
	}

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<input
				type="text"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => void commit()}
				onKeyDown={(e) => {
					if (e.key === "Enter") void commit()
					if (e.key === "Escape") cancel()
				}}
				aria-label={`New name for ${field.name}`}
				// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the inline rename editor the user just opened
				autoFocus
				onFocus={(e) => e.target.select()}
				className="min-w-0 rounded border border-blue-400 bg-white px-1 py-0 text-sm text-stone-800 outline-none dark:bg-stone-900 dark:text-stone-200"
			/>
			{error && (
				<p className="text-xs text-red-700 dark:text-red-300">{error}</p>
			)}
		</div>
	)
}

/** Click-to-edit rename control for a derived (computed) field — the SAME
 * inline affordance dataset fields get, so the name behaves consistently
 * across the panel; the calculation itself is edited through the ƒ pill's
 * popup. Enter/blur commits, Escape cancels. A derived variable has no
 * original upload name to revert to, so an emptied box just cancels. A
 * refused rename (collision) keeps the editor open with the reason inline. */
const DerivedFieldName = ({ field }: { field: Field }) => {
	const config = useAtomValue(currentDerivedVariablesAtom)
	const renameDerived = useRenameDerivedVariable()
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(field.name)
	const [error, setError] = useState<string | null>(null)
	const variable = config.variables.find(
		(v, i) => effectiveDerivedName(v, i) === field.name
	)
	if (!variable) {
		// A derived column whose definition can't be found (shouldn't happen —
		// the column only exists because a definition applied) degrades to the
		// plain non-interactive name.
		return (
			<span
				className="min-w-0 flex-1 truncate text-sm text-stone-800 dark:text-stone-200"
				title={field.name}
			>
				{field.name}
			</span>
		)
	}

	const startEditing = () => {
		setDraft(field.name)
		setError(null)
		setEditing(true)
	}

	const cancel = () => {
		setDraft(field.name)
		setError(null)
		setEditing(false)
	}

	const commit = () => {
		const trimmed = draft.trim()
		if (trimmed === "" || trimmed === field.name) {
			cancel()
			return
		}
		const result = renameDerived(variable.id, trimmed)
		if (result.ok) {
			setError(null)
			setEditing(false)
		} else {
			setError(result.error)
		}
	}

	if (!editing) {
		return (
			<button
				type="button"
				onClick={startEditing}
				title={`${field.name} — click to rename`}
				aria-label={`Rename ${field.name}`}
				className="group flex min-w-0 flex-1 items-center gap-1 text-left text-sm text-stone-800 dark:text-stone-200"
			>
				<span className="min-w-0 truncate">{field.name}</span>
				<svg
					viewBox="0 0 16 16"
					width={11}
					height={11}
					aria-hidden
					className="flex-shrink-0 text-stone-400 opacity-0 group-hover:opacity-100 dark:text-stone-500"
				>
					<path
						d="M11.7 1.6l2.7 2.7-9.2 9.2-3.4.7.7-3.4 9.2-9.2z"
						fill="currentColor"
					/>
				</svg>
			</button>
		)
	}

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<input
				type="text"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit()
					if (e.key === "Escape") cancel()
				}}
				aria-label={`New name for ${field.name}`}
				// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the inline rename editor the user just opened
				autoFocus
				onFocus={(e) => e.target.select()}
				className="min-w-0 rounded border border-blue-400 bg-white px-1 py-0 text-sm text-stone-800 outline-none dark:bg-stone-900 dark:text-stone-200"
			/>
			{error && (
				<p className="text-xs text-red-700 dark:text-red-300">{error}</p>
			)}
		</div>
	)
}

type EffectiveField = { name: string; type: FieldType }

/** Fixed label column for the Order-by picker rows (the compact-panel
 * counterpart of LABEL_COL) so the "Order by" and "in" selects — and the
 * Decreasing checkbox via a matching spacer — share one vertical edge. */
const ORDER_LABEL_COL = "w-14 text-xs text-stone-600 dark:text-stone-400"

/** Order-by select values are PREFIXED (`alpha` / `f:<name>`) so a dataset
 * field literally named "Alphabetical" can't collide with the standard
 * option. */
const fieldKey = (name: string) => `f:${name}`
const keyToField = (key: string) =>
	key.startsWith("f:") ? key.slice(2) : null

/** Renders the levels of a categorical/ordinal field with up/down arrows —
 * and drag-to-reorder on the rows themselves — so the user can pin a
 * specific axis order. The default order is smart-sort (numeric for
 * ordinal-numerics, alpha otherwise); explicit reordering persists into
 * `currentFieldLevelOrdersAtom`.
 *
 * "Order by" is one-shot: picking a quantitative/temporal field, an
 * "in <level> of <variable>" scope, or Alphabetical (or toggling Decreasing)
 * computes an order and pins it like any manual reorder — the arrows keep
 * working on the result, and a manual move drops the picker back to "—"
 * since the order is no longer purely the computed one. */
const LevelReorderPanel = ({
	field,
	type,
	effectiveFields,
	pinnedOrder,
	setPinnedOrder,
}: {
	field: string
	type: FieldType
	effectiveFields: EffectiveField[]
	pinnedOrder: string[] | undefined
	setPinnedOrder: (next: string[] | null) => void
}) => {
	const dataset = useCurrentDatasetView()
	const [collapsed, setCollapsed] = useState(false)
	const [orderBy, setOrderBy] = useState("")
	const [scopeVar, setScopeVar] = useState("")
	const [scopeLevel, setScopeLevel] = useState("")
	const [decreasing, setDecreasing] = useState(false)
	// Drag state lives here rather than in dataTransfer so only rows from
	// THIS field's panel can accept the drop — a level drag is meaningless
	// in another field's list, and a foreign drag (library folder/visual)
	// never sets it.
	const [dragIndex, setDragIndex] = useState<number | null>(null)
	// Insertion SLOT, 0…length: the gap the dragged row would land in.
	const [dropSlot, setDropSlot] = useState<number | null>(null)
	if (!dataset) return null

	// Discover the unique values for this field, then apply the user's
	// pinned ordering on top so the displayed list reflects what the chart
	// will actually render.
	const discovered: string[] = [
		...new Set(
			dataset.rows
				.map((r) => r[field])
				.filter((v) => v !== undefined && v !== null && String(v) !== "")
				.map(String)
		),
	]
	const ordered = applyLevelOrder(discovered, type, pinnedOrder)

	// Fields a level order can be computed FROM: quantitative or temporal by
	// effective type — the only types with a meaningful per-level aggregate
	// (sum / earliest).
	const orderByCandidates = effectiveFields.filter(
		(f): f is { name: string; type: "quantitative" | "temporal" } =>
			f.type === "quantitative" || f.type === "temporal"
	)
	const byField = keyToField(orderBy)
	// "in the <level> of <variable>" scope candidates: any OTHER field —
	// including quantitative ones, since a numeric-inferred `year` must
	// qualify. Excludes the order-by field itself (a self-scope is nonsense).
	const scopeVarCandidates = effectiveFields.filter(
		(f) => f.name !== field && f.name !== byField
	)
	const scopeVarType = effectiveFields.find((f) => f.name === scopeVar)?.type
	const scopeLevels =
		scopeVar === ""
			? []
			: smartSortCategories(
					[
						...new Set(
							dataset.rows
								.map((r) => r[scopeVar])
								.filter(
									(v) => v !== undefined && v !== null && String(v) !== ""
								)
								.map(String)
						),
					],
					scopeVarType ?? "categorical"
				)

	const clearPicker = () => {
		setOrderBy("")
		setScopeVar("")
		setScopeLevel("")
		setDecreasing(false)
	}

	const move = (idx: number, delta: number) => {
		const next = [...ordered]
		const target = idx + delta
		if (target < 0 || target >= next.length) return
		const tmp = next[idx]
		const other = next[target]
		if (tmp === undefined || other === undefined) return
		next[idx] = other
		next[target] = tmp
		setPinnedOrder(next)
		clearPicker()
	}

	/** Drag reorder: pull the row out and re-insert it at `slot`, an
	 * insertion gap indexed against the ORIGINAL list (so slot n appends). */
	const moveTo = (from: number, slot: number) => {
		if (slot === from || slot === from + 1) return
		const next = [...ordered]
		const [item] = next.splice(from, 1)
		if (item === undefined) return
		next.splice(slot > from ? slot - 1 : slot, 0, item)
		setPinnedOrder(next)
		clearPicker()
	}

	const endDrag = () => {
		setDragIndex(null)
		setDropSlot(null)
	}

	/** Re-pin with the given picker settings. A half-picked scope (variable
	 * chosen, level not yet) applies UNSCOPED rather than going inert, so the
	 * chart order never lags the controls. */
	const applyOrderBy = (key: string, desc: boolean, sVar: string, sLevel: string) => {
		if (key === "alpha") {
			setPinnedOrder(alphabeticalLevelOrder(discovered, desc))
			return
		}
		const name = keyToField(key)
		const candidate = orderByCandidates.find((c) => c.name === name)
		if (!candidate) return
		const scope =
			sVar !== "" && sLevel !== "" ? { field: sVar, value: sLevel } : undefined
		setPinnedOrder(
			orderLevelsByField(
				dataset.rows,
				field,
				type,
				candidate.name,
				candidate.type,
				desc,
				scope
			)
		)
	}

	const reset = () => {
		setPinnedOrder(null)
		clearPicker()
	}

	/** Flip the CURRENT displayed order — pinned, computed, or the smart-sort
	 * default — and pin the result, like any other manual move. Distinct from
	 * the picker's Decreasing box, which only flips a computed order. */
	const reverse = () => {
		setPinnedOrder([...ordered].reverse())
		clearPicker()
	}

	const hasOverride = !!pinnedOrder && pinnedOrder.length > 0

	// The indicator is suppressed for the two no-op slots (either side of the
	// dragged row) so a drag that changes nothing doesn't look like it will.
	const activeSlot =
		dragIndex !== null &&
		dropSlot !== null &&
		dropSlot !== dragIndex &&
		dropSlot !== dragIndex + 1
			? dropSlot
			: null

	return (
		<div className="mt-1 rounded border border-stone-200 bg-stone-50 p-2 dark:border-stone-700 dark:bg-stone-900/50">
			{orderByCandidates.length > 0 && (
				<div className="mb-2 flex flex-col gap-1">
					<SelectInput
						label="Order by"
						inline
						value={orderBy}
						options={[
							{ value: "", label: "—" },
							{ value: "alpha", label: "Alphabetical" },
							...orderByCandidates.map((c) => ({
								value: fieldKey(c.name),
								label: c.name,
							})),
						]}
						onChange={(next) => {
							setOrderBy(next)
							// A stale scope on the new order-by field would be a
							// self-scope — clear it before applying.
							let sVar = scopeVar
							let sLevel = scopeLevel
							if (keyToField(next) === scopeVar) {
								sVar = ""
								sLevel = ""
								setScopeVar("")
								setScopeLevel("")
							}
							if (next !== "") applyOrderBy(next, decreasing, sVar, sLevel)
						}}
						labelClassName={ORDER_LABEL_COL}
						selectClassName="py-0.5 text-xs"
					/>
					{byField !== null && (
						<div className="flex items-center gap-2">
							<SelectInput
								label="in"
								inline
								value={scopeVar}
								options={[
									{ value: "", label: "all rows" },
									...scopeVarCandidates.map((c) => ({
										value: c.name,
										label: c.name,
									})),
								]}
								onChange={(next) => {
									setScopeVar(next)
									setScopeLevel("")
									applyOrderBy(orderBy, decreasing, next, "")
								}}
								labelClassName={ORDER_LABEL_COL}
								selectClassName="py-0.5 text-xs"
							/>
							{scopeVar !== "" && (
								<SelectInput
									label={`Level of ${scopeVar}`}
									labelClassName="sr-only"
									value={scopeLevel}
									options={[
										{ value: "", label: "—" },
										...scopeLevels.map((v) => ({ value: v, label: v })),
									]}
									onChange={(next) => {
										setScopeLevel(next)
										applyOrderBy(orderBy, decreasing, scopeVar, next)
									}}
									selectClassName="py-0.5 text-xs"
									className="min-w-0"
								/>
							)}
						</div>
					)}
					{orderBy !== "" && (
						<label className="flex items-center gap-2 text-xs">
							<span className="w-14 shrink-0" aria-hidden />
							<input
								type="checkbox"
								checked={decreasing}
								onChange={(e) => {
									setDecreasing(e.target.checked)
									applyOrderBy(orderBy, e.target.checked, scopeVar, scopeLevel)
								}}
								className="h-3 w-3"
							/>
							<span className="text-stone-600 dark:text-stone-400">
								Decreasing
							</span>
						</label>
					)}
				</div>
			)}
			<div className="mb-1 flex items-center justify-between gap-2">
				<span className="text-xs text-stone-600 dark:text-stone-400">
					Levels ({ordered.length})
				</span>
				<div className="flex items-center gap-2 text-xs">
					{ordered.length > 1 && (
						<button
							type="button"
							onClick={reverse}
							className="text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
							title="Flip the current level order end to end"
						>
							reverse
						</button>
					)}
					{hasOverride && (
						<button
							type="button"
							onClick={reset}
							className="text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
							title="Drop the pinned order and use smart-sort"
						>
							reset
						</button>
					)}
					<button
						type="button"
						onClick={() => setCollapsed((c) => !c)}
						className="text-stone-600 hover:text-stone-700 dark:hover:text-stone-200"
					>
						{collapsed ? "show" : "hide"}
					</button>
				</div>
			</div>
			{!collapsed && (
				<ul className="flex flex-col gap-0.5">
					{ordered.map((value, i) => (
						<li
							key={value}
							draggable
							title="Drag to reorder"
							onDragStart={(e) => {
								setDragIndex(i)
								setDropSlot(null)
								// Firefox refuses to start a drag with no payload, even
								// though the drop reads the index from local state.
								e.dataTransfer.setData("text/plain", value)
								e.dataTransfer.effectAllowed = "move"
							}}
							onDragOver={(e) => {
								if (dragIndex === null) return
								// preventDefault is what marks this row a valid target.
								e.preventDefault()
								e.dataTransfer.dropEffect = "move"
								const rect = e.currentTarget.getBoundingClientRect()
								const after = e.clientY - rect.top > rect.height / 2
								setDropSlot(after ? i + 1 : i)
							}}
							onDrop={(e) => {
								if (dragIndex === null) return
								e.preventDefault()
								if (dropSlot !== null) moveTo(dragIndex, dropSlot)
								endDrag()
							}}
							onDragEnd={endDrag}
							className={`flex cursor-grab items-center gap-1 rounded border-y-2 bg-white px-1.5 py-0.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200 ${
								activeSlot === i
									? "border-t-indigo-500"
									: "border-t-transparent"
							} ${
								activeSlot === ordered.length && i === ordered.length - 1
									? "border-b-indigo-500"
									: "border-b-transparent"
							} ${dragIndex === i ? "opacity-50" : ""}`}
						>
							<span
								aria-hidden
								className="flex-shrink-0 select-none leading-none text-stone-400 dark:text-stone-500"
							>
								⠿
							</span>
							<span className="min-w-0 flex-1 truncate" title={value}>
								{value}
							</span>
							<button
								type="button"
								onClick={() => move(i, -1)}
								disabled={i === 0}
								title="Move up"
								className="flex h-5 w-5 items-center justify-center rounded text-stone-600 hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:bg-stone-700"
							>
								↑
							</button>
							<button
								type="button"
								onClick={() => move(i, 1)}
								disabled={i === ordered.length - 1}
								title="Move down"
								className="flex h-5 w-5 items-center justify-center rounded text-stone-600 hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:bg-stone-700"
							>
								↓
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
