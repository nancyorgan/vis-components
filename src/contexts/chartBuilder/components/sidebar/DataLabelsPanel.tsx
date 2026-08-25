import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	effectiveLabelPoints,
	type DataLabelsConfig,
	type EndpointLabelOverrides,
	type LabelPointsMode,
} from "../../lib/channelConfig"
import { resolveHierarchyIdField } from "../../lib/buildHierarchy"
import { dataLabelsConfigFromTheme } from "../../lib/themeConfig"
import { effectiveType } from "../../lib/fieldType"
import {
	PACKED_DERIVED_LABELS,
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	isHierarchyModeId,
	packedSourceForOptionValue,
	topLevelGroupNames,
} from "../../lib/packedMeasure"
import {
	emptyDataLabelsEncodings,
	type DataLabelsEncodings,
	type FieldType,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
} from "../../store/atoms"
import { useChartModeDef } from "../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import { useGeoLabelLevel } from "../../store/useGeoLabelLevel"

import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import {
	LABEL_COL,
	LABEL_COL_NESTED,
} from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Toggle } from "../../../../components/ui/Toggle"
import { AlignmentControl } from "./LabelsPanel"
import { DataLabelChannelRow } from "./dataLabels/DataLabelChannelRow"
import { LabelColorPanel } from "./dataLabels/LabelColorPanel"
import { SizePanel } from "./dataLabels/SizePanel"
import { TextBackgroundPanel } from "./dataLabels/TextBackgroundPanel"
import { TextPositionPanel } from "./dataLabels/TextPositionPanel"
import { TextPropertiesPanel } from "./dataLabels/TextPropertiesPanel"
import { SingleValuePanel, ValuePanel } from "./dataLabels/ValuePanel"
import { defaultLabelTemplate, type DataLabelsChannel } from "./dataLabels/shared"

/** Sentinel option value for the Value dropdown's "Multiple variables…"
 *  choice. Distinct from any field name and from "" (— none —) so the
 *  onChange handler can switch the `value` encoding into multi-field mode
 *  (which leaves `value.field` null and drives text off `value.fields`). */
const DATA_LABELS_MULTI_VALUE = "__multiple__"

