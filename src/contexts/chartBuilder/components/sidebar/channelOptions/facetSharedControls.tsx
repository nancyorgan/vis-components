/** Shared sub-components and helpers used across the three facet option
 *  panels (`FacetOptionsPanel` for wrap mode, plus the row / col panels
 *  built on `FacetAxisOptionsPanel`). Lives here — rather than inside
 *  any one panel — so the panels can compose the same controls without
 *  one panel importing UI from another. */

import { useEffect, useMemo } from "react"
import {
	gridPanelAxisOverride,
	type AxisRangeOverride,
	type FacetConfig,
	type PanelAxisOverride,
} from "../../../lib/channelConfig"
import type { FacetPanelRef } from "../../../lib/facetPanelRef"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL, LabelSpacer } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import { Segmented } from "../../../../../components/ui/Segmented"
import { BreaksField } from "./BreaksField"

/** Segmented control for one axis's share mode. Three options:
 *
 *    None  /  Per column (or Per row)  /  All panels
 *
 *  The middle option is only rendered when `perGroupAvailable` —
 *  per-group sharing requires the grid to have 2+ panels in BOTH
 *  directions, otherwise it degenerates to one of the other choices.
 *
 *  Renders through the shared `Segmented` control, like every other
 *  choose-one-of-a-few row in the sidebar. */
export type ShareAxisPickerProps = {
	value: "none" | "perGroup" | "all"
	perGroupLabel: string
	perGroupAvailable: boolean
	ariaLabel: string
	onChange: (next: "none" | "perGroup" | "all") => void
}

const ShareAxisPicker = ({
	value,
	perGroupLabel,
	perGroupAvailable,
	ariaLabel,
	onChange,
}: ShareAxisPickerProps) => (
	<Segmented
		ariaLabel={ariaLabel}
		value={value}
		segments={[
			{ key: "none", label: "None" },
			...(perGroupAvailable
				? [{ key: "perGroup" as const, label: perGroupLabel }]
				: []),
			{ key: "all", label: "All panels" },
		]}
		onChange={onChange}
	/>
)

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
}: PolarShareAxisPickerProps) => (
	<Segmented
		ariaLabel={ariaLabel}
		value={value}
		segments={[
			{ key: "none", label: "None" },
			...(perRowAvailable ? [{ key: "perRow" as const, label: "Per row" }] : []),
			...(perColAvailable
				? [{ key: "perCol" as const, label: "Per column" }]
				: []),
			{ key: "all", label: "All panels" },
		]}
		onChange={onChange}
	/>
)

/* ────────────────────────────────────────────────────────────────────
 * Shared layout pieces. Each takes an optional `className` appended to
 * the root so a caller can add margins without the other panels
 * inheriting them.
 * ──────────────────────────────────────────────────────────────────── */

const cls = (base: string, extra?: string) =>
	extra ? `${base} ${extra}` : base

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
			"flex items-start gap-2 text-sm vc-text",
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
		<Checkbox label={label} checked={checked} onChange={onChange} />
	</div>
)

/** One row of an axis-range editor: optional entry label (facet value,
 *  "Row 2", …) above a min / max input pair. Entries without a label
 *  render just the input pair (the "overall range" case). An entry with
 *  `onTicksChange` also offers "Replace ticks" under max: checking it
 *  opens a box whose values REPLACE the ticks of the panels that entry
 *  bounds (`AxisRangeOverride.ticks`). `ticks` present = checked. */
export type AxisRangeEntry = {
	key: string
	label?: string
	min?: number
	max?: number
	onChange: (bound: "min" | "max", raw: string) => void
	ticks?: readonly number[]
	/** `undefined` = unchecked (the entry's ticks are dropped). */
	onTicksChange?: (ticks: number[] | undefined) => void
}

