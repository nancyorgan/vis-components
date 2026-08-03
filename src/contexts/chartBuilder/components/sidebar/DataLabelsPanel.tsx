import { useId } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
	DATA_LABELS_SINGLE_COLOR_ID,
	DEFAULT_DATA_LABELS_CONFIG,
	effectiveLabelPoints,
	type ColorSlotConfig,
	type DataLabelsConfig,
	type EndpointLabelOverrides,
	type LabelPointsMode,
	type PaletteName,
	type TextColorRule,
} from "../../lib/channelConfig"
import { resolveHierarchyIdField } from "../../lib/buildHierarchy"
import { getChartMode } from "../../lib/chartMode"
import { effectiveType } from "../../lib/fieldType"
import {
	PACKED_DERIVED_LABELS,
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	isHierarchyModeId,
	packedSourceForOptionValue,
	topLevelGroupNames,
} from "../../lib/packedMeasure"
import { FONT_FAMILY_OPTIONS } from "../../lib/labelsConfig"
import { CATEGORICAL_HUE_PALETTE, parseValue } from "../../lib/scales"
import {
	emptyDataLabelsEncodings,
	type DataLabelsEncodings,
	type DatasetView,
	type FieldType,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentThemeIdAtom,
	type AtomValueType,
	themeAtom,
	themesAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { Disclosure } from "@headlessui/react"

import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Toggle } from "../../../../components/ui/Toggle"
import { TickFormatControl } from "./channelOptions/AxisOptionsPanel"
import { ColorSlotControls } from "./channelOptions/ColorPanel"
import { CategoricalSwatchList } from "./channelOptions/HueOptionsPanel"
import { AlignmentControl, StyleButton } from "./LabelsPanel"

const PALETTE_PRESET_NAMES: PaletteName[] = [
	"viridis",
	"plasma",
	"inferno",
	"magma",
	"blues",
	"BrBG",
	"PiYG",
	"PRGn",
	"PuOr",
	"RdBu",
	"RdYlBu",
	"Spectral",
]

/** Weight choices for the labels' font. Named like the Labels panel's weight
 *  dropdown so the two read consistently. */
const FONT_WEIGHTS: Array<{
	value: DataLabelsConfig["fontWeight"]
	label: string
}> = [
	{ value: 400, label: "Normal (400)" },
	{ value: 500, label: "Medium (500)" },
	{ value: 600, label: "Semibold (600)" },
	{ value: 700, label: "Bold (700)" },
]

/** Small inline "reset" link — renders next to a control to restore its
 *  default. Callers gate rendering on value !== default so it only appears
 *  when there's something to reset. */
const ResetLink = ({ onClick }: { onClick: () => void }) => (
	<button
		type="button"
		onClick={onClick}
		className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
	>
		reset
	</button>
)

