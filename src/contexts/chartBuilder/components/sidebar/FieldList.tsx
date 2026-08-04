import { useState } from "react"
import { useAtom } from "jotai"
import { applyLevelOrder } from "../../lib/smartSort"
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

/** Renders the levels of a categorical/ordinal field with up/down arrows so
 * the user can pin a specific axis order. The default order is smart-sort
 * (numeric for ordinal-numerics, alpha otherwise); explicit reordering
 * persists into `currentFieldLevelOrdersAtom`. */
const LevelReorderPanel = ({
	field,
	type,
	pinnedOrder,
	setPinnedOrder,
}: {
	field: string
	type: FieldType
	pinnedOrder: string[] | undefined
	setPinnedOrder: (next: string[] | null) => void
}) => {
	const dataset = useCurrentDatasetView()
	const [collapsed, setCollapsed] = useState(false)
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
	}

	const reset = () => setPinnedOrder(null)

	const hasOverride = !!pinnedOrder && pinnedOrder.length > 0

	return (
		<div className="mt-1 rounded border border-stone-200 bg-stone-50 p-2 dark:border-stone-700 dark:bg-stone-900/50">
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
							className="flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200"
						>
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
