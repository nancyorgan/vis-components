import { useId } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_PATTERN_CONFIG,
	DEFAULT_SPINE_CONFIG,
	DEFAULT_TICKMARK_CONFIG,
	type ChannelConfigs,
	type ChordAxisConfig,
	type ConnectionConfig,
	type HueConfig,
	type PatternConfig,
	type StackMode,
} from "../../../lib/channelConfig"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import {
	primaryStackChannel,
	type StackChannel,
} from "../../../lib/stackMode"
import { MIN_LINE_THICKNESS } from "../../../lib/connectionThickness"
import {
	HIERARCHY_ID_NONE,
	inferHierarchyIdField,
} from "../../../lib/buildHierarchy"
import {
	isFlowModeId,
	isHierarchyModeId,
	isStructureModeId,
} from "../../../lib/packedMeasure"
import {
	explicitFlowTargetField,
	resolveFlowTargetField,
} from "../../../lib/buildFlowGraph"
import {
	chordAxisConfigFromTheme,
	connectionConfigFromTheme,
	valueChanged,
} from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	type AtomValueType,
	type SetterOrUpdater,
} from "../../../store/atoms"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { effectiveType } from "../../../lib/fieldType"
import { parseValue } from "../../../lib/scales"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL, LabelSpacer } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { Toggle } from "../../../../../components/ui/Toggle"
import {
	ordinalSuffix,
	SpineControls,
	TickFormatControl,
	TickLabelFontControl,
	TickmarkControls,
} from "./AxisOptionsPanel"

/** Sidebar panel for the Connection encoding (the line that joins points
 *  sharing a connection-encoding value).
 *
 *  By design, this panel is restricted to LINE-SHAPE concerns: fill mode,
 *  thickness, and which points along the line render markers. Per-value
 *  color overrides live in the Hue panel; dash-pattern overrides live in
 *  the Pattern panel. Keeping the encoding-specific overrides out of here
 *  means there's exactly one place to look when changing how lines are
 *  styled across the chart. */