/** "Replace ticks" checkbox + its "Ticks at" box for one range entry. */
const CustomTicksControl = ({
	entryLabel,
	ticks,
	isTemporal,
	onChange,
}: {
	entryLabel?: string
	ticks: readonly number[] | undefined
	isTemporal: boolean
	onChange: (ticks: number[] | undefined) => void
}) => (
	<>
		<div className="flex items-center gap-2 text-sm">
			<LabelSpacer />
			<Checkbox
				// The entry name rides along for screen readers (and tests) so the
				// per-panel checkboxes are distinguishable.
				label={
					<>
						Replace ticks
						{entryLabel && <span className="sr-only"> for {entryLabel}</span>}
					</>
				}
				checked={ticks !== undefined}
				onChange={(on) => onChange(on ? [] : undefined)}
			/>
		</div>
		{ticks !== undefined && (
			<BreaksField
				label="Ticks at"
				isTemporal={isTemporal}
				breaks={ticks}
				onCommit={onChange}
				changed={ticks.length > 0}
				hint="Replaces the automatic ticks and any custom breaks. Ticks outside the range aren't shown."
			/>
		)}
	</>
)

/** Bordered range-editor section: title, then one min / max
 *  editor per entry. Serves every share mode — pass a single unlabeled
 *  entry for an overall range, or one labeled entry per row / column /
 *  panel for the per-group modes. `collapsible` folds the body under a
 *  chevron header (collapsed by default) for the long per-panel lists.
 *  Every call site already sits inside a white subsection card, so the
 *  nested subsection is unboxed — no purple card-in-card. */
export const AxisRangeSection = ({
	title,
	entries,
	collapsible = false,
	isTemporal = false,
	className,
}: {
	title: string
	entries: AxisRangeEntry[]
	collapsible?: boolean
	/** Date axis: custom tick values read and print as dates. */
	isTemporal?: boolean
	className?: string
}) => {
	const body = (
		<>
			<div className="flex flex-col gap-2">
				{entries.map((entry) => (
					<div key={entry.key} className="flex flex-col gap-1 text-sm">
						{entry.label !== undefined && (
							<span
								className="truncate vc-group-header"
							>
								{entry.label}
							</span>
						)}
						<div className="flex flex-col gap-1">
							<NumberInput
								label="Min"
								labelClassName={LABEL_COL}
								value={entry.min ?? null}
								onChange={(n) => entry.onChange("min", String(n))}
								onClear={() => entry.onChange("min", "")}
								inputClassName="w-16"
							/>
							<NumberInput
								label="Max"
								labelClassName={LABEL_COL}
								value={entry.max ?? null}
								onChange={(n) => entry.onChange("max", String(n))}
								onClear={() => entry.onChange("max", "")}
								inputClassName="w-16"
							/>
							{entry.onTicksChange && (
								<CustomTicksControl
									entryLabel={entry.label}
									ticks={entry.ticks}
									isTemporal={isTemporal}
									onChange={entry.onTicksChange}
								/>
							)}
						</div>
					</div>
				))}
			</div>
		</>
	)
	return (
		<div className={cls("vc-divider-group", className)}>
			{collapsible ? (
				<CollapsibleSubsection
					title={title}
					boxed={false}
					changed={entries.some(
						(e) =>
							e.min !== undefined ||
							e.max !== undefined ||
							(e.ticks?.length ?? 0) > 0,
					)}
				>
					{body}
				</CollapsibleSubsection>
			) : (
				<>
					<div className="text-sm vc-text">{title}</div>
					{body}
				</>
			)}
		</div>
	)
}

/** Gap X / Gap Y input with a reset button that appears when the value
 *  differs from the default. The gap runs plot edge to plot edge, so 0
 *  means neighbouring plots touch. Negative values are intentional — pulling
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
			<ResetLink onClick={() => onChange(defaultValue)} />
		)}
	</div>
)

/** Panel width / height input ([[auto-input-step-from-displayed]]): the
 *  placeholder shows the solver-published auto dimension, and the first
 *  spinner click / arrow key steps from that DISPLAYED value rather than
 *  jumping to min (1). Blank commits null (= auto). A "reset" link appears
 *  while a value is set — same idiom as `GapInput` — so returning to auto
 *  doesn't rely on the user discovering that an emptied field means auto. */
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
	// Before the first layout pass publishes an auto dim the placeholder
	// reads "auto"; `stepBase` keeps the first step sensible (200) instead
	// of dropping to min.
	return (
		<div className={cls("flex items-center gap-2 text-sm", className)}>
			<NumberInput
				label={label}
				labelClassName={LABEL_COL}
				min={1}
				step={1}
				value={value ?? null}
				placeholder={autoPx && autoPx > 0 ? String(Math.round(autoPx)) : "Auto"}
				stepBase={200}
				onChange={(n) => {
					if (n > 0) onCommit(n)
				}}
				onClear={() => onCommit(null)}
				suffix="px"
			/>
			{value != null && (
				<ResetLink
					onClick={() => onCommit(null)}
					ariaLabel={`Reset ${label.toLowerCase()}`}
				/>
			)}
		</div>
	)
}

