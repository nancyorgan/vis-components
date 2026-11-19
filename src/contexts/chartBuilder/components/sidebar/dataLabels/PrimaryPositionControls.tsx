import {
	type DataLabelsConfig,
} from "../../../lib/channelConfig"
import {
	POPULATION_LABEL,
} from "../../../lib/dataLabelsSelection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { PLAIN_ROWS } from "../../../../../components/ui/rowGroup"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import { AlignmentControl } from "../LabelsPanel"
import {
	BAR_POSITION_OPTIONS,
	DEFAULT_WRAP_CHARS,
	barSideOptions,
} from "./panelOptions"
import type { DataLabelsPanelModel } from "./useDataLabelsPanelModel"
import {
	layerControl,
	type PrimaryLabelPlacement,
} from "./positionShared"

/** The layer-wide placement controls of "Position and alignment" (a single
 *  label, or a lone composed one): alignment — one row per label population
 *  when the series ends are split out — angle, wrapping, overlap avoidance,
 *  the combo's "Show on", the bar Placement pair and the area Layer
 *  position. */
export const PrimaryPositionControls = ({
	m,
	p,
}: {
	m: DataLabelsPanelModel
	p: PrimaryLabelPlacement
}) => {
	const {
		merged,
		updateCfg,
		isRingLabels,
		isPolarMode,
		isBarMode,
		isVerticalBars,
		isComboMode,
		marksLayerName,
		isAreaMode,
		splitEndpoints,
		splitPopulations,
		patchEndpoint,
		primaryLabel,
	} = m
	const {
		primaryPosition,
		primarySide,
		setPrimaryPlacement,
		sideLocksAlignment,
		primaryLayerKey,
		primaryLayerFields,
		primaryOnMarks,
	} = p

	return (
		<>
			{!primaryLabel ? null : sideLocksAlignment ? null : splitEndpoints ? (
				<div className="flex flex-col gap-2">
					{/* One alignment per population — effective value shown; the
					 *  all-labels row writes the base, the series ends write their
					 *  endpoint override blocks. */}
					{splitPopulations.map((pop) => (
						<div key={pop} className="flex items-center gap-2 text-sm">
							<span className={LABEL_COL}>{POPULATION_LABEL[pop]}</span>
							<AlignmentControl
								outward={isPolarMode || isRingLabels}
								value={
									(pop === "all"
										? merged.alignment
										: (merged[`${pop}Label`]?.alignment ??
											merged.alignment)) ?? "center"
								}
								onChange={(alignment) =>
									pop === "all"
										? updateCfg({ alignment })
										: patchEndpoint(`${pop}Label`, { alignment })
								}
							/>
						</div>
					))}
				</div>
			) : (
				<div className="flex items-center gap-2 text-sm">
					<span className={LABEL_COL}>Align</span>
					{/* Pies and sunburst rings add the fourth, "outward", option:
					 *  text hangs away from the center, so a label on the left
					 *  ends at its anchor and one on the right starts there. */}
					<AlignmentControl
						outward={isPolarMode || isRingLabels}
						value={merged.alignment ?? "center"}
						onChange={(alignment) => updateCfg({ alignment })}
					/>
				</div>
			)}
			{/* Same convention as the axes' tick-label Angle: positive =
			 *  clockwise, ±90°. Rotates each label around its anchor point. */}
			{primaryLabel && (
			<>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Angle"
					labelClassName={LABEL_COL}
					value={merged.textAngle ?? 0}
					min={-90}
					max={90}
					step={1}
					clamp
					onChange={(textAngle) => updateCfg({ textAngle })}
					inputClassName="w-16"
					suffix="°"
				/>
				{(merged.textAngle ?? 0) !== 0 && (
					<ResetLink onClick={() => updateCfg({ textAngle: 0 })} />
				)}
			</div>
			<Checkbox
				label="Wrap text"
				checked={merged.wrapText === true}
				onChange={(wrapText) => updateCfg({ wrapText })}
			/>
			{merged.wrapText === true && (
				<div className="flex items-center gap-2 text-sm">
					<NumberInput
						label="Characters"
						labelClassName={LABEL_COL}
						value={merged.wrapMaxChars ?? DEFAULT_WRAP_CHARS}
						min={1}
						step={1}
						onChange={(wrapMaxChars) => updateCfg({ wrapMaxChars })}
						inputClassName="w-16"
					/>
					{(merged.wrapMaxChars ?? DEFAULT_WRAP_CHARS) !== DEFAULT_WRAP_CHARS && (
						<ResetLink
							onClick={() => updateCfg({ wrapMaxChars: DEFAULT_WRAP_CHARS })}
						/>
					)}
				</div>
			)}
			{/* Collision handling sits with the other placement knobs: it
			 *  moves labels, so it belongs beside wrap / nudges rather than
			 *  with the selection of WHICH labels render. */}
			<Checkbox
				label="Avoid overlapping labels"
				checked={merged.avoidOverlaps === true}
				onChange={(avoidOverlaps) => updateCfg({ avoidOverlaps })}
			/>
			</>
			)}
			{isComboMode && primaryLabel && primaryLayerKey !== null && (
				<div className={PLAIN_ROWS}>
					{layerControl(m, primaryLayerKey, primaryLayerFields)}
					<p className="vc-help">
						Whether the labels sit on the bars or on the {marksLayerName.toLowerCase()}.
					</p>
				</div>
			)}
			{isBarMode && primaryLabel && !primaryOnMarks && (
				<div className="vc-divider-group">
					<span className="vc-group-header">Placement</span>
					<SelectInput
						label={isVerticalBars ? "Vertical" : "Horizontal"}
						labelClassName={LABEL_COL}
						value={primaryPosition}
						options={BAR_POSITION_OPTIONS}
						onChange={(position) => setPrimaryPlacement({ position })}
					/>
					<SelectInput
						label={isVerticalBars ? "Horizontal" : "Vertical"}
						labelClassName={LABEL_COL}
						value={primarySide}
						options={barSideOptions(isVerticalBars)}
						onChange={(side) => setPrimaryPlacement({ side })}
					/>
				</div>
			)}
			{isAreaMode && (
				<>
					<SelectInput
						label="Layer position"
						labelClassName={LABEL_COL}
						value={
							(merged.areaLabelPosition ?? "edge") as NonNullable<
								DataLabelsConfig["areaLabelPosition"]
							>
						}
						options={[
							{ value: "edge", label: "On the top edge (default)" },
							{ value: "center", label: "Center of layer" },
							{ value: "inside-base", label: "Inside, near base" },
							{ value: "inside-end", label: "Inside, near end" },
							{ value: "outside-end", label: "Outside the top edge" },
						]}
						onChange={(areaLabelPosition) => updateCfg({ areaLabelPosition })}
					/>
				</>
			)}
		</>
	)
}