export const ConnectionOptionsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const theme = useCurrentTheme()
	const fieldOverrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	// Associates the "ID column" label with its select (htmlFor/id).
	const hierarchyIdSelectId = useId()
	// Same, for the flow layouts' "Flow to" select.
	const flowTargetSelectId = useId()

	const themeCfg = connectionConfigFromTheme(theme)
	const cfg: ConnectionConfig = {
		...themeCfg,
		...configs.connection,
	}

	const updateCfg = (next: Partial<ConnectionConfig>) => {
		// Seed untouched fields from the THEME's connection config so the stored
		// slice matches the "changed" dot's theme baseline; seeding from the
		// built-in `DEFAULT_CONNECTION_CONFIG` would diverge (thickness, and the
		// newer "line" fill default vs the seeded "area") and light the dot on
		// the first edit.
		setConfigs((prev) => ({
			...prev,
			connection: {
				...connectionConfigFromTheme(theme),
				...prev.connection,
				...next,
			},
		}))
	}

	const connectionFieldName = encodings.connection?.field ?? null
	const modeId = useChartModeDef().id
	const isAreaMode = modeId === "areas-x" || modeId === "areas-y"
	const isRadarMode = modeId === "radar"
	const isScatterMode = modeId === "scatter"
	// Hierarchy layouts (packed circles / treemap / sunburst): connection is
	// the HIERARCHY key (which container each row nests in), not a drawn
	// line — every line-styling section stands down and the panel offers
	// the nesting controls instead.
	const isPackedMode = isHierarchyModeId(modeId)
	// Flow layouts (chord / sankey): connection is the flow SOURCE key —
	// ribbons/links are drawn by the renderer with data-driven thickness,
	// so line styling stands down here too.
	const isFlowMode = isFlowModeId(modeId)
	// Chord only: the ring's circular value axis (group ticks). Sankey has
	// no meaningful "around the figure" axis, so the section doesn't show.
	const isChordMode = modeId === "chord"
	// Every mode where connection is a structural key rather than a drawn
	// line — the gate for the Structure section and the line-styling
	// stand-down.
	const isStructureMode = isStructureModeId(modeId)
	// Connection lines are only DRAWN by the scatter (incl. line charts),
	// area, and radar renderers. In every other mode — bars, pies, tile,
	// hexbin, geo — the channel is either unmapped by construction (mapping
	// connection on a bar chart flips detection to areas) or a join/region
	// key, so every line-styling control would be inert and stands down.
	const drawsConnectionLines = isScatterMode || isAreaMode || isRadarMode
	// The scatter/area subset — the modes whose line styling this panel
	// renders directly (radar's lives in its own Polygon subsection below).
	const isLineOrAreaMode = isScatterMode || isAreaMode
	// What "Auto" currently resolves to, for the option label. Mirrors the
	// renderer's resolution exactly (full dataset rows; parent + area
	// columns excluded as candidates).
	const inferredIdField =
		isPackedMode && connectionFieldName && dataset
			? inferHierarchyIdField(
					dataset.rows,
					dataset.fields
						.map((f) => f.name)
						.filter(
							(n) =>
								n !== connectionFieldName && n !== (encodings.area?.field ?? null)
						),
					connectionFieldName
				)
			: null
	// Flow analogue: what the "Flow to" Auto option currently resolves to.
	// Mirrors the renderer's resolution exactly (explicit pick passed as
	// null here — this IS the Auto fallback).
	const inferredTargetField =
		isFlowMode && connectionFieldName && dataset
			? resolveFlowTargetField(
					null,
					dataset.rows,
					dataset.fields,
					connectionFieldName,
					encodings.area?.field ?? null
				)
			: null
	// The stored pick, normalized through the SAME guard resolution uses
	// (a target equal to the connection field is degenerate and resolves
	// as Auto — see explicitFlowTargetField), so the select and the bold
	// label agree with what's drawn.
	const storedFlowTarget = explicitFlowTargetField(
		cfg.flowTargetField,
		connectionFieldName
	)
	const axisStem = cfg.axisStem ?? "none"

	// Point-sampling controls show whenever connection is mapped in a mode
	// that draws lines — scatter (renderConnectionLines), areas-line mode
	// (the per-row markers AreaPlot adds in line mode), and radar polygons.
	const showPointSampling = !!connectionFieldName && drawsConnectionLines

	// Line-thickness "Vary by" state. Only scatter connection lines and radar
	// polygons group by the connection value (area layers group by hue), so
	// per-connection-category thickness is offered in those two modes only.
	// The dropdown's position is DERIVED — no separate mode flag is stored:
	// a populated `thicknessByValue` map IS "vary by", an empty / absent one
	// IS "single level" (an empty map also renders byte-identically to a
	// single thickness, so nothing is lost).
	const thicknessByValue = configs.connection?.thicknessByValue
	const thicknessVarying = !!thicknessByValue && Object.keys(thicknessByValue).length > 0
	const supportsThicknessVaryBy =
		!!connectionFieldName && (isScatterMode || isRadarMode)
	// Distinct connection-field values, in first-seen order — the categories
	// the per-value inputs enumerate. Parsed through the field's effective
	// type so numeric/temporal keys match what the renderers key on.
	const connectionValues =
		supportsThicknessVaryBy && dataset && connectionFieldName
			? [
					...new Set(
						dataset.rows
							.map((r) =>
								parseValue(
									r[connectionFieldName],
									effectiveType(dataset, connectionFieldName, fieldOverrides)
								)
							)
							.filter((v) => v !== null)
							.map(String)
					),
				]
			: []

	// Per-control "changed vs default" flags, driving the subsection dots + the
	// bold-purple labels (compared the same way as the top-level dot).
	const fieldMapped = !!connectionFieldName
	const ch = {
		thickness:
			valueChanged(configs.connection?.thickness, theme.connectionThickness) ||
			thicknessVarying,
		fill: fieldMapped && (cfg.fill ?? "line") !== "line",
		axisStem: axisStem !== "none",
		pointSampling: (cfg.pointSampling ?? "all") !== "all",
		lineCap: (cfg.lineCap ?? "round") !== "round",
		smoothing: (cfg.smoothing ?? 0) > 0,
		hierarchyId: fieldMapped && !!cfg.hierarchyIdField,
		hierarchyLayout: (cfg.hierarchyLayout ?? "pack") !== "pack",
		flowTarget: fieldMapped && !!storedFlowTarget,
	}

	// Chord ring axis: untouched pieces display (and, on the first edit,
	// store) the THEME-seeded defaults, mirroring how `updateCfg` seeds the
	// connection slice — so the "changed" comparisons against `themeAxis`
	// hold before and after any edit.
	const labels = useAtomValue(currentLabelsAtom)
	const themeAxis = chordAxisConfigFromTheme(theme)
	const axis: ChordAxisConfig = { ...themeAxis, ...cfg.chordAxis }
	const updateAxis = (next: Partial<ChordAxisConfig>) =>
		updateCfg({ chordAxis: { ...themeAxis, ...cfg.chordAxis, ...next } })
	const axisCh = {
		enabled: axis.enabled,
		format: axis.customFormat !== "",
		tickCount: axis.tickCount !== themeAxis.tickCount,
		tickmarks: valueChanged(cfg.chordAxis?.tickmarks, themeAxis.tickmarks),
		labelEvery: axis.labelEvery !== themeAxis.labelEvery,
		tickLabelFont: valueChanged(cfg.chordAxis?.tickLabelFont, undefined),
		spine: valueChanged(cfg.chordAxis?.spine, themeAxis.spine),
	}

	// One-shot source ↔ target exchange for the flow layouts. Materializes
	// the Auto-resolved target as the explicit flowTargetField (there's no
	// "reversed Auto" state to store), so a second click swaps back.
	const swapFlowDirection = () => {
		const target = storedFlowTarget ?? inferredTargetField
		if (!target || !connectionFieldName) return
		setEncodings((prev) => ({
			...prev,
			connection: { ...prev.connection, field: target },
		}))
		updateCfg({ flowTargetField: connectionFieldName })
	}

	// Flip between single thickness and per-connection-category thickness.
	// Selecting "vary by" SEEDS every category at the current single value
	// (so the map is non-empty — which is what makes the dropdown read as
	// "field" — yet renders identically until a value is edited); selecting
	// "single level" clears the map.
	const setThicknessVaryBy = (varyBy: boolean) => {
		if (!varyBy) {
			updateCfg({ thicknessByValue: {} })
			return
		}
		const seeded: Record<string, number> = {}
		for (const v of connectionValues) seeded[v] = cfg.thickness
		updateCfg({ thicknessByValue: seeded })
	}
	const setThicknessFor = (value: string, n: number) => {
		if (n < 0) return
		updateCfg({
			thicknessByValue: {
				...(configs.connection?.thicknessByValue ?? {}),
				[value]: n,
			},
		})
	}
	// Per-row "reset" returns the category to the single fallback WITHOUT
	// removing its key, so the map stays populated and the mode stays "vary
	// by" (removing the last key would silently snap back to single level).
	const resetThicknessFor = (value: string) =>
		updateCfg({
			thicknessByValue: {
				...(configs.connection?.thicknessByValue ?? {}),
				[value]: cfg.thickness,
			},
		})

	// The single global thickness input + its reset — the whole control when
	// not varying, and (in "vary by" mode) unused since each category owns a
	// row instead.
	const singleThicknessRow = (
		<div className="flex items-center gap-2 text-sm">
			<NumberInput
				label="Line thickness"
				labelClassName={LABEL_COL}
				changed={ch.thickness}
				value={cfg.thickness}
				min={MIN_LINE_THICKNESS}
				step={0.5}
				onChange={(n) => {
					// No `clamp`: negative typed input is ignored rather than
					// snapped; spinner / arrow-key steps floor at
					// MIN_LINE_THICKNESS (0, which hides the line —
					// thickness-is-the-switch).
					if (n >= 0) updateCfg({ thickness: n })
				}}
				inputClassName="w-16"
				suffix="px"
			/>
			{cfg.thickness !== themeCfg.thickness && (
				<ResetLink onClick={() => updateCfg({ thickness: themeCfg.thickness })} />
			)}
		</div>
	)

	// Shared line-thickness control — lives inside the "Line properties"
	// subsection in every mode that draws connection lines. When the mode
	// groups lines by the connection value (scatter / radar), a "Vary by"
	// dropdown lets the thickness differ per category.
	const lineThicknessRow = supportsThicknessVaryBy ? (
		<div className="flex flex-col gap-2">
			<SelectInput
				label="Vary by"
				labelClassName={LABEL_COL}
				changed={thicknessVarying}
				value={thicknessVarying ? "field" : "single"}
				options={[
					{ value: "single", label: "Single level" },
					{ value: "field", label: connectionFieldName ?? "Connection" },
				]}
				onChange={(v) => setThicknessVaryBy(v === "field")}
				selectClassName="flex-1"
			/>
			{thicknessVarying ? (
				<div className="flex flex-col gap-1.5">
					{connectionValues.map((v) => {
						const rowValue =
							configs.connection?.thicknessByValue?.[v] ?? cfg.thickness
						return (
							<div key={v} className="flex items-center gap-2 text-sm">
								<span
									className="w-24 shrink-0 truncate text-stone-700 dark:text-stone-300"
									title={v}
								>
									{v}
								</span>
								<NumberInput
									label={`Line thickness for ${v}`}
									labelClassName="sr-only"
									value={rowValue}
									min={MIN_LINE_THICKNESS}
									step={0.5}
									onChange={(n) => setThicknessFor(v, n)}
									inputClassName="w-16"
									suffix="px"
								/>
								{rowValue !== cfg.thickness && (
									<ResetLink onClick={() => resetThicknessFor(v)} />
								)}
							</div>
						)
					})}
					{connectionValues.length === 0 && (
						<p className="vc-help">
							No {connectionFieldName} values in the data yet.
						</p>
					)}
				</div>
			) : (
				singleThicknessRow
			)}
		</div>
	) : (
		singleThicknessRow
	)

	// Line/Area chart switch — surfaced as the "Fill polygon" checkbox in
	// the Polygon subsection. Filling the polygon IS an area chart: checking
	// it swaps `y → length` so the existing areas-x detection (which keys off
	// `length`) fires; unchecking reverses the swap. The user's measure field
	// is preserved across the swap, so the toggle is non-destructive.
	const switchToArea = () => {
		const yField = encodings.y?.field
		const lengthField = encodings.length?.field
		if (yField && !lengthField) {
			setEncodings((prev) => ({
				...prev,
				length: { ...prev.length, field: yField },
				y: { ...prev.y, field: null },
			}))
		}
		updateCfg({ fill: "area" })
		// Area charts with a hue almost always want stacking. Existing
		// configs may have been saved with the old "overlay" default, so
		// flip them here as part of the toggle action.
		setConfigs((prev) => {
			const hue = prev.hue
			if (!hue) return prev
			return { ...prev, hue: { ...hue, stackMode: "stack" } }
		})
	}
	const switchToLine = () => {
		const yField = encodings.y?.field
		const lengthField = encodings.length?.field
		if (lengthField && !yField) {
			setEncodings((prev) => ({
				...prev,
				y: { ...prev.y, field: lengthField },
				length: { ...prev.length, field: null },
			}))
		}
		updateCfg({ fill: "line" })
	}

	return (
		<div className="vc-option-panel">
			{isStructureMode && (
				<CollapsibleSubsection
					title="Structure"
					changed={ch.hierarchyId || ch.hierarchyLayout || ch.flowTarget}
				>
					<div className="flex flex-col gap-2">
						<div className="flex flex-col gap-1.5">
							<span
								className={
									ch.hierarchyLayout
										? "text-sm font-semibold !text-vc-section-header"
										: "text-sm text-stone-600 dark:text-stone-400"
								}
							>
								Layout
							</span>
							{(
								[
									["pack", "Packed circles"],
									["treemap", "Treemap"],
									["sunburst", "Sunburst"],
									["chord", "Chord"],
									["sankey", "Sankey"],
								] as const
							).map(([value, label]) => (
								<label key={value} className="flex items-center gap-2 text-sm">
									<input
										type="radio"
										name="hierarchy-layout"
										value={value}
										checked={(cfg.hierarchyLayout ?? "pack") === value}
										onChange={() => updateCfg({ hierarchyLayout: value })}
										className="h-3 w-3"
									/>
									<span className="text-stone-600 dark:text-stone-400">
										{label}
									</span>
								</label>
							))}
						</div>
						{isPackedMode && connectionFieldName && (
							<>
								<div className="flex items-center gap-2 text-sm">
									<label
										htmlFor={hierarchyIdSelectId}
										className={
											ch.hierarchyId
												? "w-24 shrink-0 font-semibold !text-vc-section-header"
												: "w-24 shrink-0 text-stone-600 dark:text-stone-400"
										}
									>
										ID column
									</label>
									<select
										id={hierarchyIdSelectId}
										value={cfg.hierarchyIdField ?? ""}
										onChange={(e) =>
											// "" = Auto (null); the None sentinel and explicit
											// field names pass through as-is.
											updateCfg({ hierarchyIdField: e.target.value || null })
										}
										// min-w-0 + flex-1: shrink inside the flex row when the
										// sidebar is narrow instead of overflowing the panel
										// (long option labels like "Auto — using Child" clip
										// natively inside the select).
										className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
									>
										<option value="">
											{inferredIdField
												? `Auto — using ${inferredIdField}`
												: "Auto — none detected"}
										</option>
										<option value={HIERARCHY_ID_NONE}>
											None — group one level
										</option>
										{(dataset?.fields ?? [])
											.filter((f) => f.name !== connectionFieldName)
											.map((f) => (
												<option key={f.name} value={f.name}>
													{f.name}
												</option>
											))}
									</select>
								</div>
								<p className="vc-help">
									The column naming each row. A {connectionFieldName} value
									that matches another row&apos;s ID nests that circle inside
									it, so circles can nest to any depth. Auto picks the column
									whose values overlap {connectionFieldName}&apos;s.
								</p>
							</>
						)}
						{isPackedMode && !connectionFieldName && (
							<p className="vc-help">
								Map Connection to a parent column to nest circles inside
								groups.
							</p>
						)}
						{isFlowMode && connectionFieldName && (
							<>
								<div className="flex items-center gap-2 text-sm">
									<label
										htmlFor={flowTargetSelectId}
										className={
											ch.flowTarget
												? "w-24 shrink-0 font-semibold !text-vc-section-header"
												: "w-24 shrink-0 text-stone-600 dark:text-stone-400"
										}
									>
										Flow to
									</label>
									<select
										id={flowTargetSelectId}
										value={storedFlowTarget ?? ""}
										onChange={(e) =>
											// "" = Auto (null); explicit field names pass through.
											updateCfg({ flowTargetField: e.target.value || null })
										}
										// min-w-0 + flex-1: shrink inside the flex row when the
										// sidebar is narrow instead of overflowing the panel.
										className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
									>
										<option value="">
											{inferredTargetField
												? `Auto — using ${inferredTargetField}`
												: "Auto — none detected"}
										</option>
										{(dataset?.fields ?? [])
											.filter((f) => f.name !== connectionFieldName)
											.map((f) => (
												<option key={f.name} value={f.name}>
													{f.name}
												</option>
											))}
									</select>
								</div>
								<div className="flex items-center gap-2 text-sm">
									<LabelSpacer />
									<button
										type="button"
										onClick={swapFlowDirection}
										// Nothing to swap with until a target resolves (no
										// explicit pick and Auto found nothing) — disable
										// rather than no-op silently.
										disabled={!(storedFlowTarget ?? inferredTargetField)}
										title={
											storedFlowTarget ?? inferredTargetField
												? undefined
												: "No target column resolved — pick one above first"
										}
										className="text-sm text-stone-600 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-stone-600 dark:text-stone-400 dark:hover:text-white dark:disabled:hover:text-stone-400"
									>
										⇄ Swap direction
									</button>
								</div>
								<p className="vc-help">
									Each row is a flow from {connectionFieldName} to this
									column, sized by the Area field. Auto picks the column whose
									values overlap {connectionFieldName}&apos;s.
								</p>
							</>
						)}
						{isFlowMode && !connectionFieldName && (
							<p className="vc-help">
								Map Connection to a source column to draw flows from its
								values.
							</p>
						)}
					</div>
				</CollapsibleSubsection>
			)}
			{/* Chord ring axis: graduated value ticks around the figure showing
			 *  each node's flow total. The checkbox alone shows first; enabling
			 *  it reveals the same Ticks / Tick Labels / Spine subheaders the
			 *  x / y position panels use. */}
			{isChordMode && connectionFieldName && (
				<>
					<Toggle
						label="Show axis"
						className="px-2"
						checked={axis.enabled}
						onChange={(enabled) => updateAxis({ enabled })}
						changed={axisCh.enabled}
					/>
					{axis.enabled && (
						<>
							<CollapsibleSubsection
								title="Ticks"
								changed={
									axisCh.format || axisCh.tickCount || axisCh.tickmarks
								}
							>
								<TickFormatControl
									value={axis.customFormat}
									changed={axisCh.format}
									onChange={(customFormat) => updateAxis({ customFormat })}
								/>
								<div className="flex flex-col gap-1.5">
									<div className="flex items-center gap-2 text-sm">
										<NumberInput
											label="Count"
											labelClassName={LABEL_COL}
											value={axis.tickCount}
											min={2}
											max={500}
											step={1}
											clamp
											onChange={(tickCount) => updateAxis({ tickCount })}
											inputClassName="w-20"
											changed={axisCh.tickCount}
										/>
										{axis.tickCount !== themeAxis.tickCount && (
											<ResetLink
												onClick={() =>
													updateAxis({ tickCount: themeAxis.tickCount })
												}
												underline
											/>
										)}
									</div>
									<div className="flex gap-2">
										<LabelSpacer />
										<span className="min-w-0 flex-1 vc-help">
											Approximate tick marks around the full ring — the
											step snaps to a round value and each node gets a
											share proportional to its total.
										</span>
									</div>
								</div>
								<TickmarkControls
									tick={axis.tickmarks ?? DEFAULT_TICKMARK_CONFIG}
									onChange={(t) => updateAxis({ tickmarks: t })}
									theme={theme}
								/>
							</CollapsibleSubsection>
							<CollapsibleSubsection
								title="Tick Labels"
								changed={axisCh.labelEvery || axisCh.tickLabelFont}
							>
								<div className="mb-1.5 flex items-center gap-2 text-sm">
									<NumberInput
										label="Label every"
										labelClassName={LABEL_COL}
										value={axis.labelEvery}
										min={1}
										step={1}
										clamp
										onChange={(labelEvery) =>
											updateAxis({
												labelEvery: Math.max(1, Math.floor(labelEvery)),
											})
										}
										inputClassName="w-20"
										changed={axisCh.labelEvery}
									/>
									<span className="text-sm text-stone-600">
										{axis.labelEvery > 1
											? `${ordinalSuffix(axis.labelEvery)} tick`
											: "tick"}
									</span>
									{axis.labelEvery !== themeAxis.labelEvery && (
										<ResetLink
											onClick={() =>
												updateAxis({ labelEvery: themeAxis.labelEvery })
											}
											underline
										/>
									)}
								</div>
								<TickLabelFontControl
									value={axis.tickLabelFont}
									legacyColor={undefined}
									inheritedColor={labels.baseFont.text.color}
									inheritedSize={labels.baseFont.text.size}
									inheritedFamily={labels.baseFont.text.family}
									inheritedWeight={labels.baseFont.text.weight ?? 400}
									onChange={(tickLabelFont) => updateAxis({ tickLabelFont })}
								/>
							</CollapsibleSubsection>
							<CollapsibleSubsection title="Spine" changed={axisCh.spine}>
								<SpineControls
									spine={axis.spine ?? DEFAULT_SPINE_CONFIG}
									onChange={(s) => updateAxis({ spine: s })}
									theme={theme}
								/>
							</CollapsibleSubsection>
						</>
					)}
				</>
			)}
			{isLineOrAreaMode && !!connectionFieldName && (
				<CollapsibleSubsection title="Polygon" changed={ch.fill}>
					<div className="flex flex-col gap-2">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={isAreaMode}
								onChange={(e) =>
									e.target.checked ? switchToArea() : switchToLine()
								}
								className="h-3 w-3"
							/>
							<span
								className={
									ch.fill
										? "font-semibold !text-vc-section-header"
										: "text-stone-600 dark:text-stone-400"
								}
							>
								Fill polygon
							</span>
						</label>
						{isAreaMode && (
							<StackingRow
								encodings={encodings}
								configs={configs}
								setConfigs={setConfigs}
							/>
						)}
					</div>
				</CollapsibleSubsection>
			)}
			{isLineOrAreaMode && (
				<CollapsibleSubsection
					title="Line properties"
					changed={ch.thickness || ch.lineCap || ch.smoothing}
				>
					{lineThicknessRow}
					<div className="flex flex-col gap-1.5">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={ch.smoothing}
								onChange={(e) =>
									// Single stored field: on → a sensible default amount,
									// off → 0. The Amount slider (shown below when on) is
									// the fine control; no separate boolean is kept.
									updateCfg({ smoothing: e.target.checked ? 0.6 : 0 })
								}
								className="h-3 w-3"
							/>
							<span
								className={
									ch.smoothing
										? "text-sm font-semibold !text-vc-section-header"
										: "text-stone-600 dark:text-stone-400"
								}
							>
								Smooth line
							</span>
						</label>
						{ch.smoothing && (
							<label className="flex items-center gap-2 text-sm">
								<span className={LABEL_COL}>
									Amount
								</span>
								<input
									type="range"
									min={0.05}
									max={1}
									step={0.05}
									value={cfg.smoothing ?? 0}
									onChange={(e) =>
										updateCfg({ smoothing: Number(e.target.value) })
									}
									className="min-w-0 flex-1"
								/>
								<span className="w-10 text-right text-sm text-stone-600">
									{Math.round((cfg.smoothing ?? 0) * 100)}%
								</span>
							</label>
						)}
						<span
							className={
								ch.lineCap
									? "text-sm font-semibold !text-vc-section-header"
									: "text-sm text-stone-600 dark:text-stone-400"
							}
						>
							Line cap
						</span>
						{(
							[
								["round", "Round"],
								["square", "Square"],
							] as const
						).map(([value, label]) => (
							<label key={value} className="flex items-center gap-2 text-sm">
								<input
									type="radio"
									name="connection-line-cap"
									value={value}
									checked={(cfg.lineCap ?? "round") === value}
									onChange={() => updateCfg({ lineCap: value })}
									className="h-3 w-3"
								/>
								<span className="text-stone-600 dark:text-stone-400">
									{label}
								</span>
							</label>
						))}
					</div>
				</CollapsibleSubsection>
			)}
			{isScatterMode && (
				<CollapsibleSubsection title="Connect points to axis" changed={ch.axisStem}>
					<div className="flex flex-col gap-1.5">
						{(
							[
								["none", "None"],
								["x-axis", "Connect to X-axis"],
								["y-axis", "Connect to Y-axis"],
							] as const
						).map(([value, label]) => (
							<label key={value} className="flex items-center gap-2 text-sm">
								<input
									type="radio"
									name="connection-axis-stem"
									value={value}
									checked={axisStem === value}
									onChange={() => updateCfg({ axisStem: value })}
									className="h-3 w-3"
								/>
								<span className="text-stone-600 dark:text-stone-400">
									{label}
								</span>
							</label>
						))}
						{axisStem !== "none" && (
							<p className="mt-1 border-t border-stone-200 pt-2 vc-help dark:border-stone-700">
								Set stem color under the <strong>Color</strong> menu →{" "}
								<strong>Stem</strong>.
							</p>
						)}
					</div>
				</CollapsibleSubsection>
			)}
			{isRadarMode && !!connectionFieldName && (
				<CollapsibleSubsection title="Polygon" changed={ch.fill}>
					<div className="flex flex-col gap-2">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={cfg.fillPolygon === true}
								onChange={(e) => updateCfg({ fillPolygon: e.target.checked })}
								className="h-3 w-3"
							/>
							<span
								className={
									ch.fill
										? "font-semibold !text-vc-section-header"
										: "text-stone-600 dark:text-stone-400"
								}
							>
								Fill polygon
							</span>
						</label>
						<p className="vc-help">
							Adjust line and fill opacity in the Opacity panel.
						</p>
					</div>
				</CollapsibleSubsection>
			)}
			{isRadarMode && !!connectionFieldName && (
				<CollapsibleSubsection title="Line properties" changed={ch.thickness}>
					{lineThicknessRow}
				</CollapsibleSubsection>
			)}
			{showPointSampling && (
				<CollapsibleSubsection title="Show points" changed={ch.pointSampling}>
					<div className="flex flex-col gap-1.5">
						{(
							[
								["all", "All points"],
								["none", "No points"],
								["first-only", "First point only"],
								["last-only", "Last point only"],
								["first-and-last", "First and last only"],
								["every-n", "Every Nth point (with endpoints)"],
							] as const
						).map(([value, label]) => (
							<label key={value} className="flex items-center gap-2 text-sm">
								<input
									type="radio"
									name="connection-point-sampling"
									value={value}
									checked={cfg.pointSampling === value}
									onChange={() => updateCfg({ pointSampling: value })}
									className="h-3 w-3"
								/>
								<span className="text-stone-600 dark:text-stone-400">
									{label}
								</span>
							</label>
						))}
						{cfg.pointSampling === "every-n" && (
							<NumberInput
								label="N"
								labelClassName="text-stone-600 dark:text-stone-400"
								value={cfg.pointEveryN}
								min={1}
								step={1}
								onChange={(n) =>
									// Same normalization as the previous raw input: fractions
									// floor, and anything below 1 pins to 1.
									updateCfg({ pointEveryN: Math.max(1, Math.floor(n)) })
								}
								inputClassName="w-16"
							/>
						)}
					</div>
				</CollapsibleSubsection>
			)}
			{!drawsConnectionLines && !isStructureMode && (
				<p className="vc-help">
					Connection joins points that share a value into a line. This chart
					type doesn&apos;t draw connection lines, so there are no line options
					here.
				</p>
			)}
		</div>
	)
}