/* ────────────────────────────────────────────────────────────────────
 * Shared non-UI helpers.
 * ──────────────────────────────────────────────────────────────────── */

type MinMax = AxisRangeOverride

/** Apply one min / max bound edit to an override entry. Empty input
 *  clears that bound; non-numeric garbage returns null (caller ignores
 *  the edit). Custom ticks on the entry ride along. */
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

/** Set (or, with `undefined`, drop) an override entry's custom ticks. */
export const withTicks = (
	current: MinMax | undefined,
	ticks: number[] | undefined,
): MinMax => {
	const next: MinMax = { ...(current ?? {}) }
	if (ticks === undefined) delete next.ticks
	else next.ticks = ticks
	return next
}

const isEmptyEntry = (e: object): boolean =>
	Object.values(e).every((v) => v === undefined)

/** Store `next` under `key`, dropping the key once the entry is empty. */
const withEntryInMap = <T extends object>(
	map: Record<string, T> | undefined,
	key: string,
	next: T,
): Record<string, T> => {
	const all = { ...(map ?? {}) }
	if (isEmptyEntry(next)) delete all[key]
	else all[key] = next
	return all
}

/** Apply one bound edit to a keyed override map. When the entry has
 *  nothing left (no bounds, no custom ticks), it is dropped entirely.
 *  Returns the next map, or null when the edit was invalid and should be
 *  ignored. */
export const withBoundInMap = (
	map: Record<string, MinMax> | undefined,
	key: string,
	bound: "min" | "max",
	raw: string,
): Record<string, MinMax> | null => {
	const next = withBound(map?.[key], bound, raw)
	return next === null ? null : withEntryInMap(map, key, next)
}

/** Custom-ticks counterpart of `withBoundInMap`. */
export const withTicksInMap = (
	map: Record<string, MinMax> | undefined,
	key: string,
	ticks: number[] | undefined,
): Record<string, MinMax> =>
	withEntryInMap(map, key, withTicks(map?.[key], ticks))

/** An edit to one panel's override entry: the next entry — `undefined`
 *  once nothing is left on it, so the caller drops it — or `null` when the
 *  edit was invalid and should be ignored. */
type PanelEntryEdit = (
	entry: PanelAxisOverride | undefined,
) => PanelAxisOverride | undefined | null

const compactPanelEntry = (
	next: PanelAxisOverride,
): PanelAxisOverride | undefined => (isEmptyEntry(next) ? undefined : next)

/** One bound edit (xMin / xMax / yMin / yMax). Empty input clears it. */
const panelBoundEdit =
	(bound: "xMin" | "xMax" | "yMin" | "yMax", raw: string): PanelEntryEdit =>
	(entry) => {
		const next: PanelAxisOverride = { ...(entry ?? {}) }
		if (raw.trim() === "") {
			delete next[bound]
		} else {
			const n = Number(raw)
			if (!Number.isFinite(n)) return null
			next[bound] = n
		}
		return compactPanelEntry(next)
	}

/** Set (or, with `undefined`, drop) xTicks / yTicks. */
const panelTicksEdit =
	(field: "xTicks" | "yTicks", ticks: number[] | undefined): PanelEntryEdit =>
	(entry) => {
		const next: PanelAxisOverride = { ...(entry ?? {}) }
		if (ticks === undefined) delete next[field]
		else next[field] = ticks
		return compactPanelEntry(next)
	}

