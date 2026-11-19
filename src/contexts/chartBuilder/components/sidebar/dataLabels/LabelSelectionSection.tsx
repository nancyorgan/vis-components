import { useMemo } from "react"
import {
	effectiveLabelPoints,
	type LabelPointsMode,
	type LabelPointsScope,
} from "../../../lib/channelConfig"
import { buildFlowGraph } from "../../../lib/buildFlowGraph"
import {
	effectiveFlowLabelNodes,
	everyNodeSendsAndReceives,
	flowLabelNodeOptions,
	flowNodeTotals,
	type FlowLabelNodes,
} from "../../../lib/flowNodeLabels"
import {
	fieldLabelPointsMode,
	labelFacetKeysFor,
} from "../../../lib/dataLabelsSelection"
import type { FacetPanelRef } from "../../../lib/facetPanelRef"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import { FacetScopeControl } from "../FacetScopeControl"
import {
	SCOPE_HELP,
} from "./panelOptions"
import type { DataLabelsPanelModel } from "./useDataLabelsPanelModel"

/** The "Label selection" subsection: which labels draw ("Which labels" and
 *  the "Of each" unit), on which facet panels, the flow diagrams' node
 *  choice and the maps' leader lines. Renders nothing when the chart has
 *  none of those. */
export const LabelSelectionSection = ({ m }: { m: DataLabelsPanelModel }) => {
	const {
		encodings,
		merged,
		updateCfg,
		themeDefaults,
		dataset,
		isGeoMode,
		flowGeometry,
		noSeriesEndpoints,
		scopeFamily,
		scopeOptions,
		showScopeFor,
		effectiveScopeFor,
		whichLabelsOptionsFor,
		isFaceted,
		facetOptions,
		selection,
		flowEndpoints,
		multiFields,
		labelTitles,
		perVariable,
	} = m

	// Chord nodes usually both send and receive, which makes Senders,
	// Receivers and All nodes the same set — said in a hint so the select
	// doesn't look broken. Over the full data set (the sankey breaks cycles
	// per panel, but the ring draws every edge).
	const flowSameSet = useMemo(() => {
		if (flowGeometry !== "ring" || !dataset || !flowEndpoints) return false
		const { sourceField, targetField, valueField } = flowEndpoints
		if (!sourceField || !targetField || !valueField) return false
		const { nodes, edges } = buildFlowGraph(dataset.rows, {
			sourceField,
			targetField,
			valueField,
		})
		return everyNodeSendsAndReceives(flowNodeTotals(nodes, edges))
	}, [flowGeometry, dataset, flowEndpoints])
	// Per-label "Which labels" (multi-field mode), keyed by the composed
	// label's id.
	const setFieldLabelPoints = (key: string, mode: LabelPointsMode) =>
		updateCfg({
			fieldLabelPoints: { ...(merged.fieldLabelPoints ?? {}), [key]: mode },
		})
	// Per-label "Of each" and "Apply to all facets", same keying: each composed
	// label's series ends can run over a different unit and it can be kept
	// to its own facet panels. The single-field label writes the layer-wide
	// fields instead (there's one label to place).
	const setLabelScope = (key: string, scope: LabelPointsScope) =>
		updateCfg({
			fieldLabelPointsScope: {
				...(merged.fieldLabelPointsScope ?? {}),
				[key]: scope,
			},
		})
	const setLabelFacetKeys = (key: string, next: FacetPanelRef[] | null) =>
		updateCfg({
			fieldFacetKeys: { ...(merged.fieldFacetKeys ?? {}), [key]: next },
		})

	// One composed label's selection block. `null` = the single-field label,
	// which writes the layer-wide fields (and is what the per-label entries
	// fall back to). Nothing here applies without series ends AND without
	// facets, which is when `selectionControlsApply` is false.
	const selectionControlsApply = !noSeriesEndpoints || isFaceted
	// Whether the "Label selection" subsection has anything to show — the
	// union of its children's own gates (flow "Which labels", the per-label
	// selection block, map leader lines). An unfaceted sunburst has none, so
	// the subsection is skipped rather than rendered empty.
	const labelSelectionHasContent =
		Boolean(flowGeometry) || selectionControlsApply || isGeoMode
	const labelSelectionChanged = (key: string): boolean =>
		merged.fieldLabelPoints?.[key] != null ||
		merged.fieldLabelPointsScope?.[key] != null ||
		merged.fieldFacetKeys?.[key] != null
	const labelSelectionControls = (key: string | null) => (
		<>
			{!noSeriesEndpoints && (
				<>
					<SelectInput
						label="Which labels"
						labelClassName={LABEL_COL}
						value={
							key === null
								? effectiveLabelPoints(merged)
								: fieldLabelPointsMode(merged, key)
						}
						options={whichLabelsOptionsFor(key)}
						onChange={(mode: LabelPointsMode) =>
							key === null
								? updateCfg({ labelPoints: mode })
								: setFieldLabelPoints(key, mode)
						}
					/>
					{showScopeFor(key) && (
						<>
							<SelectInput
								label="Of each"
								labelClassName={LABEL_COL}
								value={effectiveScopeFor(key)}
								options={scopeOptions}
								onChange={(scope: LabelPointsScope) =>
									key === null
										? updateCfg({ labelPointsScope: scope })
										: setLabelScope(key, scope)
								}
							/>
							<p className="vc-help">
								{SCOPE_HELP[scopeFamily ?? "bars"][effectiveScopeFor(key)]}
							</p>
						</>
					)}
				</>
			)}
			{/* Faceted charts only: which panels draw this label. Checked (the
			 *  default, stored as null) = every panel; unchecking lists the
			 *  facets so the user ticks the ones that keep it. Hidden — and
			 *  ignored by the renderer — when not faceted. */}
			{isFaceted && (
				<FacetScopeControl
					label="Apply to all facets"
					facetKeys={
						key === null ? merged.facetKeys : labelFacetKeysFor(merged, key)
					}
					facetOptions={facetOptions}
					onChange={(next) =>
						key === null
							? updateCfg({ facetKeys: next })
							: setLabelFacetKeys(key, next)
					}
				/>
			)}
		</>
	)

	// Sibling subsection dots, same model: any visible control non-default.
	// (The labelPoints select is hidden — and inert — in geo modes, so a
	// stored deviation must not light the dot there. Leader lines are
	// geo-only: the color/thickness inputs are gated behind the toggle, so
	// the toggle alone decides their contribution — like Text Background.)
	const selectionChanged =
		(flowGeometry !== undefined &&
			effectiveFlowLabelNodes(merged.flowLabelNodes, flowGeometry) !== "all") ||
		selection.present.first ||
		selection.present.last ||
		(isFaceted &&
			(merged.facetKeys != null ||
				multiFields.some((k) => merged.fieldFacetKeys?.[k] != null))) ||
		(isGeoMode && merged.leaderLines === true)

	if (!labelSelectionHasContent) return null
	return (
		<CollapsibleSubsection
			title="Label selection"
			changed={selectionChanged}
		>
			<div className="flex flex-col gap-2">
			{/* One block per composed label: which anchors it draws at
			 *  ("Which labels" + the "Of each" unit its series ends run
			 *  over) and which facet panels it draws on. Each label keeps
			 *  its own — the `{value}` label can sit on the last bar of
			 *  every STACK across all panels while a `{series}` label sits
			 *  on the last bar of each SERIES in one panel only. A lone
			 *  composed label skips the subheader (nothing to tell apart);
			 *  a single-field mapping writes the layer-wide fields.
			 *  Per-series endpoints are meaningless on a map or a sunburst
			 *  (no series) — the renderer skips them there, so only the
			 *  facet scope shows. */}
			{/* Flow diagrams: which NODES get a label, by flow direction —
			 *  one choice for every label (nodes have no series to rank). */}
			{flowGeometry && (
				<>
					<SelectInput
						label="Which labels"
						labelClassName={LABEL_COL}
						value={effectiveFlowLabelNodes(
							merged.flowLabelNodes,
							flowGeometry
						)}
						options={flowLabelNodeOptions(flowGeometry)}
						onChange={(mode: FlowLabelNodes) =>
							updateCfg({ flowLabelNodes: mode })
						}
					/>
					<p className="vc-help">
						{flowGeometry === "columns"
							? "First senders have no incoming flow; last receivers have no outgoing flow."
							: flowSameSet
								? "Every node here both sends and receives, so these options label the same nodes."
								: "Senders have outgoing flow; receivers have incoming flow."}
					</p>
				</>
			)}
			{!selectionControlsApply ? null : encodings.value.multiField ? (
				multiFields.length === 0 ? null : perVariable ? (
					multiFields.map((key) => (
						<CollapsibleSubsection
							key={key}
							title={labelTitles[key] ?? key}
							changed={labelSelectionChanged(key)}
						>
							{labelSelectionControls(key)}
						</CollapsibleSubsection>
					))
				) : (
					// A lone composed label: the controls bound to its key.
					labelSelectionControls(multiFields[0])
				)
			) : (
				labelSelectionControls(null)
			)}
			{/* Maps only: leader lines connect a displaced label (offset or
			 *  overlap-nudged) back to its region's centroid. Defaults come
			 *  from the theme's Maps section. */}
			{isGeoMode && (
				<>
					<Checkbox
						label="Show leader lines"
						checked={merged.leaderLines === true}
						onChange={(leaderLines) => updateCfg({ leaderLines })}
					/>
					{merged.leaderLines === true && (
						<>
							<div className="flex flex-col gap-2 text-sm">
								{/* Reset links restore the THEME's Maps-section stroke
								 *  (the same baseline new charts seed from). */}
								<div className="flex flex-wrap items-center gap-2">
									<ColorInput
										label="Line color"
										labelClassName={LABEL_COL}
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
										labelClassName={LABEL_COL}
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
						</>
					)}
				</>
			)}
			</div>
		</CollapsibleSubsection>
	)
}