const CHANNEL_LABEL: Record<DataLabelsChannel, string> = {
	x: "X position",
	y: "Y position",
	angle: "Angle",
	r: "R",
	geography: "Geography",
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
	// Resolve the LIVE theme (same fallback chain as LabelColorPanel) so the
	// font-size / weight / style reset links compare against — and reset to —
	// the theme's data-label defaults rather than the hardcoded constants.
	const theme = useCurrentTheme()
	const themeDefaults = dataLabelsConfigFromTheme(theme)
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

	// Resolve the mode via the shared hook — it folds in field types, channel
	// configs AND the map config, so config-gated modes (histograms) and geo
	// modes both detect exactly like the render path.
	const modeDef = useChartModeDef()
	const chartMode = modeDef.id
	// Tile (categorical × categorical heatmap) is the only chart type where
	// label positions MUST match the chart's encoding — every cell is keyed
	// by (chart.x, chart.y), so encoding a third field as the label's x or
	// y would produce nonsense. When the user picks one position we
	// auto-fill the other, and we restrict the dropdowns to just the
	// chart's x/y fields so the user can't pick anything misleading.
	const isTileMode = chartMode === "tile"
	// Maps: labels anchor to REGIONS, not to x/y fields — the position rows
	// are replaced by a single "Geography" row (the field whose values join
	// to map regions; labels center on each matched region's centroid). The
	// per-series "Which labels" selection has no meaning on a map.
	const isGeoMode = modeDef.canvas.coordFamily === "geo"
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

	// Countries-level geo labels get the "Full country name" preset in the
	// Label-format dropdowns (region labels can spell out the atlas's
	// abbreviated names — "Dem. Rep. Congo" → "Democratic Republic of the
	// Congo"). The level is auto-detected from the label layer's own
	// geography field, same as the render join (useGeoLabelLevel); the
	// option never appears outside geo modes, so other chart types keep
	// their dropdown unchanged.
	const geoLabelLevel = useGeoLabelLevel(
		isGeoMode ? (encodings.geography?.field ?? null) : null
	)
	const countryNameFormats = isGeoMode && geoLabelLevel === "countries"

	const updateCfg = (next: Partial<DataLabelsConfig>) =>
		setCfg({ ...merged, ...next })

	// "First and last per series" splits the label-text, alignment, and
	// position controls into First/Last pairs (the only mode where two label
	// populations coexist). The pairs read effective values (override ?? base)
	// and write into the endpoint override blocks. Geo modes never split:
	// the labelPoints selection is hidden AND skipped there (no series on a
	// map), so a stored "first-last" from a previous chart must not split
	// the controls.
	const splitEndpoints =
		!isGeoMode && effectiveLabelPoints(merged) === "first-last"
	const patchEndpoint = (
		key: "firstLabel" | "lastLabel",
		p: Partial<EndpointLabelOverrides>
	) => updateCfg({ [key]: { ...(merged[key] ?? {}), ...p } })

	// "Changed" dot for the Position Adjustment and Alignment subsection —
	// lights when ANY control inside deviates from its default. Mode-gated
	// values (polar nudges, bar position, endpoint overrides) only count when
	// their controls are visible: a stored deviation the current panel can't
	// clear must not light the dot.
	const endpointPositionEdited = (o: EndpointLabelOverrides | undefined) =>
		o?.alignment != null || o?.xOffset != null || o?.yOffset != null
	const positionChanged =
		(merged.alignment ?? "center") !== "center" ||
		merged.wrapText === true ||
		merged.xOffset !== 0 ||
		merged.yOffset !== 0 ||
		(isBarMode && (merged.barLabelPosition ?? "center") !== "center") ||
		(isPolarMode &&
			((merged.polarLabelAngle ?? 0) !== 0 ||
				(merged.polarLabelRadius ?? 100) !== 100)) ||
		(splitEndpoints &&
			(endpointPositionEdited(merged.firstLabel) ||
				endpointPositionEdited(merged.lastLabel)))

	// Sibling subsection dots, same model: any visible control non-default.
	// (The labelPoints select is hidden — and inert — in geo modes, so a
	// stored deviation must not light the dot there. Leader lines are
	// geo-only: the color/thickness inputs are gated behind the toggle, so
	// the toggle alone decides their contribution — like Text Background.)
	const selectionChanged =
		(!isGeoMode && effectiveLabelPoints(merged) !== "all") ||
		merged.avoidOverlaps === true ||
		(isGeoMode && merged.leaderLines === true)
	const textPositionChanged = (merged.arcWrapLevels ?? []).length > 0
	// Text Properties compares against the THEME's data-label defaults — the
	// same baseline the panel's reset links restore.
	const textPropertiesChanged =
		merged.fontFamily !== themeDefaults.fontFamily ||
		merged.fontWeight !== themeDefaults.fontWeight ||
		(merged.italic ?? false) !== (themeDefaults.italic ?? false) ||
		(merged.underline ?? false) !== (themeDefaults.underline ?? false)
	// Every other background control is gated behind the toggle, so the
	// toggle alone decides the dot (stored-but-hidden values don't count).
	const textBackgroundChanged = merged.textBackground === true

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
		<div className="flex flex-col gap-2">

			{/* Channel mapping rows lead the panel and sit OUTSIDE the purple
			 *  box — choosing what each label encodes (position, value, color,
			 *  size) is the primary action and reads as its own list; the
			 *  selection / overlap / position fine-tuning lives in the purple
			 *  group below. */}

			{/* Tree layouts have no position rows at all — placement comes from
			 *  the pack / treemap / partition layout. */}
			{isTreeMode && (
				<p className="vc-help">
					Labels are placed by the layout (leaf centers, container rims).
					Value, Color, and Size apply — Value defaults to each row&apos;s
					name from the ID column.
				</p>
			)}
			{/* Maps anchor labels to REGIONS — one Geography row replaces the
			 *  cartesian X/Y rows. Its field joins to map regions at its own
			 *  auto-detected level, independent of the map's region field, so
			 *  a county map can carry state-level labels.
			 *  Pies position labels in polar terms — Angle + R replace the
			 *  cartesian X/Y rows. These are plain mapping dropdowns; the
			 *  placement nudges (Angle°, R%) live under "Adjust position". */}
			{isTreeMode ? null : isGeoMode ? (
				<DataLabelChannelRow
					channel="geography"
					label={CHANNEL_LABEL.geography}
					value={encodings.geography?.field ?? null}
					onChange={(v) => setField("geography", v)}
					eligible={allEligible}
				/>
			) : isPolarMode ? (
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
					/>

					<DataLabelChannelRow
						channel="y"
						label={CHANNEL_LABEL.y}
						value={encodings.y.field}
						onChange={(v) => setField("y", v)}
						eligible={yEligible}
					/>
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
				{/* Multi-field mode gets the full arrangement panel; a mapped
				 *  single field gets just its Label format (same per-field
				 *  spec store, so a format survives switching modes). Unmapped
				 *  single mode still has nothing to configure — `null` (not
				 *  `false`) keeps that row chevron-less. */}
				{encodings.value.multiField ? (
					<ValuePanel
						cfg={merged}
						onChange={updateCfg}
						fields={encodings.value.fields ?? []}
						allFields={allEligible.map((f) => f.name)}
						onFieldsChange={setValueFields}
						countryNames={countryNameFormats}
					/>
				) : encodings.value.field ? (
					<SingleValuePanel
						field={encodings.value.field}
						cfg={merged}
						onChange={updateCfg}
						countryNames={countryNameFormats}
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
				<LabelColorPanel
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
				<SizePanel
					cfg={merged}
					onChange={updateCfg}
					themeDefaults={themeDefaults}
					sizeMapped={sizeByDepth || Boolean(encodings.size.field)}
					depthNote={sizeByDepth}
				/>
			</DataLabelChannelRow>

			{/* One purple panel wraps the layer-wide fine-tuning so it reads as
			 *  a single group, distinct from the per-channel mappings above. */}
			<div className="vc-option-panel">
			{/* Layer-wide toggles: which labels to keep and how to handle
			 *  collisions. Grouped under their own subsection so they read as
			 *  a distinct concern from the per-channel mappings above. */}
			{/* Selection / overlap / position controls act on the overlay
			 *  layer's positioned labels — inert for layout-placed tree
			 *  labels, so they stand down there (as does Text Background,
			 *  which the tree renderers don't draw). */}
			{!isTreeMode && (
			<>
			<CollapsibleSubsection
				title="Label selection and overlap"
				changed={selectionChanged}
			>
				<div className="flex flex-col gap-2">
				{/* Per-series endpoint selection is meaningless on a map (no
				 *  series) — the renderer skips it there, so the control hides. */}
				{!isGeoMode && (
				<SelectInput
					label="Which labels"
					labelClassName={LABEL_COL}
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
				)}
				<Toggle
					label="Avoid overlapping labels"
					className="mt-1"
					checked={merged.avoidOverlaps === true}
					onChange={(avoidOverlaps) => updateCfg({ avoidOverlaps })}
				/>
				{/* Maps only: leader lines connect a displaced label (offset or
				 *  overlap-nudged) back to its region's centroid. Defaults come
				 *  from the theme's Maps section. */}
				{isGeoMode && (
					<>
						<Toggle
							label="Draw leader lines"
							checked={merged.leaderLines === true}
							onChange={(leaderLines) => updateCfg({ leaderLines })}
						/>
						{merged.leaderLines === true && (
							<>
								<div className="ml-6 flex flex-col gap-2 text-sm">
									{/* Reset links restore the THEME's Maps-section stroke
									 *  (the same baseline new charts seed from). */}
									<div className="flex items-center gap-2">
										<ColorInput
											label="Line color"
											labelClassName={LABEL_COL_NESTED}
											value={
												merged.leaderLineColor ??
												themeDefaults.leaderLineColor ??
												"#999999"
											}
											onChange={(leaderLineColor) =>
												updateCfg({ leaderLineColor })
											}
										/>
										{merged.leaderLineColor !==
											themeDefaults.leaderLineColor && (
											<ResetLink
												onClick={() =>
													updateCfg({
														leaderLineColor: themeDefaults.leaderLineColor,
													})
												}
											/>
										)}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="Thickness"
											labelClassName={LABEL_COL_NESTED}
											value={merged.leaderLineWidth ?? 1}
											min={0}
											step={0.5}
											onChange={(leaderLineWidth) =>
												updateCfg({ leaderLineWidth })
											}
											inputClassName="w-16"
											suffix="px"
										/>
										{merged.leaderLineWidth !==
											themeDefaults.leaderLineWidth && (
											<ResetLink
												onClick={() =>
													updateCfg({
														leaderLineWidth: themeDefaults.leaderLineWidth,
													})
												}
											/>
										)}
									</div>
								</div>
								<p className="vc-help">
									Lines connect a label back to its region when an offset or
									overlap avoidance moves it off the region&apos;s center.
								</p>
							</>
						)}
					</>
				)}
				</div>
			</CollapsibleSubsection>

			<CollapsibleSubsection
				title="Position Adjustment and Alignment"
				changed={positionChanged}
			>
				<div className="flex flex-col gap-2">
				{splitEndpoints ? (
					<div className="flex flex-col gap-2">
						{/* First/Last alignment pair — effective value shown, writes
						 *  land in the endpoint override blocks. */}
						<div className="flex items-center gap-2 text-sm">
							<span className={LABEL_COL}>
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
							<span className={LABEL_COL}>
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
						<span className={LABEL_COL}>
							Alignment
						</span>
						<AlignmentControl
							value={merged.alignment ?? "center"}
							onChange={(alignment) => updateCfg({ alignment })}
						/>
					</div>
				)}
				<hr className="border-stone-200 dark:border-stone-700" />
				<Toggle
					label="Wrap text"
					checked={merged.wrapText === true}
					onChange={(wrapText) => updateCfg({ wrapText })}
				/>
				{merged.wrapText === true && (
					<div className="ml-6 flex items-center gap-2 text-sm">
						<NumberInput
							label="Characters"
							labelClassName={LABEL_COL_NESTED}
							value={merged.wrapMaxChars ?? 20}
							min={1}
							step={1}
							onChange={(wrapMaxChars) => updateCfg({ wrapMaxChars })}
							inputClassName="w-16"
						/>
					</div>
				)}
				{isBarMode && (
					<>
						<SelectInput
							label="Bar position"
							labelClassName={LABEL_COL}
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
						<p className="vc-help">
							Where labels sit along the bar&apos;s measure axis.
						</p>
					</>
				)}
				<hr className="border-stone-200 dark:border-stone-700" />
				<span className="vc-group-header">Adjust position</span>
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
						<p className="vc-help">
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
						<div className="ml-6 flex flex-col gap-2 text-sm">
							<NumberInput
								label="X"
								labelClassName={LABEL_COL_NESTED}
								value={merged.firstLabel?.xOffset ?? merged.xOffset}
								step={1}
								onChange={(xOffset) => patchEndpoint("firstLabel", { xOffset })}
								inputClassName="w-16"
								suffix="px"
							/>
							<NumberInput
								label="Y"
								labelClassName={LABEL_COL_NESTED}
								value={-(merged.firstLabel?.yOffset ?? merged.yOffset)}
								step={1}
								onChange={(n) => patchEndpoint("firstLabel", { yOffset: -n })}
								inputClassName="w-16"
								suffix="px"
							/>
						</div>
						<span className="text-sm text-stone-600 dark:text-stone-400">
							Last label
						</span>
						<div className="ml-6 flex flex-col gap-2 text-sm">
							<NumberInput
								label="X"
								labelClassName={LABEL_COL_NESTED}
								value={merged.lastLabel?.xOffset ?? merged.xOffset}
								step={1}
								onChange={(xOffset) => patchEndpoint("lastLabel", { xOffset })}
								inputClassName="w-16"
								suffix="px"
							/>
							<NumberInput
								label="Y"
								labelClassName={LABEL_COL_NESTED}
								value={-(merged.lastLabel?.yOffset ?? merged.yOffset)}
								step={1}
								onChange={(n) => patchEndpoint("lastLabel", { yOffset: -n })}
								inputClassName="w-16"
								suffix="px"
							/>
						</div>
					</>
				) : (
					<div className="flex flex-col gap-2 text-sm">
						<NumberInput
							label="X"
							labelClassName={LABEL_COL}
							value={merged.xOffset}
							step={1}
							onChange={(xOffset) => updateCfg({ xOffset })}
							inputClassName="w-16"
							suffix="px"
						/>
						<NumberInput
							label="Y"
							labelClassName={LABEL_COL}
							value={-merged.yOffset}
							step={1}
							onChange={(n) => updateCfg({ yOffset: -n })}
							inputClassName="w-16"
							suffix="px"
						/>
					</div>
				)}
				</div>
			</CollapsibleSubsection>
			</>
			)}

			{/* Packed circles only: per-container-level choice between the
			 *  default inside-the-rim placement and wrapping the group name
			 *  around the OUTSIDE of the circle on an arc. */}
			{isPackedMode && (
				<CollapsibleSubsection title="Text Position" changed={textPositionChanged}>
					<TextPositionPanel
						cfg={merged}
						onChange={updateCfg}
						levels={containerWrapLevels}
					/>
				</CollapsibleSubsection>
			)}

			<CollapsibleSubsection title="Text Properties" changed={textPropertiesChanged}>
				<TextPropertiesPanel
					cfg={merged}
					onChange={updateCfg}
					themeDefaults={themeDefaults}
				/>
			</CollapsibleSubsection>

			{!isTreeMode && (
			<CollapsibleSubsection title="Text Background" changed={textBackgroundChanged}>
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
