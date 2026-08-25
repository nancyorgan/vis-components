import { useState } from "react"
import { useAtom } from "jotai"
import {
	alphabeticalLevelOrder,
	orderLevelsByField,
} from "../../lib/orderLevelsByField"
import { applyLevelOrder, smartSortCategories } from "../../lib/smartSort"
import type { FieldType } from "../../lib/types"
import {
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
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
	const dataset = useCurrentDatasetView()

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
				return (
					<li
						key={field.name}
						className="flex flex-col gap-1 rounded-md border border-stone-200 bg-white px-2 py-1.5 dark:border-stone-700 dark:bg-stone-800"
					>
						<Disclosure>
							{({ open }) => (
								<>
									<div className="flex items-center justify-between gap-2">
										<span
											className="min-w-0 flex-1 truncate text-sm text-stone-800 dark:text-stone-200"
											title={field.name}
										>
											{field.name}
										</span>
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
