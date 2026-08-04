/** Shared sub-components and helpers used across the three facet option
 *  panels (`FacetOptionsPanel` for wrap mode, plus the row / col panels
 *  built on `FacetAxisOptionsPanel`). Lives here — rather than inside
 *  any one panel — so the panels can compose the same controls without
 *  one panel importing UI from another. */

import type { KeyboardEvent } from "react"
import { useEffect, useMemo } from "react"

import { LABEL_COL, LabelSpacer } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"

/** Segmented control for one axis's share mode. Three options:
 *
 *    None  /  Per column (or Per row)  /  All panels
 *
 *  The middle option is only rendered when `perGroupAvailable` —
 *  per-group sharing requires the grid to have 2+ panels in BOTH
 *  directions, otherwise it degenerates to one of the other choices.
 *
 *  Styled to match the existing segmented controls in
 *  `ConnectionOptionsPanel` (Chart type, Stacking) for visual
 *  consistency across the sidebar. */
export type ShareAxisPickerProps = {
	value: "none" | "perGroup" | "all"
	perGroupLabel: string
	perGroupAvailable: boolean
	ariaLabel: string
	onChange: (next: "none" | "perGroup" | "all") => void
}

const buttonClass = (active: boolean) =>
	active
		? "flex items-center justify-center px-2 py-1 text-sm bg-brand-500 text-white"
		: "flex items-center justify-center px-2 py-1 text-sm bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"

export const ShareAxisPicker = ({
	value,
	perGroupLabel,
	perGroupAvailable,
	ariaLabel,
	onChange,
}: ShareAxisPickerProps) => {
	return (
		<div
			role="group"
			aria-label={ariaLabel}
			className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
		>
			<button
				type="button"
				aria-pressed={value === "none"}
				className={buttonClass(value === "none")}
				onClick={() => onChange("none")}
			>
				None
			</button>
			{perGroupAvailable && (
				<button
					type="button"
					aria-pressed={value === "perGroup"}
					className={buttonClass(value === "perGroup")}
					onClick={() => onChange("perGroup")}
				>
					{perGroupLabel}
				</button>
			)}
			<button
				type="button"
				aria-pressed={value === "all"}
				className={buttonClass(value === "all")}
				onClick={() => onChange("all")}
			>
				All panels
			</button>
		</div>
	)
}

/** Polar-chart share picker. Polar axes (R, angle) don't have a
 *  natural row vs. col bias the way cartesian Y / X do, so the picker
 *  surfaces all four options:
 *
 *    None  /  Per row  /  Per column  /  All panels
 *
 *  Per-row and per-col options gate on the grid having ≥ 2 panels in
 *  that dimension — a single-row grid hides "Per row", etc. */
export type PolarShareAxisPickerProps = {
	value: "none" | "perRow" | "perCol" | "all"
	perRowAvailable: boolean
	perColAvailable: boolean
	ariaLabel: string
	onChange: (next: "none" | "perRow" | "perCol" | "all") => void
}

export const PolarShareAxisPicker = ({
	value,
	perRowAvailable,
	perColAvailable,
	ariaLabel,
	onChange,
}: PolarShareAxisPickerProps) => {
	return (
		<div
			role="group"
			aria-label={ariaLabel}
			className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
		>
			<button
				type="button"
				aria-pressed={value === "none"}
				className={buttonClass(value === "none")}
				onClick={() => onChange("none")}
			>
				None
			</button>
			{perRowAvailable && (
				<button
					type="button"
					aria-pressed={value === "perRow"}
					className={buttonClass(value === "perRow")}
					onClick={() => onChange("perRow")}
				>
					Per row
				</button>
			)}
			{perColAvailable && (
				<button
					type="button"
					aria-pressed={value === "perCol"}
					className={buttonClass(value === "perCol")}
					onClick={() => onChange("perCol")}
				>
					Per column
				</button>
			)}
			<button
				type="button"
				aria-pressed={value === "all"}
				className={buttonClass(value === "all")}
				onClick={() => onChange("all")}
			>
				All panels
			</button>
		</div>
	)
}

/* ────────────────────────────────────────────────────────────────────
 * Shared layout pieces. Each takes an optional `className` appended to
 * the root so a caller can add margins without the other panels
 * inheriting them.
 * ──────────────────────────────────────────────────────────────────── */

const cls = (base: string, extra?: string) =>
	extra ? `${base} ${extra}` : base

const boundInputClass =
	"w-16 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
const dimInputClass =
	"w-20 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"

/** "Share ___" label + segmented picker row. `label` is the visible
 *  copy (the standalone panels lowercase the axis name, the wrap panel
 *  doesn't); `ariaLabel` always uses the canonical axis label. */