/** Stack ↔ Overlay toggle styled identically to the Chart-type (Line/Area)
 *  toggle one row above. Lives in the Connection panel for area charts;
 *  bars and other stacking-supporting modes keep their Stacking toggle in
 *  the Hue panel (which doesn't have a Chart-type concept to anchor to).
 *
 *  Writes to whichever color channel owns layout for the current encoding
 *  (`primaryStackChannel`) — hue in the common case, pattern when only
 *  pattern is mapped. Same data path as the shared `StackModeRow`, just
 *  with the visual treatment that matches its sibling row. */
const StackingRow = ({
	encodings,
	configs,
	setConfigs,
}: {
	encodings: AtomValueType<typeof currentEncodingsAtom>
	configs: ChannelConfigs
	setConfigs: SetterOrUpdater<AtomValueType<typeof currentChannelConfigsAtom>>
}) => {
	const channel: StackChannel = primaryStackChannel(encodings) ?? "hue"
	const channelCfg = configs[channel] as { stackMode?: StackMode } | undefined
	const value: StackMode = channelCfg?.stackMode ?? "stack"
	const setValue = (next: StackMode) => {
		setConfigs((prev) => writeStackMode(prev, channel, next))
	}

	const buttonClass = (active: boolean) =>
		active
			? "bg-brand-500 px-2 py-1 text-sm text-white"
			: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"

	return (
		<div className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Stacking</span>
			<div
				role="group"
				aria-label="Stacking"
				className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
			>
				<button
					type="button"
					onClick={() => setValue("stack")}
					className={buttonClass(value === "stack")}
					aria-pressed={value === "stack"}
				>
					Stack
				</button>
				<button
					type="button"
					onClick={() => setValue("overlay")}
					className={buttonClass(value === "overlay")}
					aria-pressed={value === "overlay"}
				>
					Overlay
				</button>
			</div>
		</div>
	)
}

/** Write a new stackMode into the primary color channel's config slot.
 *  Mirrors the helper in `StackModeRow` so the Connection-panel toggle
 *  and the Hue/Pattern-panel toggle stay in lockstep on storage shape. */
const writeStackMode = (
	prev: ChannelConfigs,
	channel: StackChannel,
	next: StackMode,
): ChannelConfigs => {
	if (channel === "hue") {
		const base: HueConfig = prev.hue ?? DEFAULT_CATEGORICAL_HUE_CONFIG
		return { ...prev, hue: { ...base, stackMode: next } }
	}
	if (channel === "pattern") {
		const base: PatternConfig = prev.pattern ?? DEFAULT_PATTERN_CONFIG
		return { ...prev, pattern: { ...base, stackMode: next } }
	}
	return prev
}