const Chevron = ({ open }: { open: boolean }) => (
	<svg
		viewBox="0 0 12 12"
		width={10}
		height={10}
		aria-hidden="true"
		className={`flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
	>
		<path
			d="M3 4.5l3 3 3-3"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

type DataLabelsChannel = keyof DataLabelsEncodings

/** Sentinel option value for the Value dropdown's "Multiple variables…"
 *  choice. Distinct from any field name and from "" (— none —) so the
 *  onChange handler can switch the `value` encoding into multi-field mode
 *  (which leaves `value.field` null and drives text off `value.fields`). */
const DATA_LABELS_MULTI_VALUE = "__multiple__"

/** Preset arrangements for a multi-field label, built from the first two
 *  selected fields, joined with ", " (e.g. `{Region}, {Share}`). This
 *  pre-fills the editable template so the user starts from a working
 *  arrangement instead of an empty box, and stays in sync with the
 *  checklist until they hand-edit it. */
const defaultLabelTemplate = (fields: string[]): string =>
	fields.map((f) => `{${f}}`).join(", ")

const CHANNEL_LABEL: Record<DataLabelsChannel, string> = {
	x: "X position",
	y: "Y position",
	angle: "Angle",
	r: "R",
	value: "Value",
	hue: "Color",
	size: "Size",
}

/** Sidebar section that lets the user encode an independent label layer
 * on top of the main visualization. The layer's encodings are stored in
 * `currentDataLabelsEncodingsAtom`; appearance + offsets + scale knobs
 * live in `currentDataLabelsConfigAtom`. */
export const DataLabelsPanel = () => {
	const [storedEncodings, setEncodings] = useAtom(
		currentDataLabelsEncodingsAtom
	)
	// Defensive merge: persisted state from before the `text` → `value`
	// rename (or any future channel addition) wouldn't have all keys, so
	// reads like `encodings.value.field` would crash. Spreading defaults
	// underneath guarantees every channel slot exists.
	const encodings: DataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		...storedEncodings,
	}
	const [cfg, setCfg] = useAtom(currentDataLabelsConfigAtom)
	const merged: DataLabelsConfig = { ...DEFAULT_DATA_LABELS_CONFIG, ...cfg }
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const chartEncodings = useAtomValue(currentEncodingsAtom)
	const chartConfigs = useAtomValue(currentChannelConfigsAtom)
	// The visualization's own background (null = transparent canvas → white)
	// is the default fill for the text-background rect, so labels mask the
	// gridlines they sit over by blending into the chart surface.
	const vizBackground = chartConfigs.backgroundColor ?? "#ffffff"
	const dataset = useCurrentDatasetView()
	const hueField = encodings.hue.field
	// Hierarchy-derived label sources (tree layouts): Color can vary by
	// "Top-level group" (categorical) or "Nesting depth" (ordinal), Size
	// by depth. Stored as `measureSource` on the slot, mirroring the main
	// shelf's derived variables.
	const hueSource = encodings.hue.measureSource ?? null
	const sizeByDepth = encodings.size.measureSource === "depth"
	// Resolve the hue field's effective type so the Color panel can show
	// the right picker — categorical palettes for discrete fields,
	// gradient list for quantitative / temporal. Derived sources carry
	// their own type (depth is ordinal, group names categorical).
	const hueFieldType: FieldType | null = hueSource
		? hueSource === "depth"
			? "ordinal"
			: "categorical"
		: dataset && hueField
			? effectiveType(dataset, hueField, overrides)
			: null

	// Tile (categorical × categorical heatmap) is the only chart type where
	// label positions MUST match the chart's encoding — every cell is keyed
	// by (chart.x, chart.y), so encoding a third field as the label's x or
	// y would produce nonsense. When the user picks one position we
	// auto-fill the other, and we restrict the dropdowns to just the
	// chart's x/y fields so the user can't pick anything misleading.
	const chartMode =
		dataset == null
			? getChartMode(chartEncodings, undefined, chartConfigs)
			: getChartMode(
					chartEncodings,
					(name) => effectiveType(dataset, name, overrides),
					chartConfigs
				)
	const isTileMode = chartMode === "tile"
	// Tree layouts (packed circles / treemap / sunburst): labels are PLACED
	// by the layout (leaf centers, container rims, arc centroids), so the
	// position rows and every position/overlap fine-tuning control stand
	// down — Value, Color, Size, and Text Properties still apply. Chord /
	// sankey label styling is a follow-up; their panel is unchanged.
	const isTreeMode = isHierarchyModeId(chartMode)
	// Pie family — labels are placed in polar terms (distance from center +
	// angular nudge) rather than the cartesian X/Y pixel offsets that make
	// no sense around a wedge.
	const isPolarMode =
		chartMode === "pies" || chartMode === "pies-x" || chartMode === "pies-y"
	// Bar charts (incl. histograms, which are bars over binned categories) are
	// the only mode where "Bar position" (label placement along the measure
	// axis) applies — gate the control on it.
	const isBarMode = chartMode === "bars-x" || chartMode === "bars-y"
	const chartXField = chartEncodings.x?.field ?? null
	const chartYField = chartEncodings.y?.field ?? null

	const updateCfg = (next: Partial<DataLabelsConfig>) =>
		setCfg({ ...merged, ...next })

	// "First and last per series" splits the label-text, alignment, and
	// position controls into First/Last pairs (the only mode where two label
	// populations coexist). The pairs read effective values (override ?? base)
	// and write into the endpoint override blocks.
	const splitEndpoints = effectiveLabelPoints(merged) === "first-last"
	const patchEndpoint = (
		key: "firstLabel" | "lastLabel",
		p: Partial<EndpointLabelOverrides>
	) => updateCfg({ [key]: { ...(merged[key] ?? {}), ...p } })

	const setField = (channel: DataLabelsChannel, fieldName: string) => {
		// Reserved option values = the hierarchy-derived sources. Writing
		// the slot fresh clears the other member (field ↔ measureSource
		// mutual exclusivity, like the main shelf).
		const derived = packedSourceForOptionValue(fieldName)
		if (derived) {
			setEncodings((prev) => ({
				...prev,
				[channel]: { field: null, measureSource: derived },
			}))
			return
		}
		const newField = fieldName === "" ? null : fieldName
		setEncodings((prev) => {
			const next = { ...prev, [channel]: { field: newField } }
			if (isTileMode && newField !== null) {
				if (channel === "x" && chartYField && !prev.y?.field) {
					next.y = { field: chartYField }
				} else if (channel === "y" && chartXField && !prev.x?.field) {
					next.x = { field: chartXField }
				}
			}
			return next
		})
	}

	// The Value row is special: besides picking a single field it can switch
	// into multi-field mode (the "Multiple variables…" sentinel), which keeps
	// `value.field` null and drives the label off `value.fields` + template.
	const setValueField = (v: string) => {
		if (v === DATA_LABELS_MULTI_VALUE) {
			const fields = encodings.value.fields ?? []
			const current = merged.labelTemplate ?? ""
			setEncodings((prev) => ({
				...prev,
				value: { field: null, multiField: true, fields: prev.value?.fields ?? [] },
			}))
			// Pre-fill the template so the box opens on a working arrangement.
			if (current === "" && fields.length > 0) {
				updateCfg({ labelTemplate: defaultLabelTemplate(fields) })
			}
			return
		}
		setEncodings((prev) => ({
			...prev,
			value: {
				field: v === "" ? null : v,
				multiField: false,
				fields: prev.value?.fields ?? [],
			},
		}))
	}
	const setValueFields = (fields: string[]) => {
		// Keep the template in sync with the checklist WHILE it's still the
		// auto default (or empty) — so checking/unchecking updates the
		// pre-filled arrangement — but never once the user has hand-edited it.
		const prevFields = encodings.value.fields ?? []
		const current = merged.labelTemplate ?? ""
		const stillAuto =
			current === "" || current === defaultLabelTemplate(prevFields)
		setEncodings((prev) => ({
			...prev,
			value: { field: null, multiField: true, fields },
		}))
		if (stillAuto) updateCfg({ labelTemplate: defaultLabelTemplate(fields) })
	}

	const allEligible = dataset?.fields ?? []
	const tileXEligible = chartXField
		? allEligible.filter((f) => f.name === chartXField)
		: []
	const tileYEligible = chartYField
		? allEligible.filter((f) => f.name === chartYField)
		: []
	const xEligible = isTileMode ? tileXEligible : allEligible
	const yEligible = isTileMode ? tileYEligible : allEligible

	// Derived options for the Color / Size dropdowns — tree layouts with a
	// mapped connection only (a flat pack is uniformly depth 1, and there
	// are no groups to derive). Size offers depth only: group names are
	// categorical, and a font size needs an ordered value.
	const connectionMapped = !!chartEncodings.connection?.field
	const labelDerivedHueOptions =
		isTreeMode && connectionMapped
			? [
					{
						value: PACKED_MEASURE_OPTION_VALUE.rootGroup,
						label: PACKED_DERIVED_LABELS.rootGroup,
					},
					{
						value: PACKED_MEASURE_OPTION_VALUE.depth,
						label: PACKED_DERIVED_LABELS.depth,
					},
				]
			: []
	const labelDerivedSizeOptions =
		isTreeMode && connectionMapped
			? [
					{
						value: PACKED_MEASURE_OPTION_VALUE.depth,
						label: PACKED_DERIVED_LABELS.depth,
					},
				]
			: []
	// Override-swatch values for a derived Color: group names / depth
	// levels from the same tree the renderer builds (id column resolved
	// identically), so the swatch list matches the drawn labels.
	const derivedHueValues = (() => {
		if (!hueSource || !dataset || !isTreeMode) return undefined
		const parentField = chartEncodings.connection?.field ?? null
		if (!parentField) return undefined
		const areaField = chartEncodings.area?.field ?? null
		const idField = resolveHierarchyIdField(
			chartConfigs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			areaField
		)
		return hueSource === "rootGroup"
			? topLevelGroupNames(dataset.rows, parentField, idField, areaField)
			: hierarchyDepthLevels(dataset.rows, parentField, idField, areaField)
	})()

	// Packed circles' "Text Position" checkboxes: one per CONTAINER depth
	// (levels that draw grouping circles — every hierarchy level except the
	// deepest, which is all leaves). Derived from the same tree the renderer
	// builds so the checkbox list tracks the drawn nesting.
	const isPackedMode = chartMode === "packed-circles"
	const containerWrapLevels = (() => {
		if (!isPackedMode || !dataset) return []
		const parentField = chartEncodings.connection?.field ?? null
		if (!parentField) return []
		const areaField = chartEncodings.area?.field ?? null
		const idField = resolveHierarchyIdField(
			chartConfigs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			areaField
		)
		return hierarchyDepthLevels(dataset.rows, parentField, idField, areaField)
			.slice(0, -1)
			.map(Number)
			.filter((n) => Number.isFinite(n))
	})()

	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Draw a layer of text labels on top of the visualization. Map fields to
				position, color, size, and text content — labels inherit faceting from
				the main chart.
			</p>

			{/* Channel mapping rows lead the panel and sit OUTSIDE the purple
			 *  box — choosing what each label encodes (position, value, color,
			 *  size) is the primary action and reads as its own list; the
			 *  selection / overlap / position fine-tuning lives in the purple
			 *  group below. */}

			{/* Tree layouts have no position rows at all — placement comes from
			 *  the pack / treemap / partition layout. */}
			{isTreeMode && (
				<p className="text-xs text-stone-600 dark:text-stone-400">
					Labels are placed by the layout (leaf centers, container rims).
					Value, Color, and Size apply — Value defaults to each row&apos;s
					name from the ID column.
				</p>
			)}
			{/* Pies position labels in polar terms — Angle + R replace the
			 *  cartesian X/Y rows. These are plain mapping dropdowns; the
			 *  placement nudges (Angle°, R%) live under "Adjust position". */}
			{isTreeMode ? null : isPolarMode ? (
				<>
					<DataLabelChannelRow
						channel="angle"
						label={CHANNEL_LABEL.angle}
						value={encodings.angle.field}
						onChange={(v) => setField("angle", v)}
						eligible={allEligible}
					/>

					<DataLabelChannelRow
						channel="r"
						label={CHANNEL_LABEL.r}
						value={encodings.r.field}
						onChange={(v) => setField("r", v)}
						eligible={allEligible}
					/>
				</>
			) : (
				<>
					<DataLabelChannelRow
						channel="x"
						label={CHANNEL_LABEL.x}
						value={encodings.x.field}
						onChange={(v) => setField("x", v)}
						eligible={xEligible}
					>
						<XYPositionPanel axis="x" cfg={merged} onChange={updateCfg} />
					</DataLabelChannelRow>

					<DataLabelChannelRow
						channel="y"
						label={CHANNEL_LABEL.y}
						value={encodings.y.field}
						onChange={(v) => setField("y", v)}
						eligible={yEligible}
					>
						<XYPositionPanel axis="y" cfg={merged} onChange={updateCfg} />
					</DataLabelChannelRow>
				</>
			)}

			<DataLabelChannelRow
				channel="value"
				label={CHANNEL_LABEL.value}
				value={
					encodings.value.multiField
						? DATA_LABELS_MULTI_VALUE
						: encodings.value.field
				}
				onChange={setValueField}
				eligible={allEligible}
				extraOptions={[
					{ value: DATA_LABELS_MULTI_VALUE, label: "Multiple variables…" },
				]}
			>
				{/* Single-field Value now has nothing to configure (formatting
				 *  moved to the per-field specs in multi-field mode), so only the
				 *  multi-field panel gets a disclosure — single mode is a plain
				 *  dropdown. `null` (not `false`) keeps the row chevron-less. */}
				{encodings.value.multiField ? (
					<ValuePanel
						cfg={merged}
						onChange={updateCfg}
						fields={encodings.value.fields ?? []}
						allFields={allEligible.map((f) => f.name)}
						onFieldsChange={setValueFields}
					/>
				) : null}
			</DataLabelChannelRow>

			<DataLabelChannelRow
				channel="hue"
				label={CHANNEL_LABEL.hue}
				value={
					hueSource
						? PACKED_MEASURE_OPTION_VALUE[hueSource]
						: encodings.hue.field
				}
				onChange={(v) => setField("hue", v)}
				eligible={allEligible}
				derivedOptions={labelDerivedHueOptions}
			>
				<HuePanel
					cfg={merged}
					onChange={updateCfg}
					hueField={hueField}
					hueFieldType={hueFieldType}
					dataset={dataset}
					chartConfigs={chartConfigs}
					valuesOverride={derivedHueValues}
					multiFields={
						encodings.value.multiField ? (encodings.value.fields ?? []) : []
					}
				/>
			</DataLabelChannelRow>

			<DataLabelChannelRow
				channel="size"
				label={CHANNEL_LABEL.size}
				value={
					sizeByDepth
						? PACKED_MEASURE_OPTION_VALUE.depth
						: encodings.size.field
				}
				onChange={(v) => setField("size", v)}
				eligible={allEligible}
				derivedOptions={labelDerivedSizeOptions}
			>
				<SizePanel cfg={merged} onChange={updateCfg} depthNote={sizeByDepth} />
			</DataLabelChannelRow>

			{/* One purple panel wraps the layer-wide fine-tuning so it reads as
			 *  a single group, distinct from the per-channel mappings above. */}
			<div className="vc-option-panel flex flex-col gap-3">
			{/* Layer-wide toggles: which labels to keep and how to handle
			 *  collisions. Grouped under their own subsection so they read as
			 *  a distinct concern from the per-channel mappings above. */}
			{/* Selection / overlap / position controls act on the overlay
			 *  layer's positioned labels — inert for layout-placed tree
			 *  labels, so they stand down there (as does Text Background,
			 *  which the tree renderers don't draw). */}
			{!isTreeMode && (
			<>
			<CollapsibleSubsection title="Label selection and overlap">
				<SelectInput
					label="Which labels"
					labelClassName="w-24 text-stone-600 dark:text-stone-400"
					value={effectiveLabelPoints(merged)}
					options={[
						{ value: "all", label: "All labels" },
						{ value: "first", label: "First per series" },
						{ value: "last", label: "Last per series" },
						{ value: "first-last", label: "First and last per series" },
					]}
					onChange={(labelPoints: LabelPointsMode) =>
						updateCfg({ labelPoints })
					}
				/>
				<p className="text-xs text-stone-600 dark:text-stone-400">
					First / last keep only each series&apos; leftmost / rightmost (or
					topmost / bottom-most) label — handy for directly labeling line
					charts and stacked bar charts so the legend can be turned off.
					Series = hue field (bars/areas) or connection field (line charts).
					A one-point series counts as &quot;last&quot;. With first and last
					shown, the label text (under Value) and the position / alignment
					controls below split into separate first / last settings.
				</p>
				<Toggle
					label="Avoid overlapping labels"
					className="mt-3"
					checked={merged.avoidOverlaps === true}
					onChange={(avoidOverlaps) => updateCfg({ avoidOverlaps })}
				/>
				<p className="ml-5 text-xs text-stone-600 dark:text-stone-400">
					Moves colliding labels apart vertically — up or down — keeping each
					as close to its data point as possible and preserving their order.
					Best-effort — densely packed labels may still collide.
				</p>
			</CollapsibleSubsection>

			<CollapsibleSubsection title="Position Adjustment and Alignment">
				{splitEndpoints ? (
					<div className="flex flex-col gap-2">
						{/* First/Last alignment pair — effective value shown, writes
						 *  land in the endpoint override blocks. */}
						<div className="flex items-center gap-2 text-sm">
							<span className="w-24 text-stone-600 dark:text-stone-400">
								First label
							</span>
							<AlignmentControl
								value={
									merged.firstLabel?.alignment ?? merged.alignment ?? "center"
								}
								onChange={(alignment) =>
									patchEndpoint("firstLabel", { alignment })
								}
							/>
						</div>
						<div className="flex items-center gap-2 text-sm">
							<span className="w-24 text-stone-600 dark:text-stone-400">
								Last label
							</span>
							<AlignmentControl
								value={
									merged.lastLabel?.alignment ?? merged.alignment ?? "center"
								}
								onChange={(alignment) =>
									patchEndpoint("lastLabel", { alignment })
								}
							/>
						</div>
					</div>
				) : (
					<div className="flex items-center gap-2 text-sm">
						<span className="w-24 text-stone-600 dark:text-stone-400">
							Alignment
						</span>
						<AlignmentControl
							value={merged.alignment ?? "center"}
							onChange={(alignment) => updateCfg({ alignment })}
						/>
					</div>
				)}
				<p className="text-xs text-stone-600 dark:text-stone-400">
					Pairs with the X offset below — e.g. <em>Left</em> + a small
					positive X nudges the label cleanly past its data point.
				</p>
				<hr className="my-2 border-stone-200 dark:border-stone-700" />
				<Toggle
					label="Wrap text"
					checked={merged.wrapText === true}
					onChange={(wrapText) => updateCfg({ wrapText })}
				/>
				{merged.wrapText === true && (
					<div className="ml-5 flex items-center gap-2 text-sm">
						<NumberInput
							label="Characters"
							labelClassName="w-24 text-stone-600 dark:text-stone-400"
							value={merged.wrapMaxChars ?? 20}
							min={1}
							step={1}
							onChange={(wrapMaxChars) => updateCfg({ wrapMaxChars })}
							inputClassName="w-16"
						/>
					</div>
				)}
				<p className="ml-5 text-xs text-stone-600 dark:text-stone-400">
					Wraps long labels onto multiple lines, targeting this many characters
					per line and breaking on the nearest space so words stay whole.
				</p>
				{isBarMode && (
					<>
						<SelectInput
							label="Bar position"
							labelClassName="w-24 text-stone-600 dark:text-stone-400"
							value={
								(merged.barLabelPosition ?? "center") as NonNullable<
									DataLabelsConfig["barLabelPosition"]
								>
							}
							options={[
								{ value: "center", label: "Center of bar (default)" },
								{ value: "inside-base", label: "Inside, near base" },
								{ value: "inside-end", label: "Inside, near end" },
								{ value: "outside-end", label: "Outside the end of the bar" },
							]}
							onChange={(barLabelPosition) => updateCfg({ barLabelPosition })}
						/>
						<p className="text-xs text-stone-600 dark:text-stone-400">
							Where labels sit along the bar&apos;s measure axis.
						</p>
					</>
				)}
				<hr className="my-2 border-stone-200 dark:border-stone-700" />
				<span className="text-sm text-stone-600 dark:text-stone-400">
					Adjust position
				</span>
				{/* Angle / R are polar-only — they only make sense around a pie,
				 *  so they're hidden for cartesian charts. The X/Y pixel nudge
				 *  below applies to every chart type, pies included. */}
				{isPolarMode && (
					<>
						<div className="flex items-center gap-2 text-sm">
							<NumberInput
								label="Angle"
								labelClassName="w-12 text-stone-600 dark:text-stone-400"
								value={merged.polarLabelAngle ?? 0}
								step={5}
								onChange={(polarLabelAngle) => updateCfg({ polarLabelAngle })}
								inputClassName="w-16"
								suffix="°"
							/>
							<NumberInput
								label="R"
								labelClassName="w-8 text-stone-600 dark:text-stone-400"
								value={merged.polarLabelRadius ?? 100}
								min={0}
								max={200}
								step={5}
								onChange={(polarLabelRadius) => updateCfg({ polarLabelRadius })}
								inputClassName="w-16"
								suffix="%"
							/>
						</div>
						<p className="text-xs text-stone-600 dark:text-stone-400">
							Angle rotates every label off its slice&apos;s midpoint (positive =
							clockwise). R is the distance from each pie&apos;s center as a percent
							of its radius — 100% is the border, lower pulls labels inside the
							wedge, higher pushes them outside.
						</p>
					</>
				)}
				{splitEndpoints ? (
					<>
						{/* First/Last offset pairs — effective values shown, writes
						 *  land in the endpoint override blocks. */}
						<span className="text-sm text-stone-600 dark:text-stone-400">
							First label
						</span>
						<div className="ml-5 flex flex-col gap-2 text-sm">
							<NumberInput
								label="X"
								labelClassName="w-24 text-stone-600 dark:text-stone-400"
								value={merged.firstLabel?.xOffset ?? merged.xOffset}
								step={1}
								onChange={(xOffset) => patchEndpoint("firstLabel", { xOffset })}
								inputClassName="w-16"
								suffix="px"
							/>
							<NumberInput
								label="Y"
								labelClassName="w-24 text-stone-600 dark:text-stone-400"
								value={merged.firstLabel?.yOffset ?? merged.yOffset}
								step={1}
								onChange={(yOffset) => patchEndpoint("firstLabel", { yOffset })}
								inputClassName="w-16"
								suffix="px"
							/>
						</div>
						<span className="text-sm text-stone-600 dark:text-stone-400">
							Last label
						</span>
						<div className="ml-5 flex flex-col gap-2 text-sm">
							<NumberInput
								label="X"
								labelClassName="w-24 text-stone-600 dark:text-stone-400"
								value={merged.lastLabel?.xOffset ?? merged.xOffset}
								step={1}
								onChange={(xOffset) => patchEndpoint("lastLabel", { xOffset })}
								inputClassName="w-16"
								suffix="px"
							/>
							<NumberInput
								label="Y"
								labelClassName="w-24 text-stone-600 dark:text-stone-400"
								value={merged.lastLabel?.yOffset ?? merged.yOffset}
								step={1}
								onChange={(yOffset) => patchEndpoint("lastLabel", { yOffset })}
								inputClassName="w-16"
								suffix="px"
							/>
						</div>
					</>
				) : (
					<div className="flex flex-col gap-2 text-sm">
						<NumberInput
							label="X"
							labelClassName="w-24 text-stone-600 dark:text-stone-400"
							value={merged.xOffset}
							step={1}
							onChange={(xOffset) => updateCfg({ xOffset })}
							inputClassName="w-16"
							suffix="px"
						/>
						<NumberInput
							label="Y"
							labelClassName="w-24 text-stone-600 dark:text-stone-400"
							value={merged.yOffset}
							step={1}
							onChange={(yOffset) => updateCfg({ yOffset })}
							inputClassName="w-16"
							suffix="px"
						/>
					</div>
				)}
				<p className="text-xs text-stone-600 dark:text-stone-400">
					Pixel offset{splitEndpoints ? " per endpoint" : " applied to every label"}.
					Positive X pushes right, positive Y pushes down. Useful for shifting
					labels off of the marks they&apos;re annotating.
				</p>
			</CollapsibleSubsection>
			</>
			)}

			{/* Packed circles only: per-container-level choice between the
			 *  default inside-the-rim placement and wrapping the group name
			 *  around the OUTSIDE of the circle on an arc. */}
			{isPackedMode && (
				<CollapsibleSubsection title="Text Position">
					<TextPositionPanel
						cfg={merged}
						onChange={updateCfg}
						levels={containerWrapLevels}
					/>
				</CollapsibleSubsection>
			)}

			<CollapsibleSubsection title="Text Properties">
				<TextPropertiesPanel cfg={merged} onChange={updateCfg} />
			</CollapsibleSubsection>

			{!isTreeMode && (
			<CollapsibleSubsection title="Text Background">
				<TextBackgroundPanel
					cfg={merged}
					onChange={updateCfg}
					vizBackground={vizBackground}
				/>
			</CollapsibleSubsection>
			)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Text background panel — draws a filled rounded rect behind each label so
// the text doesn't collide with gridlines / dense marks. The color defaults
// to the visualization's own background so labels blend into the canvas
// while masking whatever they sit over.
// ---------------------------------------------------------------------------
const TextBackgroundPanel = ({
	cfg,
	onChange,
	vizBackground,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	vizBackground: string
}) => {
	const enabled = cfg.textBackground === true
	// `null` background color means "inherit the viz background" — resolve it
	// to the concrete color so the swatch shows the effective fill.
	const colorValue = cfg.textBackgroundColor ?? vizBackground
	return (
		<div className="flex flex-col gap-2">
			<Toggle
				label="Use text background"
				checked={enabled}
				onChange={(textBackground) => onChange({ textBackground })}
			/>
			<p className="text-xs text-stone-600 dark:text-stone-400">
				Draws a filled rectangle behind each label so text reads cleanly over
				gridlines instead of colliding with them.
			</p>
			{enabled && (
				<>
					<ColorInput
						label="Background"
						labelClassName="w-24 text-stone-600 dark:text-stone-400"
						value={colorValue}
						onChange={(textBackgroundColor) =>
							onChange({ textBackgroundColor })
						}
					/>
					<p className="text-xs text-stone-600 dark:text-stone-400">
						Defaults to the visualization&apos;s background color.
					</p>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Corner radius"
							labelClassName="w-24 text-stone-600 dark:text-stone-400"
							value={cfg.textBackgroundRadius ?? 0}
							min={0}
							max={32}
							step={1}
							onChange={(textBackgroundRadius) =>
								onChange({ textBackgroundRadius })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{(cfg.textBackgroundRadius ?? 0) !==
							DEFAULT_DATA_LABELS_CONFIG.textBackgroundRadius && (
							<ResetLink
								onClick={() =>
									onChange({
										textBackgroundRadius:
											DEFAULT_DATA_LABELS_CONFIG.textBackgroundRadius,
									})
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Horizontal padding"
							labelClassName="w-24 text-stone-600 dark:text-stone-400"
							value={cfg.textBackgroundPadX ?? 0}
							min={0}
							max={32}
							step={1}
							onChange={(textBackgroundPadX) =>
								onChange({ textBackgroundPadX })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{(cfg.textBackgroundPadX ?? 0) !==
							DEFAULT_DATA_LABELS_CONFIG.textBackgroundPadX && (
							<ResetLink
								onClick={() =>
									onChange({
										textBackgroundPadX:
											DEFAULT_DATA_LABELS_CONFIG.textBackgroundPadX,
									})
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Vertical padding"
							labelClassName="w-24 text-stone-600 dark:text-stone-400"
							value={cfg.textBackgroundPadY ?? 0}
							min={0}
							max={32}
							step={0.5}
							onChange={(textBackgroundPadY) =>
								onChange({ textBackgroundPadY })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{(cfg.textBackgroundPadY ?? 0) !==
							DEFAULT_DATA_LABELS_CONFIG.textBackgroundPadY && (
							<ResetLink
								onClick={() =>
									onChange({
										textBackgroundPadY:
											DEFAULT_DATA_LABELS_CONFIG.textBackgroundPadY,
									})
								}
							/>
						)}
					</div>
				</>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Channel row — same chrome as `EncodingShelf` so the two sections feel
// like siblings, but driven by the data-labels atoms instead.
// ---------------------------------------------------------------------------
type DataLabelChannelRowProps = {
	channel: DataLabelsChannel
	label: string
	value: string | null
	onChange: (v: string) => void
	eligible: ReadonlyArray<{ name: string }>
	/** Hierarchy-derived choices (Top-level group / Nesting depth) offered
	 *  ahead of the dataset fields in tree layouts. Values are the
	 *  reserved `PACKED_MEASURE_OPTION_VALUE` sentinels, so onChange can
	 *  tell them apart from field names. */
	derivedOptions?: ReadonlyArray<{ value: string; label: string }>
	/** Extra choices offered AFTER the dataset fields — e.g. the Value row's
	 *  "Multiple variables…" sentinel. Same shape as `derivedOptions`;
	 *  onChange receives the option's `value`. */
	extraOptions?: ReadonlyArray<{ value: string; label: string }>
	/** Per-channel option panel. Omit it for channels whose only settings
	 *  live elsewhere (e.g. Angle / R, tuned under "Adjust position") — the
	 *  row then renders as a plain mapping dropdown with no chevron. */
	children?: React.ReactNode
}

const DataLabelChannelRow = ({
	channel: _channel,
	label,
	value,
	onChange,
	eligible,
	derivedOptions,
	extraOptions,
	children,
}: DataLabelChannelRowProps) => {
	// Associates the visible channel label with its field dropdown.
	const selectId = useId()
	const selectClass = `min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-800 ${
		value
			? "text-vc-section-header font-semibold"
			: "text-stone-700 dark:text-stone-200"
	}`
	const fieldSelect = (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<label
				htmlFor={selectId}
				className="w-24 flex-shrink-0 text-sm text-stone-600 dark:text-stone-300"
			>
				{label}
			</label>
			<select
				id={selectId}
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value)}
				className={selectClass}
			>
				<option value="">— none —</option>
				{derivedOptions?.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
				{eligible.map((f) => (
					<option key={f.name} value={f.name}>
						{f.name}
					</option>
				))}
				{extraOptions?.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
		</div>
	)

	// No per-channel options → plain dropdown row, no disclosure chrome.
	if (children == null) {
		return <div className="flex items-center gap-1">{fieldSelect}</div>
	}

	return (
		<Disclosure as="div" className="flex flex-col gap-1">
			{({ open }) => (
				<>
					<div className="flex items-center gap-1">
						{fieldSelect}
						<Disclosure.Button
							className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
							aria-label={`Toggle settings for ${label}`}
						>
							<Chevron open={open} />
						</Disclosure.Button>
					</div>
					<Disclosure.Panel>
						{/* Purple option-panel fill so each channel's expanded
						 *  options match the shaded option groups used elsewhere
						 *  in the sidebar. (The mapping rows now sit outside any
						 *  purple box, so the panel supplies its own.) */}
						<div className="vc-option-panel">{children}</div>
					</Disclosure.Panel>
				</>
			)}
		</Disclosure>
	)
}

// ---------------------------------------------------------------------------
// Text position — packed circles only. One checkbox per container level:
// checked levels draw their group name on an arc around the OUTSIDE of the
// circle (12 o'clock, via <textPath>) instead of inside the top rim.
// ---------------------------------------------------------------------------
const WRAP_LEVEL_LABELS = [
	"Top level circle",
	"Second level circle",
	"Third level circle",
	"Fourth level circle",
]
const wrapLevelLabel = (level: number): string =>
	WRAP_LEVEL_LABELS[level - 1] ?? `Level ${level} circle`

const TextPositionPanel = ({
	cfg,
	onChange,
	levels,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	/** Container depths present in the current hierarchy (1 = top level). */
	levels: number[]
}) => {
	const wrapped = cfg.arcWrapLevels ?? []
	const toggle = (level: number, on: boolean) =>
		onChange({
			arcWrapLevels: on
				? [...wrapped, level].sort((a, b) => a - b)
				: wrapped.filter((l) => l !== level),
		})
	if (levels.length === 0) {
		return (
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				Labels can wrap around grouping circles once the chart has them —
				map a categorical field to the connection channel first.
			</p>
		)
	}
	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm text-stone-600 dark:text-stone-400">
				Wrap label around
			</span>
			{levels.map((level) => (
				<Toggle
					key={level}
					label={wrapLevelLabel(level)}
					checked={wrapped.includes(level)}
					onChange={(on) => toggle(level, on)}
				/>
			))}
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				Checked levels draw the group name on an arc around the outside of
				the circle; unchecked levels keep it inside the top rim.
			</p>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Text properties — layer-wide font family / weight / style (italic,
// underline). Grouped in their own purple subsection; the per-channel
// panels keep only the settings scoped to their channel.
// ---------------------------------------------------------------------------
const TextPropertiesPanel = ({
	cfg,
	onChange,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
}) => (
	<div className="flex flex-col gap-2">
		<div className="flex items-center gap-2">
			<SelectInput
				label="Family"
				labelClassName="w-24 text-stone-600 dark:text-stone-400"
				value={cfg.fontFamily}
				options={FONT_FAMILY_OPTIONS.map((opt) => ({
					value: opt.value,
					label: opt.label,
				}))}
				onChange={(fontFamily) => onChange({ fontFamily })}
				selectClassName="flex-1"
			/>
			{cfg.fontFamily !== DEFAULT_DATA_LABELS_CONFIG.fontFamily && (
				<ResetLink
					onClick={() =>
						onChange({ fontFamily: DEFAULT_DATA_LABELS_CONFIG.fontFamily })
					}
				/>
			)}
		</div>
		<div className="flex items-center gap-2">
			<SelectInput
				label="Weight"
				labelClassName="w-24 text-stone-600 dark:text-stone-400"
				value={String(cfg.fontWeight) as "400" | "500" | "600" | "700"}
				options={FONT_WEIGHTS.map((w) => ({
					value: String(w.value) as "400" | "500" | "600" | "700",
					label: w.label,
				}))}
				onChange={(w) =>
					onChange({
						fontWeight: Number(w) as DataLabelsConfig["fontWeight"],
					})
				}
				selectClassName="flex-1"
			/>
			{cfg.fontWeight !== DEFAULT_DATA_LABELS_CONFIG.fontWeight && (
				<ResetLink
					onClick={() =>
						onChange({ fontWeight: DEFAULT_DATA_LABELS_CONFIG.fontWeight })
					}
				/>
			)}
		</div>
		<div className="flex items-center gap-1.5">
			<span className="w-24 flex-shrink-0 text-sm text-stone-600 dark:text-stone-400">
				Style
			</span>
			<StyleButton
				on={cfg.italic === true}
				label="I"
				className="italic"
				ariaLabel="Italic"
				onClick={() => onChange({ italic: !cfg.italic })}
			/>
			<StyleButton
				on={cfg.underline === true}
				label="U"
				className="underline"
				ariaLabel="Underline"
				onClick={() => onChange({ underline: !cfg.underline })}
			/>
			{(cfg.italic === true || cfg.underline === true) && (
				<ResetLink
					onClick={() => onChange({ italic: false, underline: false })}
				/>
			)}
		</div>
	</div>
)

// ---------------------------------------------------------------------------
// X / Y position settings — color and position adjustment. (Font weight
// moved to the layer-wide "Text Properties" subsection.)
// ---------------------------------------------------------------------------
const XYPositionPanel = ({
	axis,
	cfg,
	onChange,
}: {
	axis: "x" | "y"
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
}) => {
	const offsetKey: keyof DataLabelsConfig = axis === "x" ? "xOffset" : "yOffset"
	const offsetValue = (cfg[offsetKey] as number) ?? 0
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<ColorInput
					label="Color"
					labelClassName="w-24 text-stone-600 dark:text-stone-400"
					value={cfg.color}
					onChange={(color) => onChange({ color })}
				/>
				{cfg.color !== DEFAULT_DATA_LABELS_CONFIG.color && (
					<ResetLink
						onClick={() => onChange({ color: DEFAULT_DATA_LABELS_CONFIG.color })}
					/>
				)}
			</div>
			<NumberInput
				label={`Adjust (${axis})`}
				labelClassName="w-24 text-stone-600 dark:text-stone-400"
				value={offsetValue}
				step={1}
				onChange={(v) => onChange({ [offsetKey]: v })}
				inputClassName="w-16"
				suffix="px"
			/>
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				Nudges the label by this many pixels along the {axis} axis. Positive
				values push {axis === "x" ? "right" : "down"}.
			</p>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Hue / color panel — branches on the hue field's effective type so the
// user picks a CATEGORICAL palette for discrete fields and a GRADIENT for
// continuous fields, matching the main hue panel UX.
// ---------------------------------------------------------------------------
const HuePanel = ({
	cfg,
	onChange,
	hueField,
	hueFieldType,
	dataset,
	chartConfigs,
	valuesOverride,
	multiFields = [],
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	hueField: string | null
	hueFieldType: FieldType | null
	dataset: DatasetView | undefined
	chartConfigs: AtomValueType<typeof currentChannelConfigsAtom>
	/** Swatch values for a hierarchy-DERIVED color source (group names /
	 *  depth levels) — there's no dataset column to enumerate. */
	valuesOverride?: string[]
	/** Multi-field label variables (empty in single-field mode). When
	 *  non-empty, each gets its own color slot below the base color — one
	 *  color target per shown variable, mirroring the mark fill/outline/line
	 *  slots. */
	multiFields?: string[]
}) => {
	// Prefer the LIVE theme from `themesAtom` (which the settings editor
	// writes to) so palettes added / edited in Settings appear here with
	// their current colors. Falls back to `themeAtom` when the chart's
	// theme id is missing from `themesAtom` (e.g., a deleted custom theme
	// or a fresh chart that hasn't picked a theme yet).
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const hueFieldMapped = hueFieldType !== null
	const isQuantitative =
		hueFieldType === "quantitative" || hueFieldType === "temporal"
	const singleColor = cfg.paletteId === DATA_LABELS_SINGLE_COLOR_ID
	// Is a palette / gradient scale coloring the labels? Decides whether the
	// swatch below IS the label color or just the fallback for unmatched
	// values. Categorical fields color through a palette unless the user
	// explicitly picked "None (single color)" — with no pick, the layer
	// inherits the chart's palette.
	const usesScale =
		hueFieldMapped && (isQuantitative ? cfg.gradientId !== null : !singleColor)

	// With more than one variable in the label, every variable carries its own
	// color slot below — the single base palette / swatch / fallback would be a
	// redundant, do-nothing set of pickers, so hide it and show only the
	// per-variable slots.
	const perVariableColor = multiFields.length > 1

	return (
		<div className="flex flex-col gap-2">
			{!perVariableColor && (
				<>
					{!hueFieldMapped && (
						<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
							Map a field to <strong>Color</strong> above to drive label colors
							by that field&apos;s values. The fallback color below is used
							until then.
						</p>
					)}
					{hueFieldMapped && !isQuantitative && (
						<>
							<CategoricalPaletteRow cfg={cfg} onChange={onChange} theme={theme} />
							<LabelSwatchList
								cfg={cfg}
								onChange={onChange}
								hueField={hueField}
								hueFieldType={hueFieldType}
								dataset={dataset}
								chartConfigs={chartConfigs}
								valuesOverride={valuesOverride}
							/>
						</>
					)}
					{hueFieldMapped && isQuantitative && (
						<GradientRow cfg={cfg} onChange={onChange} theme={theme} />
					)}
					{/* The single color swatch sits directly under the palette/gradient
					 *  dropdown so it's immediately reachable when "None (single
					 *  color)" is selected (no scale → this IS the label color). The
					 *  advanced text-color rules drop below it. */}
					<ColorInput
						label={
							(cfg.textColorRules?.length ?? 0) > 0
								? "Else (fallback)"
								: usesScale
									? "Fallback"
									: "Color"
						}
						labelClassName="w-24 text-stone-600 dark:text-stone-400"
						value={cfg.color}
						onChange={(color) => onChange({ color })}
					/>
					<TextColorRulesRow cfg={cfg} onChange={onChange} />
				</>
			)}
			{multiFields.length > 0 && (
				<div
					className={
						perVariableColor
							? "flex flex-col gap-1.5"
							: "flex flex-col gap-1.5 border-t border-stone-200 pt-2 dark:border-stone-700"
					}
				>
					{multiFields.map((name) => (
						<CollapsibleSubsection key={name} title={name} boxed={false}>
							<ColorSlotControls
								labelPrefix={name}
								slotCfg={cfg.fieldColors?.[name]}
								defaultColor={cfg.color}
								// With a field mapped on the Color channel above, an
								// unconfigured variable's segments follow that mapping
								// (the renderer falls through to the label's base fill)
								// — surface that as the explicit default option so the
								// dropdown matches what actually renders. Without a
								// mapping, base fill IS the single color, so the plain
								// "Single color" default already tells the truth.
								inheritLabel={
									hueFieldMapped
										? `Main Color mapping${hueField ? ` (${hueField})` : ""}`
										: undefined
								}
								clearSlot={() => {
									const next = { ...(cfg.fieldColors ?? {}) }
									delete next[name]
									onChange({ fieldColors: next })
								}}
								updateSlot={(partial) => {
									const existing = cfg.fieldColors?.[name]
									const base: ColorSlotConfig = {
										field: existing?.field ?? null,
										singleColor: existing?.singleColor ?? cfg.color,
										...existing,
									}
									onChange({
										fieldColors: {
											...(cfg.fieldColors ?? {}),
											[name]: { ...base, ...partial },
										},
									})
								}}
							/>
						</CollapsibleSubsection>
					))}
				</div>
			)}
		</div>
	)
}

/** Per-category swatch rows for the Data Labels color panel — one editable
 *  swatch per distinct value of the mapped hue field, defaulting to the
 *  palette slot the renderer will use (labels' own palette, else the chart's
 *  inherited palette, else the single label color in "None (single color)"
 *  mode). Edits store per-value overrides in `cfg.colorOverrides`, which win
 *  over the hue scale in `DataLabelsLayer`. Values enumerate in dataset row
 *  order — the same order `makeHueScale` builds its ordinal domain — so the
 *  swatch defaults line up with the rendered label colors. */
const LabelSwatchList = ({
	cfg,
	onChange,
	hueField,
	hueFieldType,
	dataset,
	chartConfigs,
	valuesOverride,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	hueField: string | null
	hueFieldType: FieldType
	dataset: DatasetView | undefined
	chartConfigs: AtomValueType<typeof currentChannelConfigsAtom>
	valuesOverride?: string[]
}) => {
	if (!dataset || (!hueField && !valuesOverride)) return null
	const values =
		valuesOverride ??
		(hueField
			? [
					...new Set(
						dataset.rows
							.map((r) => parseValue(r[hueField], hueFieldType))
							.filter((v) => v !== null)
							.map(String)
					),
				]
			: [])
	if (values.length === 0) return null
	// Default color per row mirrors the layer's palette resolution: the
	// labels' own palette when picked; otherwise the chart's palette
	// (ordinal palette for ordinal fields); every row shows the single
	// label color in "None (single color)" mode.
	const chartPalette =
		hueFieldType === "ordinal"
			? (chartConfigs.ordinalPalette ?? chartConfigs.categoricalPalette)
			: chartConfigs.categoricalPalette
	const scheme =
		cfg.paletteId === DATA_LABELS_SINGLE_COLOR_ID
			? [cfg.color]
			: cfg.palette.length > 0
				? cfg.palette
				: (chartPalette ?? CATEGORICAL_HUE_PALETTE)
	return (
		<CategoricalSwatchList
			values={values}
			scheme={scheme}
			colors={cfg.colorOverrides}
			onSetColor={(value, color) =>
				onChange({
					colorOverrides: { ...cfg.colorOverrides, [value]: color },
				})
			}
			onResetColor={(value) => {
				const { [value]: _removed, ...rest } = cfg.colorOverrides
				onChange({ colorOverrides: rest })
			}}
			labelPrefix="Label color"
		/>
	)
}

/** Conditional text-color rules — primarily for heatmaps, where a single
 *  fallback color can't read against every cell in the gradient. The user
 *  types a comparison expression (`> 0`, `< 50`) and picks a color; the
 *  first matching rule wins. Always renders at least one slot so the
 *  feature is discoverable; an empty condition is a no-op. */
const TextColorRulesRow = ({
	cfg,
	onChange,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
}) => {
	const stored = cfg.textColorRules ?? []
	const display: TextColorRule[] =
		stored.length === 0 ? [{ condition: "", color: cfg.color }] : stored
	const update = (next: TextColorRule[]) => onChange({ textColorRules: next })
	const setRule = (i: number, patch: Partial<TextColorRule>) => {
		const merged = display.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
		update(merged)
	}
	const removeRule = (i: number) =>
		update(display.filter((_, idx) => idx !== i))
	const addRule = () =>
		update([...display, { condition: "", color: cfg.color }])
	return (
		<CollapsibleSubsection title="Text color rules" boxed={false}>
			{display.map((rule, i) => (
				<div
					// Index key is stable here: rules are ordered, identity == position
					// eslint-disable-next-line react/no-array-index-key
					key={i}
					className="flex items-center gap-2 text-sm"
				>
					{/* Empty leading column so the condition box lines up under the
					 *  w-24-labeled text boxes above (Palette / Gradient, Color). */}
					<span className="w-24 flex-shrink-0" aria-hidden="true" />
					<input
						type="text"
						value={rule.condition}
						onChange={(e) => setRule(i, { condition: e.target.value })}
						placeholder="> 0"
						aria-label={`Condition for rule ${i + 1}`}
						className="w-24 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
					/>
					<ColorInput
						label={`Color for rule ${i + 1}`}
						labelClassName="sr-only"
						value={rule.color}
						onChange={(color) => setRule(i, { color })}
						showHexInput={false}
					/>
					{stored.length > 0 && (
						<button
							type="button"
							onClick={() => removeRule(i)}
							className="rounded px-1 text-stone-600 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
							aria-label={`Remove rule ${i + 1}`}
						>
							×
						</button>
					)}
				</div>
			))}
			<button
				type="button"
				onClick={addRule}
				className="self-start text-xs text-blue-600 hover:underline dark:text-blue-400"
			>
				+ Add rule
			</button>
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				First matching rule wins. Use <code>{">"}</code>, <code>{"<"}</code>,{" "}
				<code>{">="}</code>, <code>{"<="}</code>, <code>==</code>, or{" "}
				<code>!=</code> followed by a number.
			</p>
		</CollapsibleSubsection>
	)
}

const CategoricalPaletteRow = ({
	cfg,
	onChange,
	theme,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	theme: AtomValueType<typeof themeAtom>
}) => {
	// Every pick clears the per-value overrides (mirroring the main hue
	// panel's palette switch) so stale overrides from the previous palette
	// don't mask the new one.
	const onPickPalette = (paletteId: string) => {
		if (paletteId === "__match__") {
			// Inherit the chart's palette — the renderer's default when the
			// user hasn't picked a labels-specific palette.
			onChange({ paletteId: null, palette: [], colorOverrides: {} })
			return
		}
		if (paletteId === DATA_LABELS_SINGLE_COLOR_ID) {
			onChange({
				paletteId: DATA_LABELS_SINGLE_COLOR_ID,
				palette: [],
				colorOverrides: {},
			})
			return
		}
		const pal = theme.categoricalPalettes.find((p) => p.id === paletteId)
		if (!pal) return
		onChange({ paletteId, palette: [...pal.colors], colorOverrides: {} })
	}
	const currentSelection: string =
		cfg.paletteId === DATA_LABELS_SINGLE_COLOR_ID
			? DATA_LABELS_SINGLE_COLOR_ID
			: cfg.paletteId &&
				  theme.categoricalPalettes.some((p) => p.id === cfg.paletteId)
				? cfg.paletteId
				: "__match__"
	return (
		<>
			<label className="flex items-center gap-2 text-sm">
				<span className="w-24 text-stone-600 dark:text-stone-400">Palette</span>
				<select
					value={currentSelection}
					onChange={(e) => onPickPalette(e.target.value)}
					className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				>
					<option value="__match__">Match chart colors</option>
					<option value={DATA_LABELS_SINGLE_COLOR_ID}>
						None (single color)
					</option>
					{theme.categoricalPalettes.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
			</label>
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				<em>Match chart colors</em> inherits the chart&apos;s palette so labels
				match their marks. <em>None (single color)</em> paints every label
				with the color below. Either way, the swatches under the dropdown
				override individual categories.
			</p>
		</>
	)
}

const GradientRow = ({
	cfg,
	onChange,
	theme,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	theme: AtomValueType<typeof themeAtom>
}) => {
	const onPickGradient = (gradientId: string) => {
		if (gradientId === "__none__") {
			onChange({ gradientId: null, gradientColors: null })
			return
		}
		// Saved linear gradient → snapshot low/high.
		const lin = theme.linearGradients.find((g) => g.id === gradientId)
		if (lin) {
			onChange({
				gradientId,
				gradientColors: { low: lin.low, mid: null, high: lin.high },
			})
			return
		}
		// Saved diverging gradient → snapshot low/mid/high.
		const div = theme.divergingGradients.find((g) => g.id === gradientId)
		if (div) {
			onChange({
				gradientId,
				gradientColors: { low: div.low, mid: div.mid, high: div.high },
			})
			return
		}
		// Falls through to a d3 preset name — no resolved colors needed; the
		// renderer looks up the interpolator at render time.
		onChange({ gradientId, gradientColors: null })
	}
	const currentSelection: string = cfg.gradientId ?? "__none__"
	return (
		<label className="flex items-center gap-2 text-sm">
			<span className="w-24 text-stone-600 dark:text-stone-400">Gradient</span>
			<select
				value={currentSelection}
				onChange={(e) => onPickGradient(e.target.value)}
				className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
			>
				<option value="__none__">None</option>
				<optgroup label="Presets">
					{PALETTE_PRESET_NAMES.map((p) => (
						<option key={p} value={p}>
							{p}
						</option>
					))}
				</optgroup>
				{theme.linearGradients.length > 0 && (
					<optgroup label="Linear gradients">
						{theme.linearGradients.map((g) => (
							<option key={g.id} value={g.id}>
								{g.name}
							</option>
						))}
					</optgroup>
				)}
				{theme.divergingGradients.length > 0 && (
					<optgroup label="Diverging gradients">
						{theme.divergingGradients.map((g) => (
							<option key={g.id} value={g.id}>
								{g.name}
							</option>
						))}
					</optgroup>
				)}
			</select>
		</label>
	)
}

// ---------------------------------------------------------------------------
// Size panel — min/max font size used when a size field is mapped, plus a
// fallback fixed font size for unmapped charts.
// ---------------------------------------------------------------------------
const SizePanel = ({
	cfg,
	onChange,
	depthNote = false,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	/** True when Size varies by "Nesting depth" — explains the direction
	 *  (top level = Max), since it inverts the usual min→max reading. */
	depthNote?: boolean
}) => (
	<div className="flex flex-col gap-2">
		{depthNote && (
			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				The TOP level uses the Max size and the deepest level the Min —
				big group titles, small leaf labels. Swap Min and Max to invert.
			</p>
		)}
		<div className="flex items-center gap-2">
			<NumberInput
				label="Default size"
				labelClassName="w-24 text-stone-600 dark:text-stone-400"
				value={cfg.fontSize}
				min={6}
				max={64}
				step={1}
				onChange={(fontSize) => onChange({ fontSize })}
				inputClassName="w-16"
				suffix="px"
			/>
			{cfg.fontSize !== DEFAULT_DATA_LABELS_CONFIG.fontSize && (
				<ResetLink
					onClick={() =>
						onChange({ fontSize: DEFAULT_DATA_LABELS_CONFIG.fontSize })
					}
				/>
			)}
		</div>
		<div className="flex items-center gap-2">
			<NumberInput
				label="Min"
				labelClassName="w-24 text-stone-600 dark:text-stone-400"
				value={cfg.sizeMin}
				min={4}
				max={64}
				step={1}
				onChange={(sizeMin) => onChange({ sizeMin })}
				inputClassName="w-16"
				suffix="px"
			/>
			{cfg.sizeMin !== DEFAULT_DATA_LABELS_CONFIG.sizeMin && (
				<ResetLink
					onClick={() =>
						onChange({ sizeMin: DEFAULT_DATA_LABELS_CONFIG.sizeMin })
					}
				/>
			)}
		</div>
		<div className="flex items-center gap-2">
			<NumberInput
				label="Max"
				labelClassName="w-24 text-stone-600 dark:text-stone-400"
				value={cfg.sizeMax}
				min={4}
				max={128}
				step={1}
				onChange={(sizeMax) => onChange({ sizeMax })}
				inputClassName="w-16"
				suffix="px"
			/>
			{cfg.sizeMax !== DEFAULT_DATA_LABELS_CONFIG.sizeMax && (
				<ResetLink
					onClick={() =>
						onChange({ sizeMax: DEFAULT_DATA_LABELS_CONFIG.sizeMax })
					}
				/>
			)}
		</div>
		<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
			Default size applies when no size field is mapped. Min / max set the pixel
			range when a numeric field drives the label size.
		</p>
	</div>
)

// ---------------------------------------------------------------------------
// Value panel — multi-field mode only ("Multiple variables…"): pick which
// fields to combine, arrange them in the editable label text, and give each a
// d3 number format (so e.g. a category can sit next to "32%"). Per-variable
// COLOR lives under the Color dropdown (one slot per variable), not here.
// Single-field Value has no settings, so the parent renders this only in
// multi mode.
// ---------------------------------------------------------------------------
const ValuePanel = ({
	cfg,
	onChange,
	fields,
	allFields,
	onFieldsChange,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	fields: string[]
	allFields: string[]
	onFieldsChange: (fields: string[]) => void
}) => {
	const toggleField = (name: string, on: boolean) =>
		onFieldsChange(on ? [...fields, name] : fields.filter((f) => f !== name))
	const textInputClass =
		"w-full rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"

	return (
		<div className="flex flex-col gap-3">
			{/* Which fields to include — check order sets the pre-filled order. */}
			<div className="flex flex-col gap-1">
				<span className="text-sm font-semibold text-vc-section-header">
					Fields to include
				</span>
				{allFields.length === 0 ? (
					<p className="text-xs text-stone-500 dark:text-stone-400">
						No dataset fields.
					</p>
				) : (
					allFields.map((name) => (
						<label key={name} className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={fields.includes(name)}
								onChange={(e) => toggleField(name, e.target.checked)}
							/>
							<span className="truncate">{name}</span>
						</label>
					))
				)}
			</div>

			{/* Editable label text — pre-filled with the checked fields (kept in
			 *  sync until hand-edited). Each field name in braces is replaced by
			 *  that row's value; edit the surrounding text freely. With "first
			 *  and last per series" selected, the single input splits into a
			 *  first/last pair: each writes its endpoint's template override and
			 *  an empty box inherits the shared arrangement (the placeholder). */}
			{effectiveLabelPoints(cfg) === "first-last" ? (
				(["firstLabel", "lastLabel"] as const).map((key) => (
					<label key={key} className="flex flex-col gap-1 text-sm">
						<span className="text-stone-600 dark:text-stone-400">
							{key === "firstLabel" ? "First label text" : "Last label text"}
						</span>
						<input
							type="text"
							value={cfg[key]?.labelTemplate ?? ""}
							placeholder={
								cfg.labelTemplate ||
								(fields.length > 0
									? defaultLabelTemplate(fields)
									: "Check some fields above")
							}
							onChange={(e) => {
								const next = { ...(cfg[key] ?? {}) }
								if (e.target.value === "") delete next.labelTemplate
								else next.labelTemplate = e.target.value
								onChange({ [key]: next })
							}}
							className={textInputClass}
						/>
					</label>
				))
			) : (
				<label className="flex flex-col gap-1 text-sm">
					<span className="text-stone-600 dark:text-stone-400">Label text</span>
					<input
						type="text"
						value={cfg.labelTemplate ?? ""}
						placeholder={
							fields.length > 0
								? defaultLabelTemplate(fields)
								: "Check some fields above"
						}
						onChange={(e) => onChange({ labelTemplate: e.target.value })}
						className={textInputClass}
					/>
				</label>
			)}

			{/* Per-field format — the same preset dropdown (+ custom spec) the
			 *  x / y axes use, one per selected field. */}
			{fields.length > 0 && (
				<div className="flex flex-col gap-1">
					<span className="text-sm font-semibold text-vc-section-header">
						Label format
					</span>
					{fields.map((name) => (
						<TickFormatControl
							key={name}
							label={name}
							value={cfg.fieldFormats?.[name] ?? ""}
							changed={(cfg.fieldFormats?.[name] ?? "") !== ""}
							onChange={(spec) => {
								const next = { ...(cfg.fieldFormats ?? {}) }
								if (spec === "") delete next[name]
								else next[name] = spec
								onChange({ fieldFormats: next })
							}}
						/>
					))}
				</div>
			)}

			<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
				Edit the label text above — a field name in braces (e.g.{" "}
				<code>{"{Region}"}</code>) shows that row&apos;s value; type any text
				around it. Each field takes a format (same options as the axes); set
				each variable&apos;s color under the <strong>Color</strong> menu.
			</p>
		</div>
	)
}