export const ShareAxisRow = ({
	label,
	className,
	...picker
}: ShareAxisPickerProps & { label: string; className?: string }) => (
	<div
		className={cls(
			"flex items-start gap-2 text-sm text-stone-700 dark:text-stone-300",
			className,
		)}
	>
		<span className={`shrink-0 pt-1 ${LABEL_COL}`}>
			{label}
		</span>
		<div>
			<ShareAxisPicker {...picker} />
		</div>
	</div>
)

/** Secondary checkbox row ("Size rows by …", "Size panels by unit").
 *  Aligns to the control column via a `w-24 shrink-0` spacer — NOT the
 *  label edge ([[sidebar-control-alignment]]). */
export const SizeByCheckboxRow = ({
	label,
	checked,
	onChange,
	className,
}: {
	label: string
	checked: boolean
	onChange: (checked: boolean) => void
	className?: string
}) => (
	<div className={cls("mt-2 flex items-center gap-2 text-sm", className)}>
		<LabelSpacer />
		<label className="flex items-center gap-2 text-stone-700 dark:text-stone-300">
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="cursor-pointer"
			/>
			{label}
		</label>
	</div>
)

/** One row of an axis-range editor: optional entry label (facet value,
 *  "Row 2", …) above a min / max input pair. Entries without a label
 *  render just the input pair (the "overall range" case). */
export type AxisRangeEntry = {
	key: string
	label?: string
	min?: number
	max?: number
	onChange: (bound: "min" | "max", raw: string) => void
}

/** Bordered range-editor section: title, help copy, then one min / max
 *  editor per entry. Serves every share mode — pass a single unlabeled
 *  entry for an overall range, or one labeled entry per row / column /
 *  panel for the per-group modes. */
export const AxisRangeSection = ({
	title,
	help,
	entries,
	className,
}: {
	title: string
	help: string
	entries: AxisRangeEntry[]
	className?: string
}) => (
	<div
		className={cls(
			"mt-2 flex flex-col gap-1 border-t border-stone-200 pt-2 dark:border-stone-700",
			className,
		)}
	>
		<div className="text-sm text-stone-700 dark:text-stone-300">
			{title}
		</div>
		<div className="vc-help">{help}</div>
		<div className="flex flex-col gap-2">
			{entries.map((entry) => (
				<div key={entry.key} className="flex flex-col gap-1 text-sm">
					{entry.label !== undefined && (
						<span
							className="truncate text-stone-700 dark:text-stone-300"
							title={entry.label}
						>
							{entry.label}
						</span>
					)}
					<div className="flex flex-col gap-1">
						<label className="flex items-center gap-2">
							<span className={LABEL_COL}>
								min
							</span>
							<input
								type="number"
								value={entry.min ?? ""}
								onChange={(e) => entry.onChange("min", e.target.value)}
								className={boundInputClass}
							/>
						</label>
						<label className="flex items-center gap-2">
							<span className={LABEL_COL}>
								max
							</span>
							<input
								type="number"
								value={entry.max ?? ""}
								onChange={(e) => entry.onChange("max", e.target.value)}
								className={boundInputClass}
							/>
						</label>
					</div>
				</div>
			))}
		</div>
	</div>
)

/** Gap X / Gap Y input with a reset button that appears when the value
 *  differs from the default. Negative values are intentional — pulling
 *  panels on top of each other is how ridgeline-style facets get drawn. */
export const GapInput = ({
	label,
	value,
	defaultValue,
	onChange,
	className,
}: {
	label: string
	value: number
	defaultValue: number
	onChange: (n: number) => void
	className?: string
}) => (
	<div className={cls("flex items-center gap-2 text-sm", className)}>
		<NumberInput
			label={label}
			labelClassName={LABEL_COL}
			value={value}
			step={1}
			onChange={onChange}
			suffix="px"
		/>
		{value !== defaultValue && (
			<button
				type="button"
				onClick={() => onChange(defaultValue)}
				className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				reset
			</button>
		)}
	</div>
)

/** Panel width / height input with the focus-fill stepping pattern
 *  ([[auto-input-step-from-displayed]]): the placeholder shows the
 *  solver-published auto dimension, and the first interaction — focus,
 *  spinner click, or arrow key — steps from that DISPLAYED value rather
 *  than jumping to min (1). Blank commits null (= auto). */