const applyPanelEdit = (
	map: Record<string, PanelAxisOverride> | undefined,
	panelKey: string,
	edit: PanelEntryEdit,
): Record<string, PanelAxisOverride> | null => {
	const next = edit(map?.[panelKey])
	if (next === null) return null
	const all = { ...(map ?? {}) }
	if (next) all[panelKey] = next
	else delete all[panelKey]
	return all
}

/** Apply one bound edit to the wrap panel's per-panel `panelAxisOverrides`
 *  map (keyed by facet value). When nothing is left on the panel's entry,
 *  it is dropped. Returns the next map, or null when the edit was invalid
 *  and should be ignored. */
export const withPanelBound = (
	map: Record<string, PanelAxisOverride> | undefined,
	panelKey: string,
	bound: "xMin" | "xMax" | "yMin" | "yMax",
	raw: string,
): Record<string, PanelAxisOverride> | null =>
	applyPanelEdit(map, panelKey, panelBoundEdit(bound, raw))

/** Custom-ticks counterpart of `withPanelBound`. */
export const withPanelTicks = (
	map: Record<string, PanelAxisOverride> | undefined,
	panelKey: string,
	field: "xTicks" | "yTicks",
	ticks: number[] | undefined,
): Record<string, PanelAxisOverride> =>
	applyPanelEdit(map, panelKey, panelTicksEdit(field, ticks)) ?? {}

/** Apply one edit to a GRID panel's entry — the row / column panels'
 *  "range per panel" editor when the other direction has 2+ panels. Writes
 *  `gridPanelAxisOverrides[row][col]` (dropping an emptied entry, and an
 *  emptied row) and clears the joined-key entry a pre-structure build left
 *  in `panelAxisOverrides` for the same panel, so the first edit after an
 *  upgrade leaves one source of truth. Returns the config patch, or null
 *  when the edit was invalid and should be ignored. A wrap-mode reference
 *  (a bare facet value) edits `panelAxisOverrides` instead. */
const applyGridPanelEdit = (
	cfg: Pick<FacetConfig, "gridPanelAxisOverrides" | "panelAxisOverrides">,
	ref: FacetPanelRef,
	edit: PanelEntryEdit,
): Partial<FacetConfig> | null => {
	if (typeof ref === "string") {
		const flat = applyPanelEdit(cfg.panelAxisOverrides, ref, edit)
		return flat ? { panelAxisOverrides: flat } : null
	}
	const next = edit(gridPanelAxisOverride(cfg, ref.row, ref.col))
	if (next === null) return null
	const grid = { ...(cfg.gridPanelAxisOverrides ?? {}) }
	const byCol = { ...(grid[ref.row] ?? {}) }
	if (next) byCol[ref.col] = next
	else delete byCol[ref.col]
	if (Object.keys(byCol).length > 0) grid[ref.row] = byCol
	else delete grid[ref.row]
	const legacyKey = `${ref.row}|${ref.col}`
	if (cfg.panelAxisOverrides && legacyKey in cfg.panelAxisOverrides) {
		const flat = { ...cfg.panelAxisOverrides }
		delete flat[legacyKey]
		return { gridPanelAxisOverrides: grid, panelAxisOverrides: flat }
	}
	return { gridPanelAxisOverrides: grid }
}

/** One bound edit to a grid (or wrap) panel's entry — see
 *  `applyGridPanelEdit`. */
export const withGridPanelBound = (
	cfg: Pick<FacetConfig, "gridPanelAxisOverrides" | "panelAxisOverrides">,
	ref: FacetPanelRef,
	bound: "xMin" | "xMax" | "yMin" | "yMax",
	raw: string,
): Partial<FacetConfig> | null =>
	applyGridPanelEdit(cfg, ref, panelBoundEdit(bound, raw))

/** Custom-ticks counterpart of `withGridPanelBound`. */
export const withGridPanelTicks = (
	cfg: Pick<FacetConfig, "gridPanelAxisOverrides" | "panelAxisOverrides">,
	ref: FacetPanelRef,
	field: "xTicks" | "yTicks",
	ticks: number[] | undefined,
): Partial<FacetConfig> =>
	applyGridPanelEdit(cfg, ref, panelTicksEdit(field, ticks)) ?? {}

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
