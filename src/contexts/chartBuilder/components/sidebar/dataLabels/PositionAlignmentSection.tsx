import {
	type EndpointLabelOverrides,
} from "../../../lib/channelConfig"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import {
	hierarchyDepthLevels,
} from "../../../lib/packedMeasure"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { TextPositionPanel } from "./TextPositionPanel"
import type { DataLabelsPanelModel } from "./useDataLabelsPanelModel"
import {
	primaryLabelPlacement,
} from "./positionShared"
import { OwnLabelPositionSection } from "./OwnLabelPositionSection"
import { PrimaryPositionControls } from "./PrimaryPositionControls"
import { AdjustPositionGroup } from "./AdjustPositionGroup"

/** The "Position and alignment" subsection: packed circles' rim wrapping,
 *  one block per label when several are composed, else the layer-wide
 *  placement controls and the "Adjust position" group. */
export const PositionAlignmentSection = ({ m }: { m: DataLabelsPanelModel }) => {
	const {
		chartEncodings,
		merged,
		updateCfg,
		chartConfigs,
		dataset,
		modeDef,
		isRingLabels,
		isPolarMode,
		isBarMode,
		isComboMode,
		isAreaMode,
		selection,
		splitEndpoints,
		ownLabelKeys,
		primaryLabel,
	} = m
	const p = primaryLabelPlacement(m)
	const {
		primaryPosition,
		primarySide,
		primaryPolarAngle,
		primaryPolarRadius,
		sideLocksAlignment,
		primaryLayerKey,
		primaryOnMarks,
	} = p

	// "Changed" dot for the Position and alignment subsection —
	// lights when ANY control inside deviates from its default. Mode-gated
	// values (polar nudges, bar position, endpoint overrides) only count when
	// their controls are visible: a stored deviation the current panel can't
	// clear must not light the dot.
	const endpointPositionEdited = (o: EndpointLabelOverrides | undefined) =>
		o?.alignment != null || o?.xOffset != null || o?.yOffset != null
	// Separate variables: the layer-wide alignment / angle / wrap / overlap /
	// nudge / bar-placement controls hide (each variable has its own), so
	// only the per-variable entries count there.
	const anyOwn = (map: Record<string, unknown> | undefined) =>
		ownLabelKeys.some((k) => map?.[k] != null)
	const positionChanged =
		anyOwn(merged.fieldAlignments) ||
		anyOwn(merged.fieldLayouts) ||
		anyOwn(merged.fieldOffsets) ||
		(isBarMode && anyOwn(merged.fieldBarPlacements)) ||
		(isComboMode &&
			(anyOwn(merged.fieldLayers) ||
				(primaryLabel &&
					primaryLayerKey !== null &&
					merged.fieldLayers?.[primaryLayerKey] != null))) ||
		(primaryLabel &&
			((!sideLocksAlignment && (merged.alignment ?? "center") !== "center") ||
				(merged.textAngle ?? 0) !== 0 ||
				merged.wrapText === true ||
				merged.avoidOverlaps === true ||
				merged.xOffset !== 0 ||
				merged.yOffset !== 0 ||
				(isBarMode && !primaryOnMarks && primaryPosition !== "center") ||
				(isBarMode && !primaryOnMarks && primarySide !== "center"))) ||
		ownLabelKeys.some(
			(k) => (merged.fieldPositionRules?.[k]?.length ?? 0) > 0
		) ||
		(primaryLabel && (merged.positionRules ?? []).length > 0) ||
		(isAreaMode && (merged.areaLabelPosition ?? "edge") !== "edge") ||
		(isPolarMode && anyOwn(merged.fieldPolarPlacements)) ||
		(isPolarMode &&
			primaryLabel &&
			(primaryPolarAngle !== 0 || primaryPolarRadius !== 100)) ||
		(isRingLabels &&
			((merged.polarLabelAngle ?? 0) !== 0 ||
				(merged.ringLabelRadius ?? 50) !== 50)) ||
		(splitEndpoints &&
			((selection.present.first && endpointPositionEdited(merged.firstLabel)) ||
				(selection.present.last && endpointPositionEdited(merged.lastLabel))))
	const textPositionChanged = (merged.arcWrapLevels ?? []).length > 0

	// Packed circles' "Wrap label around" checkboxes: one per CONTAINER depth
	// (levels that draw grouping circles — every hierarchy level except the
	// deepest, which is all leaves). Derived from the same tree the renderer
	// builds so the checkbox list tracks the drawn nesting.
	const hasContainerRimLabels = modeDef.labels.containerRimLabels
	const containerWrapLevels = (() => {
		if (!hasContainerRimLabels || !dataset) return []
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
	// Shown (inside Position and alignment) only with levels to wrap.
	const showWrapLevels = hasContainerRimLabels && containerWrapLevels.length > 0

	return (
		<CollapsibleSubsection
			title="Position and alignment"
			changed={positionChanged || (showWrapLevels && textPositionChanged)}
		>
			<div className="flex flex-col gap-2">
			{/* Packed circles only: per-container-level choice between the
			 *  default inside-the-rim placement and wrapping the group name
			 *  around the OUTSIDE of the circle on an arc. Leads the section:
			 *  it decides where a container's label sits at all, before any
			 *  alignment or nudge applies. */}
			{showWrapLevels && (
				<>
					<TextPositionPanel
						cfg={merged}
						onChange={updateCfg}
						levels={containerWrapLevels}
					/>
					{/* A divider once the levels are a group, not a single row. */}
					{containerWrapLevels.length > 1 && (
						<hr className="border-stone-200 dark:border-stone-700" />
					)}
				</>
			)}
			{/* Separate labels (Combine variables unchecked): every variable is
			 *  its own label, so each gets its OWN subsection holding the
			 *  whole set — alignment, angle, wrapping, overlap avoidance, bar
			 *  placement, and the X / Y nudge. Effective values shown (the
			 *  variable's entry, else the layer's); writes go to the
			 *  variable's entry. The layer-wide controls below hide in this
			 *  mode; position rules stay layer-wide (they key on values). */}
			{ownLabelKeys.map((name) => (
				<OwnLabelPositionSection key={name} m={m} name={name} />
			))}
			<PrimaryPositionControls m={m} p={p} />
			<AdjustPositionGroup m={m} p={p} />
			</div>
		</CollapsibleSubsection>
	)
}
