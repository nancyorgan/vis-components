import {
	type FieldBarPlacement,
	type FieldLabelLayout,
	type FieldPolarPlacement,
	type LabelPositionRule,
} from "../../../lib/channelConfig"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import { AlignmentControl } from "../LabelsPanel"
import { PositionRulesEditor } from "./PositionRulesEditor"
import {
	BAR_POSITION_OPTIONS,
	DEFAULT_WRAP_CHARS,
	barSideOptions,
} from "./panelOptions"
import type { DataLabelsPanelModel } from "./useDataLabelsPanelModel"
import {
	layerControl,
} from "./positionShared"

/** One label's own "Position and alignment" block (two or more composed
 *  labels): alignment, angle, wrapping, overlap avoidance, bar placement,
 *  the position nudges and its position rules. Effective values shown (the
 *  label's entry, else the layer's); writes go to the label's entry. */
export const OwnLabelPositionSection = ({
	m,
	name,
}: {
	m: DataLabelsPanelModel
	name: string
}) => {
	const {
		merged,
		updateCfg,
		isRingLabels,
		isPolarMode,
		isBarMode,
		isVerticalBars,
		isComboMode,
		layerFor,
		sideLocksAlignmentFor,
		labelKeys,
		labelTitles,
		comboIds,
	} = m
	const ownLayout = merged.fieldLayouts?.[name] ?? {}
	const ownOffsets = merged.fieldOffsets?.[name] ?? {}
	const ownPlacement = merged.fieldBarPlacements?.[name] ?? {}
	const ownPolar = merged.fieldPolarPlacements?.[name] ?? {}
	const ownAlignment = merged.fieldAlignments?.[name]
	const patchLayout = (p: FieldLabelLayout) =>
		updateCfg({
			fieldLayouts: {
				...(merged.fieldLayouts ?? {}),
				[name]: { ...ownLayout, ...p },
			},
		})
	const patchOffsets = (p: { xOffset?: number; yOffset?: number }) =>
		updateCfg({
			fieldOffsets: {
				...(merged.fieldOffsets ?? {}),
				[name]: { ...ownOffsets, ...p },
			},
		})
	const patchPlacement = (p: FieldBarPlacement) =>
		updateCfg({
			fieldBarPlacements: {
				...(merged.fieldBarPlacements ?? {}),
				[name]: { ...ownPlacement, ...p },
			},
		})
	const patchPolar = (p: FieldPolarPlacement) =>
		updateCfg({
			fieldPolarPlacements: {
				...(merged.fieldPolarPlacements ?? {}),
				[name]: { ...ownPolar, ...p },
			},
		})
	const polarAngle = ownPolar.angle ?? merged.polarLabelAngle ?? 0
	const polarRadius = ownPolar.radius ?? merged.polarLabelRadius ?? 100
	const angle = ownLayout.textAngle ?? merged.textAngle ?? 0
	const wrap = ownLayout.wrapText ?? merged.wrapText === true
	const avoid =
		ownLayout.avoidOverlaps ?? merged.avoidOverlaps === true
	const ownRules = merged.fieldPositionRules?.[name] ?? []
	const setRules = (next: LabelPositionRule[]) => {
		const all = { ...(merged.fieldPositionRules ?? {}) }
		if (next.length === 0) delete all[name]
		else all[name] = next
		updateCfg({ fieldPositionRules: all })
	}
	const ownOnMarks =
		isComboMode && layerFor(name, labelKeys.pieces[name] ?? []) === "marks"
	const changed =
		ownAlignment != null ||
		Object.keys(ownLayout).length > 0 ||
		ownOffsets.xOffset != null ||
		ownOffsets.yOffset != null ||
		ownRules.length > 0 ||
		(isComboMode && merged.fieldLayers?.[name] != null) ||
		(isBarMode && !ownOnMarks && Object.keys(ownPlacement).length > 0) ||
		(isPolarMode && Object.keys(ownPolar).length > 0)
	const measureSelect = (
		<SelectInput
			label={isVerticalBars ? "Vertical" : "Horizontal"}
			labelClassName={LABEL_COL}
			value={
				ownPlacement.position ?? merged.barLabelPosition ?? "center"
			}
			options={BAR_POSITION_OPTIONS}
			onChange={(position) => patchPlacement({ position })}
		/>
	)
	const sideSelect = (
		<SelectInput
			label={isVerticalBars ? "Horizontal" : "Vertical"}
			labelClassName={LABEL_COL}
			value={ownPlacement.side ?? merged.barLabelSide ?? "center"}
			options={barSideOptions(isVerticalBars)}
			onChange={(side) => patchPlacement({ side })}
		/>
	)
	return (
		<CollapsibleSubsection
			title={labelTitles[name] ?? name}
			changed={changed}
		>
			{isComboMode && layerControl(m, name, labelKeys.pieces[name] ?? [])}
			{/* Beside a vertical bar the side sets the alignment. */}
			{!sideLocksAlignmentFor(name) && (
				<div className="flex items-center gap-2 text-sm">
					<span className={LABEL_COL}>Align</span>
					<AlignmentControl
						outward={isPolarMode || isRingLabels}
						value={ownAlignment ?? merged.alignment ?? "center"}
						onChange={(alignment) =>
							updateCfg({
								fieldAlignments: {
									...(merged.fieldAlignments ?? {}),
									[name]: alignment,
								},
							})
						}
					/>
				</div>
			)}
			<div className="flex items-center gap-2">
				<NumberInput
					label="Angle"
					labelClassName={LABEL_COL}
					value={angle}
					min={-90}
					max={90}
					step={1}
					clamp
					onChange={(textAngle) => patchLayout({ textAngle })}
					inputClassName="w-16"
					suffix="°"
				/>
				{angle !== 0 && (
					<ResetLink onClick={() => patchLayout({ textAngle: 0 })} />
				)}
			</div>
			<Checkbox
				label="Wrap text"
				checked={wrap}
				onChange={(wrapText) => patchLayout({ wrapText })}
			/>
			{wrap && (
				<div className="flex items-center gap-2 text-sm">
					<NumberInput
						label="Characters"
						labelClassName={LABEL_COL}
						value={ownLayout.wrapMaxChars ?? merged.wrapMaxChars ?? DEFAULT_WRAP_CHARS}
						min={1}
						step={1}
						onChange={(wrapMaxChars) => patchLayout({ wrapMaxChars })}
						inputClassName="w-16"
					/>
					{(ownLayout.wrapMaxChars ?? merged.wrapMaxChars ?? DEFAULT_WRAP_CHARS) !==
						DEFAULT_WRAP_CHARS && (
						<ResetLink
							onClick={() => patchLayout({ wrapMaxChars: DEFAULT_WRAP_CHARS })}
						/>
					)}
				</div>
			)}
			<Checkbox
				label="Avoid overlapping labels"
				checked={avoid}
				onChange={(avoidOverlaps) => patchLayout({ avoidOverlaps })}
			/>
			{isBarMode && !ownOnMarks && (
				<div className="vc-divider-group">
					<span className="vc-group-header">Placement</span>
					{isVerticalBars ? measureSelect : sideSelect}
					{isVerticalBars ? sideSelect : measureSelect}
				</div>
			)}
			<div className="vc-divider-group">
				<span className="vc-group-header">Adjust position</span>
				{/* On a pie each variable has its own Angle / R, above the
				 *  X / Y nudge as in the layer-wide group: the radius is
				 *  what puts the name at the rim and the value in the wedge
				 *  (a pixel nudge pushes a top wedge's label outward and a
				 *  bottom wedge's inward). */}
				{isPolarMode && (
					<>
						<div className="flex items-center gap-2">
							<NumberInput
								label="Angle"
								labelClassName={LABEL_COL}
								value={polarAngle}
								step={5}
								onChange={(angle) => patchPolar({ angle })}
								inputClassName="w-16"
								suffix="°"
							/>
							{polarAngle !== 0 && (
								<ResetLink onClick={() => patchPolar({ angle: 0 })} />
							)}
						</div>
						<div className="flex items-center gap-2">
							<NumberInput
								label="R"
								labelClassName={LABEL_COL}
								value={polarRadius}
								min={0}
								max={200}
								step={5}
								onChange={(radius) => patchPolar({ radius })}
								inputClassName="w-16"
								suffix="%"
							/>
							{polarRadius !== 100 && (
								<ResetLink onClick={() => patchPolar({ radius: 100 })} />
							)}
						</div>
					</>
				)}
				<div className="flex items-center gap-2">
					<NumberInput
						label="X"
						labelClassName={LABEL_COL}
						value={ownOffsets.xOffset ?? merged.xOffset}
						step={1}
						onChange={(xOffset) => patchOffsets({ xOffset })}
						inputClassName="w-16"
						suffix="px"
					/>
					{(ownOffsets.xOffset ?? merged.xOffset) !== 0 && (
						<ResetLink onClick={() => patchOffsets({ xOffset: 0 })} />
					)}
				</div>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Y"
						labelClassName={LABEL_COL}
						value={-(ownOffsets.yOffset ?? merged.yOffset)}
						step={1}
						onChange={(n) => patchOffsets({ yOffset: -n })}
						inputClassName="w-16"
						suffix="px"
					/>
					{(ownOffsets.yOffset ?? merged.yOffset) !== 0 && (
						<ResetLink onClick={() => patchOffsets({ yOffset: 0 })} />
					)}
				</div>
				{/* This label's own rules, under its own header —
				 *  each label positions on its own, so each gets its
				 *  own "+ Add rule". */}
				<PositionRulesEditor
					rules={ownRules}
					onChange={setRules}
					baseXOffset={ownOffsets.xOffset ?? merged.xOffset}
					baseYOffset={ownOffsets.yOffset ?? merged.yOffset}
					ruleLabel={labelTitles[name] ?? name}
					help={
						comboIds.has(name) ? undefined : (
							<>
								Compared against each label&apos;s{" "}
								<strong>{name}</strong> value.
							</>
						)
					}
				/>
			</div>
		</CollapsibleSubsection>
	)
}
