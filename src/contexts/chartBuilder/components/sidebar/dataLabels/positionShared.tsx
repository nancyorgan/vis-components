import {
	type FieldBarPlacement,
	type FieldPolarPlacement,
} from "../../../lib/channelConfig"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { Segmented } from "../../../../../components/ui/Segmented"
import type { DataLabelsPanelModel } from "./useDataLabelsPanelModel"

/** The PRIMARY label's placement: the layer-wide controls of "Position and
 *  alignment", bound to a lone composed label's own entries when there is
 *  one. */
export const primaryLabelPlacement = (m: DataLabelsPanelModel) => {
	const {
		encodings,
		merged,
		updateCfg,
		isComboMode,
		layerFor,
		sideLocksAlignmentFor,
		labelKeys,
		loneLabelKey,
	} = m
	const primaryPlacement: FieldBarPlacement =
		loneLabelKey === null
			? {}
			: (merged.fieldBarPlacements?.[loneLabelKey] ?? {})
	const primaryPosition =
		primaryPlacement.position ?? merged.barLabelPosition ?? "center"
	const primarySide = primaryPlacement.side ?? merged.barLabelSide ?? "center"
	const setPrimaryPlacement = (p: FieldBarPlacement) =>
		loneLabelKey === null
			? updateCfg({
					...(p.position ? { barLabelPosition: p.position } : {}),
					...(p.side ? { barLabelSide: p.side } : {}),
				})
			: updateCfg({
					fieldBarPlacements: {
						...(merged.fieldBarPlacements ?? {}),
						[loneLabelKey]: { ...primaryPlacement, ...p },
					},
				})
	// Same for a lone composed label's Angle / R pair on a pie: its own
	// entry over the layer-wide pair, written in place of it.
	const primaryPolar: FieldPolarPlacement =
		loneLabelKey === null
			? {}
			: (merged.fieldPolarPlacements?.[loneLabelKey] ?? {})
	const primaryPolarAngle = primaryPolar.angle ?? merged.polarLabelAngle ?? 0
	const primaryPolarRadius =
		primaryPolar.radius ?? merged.polarLabelRadius ?? 100
	const setPrimaryPolar = (p: FieldPolarPlacement) =>
		loneLabelKey === null
			? updateCfg({
					...(p.angle !== undefined ? { polarLabelAngle: p.angle } : {}),
					...(p.radius !== undefined ? { polarLabelRadius: p.radius } : {}),
				})
			: updateCfg({
					fieldPolarPlacements: {
						...(merged.fieldPolarPlacements ?? {}),
						[loneLabelKey]: { ...primaryPolar, ...p },
					},
				})
	const sideLocksAlignment = sideLocksAlignmentFor(loneLabelKey)
	// The primary label's combo layer: a lone composed label keys by its id,
	// the single-field label by its value field (the renderer's rule).
	const primaryLayerKey =
		loneLabelKey ??
		encodings.value.field ??
		encodings.x.field ??
		encodings.y.field ??
		null
	const primaryLayerFields =
		loneLabelKey !== null
			? (labelKeys.pieces[loneLabelKey] ?? [])
			: primaryLayerKey !== null
				? [primaryLayerKey]
				: []
	const primaryOnMarks =
		isComboMode && layerFor(primaryLayerKey, primaryLayerFields) === "marks"

	return {
		primaryPosition,
		primarySide,
		setPrimaryPlacement,
		primaryPolarAngle,
		primaryPolarRadius,
		setPrimaryPolar,
		sideLocksAlignment,
		primaryLayerKey,
		primaryLayerFields,
		primaryOnMarks,
	}
}

export type PrimaryLabelPlacement = ReturnType<typeof primaryLabelPlacement>

/** Bar + marks combo: the "Show on" row for one label. */
export const layerControl = (
	m: DataLabelsPanelModel,
	key: string,
	fields: ReadonlyArray<string>
) => {
	const { layerFor, marksLayerName, updateCfg, merged } = m
	return (
		<div className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Show on</span>
			<Segmented
				ariaLabel="Show labels on"
				value={layerFor(key, fields)}
				segments={[
					{ key: "bars", label: "Bars" },
					{ key: "marks", label: marksLayerName },
				]}
				onChange={(layer) =>
					updateCfg({
						fieldLayers: { ...(merged.fieldLayers ?? {}), [key]: layer },
					})
				}
			/>
		</div>
	)
}
