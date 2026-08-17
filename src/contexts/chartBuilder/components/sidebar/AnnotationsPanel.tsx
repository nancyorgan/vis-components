import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { SectionChevron } from "../../../../components/ui/Chevron"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../components/ui/SelectInput"
import {
	DEFAULT_RECTANGLE_TEXT,
	newCircle,
	newLineSegment,
	newRectangle,
	type AnnotationsConfig,
	type CircleAnnotation,
	type LineSegmentAnnotation,
	type RectangleAnnotation,
} from "../../lib/annotationsConfig"
import {
	DEFAULT_FACET_CONFIG,
	type FacetConfig,
	type LineDashPattern,
} from "../../lib/channelConfig"
import {
	FONT_FAMILY_OPTIONS,
	fontWeightOptionsFor,
} from "../../lib/labelsConfig"
import { AlignmentControl } from "./LabelsPanel"
import { useChartModeDef } from "../../store/useChartModeDef"
import { effectiveType } from "../../lib/fieldType"
import { resolveFacetPanels } from "../../lib/resolveFacetPanels"
import type { FieldType } from "../../lib/types"
import {
	currentAnnotationsAtom,
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

const DASH_OPTIONS: LineDashPattern[] = [
	"solid",
	"dashed",
	"dotted",
	"dash-dot",
]

/** Font-family choices for rectangle text, mirroring the Caption panel. */
const FAMILY_OPTIONS = FONT_FAMILY_OPTIONS.map((opt) => ({
	value: opt.value,
	label: opt.label,
}))

/** Seed values the `new*` factories write, so each style control can offer a
 *  "reset" link that only shows when the current value differs from the
 *  default and snaps back to exactly what a freshly-added annotation has.
 *  Mirrors the per-shape factories in `annotationsConfig.ts`. */
const RECT_STYLE_DEFAULTS = newRectangle("")
const CIRCLE_STYLE_DEFAULTS = newCircle("")
const LINE_STYLE_DEFAULTS = newLineSegment("")

/** Shared collapsible shell for one annotation's editor. The header row —
 *  expand/collapse chevron, name box, remove link — is always visible so a
 *  long list of annotations stays scannable; the body (position, style,
 *  layer controls) renders only while expanded. Collapse state lives in the
 *  parent so a freshly added annotation starts open while existing ones
 *  stay collapsed. */
const AnnotationCard = ({
	name,
	namePlaceholder,
	onNameChange,
	onRemove,
	open,
	onToggle,
	children,
}: {
	name: string
	namePlaceholder?: string
	onNameChange: (name: string) => void
	onRemove: () => void
	open: boolean
	onToggle: () => void
	children: ReactNode
}) => (
	<div className="vc-option-panel">
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				aria-label={open ? "Collapse annotation" : "Expand annotation"}
				className="flex h-6 w-4 flex-shrink-0 items-center justify-center text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				<SectionChevron open={open} />
			</button>
			<input
				type="text"
				value={name}
				placeholder={namePlaceholder}
				onChange={(e) => onNameChange(e.target.value)}
				className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500"
			/>
			<button
				type="button"
				onClick={onRemove}
				className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				remove
			</button>
		</div>
		{open && children}
	</div>
)

/** Round `n` to a short, human-readable representation. Strips trailing
 *  zeros that JavaScript's float arithmetic introduces (e.g.,
 *  `12.34 / 100 * 100 = 12.339999999`) so the position-adjuster inputs
 *  don't fill up with noise after a blur/round-trip. */
const cleanNumber = (n: number): number => {
	if (!Number.isFinite(n)) return n
	// `toPrecision(10)` keeps enough digits for any reasonable axis value
	// while parseFloat re-parses to drop trailing zeros from the string.
	return parseFloat(n.toPrecision(10))
}

/** Coerce a stored value to a number for percent-mode math. Strings
 *  (left over from a previous values-mode setting on a categorical
 *  axis) coerce to 0 here — the user's display in percent mode is
 *  meaningless on those anyway. */
const toNumber = (v: number | string): number => {
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** Picks the right input for an axis: a dropdown of unique categories
 *  for categorical/string-ordinal axes, a number input for everything
 *  else. The renderer treats string values as category labels and
 *  numeric values as scaled positions. */
const AxisValueInput = ({
	label,
	value,
	axis,
	onChange,
	labelClassName,
}: {
	label: string
	value: number | string
	axis: AxisInfo
	onChange: (next: number | string) => void
	labelClassName?: string
}) => {
	// Categorical-or-string-ordinal: dropdown.
	if (axis.categories && axis.categories.length > 0) {
		const current = typeof value === "string" ? value : (axis.categories[0] ?? "")
		return (
			<SelectInput
				label={label}
				value={current}
				options={axis.categories.map((c) => ({ value: c, label: c }))}
				onChange={(v) => onChange(v)}
				labelClassName={labelClassName}
			/>
		)
	}
	// Numeric / temporal / numeric-ordinal: number input.
	const numericValue = typeof value === "number" ? value : Number(value)
	return (
		<NumberInput
			label={label}
			value={cleanNumber(Number.isFinite(numericValue) ? numericValue : 0)}
			step={1}
			onChange={(v) => onChange(v)}
			labelClassName={labelClassName}
		/>
	)
}

/** Sidebar editor for rectangle annotations. The position math is
 *  plot-area-normalized — see `annotationsConfig.ts` for the coordinate
 *  convention. The actual drawing happens in PlotCanvas, which converts
 *  the percent coords to pixel coords against each panel's `inner` rect. */
/** Resolved per-axis info used by the panel to pick number-input vs.
 *  category-dropdown for `values` mode. Mirrors the resolution PlotCanvas
 *  does at render time so the panel and the renderer agree on what each
 *  axis represents in the current chart mode. */
type AxisInfo = {
	field: string | null
	type: FieldType | null
	categories: string[] | null
	/** Data min for numeric/temporal axes. Stored as a number (timestamp
	 *  in ms for temporal) so the percent↔values conversion below can lerp
	 *  uniformly. `null` when the axis is categorical or empty. */
	dataMin: number | null
	dataMax: number | null
}

/** Convert a stored percent coord (0–1) to a data-mode value using the
 *  axis info. Categorical axes pick the category at that position;
 *  numeric/temporal lerp between data min and max. Returns the original
 *  value unchanged when conversion isn't possible (no axis info). */
const percentToValue = (
	percent: number,
	axis: AxisInfo,
): number | string => {
	if (axis.categories && axis.categories.length > 0) {
		const idx = Math.max(
			0,
			Math.min(
				axis.categories.length - 1,
				Math.round(percent * (axis.categories.length - 1)),
			),
		)
		return axis.categories[idx] ?? ""
	}
	if (axis.dataMin !== null && axis.dataMax !== null) {
		const lerped = axis.dataMin + percent * (axis.dataMax - axis.dataMin)
		return cleanNumber(lerped)
	}
	return percent
}

/** Inverse of `percentToValue` — convert a data-mode value back to its
 *  0–1 position on the axis so the percent boxes show the live numbers
 *  after a toggle. */
const valueToPercent = (
	value: number | string,
	axis: AxisInfo,
): number => {
	if (axis.categories && axis.categories.length > 0) {
		const idx = axis.categories.indexOf(String(value))
		if (idx < 0) return 0
		return axis.categories.length <= 1
			? 0.5
			: idx / (axis.categories.length - 1)
	}
	if (axis.dataMin !== null && axis.dataMax !== null) {
		const num = typeof value === "number" ? value : Number(value)
		if (!Number.isFinite(num)) return 0
		if (axis.dataMax === axis.dataMin) return 0.5
		return (num - axis.dataMin) / (axis.dataMax - axis.dataMin)
	}
	return typeof value === "number" ? value : 0
}

/** Suggestion (placeholder) label for the Nth annotation of a kind:
 *  "Rectangle", "Rectangle 2", "Rectangle 3", … Shown as light placeholder
 *  text so the user can tell the shapes apart, but is nudged to type a more
 *  descriptive name (which replaces the suggestion). */
const nameSuggestion = (base: string, index: number): string =>
	index === 0 ? base : `${base} ${index + 1}`

/** Per-annotation facet targeting. "Apply to all facets" checked ⇒
 *  `facetKeys` is null = every panel (the default). Unchecking reveals a
 *  checkbox per facet so the user picks exactly which panels the annotation
 *  is drawn on. Only rendered when the chart is actually faceted. */
const FacetScopeControl = ({
	facetKeys,
	facetOptions,
	onChange,
}: {
	facetKeys: string[] | null | undefined
	facetOptions: readonly string[]
	onChange: (next: string[] | null) => void
}) => {
	const applyAll = facetKeys == null
	return (
		/* px-2: this control renders as a bare sibling of the boxed subsections
		 * inside each editor's purple panel, so pad it to their content edge. */
		<div className="flex flex-col gap-1.5 px-2">
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={applyAll}
					onChange={(e) =>
						onChange(e.target.checked ? null : [...facetOptions])
					}
					className="h-3 w-3"
				/>
				<span className="text-stone-600 dark:text-stone-400">
					Apply to all facets
				</span>
			</label>
			{!applyAll && (
				<div className="flex flex-col gap-1 pl-5">
					{facetOptions.map((key) => (
						<label key={key} className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={facetKeys?.includes(key) ?? false}
								onChange={(e) => {
									const set = new Set(facetKeys ?? [])
									if (e.target.checked) set.add(key)
									else set.delete(key)
									// Keep stored keys in panel order for stable display.
									onChange(facetOptions.filter((k) => set.has(k)))
								}}
								className="h-3 w-3"
							/>
							<span
								className="min-w-0 truncate text-stone-700 dark:text-stone-300"
								title={key}
							>
								{key}
							</span>
						</label>
					))}
				</div>
			)}
		</div>
	)
}

export const AnnotationsPanel = () => {
	const [cfg, setCfg] = useAtom(currentAnnotationsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()
	const modeId = useChartModeDef().id
	// Facet panels for the current chart — same resolver PlotCanvas renders
	// against, so the keys the user scopes to match the rendered panels. When
	// the chart isn't faceted (`mode === "single"`) we hide the scope control.
	const facetCfg = useMemo<FacetConfig>(
		() => ({ ...DEFAULT_FACET_CONFIG, ...channelConfigs.facet }),
		[channelConfigs.facet],
	)
	const facetPanels = useMemo(
		() =>
			resolveFacetPanels(dataset, encodings, levelOrders, overrides, facetCfg),
		[dataset, encodings, levelOrders, overrides, facetCfg],
	)
	const isFaceted = facetPanels.mode !== "single"
	const facetOptions = facetPanels.values
	// Radar maps onto the same x→angle, y→r convention the renderer uses, so
	// value-mode circle centers read x=angle, y=r. Pies have no value axes.
	const isRadar = modeId === "radar"
	const isPolar =
		isRadar || modeId === "pies" || modeId === "pies-x" || modeId === "pies-y"

	const resolveAxis = (axis: "x" | "y"): AxisInfo => {
		const field =
			axis === "x"
				? isRadar
					? (encodings.angle?.field ?? null)
					: modeId === "bars-y" || modeId === "areas-y"
						? (encodings.length?.field ?? null)
						: modeId === "pies-y" || modeId === "pies"
							? null
							: (encodings.x?.field ?? null)
				: isRadar
					? (encodings.r?.field ?? null)
					: modeId === "bars-x" || modeId === "areas-x"
						? (encodings.length?.field ?? null)
						: modeId === "pies-x" || modeId === "pies"
							? null
							: (encodings.y?.field ?? null)
		if (!field || !dataset)
			return { field, type: null, categories: null, dataMin: null, dataMax: null }
		const type = effectiveType(dataset, field, overrides)
		// For categorical/string-ordinal axes, expose the unique values
		// so the panel can render a dropdown.
		const isCategoricalLike =
			type === "categorical" ||
			(type === "ordinal" &&
				dataset.rows.every((r) => {
					const v = r[field]
					return v === null || v === undefined || typeof v === "string"
				}))
		const categories = isCategoricalLike
			? [
					...new Set(
						dataset.rows
							.map((r) => r[field])
							.filter((v): v is string => typeof v === "string" && v !== "")
					),
				]
			: null
		// Numeric / temporal data range — only needed for the
		// percent↔values toggle to lerp between data min and max.
		let dataMin: number | null = null
		let dataMax: number | null = null
		if (!isCategoricalLike) {
			const nums: number[] = []
			for (const row of dataset.rows) {
				const raw = row[field]
				if (raw === null || raw === undefined || raw === "") continue
				const n =
					type === "temporal"
						? new Date(String(raw)).getTime()
						: Number(raw)
				if (Number.isFinite(n)) nums.push(n)
			}
			if (nums.length > 0) {
				dataMin = Math.min(...nums)
				dataMax = Math.max(...nums)
			}
		}
		return { field, type, categories, dataMin, dataMax }
	}
	const xAxis = resolveAxis("x")
	const yAxis = resolveAxis("y")

	// Which annotation editors are expanded. Everything starts collapsed so a
	// long list reads as a compact set of name rows; adding a new annotation
	// expands it for immediate editing. Local state (resets on unmount), same
	// trade-off CollapsibleSubsection makes.
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
	const setExpanded = (id: string, open: boolean) =>
		setExpandedIds((prev) => {
			if (prev.has(id) === open) return prev
			const next = new Set(prev)
			if (open) next.add(id)
			else next.delete(id)
			return next
		})

	const update = (next: AnnotationsConfig) => setCfg(next)
	// Older saved configs (pre-circle) may lack `circles` until migrated;
	// treat a missing list as empty so the panel never reads `undefined`.
	const circles = cfg.circles ?? []
	// Same guard for line segments, which were added after circles.
	const lineSegments = cfg.lineSegments ?? []

	const addRectangle = () => {
		const id = `rect-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 6)}`
		update({ ...cfg, rectangles: [...cfg.rectangles, newRectangle(id)] })
		setExpanded(id, true)
	}

	const updateRect = (id: string, patch: Partial<RectangleAnnotation>) => {
		update({
			...cfg,
			rectangles: cfg.rectangles.map((r) =>
				r.id === id ? { ...r, ...patch } : r
			),
		})
	}

	const removeRect = (id: string) => {
		update({ ...cfg, rectangles: cfg.rectangles.filter((r) => r.id !== id) })
		setExpanded(id, false)
	}

	const addCircle = () => {
		const id = `circle-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 6)}`
		update({ ...cfg, circles: [...circles, newCircle(id)] })
		setExpanded(id, true)
	}

	const updateCircle = (id: string, patch: Partial<CircleAnnotation>) => {
		update({
			...cfg,
			circles: circles.map((c) => (c.id === id ? { ...c, ...patch } : c)),
		})
	}

	const removeCircle = (id: string) => {
		update({ ...cfg, circles: circles.filter((c) => c.id !== id) })
		setExpanded(id, false)
	}

	const addLineSegment = () => {
		const id = `line-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 6)}`
		update({ ...cfg, lineSegments: [...lineSegments, newLineSegment(id)] })
		setExpanded(id, true)
	}

	const updateLine = (id: string, patch: Partial<LineSegmentAnnotation>) => {
		update({
			...cfg,
			lineSegments: lineSegments.map((l) =>
				l.id === id ? { ...l, ...patch } : l
			),
		})
	}

	const removeLine = (id: string) => {
		update({ ...cfg, lineSegments: lineSegments.filter((l) => l.id !== id) })
		setExpanded(id, false)
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={addRectangle}
					className="self-start rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
				>
					+ Add rectangle
				</button>
				<button
					type="button"
					onClick={addCircle}
					className="self-start rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
				>
					+ Add circle
				</button>
				<button
					type="button"
					onClick={addLineSegment}
					className="self-start rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
				>
					+ Add line
				</button>
			</div>
			{cfg.rectangles.length === 0 &&
				circles.length === 0}
			{cfg.rectangles.map((rect, i) => (
				<RectangleEditor
					key={rect.id}
					rect={rect}
					onChange={(patch) => updateRect(rect.id, patch)}
					onRemove={() => removeRect(rect.id)}
					open={expandedIds.has(rect.id)}
					onToggle={() => setExpanded(rect.id, !expandedIds.has(rect.id))}
					xAxis={xAxis}
					yAxis={yAxis}
					disableValues={isPolar}
					namePlaceholder={nameSuggestion("Rectangle", i)}
					facetScope={
						isFaceted ? (
							<FacetScopeControl
								facetKeys={rect.facetKeys}
								facetOptions={facetOptions}
								onChange={(next) => updateRect(rect.id, { facetKeys: next })}
							/>
						) : null
					}
				/>
			))}
			{circles.map((circle, i) => (
				<CircleEditor
					key={circle.id}
					circle={circle}
					onChange={(patch) => updateCircle(circle.id, patch)}
					onRemove={() => removeCircle(circle.id)}
					open={expandedIds.has(circle.id)}
					onToggle={() => setExpanded(circle.id, !expandedIds.has(circle.id))}
					xAxis={xAxis}
					yAxis={yAxis}
					isRadar={isRadar}
					disableValues={isPolar && !isRadar}
					namePlaceholder={nameSuggestion("Circle", i)}
					facetScope={
						isFaceted ? (
							<FacetScopeControl
								facetKeys={circle.facetKeys}
								facetOptions={facetOptions}
								onChange={(next) => updateCircle(circle.id, { facetKeys: next })}
							/>
						) : null
					}
				/>
			))}
			{lineSegments.map((line, i) => (
				<LineSegmentEditor
					key={line.id}
					line={line}
					onChange={(patch) => updateLine(line.id, patch)}
					onRemove={() => removeLine(line.id)}
					open={expandedIds.has(line.id)}
					onToggle={() => setExpanded(line.id, !expandedIds.has(line.id))}
					xAxis={xAxis}
					yAxis={yAxis}
					disableValues={isPolar}
					namePlaceholder={nameSuggestion("Line", i)}
					facetScope={
						isFaceted ? (
							<FacetScopeControl
								facetKeys={line.facetKeys}
								facetOptions={facetOptions}
								onChange={(next) => updateLine(line.id, { facetKeys: next })}
							/>
						) : null
					}
				/>
			))}
		</div>
	)
}

/** Sidebar editor for line-segment annotations. Endpoint A = (xMin, yMin),
 *  endpoint B = (xMax, yMax) — labeled "start"/"end" in the UI. Mirrors
 *  RectangleEditor's coordinate handling (shared percent↔values conversion)
 *  but styles a stroke instead of a fill + border. */
const LineSegmentEditor = ({
	line,
	onChange,
	onRemove,
	open,
	onToggle,
	xAxis,
	yAxis,
	disableValues,
	namePlaceholder,
	facetScope,
}: {
	line: LineSegmentAnnotation
	onChange: (patch: Partial<LineSegmentAnnotation>) => void
	onRemove: () => void
	/** Whether the editor body is expanded; the name row always shows. */
	open: boolean
	onToggle: () => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out "Values (data units)" on polar charts (radar / pie), which
	 *  have no cartesian axes for a straight segment to map against. */
	disableValues?: boolean
	/** Light suggestion shown when the user hasn't named the annotation. */
	namePlaceholder?: string
	/** Facet-targeting control, rendered at the top when faceted (else null). */
	facetScope?: ReactNode
}) => {
	return (
		<AnnotationCard
			name={line.name}
			namePlaceholder={namePlaceholder}
			onNameChange={(name) => onChange({ name })}
			onRemove={onRemove}
			open={open}
			onToggle={onToggle}
		>
			{facetScope}

			<CollapsibleSubsection title="Position">
				<div className="flex flex-col gap-2">
					<SelectInput
						label="Adjust by"
						labelClassName={LABEL_COL}
						value={line.coordSystem}
						options={[
							{ value: "percent", label: "Percent (0–100)" },
							{
								value: "values",
								label: "Values (data units)",
								disabled: disableValues,
							},
						]}
						onChange={(v) => {
							const nextSystem = v as "percent" | "values"
							if (nextSystem === line.coordSystem) return
							if (nextSystem === "values" && disableValues) return
							// Convert endpoints so the new boxes show the equivalent
							// position in the target system, same as RectangleEditor.
							const convert =
								nextSystem === "values"
									? (val: number | string, ax: AxisInfo) =>
											percentToValue(toNumber(val), ax)
									: (val: number | string, ax: AxisInfo) =>
											valueToPercent(val, ax)
							onChange({
								coordSystem: nextSystem,
								xMin: convert(line.xMin, xAxis),
								xMax: convert(line.xMax, xAxis),
								yMin: convert(line.yMin, yAxis),
								yMax: convert(line.yMax, yAxis),
							})
						}}
					/>

					{line.coordSystem === "percent" ? (
						<div className="flex flex-col gap-2">
							<NumberInput
								label="start x %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(line.xMin) * 100)}
								step={1}
								onChange={(v) => onChange({ xMin: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="start y %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(line.yMin) * 100)}
								step={1}
								onChange={(v) => onChange({ yMin: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="end x %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(line.xMax) * 100)}
								step={1}
								onChange={(v) => onChange({ xMax: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="end y %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(line.yMax) * 100)}
								step={1}
								onChange={(v) => onChange({ yMax: v / 100 })}
								suffix="%"
							/>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<AxisValueInput
								label="start x"
								labelClassName={LABEL_COL}
								value={line.xMin}
								axis={xAxis}
								onChange={(v) => onChange({ xMin: v })}
							/>
							<AxisValueInput
								label="start y"
								labelClassName={LABEL_COL}
								value={line.yMin}
								axis={yAxis}
								onChange={(v) => onChange({ yMin: v })}
							/>
							<AxisValueInput
								label="end x"
								labelClassName={LABEL_COL}
								value={line.xMax}
								axis={xAxis}
								onChange={(v) => onChange({ xMax: v })}
							/>
							<AxisValueInput
								label="end y"
								labelClassName={LABEL_COL}
								value={line.yMax}
								axis={yAxis}
								onChange={(v) => onChange({ yMax: v })}
							/>
						</div>
					)}
				</div>
			</CollapsibleSubsection>

			<CollapsibleSubsection title="Line">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<ColorInput
							label="Line"
							labelClassName={LABEL_COL}
							value={line.lineColor}
							onChange={(c) => onChange({ lineColor: c })}
						/>
						{line.lineColor !== LINE_STYLE_DEFAULTS.lineColor && (
							<ResetLink
								onClick={() =>
									onChange({ lineColor: LINE_STYLE_DEFAULTS.lineColor })
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Thickness"
							labelClassName={LABEL_COL}
							value={line.lineThickness}
							step={0.5}
							min={0}
							onChange={(v) => onChange({ lineThickness: v })}
							suffix="px"
						/>
						{line.lineThickness !== LINE_STYLE_DEFAULTS.lineThickness && (
							<ResetLink
								onClick={() =>
									onChange({ lineThickness: LINE_STYLE_DEFAULTS.lineThickness })
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Opacity"
							labelClassName={LABEL_COL}
							value={line.lineOpacity}
							step={0.05}
							min={0}
							max={1}
							onChange={(v) => onChange({ lineOpacity: v })}
						/>
						{line.lineOpacity !== LINE_STYLE_DEFAULTS.lineOpacity && (
							<ResetLink
								onClick={() =>
									onChange({ lineOpacity: LINE_STYLE_DEFAULTS.lineOpacity })
								}
							/>
						)}
					</div>
					<SelectInput
						label="Dash"
						labelClassName={LABEL_COL}
						value={line.lineDash}
						options={DASH_OPTIONS.map((d) => ({ value: d, label: d }))}
						onChange={(v) => onChange({ lineDash: v as LineDashPattern })}
					/>
				</div>
			</CollapsibleSubsection>

			{/* px-2 keeps this bare row's label/control column aligned with the
			 * rows inside the p-2 subsection cards above. */}
			<div className="flex items-center gap-2 px-2 text-sm">
				<span className={LABEL_COL}>Layer</span>
				<div
					role="group"
					aria-label="Layer order"
					className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
				>
					<button
						type="button"
						onClick={() => onChange({ zOrder: "behind" })}
						className={
							line.zOrder === "behind"
								? "bg-brand-500 px-2 py-1 text-sm text-white"
								: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						}
						aria-pressed={line.zOrder === "behind"}
					>
						Behind chart
					</button>
					<button
						type="button"
						onClick={() => onChange({ zOrder: "front" })}
						className={
							line.zOrder === "front"
								? "bg-brand-500 px-2 py-1 text-sm text-white"
								: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						}
						aria-pressed={line.zOrder === "front"}
					>
						In front
					</button>
				</div>
			</div>
		</AnnotationCard>
	)
}

const RectangleEditor = ({
	rect,
	onChange,
	onRemove,
	open,
	onToggle,
	xAxis,
	yAxis,
	disableValues,
	namePlaceholder,
	facetScope,
}: {
	rect: RectangleAnnotation
	onChange: (patch: Partial<RectangleAnnotation>) => void
	onRemove: () => void
	/** Whether the editor body is expanded; the name row always shows. */
	open: boolean
	onToggle: () => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out the "Values (data units)" option — used on polar charts
	 *  (radar / pie) where a rectangle has no cartesian axes to map against. */
	disableValues?: boolean
	/** Light suggestion shown when the user hasn't named the annotation. */
	namePlaceholder?: string
	/** Facet-targeting control, rendered at the top when faceted (else null). */
	facetScope?: ReactNode
}) => {
	return (
		<AnnotationCard
			name={rect.name}
			namePlaceholder={namePlaceholder}
			onNameChange={(name) => onChange({ name })}
			onRemove={onRemove}
			open={open}
			onToggle={onToggle}
		>
			{facetScope}

			<CollapsibleSubsection title="Position">
				<div className="flex flex-col gap-2">
					<SelectInput
						label="Adjust by"
						labelClassName={LABEL_COL}
						value={rect.coordSystem}
						options={[
							{ value: "percent", label: "Percent (0–100)" },
							{
								value: "values",
								label: "Values (data units)",
								disabled: disableValues,
							},
						]}
						onChange={(v) => {
							const nextSystem = v as "percent" | "values"
							if (nextSystem === rect.coordSystem) return
							if (nextSystem === "values" && disableValues) return
							// Convert the stored coords so the new boxes show the
							// equivalent position in the target system. Without
							// this the user sees raw percents being treated as data
							// values (or vice versa).
							const convert =
								nextSystem === "values"
									? (val: number | string, ax: AxisInfo) =>
											percentToValue(toNumber(val), ax)
									: (val: number | string, ax: AxisInfo) =>
											valueToPercent(val, ax)
							onChange({
								coordSystem: nextSystem,
								xMin: convert(rect.xMin, xAxis),
								xMax: convert(rect.xMax, xAxis),
								yMin: convert(rect.yMin, yAxis),
								yMax: convert(rect.yMax, yAxis),
							})
						}}
					/>

					{rect.coordSystem === "percent" ? (
						<div className="flex flex-col gap-2">
							<NumberInput
								label="x min %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(rect.xMin) * 100)}
								step={1}
								onChange={(v) => onChange({ xMin: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="x max %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(rect.xMax) * 100)}
								step={1}
								onChange={(v) => onChange({ xMax: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="y min %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(rect.yMin) * 100)}
								step={1}
								onChange={(v) => onChange({ yMin: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="y max %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(rect.yMax) * 100)}
								step={1}
								onChange={(v) => onChange({ yMax: v / 100 })}
								suffix="%"
							/>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<AxisValueInput
								label="x min"
								labelClassName={LABEL_COL}
								value={rect.xMin}
								axis={xAxis}
								onChange={(v) => onChange({ xMin: v })}
							/>
							<AxisValueInput
								label="x max"
								labelClassName={LABEL_COL}
								value={rect.xMax}
								axis={xAxis}
								onChange={(v) => onChange({ xMax: v })}
							/>
							<AxisValueInput
								label="y min"
								labelClassName={LABEL_COL}
								value={rect.yMin}
								axis={yAxis}
								onChange={(v) => onChange({ yMin: v })}
							/>
							<AxisValueInput
								label="y max"
								labelClassName={LABEL_COL}
								value={rect.yMax}
								axis={yAxis}
								onChange={(v) => onChange({ yMax: v })}
							/>
						</div>
					)}
				</div>
			</CollapsibleSubsection>

			<CollapsibleSubsection title="Fill">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<ColorInput
							label="Fill"
							labelClassName={LABEL_COL}
							value={rect.backgroundColor}
							onChange={(c) => onChange({ backgroundColor: c })}
						/>
						{rect.backgroundColor !== RECT_STYLE_DEFAULTS.backgroundColor && (
							<ResetLink
								onClick={() =>
									onChange({
										backgroundColor: RECT_STYLE_DEFAULTS.backgroundColor,
									})
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Fill opacity"
							labelClassName={LABEL_COL}
							value={rect.backgroundOpacity}
							step={0.05}
							min={0}
							max={1}
							onChange={(v) => onChange({ backgroundOpacity: v })}
						/>
						{rect.backgroundOpacity !==
							RECT_STYLE_DEFAULTS.backgroundOpacity && (
							<ResetLink
								onClick={() =>
									onChange({
										backgroundOpacity: RECT_STYLE_DEFAULTS.backgroundOpacity,
									})
								}
							/>
						)}
					</div>
				</div>
			</CollapsibleSubsection>

			<CollapsibleSubsection title="Border">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<ColorInput
							label="Color"
							labelClassName={LABEL_COL}
							value={rect.borderColor}
							onChange={(c) => onChange({ borderColor: c })}
						/>
						{rect.borderColor !== RECT_STYLE_DEFAULTS.borderColor && (
							<ResetLink
								onClick={() =>
									onChange({ borderColor: RECT_STYLE_DEFAULTS.borderColor })
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Thickness"
							labelClassName={LABEL_COL}
							value={rect.borderThickness}
							step={0.5}
							min={0}
							onChange={(v) => onChange({ borderThickness: v })}
							suffix="px"
						/>
						{rect.borderThickness !== RECT_STYLE_DEFAULTS.borderThickness && (
							<ResetLink
								onClick={() =>
									onChange({
										borderThickness: RECT_STYLE_DEFAULTS.borderThickness,
									})
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Opacity"
							labelClassName={LABEL_COL}
							value={rect.borderOpacity}
							step={0.05}
							min={0}
							max={1}
							onChange={(v) => onChange({ borderOpacity: v })}
						/>
						{rect.borderOpacity !== RECT_STYLE_DEFAULTS.borderOpacity && (
							<ResetLink
								onClick={() =>
									onChange({ borderOpacity: RECT_STYLE_DEFAULTS.borderOpacity })
								}
							/>
						)}
					</div>
					<SelectInput
						label="Dash"
						labelClassName={LABEL_COL}
						value={rect.borderDash}
						options={DASH_OPTIONS.map((d) => ({ value: d, label: d }))}
						onChange={(v) => onChange({ borderDash: v as LineDashPattern })}
					/>
				</div>
			</CollapsibleSubsection>

			<CollapsibleSubsection title="Text">
				<div className="flex flex-col gap-2">
					<label className="flex flex-col gap-1 text-sm">
						<span className="text-stone-600 dark:text-stone-400">
							Text
						</span>
						<textarea
							value={rect.text ?? DEFAULT_RECTANGLE_TEXT.text}
							onChange={(e) => onChange({ text: e.target.value })}
							placeholder="Label drawn inside the rectangle…"
							rows={2}
							className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
						/>
					</label>
					<SelectInput
						label="Font"
						labelClassName={LABEL_COL}
						value={rect.textFontFamily ?? DEFAULT_RECTANGLE_TEXT.textFontFamily}
						options={FAMILY_OPTIONS}
						onChange={(textFontFamily) => onChange({ textFontFamily })}
						selectClassName="flex-1"
					/>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Size"
							labelClassName={LABEL_COL}
							value={rect.textFontSize ?? DEFAULT_RECTANGLE_TEXT.textFontSize}
							min={1}
							step={1}
							onChange={(v) => onChange({ textFontSize: v })}
							suffix="pt"
						/>
						{(rect.textFontSize ?? DEFAULT_RECTANGLE_TEXT.textFontSize) !==
							DEFAULT_RECTANGLE_TEXT.textFontSize && (
							<ResetLink
								onClick={() =>
									onChange({ textFontSize: DEFAULT_RECTANGLE_TEXT.textFontSize })
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<ColorInput
							label="Color"
							labelClassName={LABEL_COL}
							value={rect.textColor ?? DEFAULT_RECTANGLE_TEXT.textColor}
							onChange={(c) => onChange({ textColor: c })}
						/>
						{(rect.textColor ?? DEFAULT_RECTANGLE_TEXT.textColor) !==
							DEFAULT_RECTANGLE_TEXT.textColor && (
							<ResetLink
								onClick={() =>
									onChange({ textColor: DEFAULT_RECTANGLE_TEXT.textColor })
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<SelectInput
							label="Weight"
							labelClassName={LABEL_COL}
							value={String(
								rect.textFontWeight ?? DEFAULT_RECTANGLE_TEXT.textFontWeight,
							)}
							options={fontWeightOptionsFor(
								rect.textFontFamily ?? DEFAULT_RECTANGLE_TEXT.textFontFamily,
								rect.textFontWeight ?? DEFAULT_RECTANGLE_TEXT.textFontWeight
							).map((w) => ({ value: String(w.value), label: w.label }))}
							onChange={(w) => onChange({ textFontWeight: Number(w) })}
						/>
						{(rect.textFontWeight ?? DEFAULT_RECTANGLE_TEXT.textFontWeight) !==
							DEFAULT_RECTANGLE_TEXT.textFontWeight && (
							<ResetLink
								onClick={() =>
									onChange({
										textFontWeight: DEFAULT_RECTANGLE_TEXT.textFontWeight,
									})
								}
							/>
						)}
					</div>
					{/* div, not label: AlignmentControl is a button group, not a form control */}
					<div className="flex items-center gap-2 text-sm">
						<span className={LABEL_COL}>Alignment</span>
						<AlignmentControl
							value={rect.textAlign ?? DEFAULT_RECTANGLE_TEXT.textAlign}
							onChange={(textAlign) => onChange({ textAlign })}
						/>
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Padding"
							labelClassName={LABEL_COL}
							value={rect.textPadding ?? DEFAULT_RECTANGLE_TEXT.textPadding}
							min={0}
							step={1}
							onChange={(v) => onChange({ textPadding: v })}
							suffix="px"
						/>
						{(rect.textPadding ?? DEFAULT_RECTANGLE_TEXT.textPadding) !==
							DEFAULT_RECTANGLE_TEXT.textPadding && (
							<ResetLink
								onClick={() =>
									onChange({ textPadding: DEFAULT_RECTANGLE_TEXT.textPadding })
								}
							/>
						)}
					</div>
				</div>
			</CollapsibleSubsection>

			{/* px-2 keeps this bare row's label/control column aligned with the
			 * rows inside the p-2 subsection cards above. */}
			<div className="flex items-center gap-2 px-2 text-sm">
				<span className={LABEL_COL}>Layer</span>
				<div
					role="group"
					aria-label="Layer order"
					className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
				>
					<button
						type="button"
						onClick={() => onChange({ zOrder: "behind" })}
						className={
							rect.zOrder === "behind"
								? "bg-brand-500 px-2 py-1 text-sm text-white"
								: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						}
						aria-pressed={rect.zOrder === "behind"}
					>
						Behind chart
					</button>
					<button
						type="button"
						onClick={() => onChange({ zOrder: "front" })}
						className={
							rect.zOrder === "front"
								? "bg-brand-500 px-2 py-1 text-sm text-white"
								: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						}
						aria-pressed={rect.zOrder === "front"}
					>
						In front
					</button>
				</div>
			</div>
		</AnnotationCard>
	)
}

/** Convert a percent-mode radius (fraction of the radius-axis extent) to a
 *  data-unit radius along that axis. Falls back to the raw fraction when the
 *  axis has no numeric span (categorical / empty). */
const radiusToValues = (fraction: number, axis: AxisInfo): number => {
	if (axis.dataMin === null || axis.dataMax === null) return fraction
	return cleanNumber(fraction * (axis.dataMax - axis.dataMin))
}

/** Inverse of `radiusToValues` — data-unit radius back to a 0–1 fraction of
 *  the axis extent so the percent box shows a sensible number after toggling. */
const radiusToPercent = (units: number, axis: AxisInfo): number => {
	if (axis.dataMin === null || axis.dataMax === null) return units
	const span = axis.dataMax - axis.dataMin
	if (span === 0) return 0
	return cleanNumber(units / span)
}

/** Sidebar editor for circle annotations. Mirrors RectangleEditor, but a
 *  circle is center + radius rather than four edges. The radius is measured
 *  against a single chosen axis (`radiusAxis`) so it always renders as a true
 *  on-screen circle — see `circleAnnotationGeometry.ts` for the placement. */
const CircleEditor = ({
	circle,
	onChange,
	onRemove,
	open,
	onToggle,
	xAxis,
	yAxis,
	isRadar,
	disableValues,
	namePlaceholder,
	facetScope,
}: {
	circle: CircleAnnotation
	onChange: (patch: Partial<CircleAnnotation>) => void
	onRemove: () => void
	/** Whether the editor body is expanded; the name row always shows. */
	open: boolean
	onToggle: () => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Radar: value-mode center is polar — x=angle, y=r — and the radius is
	 *  always measured on the r-axis, so we relabel the inputs and hide the
	 *  x/y radius-axis toggle. */
	isRadar?: boolean
	/** Gray out the "Values (data units)" option (non-radar polar / pie). */
	disableValues?: boolean
	/** Light suggestion shown when the user hasn't named the annotation. */
	namePlaceholder?: string
	/** Facet-targeting control, rendered at the top when faceted (else null). */
	facetScope?: ReactNode
}) => {
	// On radar the radius is always in r-axis units (yAxis); off-radar it
	// follows the user's radius-axis choice.
	const radiusAxisInfo = isRadar
		? yAxis
		: circle.radiusAxis === "x"
			? xAxis
			: yAxis
	return (
		<AnnotationCard
			name={circle.name}
			namePlaceholder={namePlaceholder}
			onNameChange={(name) => onChange({ name })}
			onRemove={onRemove}
			open={open}
			onToggle={onToggle}
		>
			{facetScope}

			<CollapsibleSubsection title="Position">
				<div className="flex flex-col gap-2">
					<SelectInput
						label="Adjust by"
						labelClassName={LABEL_COL}
						value={circle.coordSystem}
						options={[
							{ value: "percent", label: "Percent (0–100)" },
							{
								value: "values",
								label: "Values (data units)",
								disabled: disableValues,
							},
						]}
						onChange={(v) => {
							const nextSystem = v as "percent" | "values"
							if (nextSystem === circle.coordSystem) return
							if (nextSystem === "values" && disableValues) return
							// Convert center + radius so the new boxes show the equivalent
							// position in the target system, same as RectangleEditor.
							if (nextSystem === "values") {
								onChange({
									coordSystem: "values",
									centerX: percentToValue(toNumber(circle.centerX), xAxis),
									centerY: percentToValue(toNumber(circle.centerY), yAxis),
									radius: radiusToValues(circle.radius, radiusAxisInfo),
								})
							} else {
								onChange({
									coordSystem: "percent",
									centerX: valueToPercent(circle.centerX, xAxis),
									centerY: valueToPercent(circle.centerY, yAxis),
									radius: radiusToPercent(circle.radius, radiusAxisInfo),
								})
							}
						}}
					/>

					{circle.coordSystem === "percent" ? (
						<div className="flex flex-col gap-2">
							<NumberInput
								label="center x %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.centerX) * 100)}
								step={1}
								onChange={(v) => onChange({ centerX: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="center y %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.centerY) * 100)}
								step={1}
								onChange={(v) => onChange({ centerY: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="radius %"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.radius) * 100)}
								step={1}
								min={0}
								onChange={(v) => onChange({ radius: v / 100 })}
								suffix="%"
							/>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<AxisValueInput
								label={isRadar ? "center angle" : "center x"}
								labelClassName={LABEL_COL}
								value={circle.centerX}
								axis={xAxis}
								onChange={(v) => onChange({ centerX: v })}
							/>
							<AxisValueInput
								label={isRadar ? "center r" : "center y"}
								labelClassName={LABEL_COL}
								value={circle.centerY}
								axis={yAxis}
								onChange={(v) => onChange({ centerY: v })}
							/>
							<NumberInput
								label={isRadar ? "radius (r)" : `radius (${circle.radiusAxis})`}
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.radius))}
								step={1}
								min={0}
								onChange={(v) => onChange({ radius: v })}
							/>
						</div>
					)}

					{/* Radar radius is always measured on the r-axis, so the x/y
					    radius-axis choice is meaningless there — hide it. */}
					{!isRadar && (
						<div className="flex items-center gap-2 text-sm">
							<span className={LABEL_COL}>
								Radius axis
							</span>
							<div
								role="group"
								aria-label="Radius axis"
								className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
							>
								<button
									type="button"
									onClick={() => onChange({ radiusAxis: "x" })}
									className={
										circle.radiusAxis === "x"
											? "bg-brand-500 px-2 py-1 text-sm text-white"
											: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
									}
									aria-pressed={circle.radiusAxis === "x"}
								>
									x
								</button>
								<button
									type="button"
									onClick={() => onChange({ radiusAxis: "y" })}
									className={
										circle.radiusAxis === "y"
											? "bg-brand-500 px-2 py-1 text-sm text-white"
											: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
									}
									aria-pressed={circle.radiusAxis === "y"}
								>
									y
								</button>
							</div>
						</div>
					)}
				</div>
			</CollapsibleSubsection>

			<CollapsibleSubsection title="Fill">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<ColorInput
							label="Fill"
							labelClassName={LABEL_COL}
							value={circle.backgroundColor}
							onChange={(c) => onChange({ backgroundColor: c })}
						/>
						{circle.backgroundColor !==
							CIRCLE_STYLE_DEFAULTS.backgroundColor && (
							<ResetLink
								onClick={() =>
									onChange({
										backgroundColor: CIRCLE_STYLE_DEFAULTS.backgroundColor,
									})
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Fill opacity"
							labelClassName={LABEL_COL}
							value={circle.backgroundOpacity}
							step={0.05}
							min={0}
							max={1}
							onChange={(v) => onChange({ backgroundOpacity: v })}
						/>
						{circle.backgroundOpacity !==
							CIRCLE_STYLE_DEFAULTS.backgroundOpacity && (
							<ResetLink
								onClick={() =>
									onChange({
										backgroundOpacity: CIRCLE_STYLE_DEFAULTS.backgroundOpacity,
									})
								}
							/>
						)}
					</div>
				</div>
			</CollapsibleSubsection>

			<CollapsibleSubsection title="Border">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<ColorInput
							label="Color"
							labelClassName={LABEL_COL}
							value={circle.borderColor}
							onChange={(c) => onChange({ borderColor: c })}
						/>
						{circle.borderColor !== CIRCLE_STYLE_DEFAULTS.borderColor && (
							<ResetLink
								onClick={() =>
									onChange({ borderColor: CIRCLE_STYLE_DEFAULTS.borderColor })
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Thickness"
							labelClassName={LABEL_COL}
							value={circle.borderThickness}
							step={0.5}
							min={0}
							onChange={(v) => onChange({ borderThickness: v })}
							suffix="px"
						/>
						{circle.borderThickness !==
							CIRCLE_STYLE_DEFAULTS.borderThickness && (
							<ResetLink
								onClick={() =>
									onChange({
										borderThickness: CIRCLE_STYLE_DEFAULTS.borderThickness,
									})
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Opacity"
							labelClassName={LABEL_COL}
							value={circle.borderOpacity}
							step={0.05}
							min={0}
							max={1}
							onChange={(v) => onChange({ borderOpacity: v })}
						/>
						{circle.borderOpacity !== CIRCLE_STYLE_DEFAULTS.borderOpacity && (
							<ResetLink
								onClick={() =>
									onChange({
										borderOpacity: CIRCLE_STYLE_DEFAULTS.borderOpacity,
									})
								}
							/>
						)}
					</div>
					<SelectInput
						label="Dash"
						labelClassName={LABEL_COL}
						value={circle.borderDash}
						options={DASH_OPTIONS.map((d) => ({ value: d, label: d }))}
						onChange={(v) => onChange({ borderDash: v as LineDashPattern })}
					/>
				</div>
			</CollapsibleSubsection>

			{/* px-2 keeps this bare row's label/control column aligned with the
			 * rows inside the p-2 subsection cards above. */}
			<div className="flex items-center gap-2 px-2 text-sm">
				<span className={LABEL_COL}>Layer</span>
				<div
					role="group"
					aria-label="Layer order"
					className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
				>
					<button
						type="button"
						onClick={() => onChange({ zOrder: "behind" })}
						className={
							circle.zOrder === "behind"
								? "bg-brand-500 px-2 py-1 text-sm text-white"
								: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						}
						aria-pressed={circle.zOrder === "behind"}
					>
						Behind chart
					</button>
					<button
						type="button"
						onClick={() => onChange({ zOrder: "front" })}
						className={
							circle.zOrder === "front"
								? "bg-brand-500 px-2 py-1 text-sm text-white"
								: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						}
						aria-pressed={circle.zOrder === "front"}
					>
						In front
					</button>
				</div>
			</div>
		</AnnotationCard>
	)
}