export const PanelDimInput = ({
	label,
	value,
	autoPx,
	onCommit,
	className,
}: {
	label: string
	value: number | null | undefined
	/** Solver-published auto dimension for the placeholder / step start. */
	autoPx: number | undefined
	onCommit: (next: number | null) => void
	className?: string
}) => {
	// Step start: explicit value → auto dim → 200 (covers the brief mount
	// window before the first layout pass publishes).
	const resolveStart = (): number => {
		if (value != null) return value
		return autoPx && autoPx > 0 ? Math.round(autoPx) : 200
	}
	// Native spinner buttons fire no keydown — they'd jump blank → min.
	// Seed the input with the auto value on focus so every interaction
	// steps from the visible number.
	const onFocus = () => {
		if (value != null) return
		onCommit(resolveStart())
	}
	// Belt-and-suspenders for the first arrow press racing the focus-fill.
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
		const start = resolveStart()
		const step = e.key === "ArrowUp" ? 1 : -1
		e.preventDefault()
		onCommit(Math.max(1, start + step))
	}
	return (
		<label className={cls("mt-2 flex items-center gap-2 text-sm", className)}>
			<span className={LABEL_COL}>{label}</span>
			<input
				type="number"
				min={1}
				step={1}
				value={value ?? ""}
				placeholder={autoPx ? String(autoPx) : "auto"}
				onChange={(e) => {
					const raw = e.target.value.trim()
					if (raw === "") {
						onCommit(null)
						return
					}
					const n = Number(raw)
					if (Number.isFinite(n) && n > 0) onCommit(n)
				}}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
				className={dimInputClass}
			/>
			<span className="text-stone-600 dark:text-stone-400">px</span>
		</label>
	)
}

/* ────────────────────────────────────────────────────────────────────
 * Shared non-UI helpers.
 * ──────────────────────────────────────────────────────────────────── */

type MinMax = { min?: number; max?: number }

/** Apply one min / max bound edit to an override entry. Empty input
 *  clears that bound; non-numeric garbage returns null (caller ignores
 *  the edit). */
export const withBound = (
	current: MinMax | undefined,
	bound: "min" | "max",
	raw: string,
): MinMax | null => {
	const next: MinMax = { ...(current ?? {}) }
	if (raw.trim() === "") {
		delete next[bound]
	} else {
		const n = Number(raw)
		if (!Number.isFinite(n)) return null
		next[bound] = n
	}
	return next
}

/** Apply one bound edit to a keyed override map. When both bounds on an
 *  entry clear, the entry is dropped entirely. Returns the next map, or
 *  null when the edit was invalid and should be ignored. */
export const withBoundInMap = (
	map: Record<string, MinMax> | undefined,
	key: string,
	bound: "min" | "max",
	raw: string,
): Record<string, MinMax> | null => {
	const next = withBound(map?.[key], bound, raw)
	if (next === null) return null
	const all = { ...(map ?? {}) }
	if (next.min !== undefined || next.max !== undefined) {
		all[key] = next
	} else {
		delete all[key]
	}
	return all
}

/** Invariant: an explicit panel width / height must not coexist with
 *  active proportional sizing on the same axis — they'd fight, and the
 *  explicit dim would silently win at render time. The sizing-toggle
 *  handlers clear the conflicting dim on check, but this enforces the
 *  invariant defensively in case the conflicting state arrives via a
 *  different path (loaded visual, share-mode change that activates a
 *  pre-existing sizing, etc.). */
export const useClearPanelDimWhenSizing = (
	sizingActive: boolean,
	dimValue: number | null | undefined,
	clear: () => void,
) => {
	useEffect(() => {
		if (sizingActive && dimValue != null) clear()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sizingActive, dimValue])
}

/** Unique values of a field (stringified, dataset-encounter order) —
 *  drive the per-row / per-column axis bound override editors. */
export const useUniqueFieldValues = (
	dataset: { rows: Record<string, unknown>[] } | null | undefined,
	field: string | null,
): string[] =>
	useMemo(() => {
		if (!dataset || !field) return []
		const seen = new Set<string>()
		const out: string[] = []
		for (const r of dataset.rows) {
			const v = r[field]
			if (v == null) continue
			const s = String(v)
			if (!seen.has(s)) {
				seen.add(s)
				out.push(s)
			}
		}
		return out
	}, [dataset, field])

/** Unique-value count for a facet field — gates "Per row" / "Per
 *  column" availability (per-group sharing requires 2+ panels in both
 *  directions to differ from "All panels"). Unmapped fields count as a
 *  single panel in that direction. */
export const countUniqueFieldValues = (
	dataset: { rows: Record<string, unknown>[] } | null | undefined,
	field: string | null,
): number => {
	if (!field || !dataset) return 1
	const s = new Set<string>()
	for (const r of dataset.rows) {
		const v = r[field]
		if (v != null) s.add(String(v))
	}
	return s.size
}
