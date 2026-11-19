import {
	POPULATION_LABEL,
} from "../../../lib/dataLabelsSelection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { PositionRulesEditor } from "./PositionRulesEditor"
import type { DataLabelsPanelModel } from "./useDataLabelsPanelModel"
import {
	type PrimaryLabelPlacement,
} from "./positionShared"

/** The "Adjust position" group: the pie's Angle / R, the sunburst's
 *  ring-relative pair, the X / Y pixel nudge (one pair per label population
 *  when the series ends are split out) and the arranged label's position
 *  rules. */
export const AdjustPositionGroup = ({
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
		splitEndpoints,
		splitPopulations,
		patchEndpoint,
		primaryLabel,
	} = m
	const {
		primaryPolarAngle,
		primaryPolarRadius,
		setPrimaryPolar,
	} = p

	if (!(primaryLabel || isRingLabels)) return null
	return (
		<div className="vc-divider-group">
			<span className="vc-group-header">Adjust position</span>
			{/* Angle / R are polar-only — they only make sense around a pie,
			 *  so they're hidden for cartesian charts. The X/Y pixel nudge
			 *  below applies to every chart type, pies included. With
			 *  separate variables the pair moves into each variable's block
			 *  above (`fieldPolarPlacements`); a lone composed label reads
			 *  and writes its own entry, like its bar Placement. */}
			{isPolarMode && primaryLabel && (
				<>
					<div className="flex flex-col gap-2 text-sm">
						<div className="flex items-center gap-2">
							<NumberInput
								label="Angle"
								labelClassName={LABEL_COL}
								value={primaryPolarAngle}
								step={5}
								onChange={(angle) => setPrimaryPolar({ angle })}
								inputClassName="w-16"
								suffix="°"
							/>
							{primaryPolarAngle !== 0 && (
								<ResetLink onClick={() => setPrimaryPolar({ angle: 0 })} />
							)}
						</div>
						<div className="flex items-center gap-2">
							<NumberInput
								label="R"
								labelClassName={LABEL_COL}
								value={primaryPolarRadius}
								min={0}
								max={200}
								step={5}
								onChange={(radius) => setPrimaryPolar({ radius })}
								inputClassName="w-16"
								suffix="%"
							/>
							{primaryPolarRadius !== 100 && (
								<ResetLink onClick={() => setPrimaryPolar({ radius: 100 })} />
							)}
						</div>
					</div>
				</>
			)}
			{/* Sunburst: same Angle nudge; R is RING-relative (percent across
			 *  the ring's thickness) since each ring sits at its own radius. */}
			{isRingLabels && (
				<>
					<div className="flex flex-col gap-2 text-sm">
						<div className="flex items-center gap-2">
							<NumberInput
								label="Angle"
								labelClassName={LABEL_COL}
								value={merged.polarLabelAngle ?? 0}
								step={5}
								onChange={(polarLabelAngle) => updateCfg({ polarLabelAngle })}
								inputClassName="w-16"
								suffix="°"
							/>
							{(merged.polarLabelAngle ?? 0) !== 0 && (
								<ResetLink onClick={() => updateCfg({ polarLabelAngle: 0 })} />
							)}
						</div>
						<div className="flex items-center gap-2">
							<NumberInput
								label="R"
								labelClassName={LABEL_COL}
								value={merged.ringLabelRadius ?? 50}
								min={0}
								max={200}
								step={5}
								onChange={(ringLabelRadius) => updateCfg({ ringLabelRadius })}
								inputClassName="w-16"
								suffix="%"
							/>
							{(merged.ringLabelRadius ?? 50) !== 50 && (
								<ResetLink onClick={() => updateCfg({ ringLabelRadius: 50 })} />
							)}
						</div>
					</div>
				</>
			)}
			{!primaryLabel ? null : splitEndpoints ? (
				<>
					{/* One X/Y pair per population — effective values shown; the
					 *  all-labels pair writes the base offsets, the series ends
					 *  write their endpoint override blocks. */}
					{splitPopulations.map((pop) => {
						const patch = (p: { xOffset?: number; yOffset?: number }) =>
							pop === "all"
								? updateCfg(p)
								: patchEndpoint(`${pop}Label`, p)
						const xValue =
							pop === "all"
								? merged.xOffset
								: (merged[`${pop}Label`]?.xOffset ?? merged.xOffset)
						const yValue =
							pop === "all"
								? merged.yOffset
								: (merged[`${pop}Label`]?.yOffset ?? merged.yOffset)
						// Reset: the all-labels pair back to 0; a series end back to
						// inheriting the all-labels pair (its override cleared).
						const ownOf = (k: "xOffset" | "yOffset") =>
							pop === "all" ? null : (merged[`${pop}Label`]?.[k] ?? null)
						const xChanged =
							pop === "all" ? merged.xOffset !== 0 : ownOf("xOffset") != null
						const yChanged =
							pop === "all" ? merged.yOffset !== 0 : ownOf("yOffset") != null
						const resetPop = (k: "xOffset" | "yOffset") =>
							pop === "all"
								? updateCfg({ [k]: 0 })
								: patchEndpoint(`${pop}Label`, { [k]: null })
						return (
							<div key={pop} className="flex flex-col gap-2">
								<span className="text-sm vc-text">
									{POPULATION_LABEL[pop]}
								</span>
								<div className="flex flex-col gap-2 text-sm">
									<div className="flex items-center gap-2">
										<NumberInput
											label="X"
											labelClassName={LABEL_COL}
											value={xValue}
											step={1}
											onChange={(xOffset) => patch({ xOffset })}
											inputClassName="w-16"
											suffix="px"
										/>
										{xChanged && <ResetLink onClick={() => resetPop("xOffset")} />}
									</div>
									<div className="flex items-center gap-2">
										<NumberInput
											label="Y"
											labelClassName={LABEL_COL}
											value={-yValue}
											step={1}
											onChange={(n) => patch({ yOffset: -n })}
											inputClassName="w-16"
											suffix="px"
										/>
										{yChanged && <ResetLink onClick={() => resetPop("yOffset")} />}
									</div>
								</div>
							</div>
						)
					})}
				</>
			) : (
				<div className="flex flex-col gap-2 text-sm">
					<div className="flex items-center gap-2">
						<NumberInput
							label="X"
							labelClassName={LABEL_COL}
							value={merged.xOffset}
							step={1}
							onChange={(xOffset) => updateCfg({ xOffset })}
							inputClassName="w-16"
							suffix="px"
						/>
						{merged.xOffset !== 0 && (
							<ResetLink onClick={() => updateCfg({ xOffset: 0 })} />
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Y"
							labelClassName={LABEL_COL}
							value={-merged.yOffset}
							step={1}
							onChange={(n) => updateCfg({ yOffset: -n })}
							inputClassName="w-16"
							suffix="px"
						/>
						{merged.yOffset !== 0 && (
							<ResetLink onClick={() => updateCfg({ yOffset: 0 })} />
						)}
					</div>
				</div>
			)}
			{/* The ARRANGED label's rules. With the variables separate there is
			 *  no arranged label, and every own label carries its rules in its
			 *  own subsection above. */}
			{primaryLabel && (
				<PositionRulesEditor
					rules={merged.positionRules ?? []}
					onChange={(positionRules) => updateCfg({ positionRules })}
					baseXOffset={merged.xOffset}
					baseYOffset={merged.yOffset}
				/>
			)}
		</div>
	)
}
