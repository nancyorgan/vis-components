import type { ReactNode } from "react"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { Segmented } from "../../../../../components/ui/Segmented"
import { Select } from "../../../../../components/ui/Select"
import {
	radiusUnitOf,
	type BoxAnnotationStyle,
	type CircleAnnotation,
	type RadiusUnit,
} from "../../../lib/annotationsConfig"
import {
	convertCoord,
	convertRadius,
	convertRadiusUnit,
	hasDataUnits,
	toNumber,
	cleanNumber,
	type AxisInfo,
} from "./axisInfo"
import { isPercentSystem } from "../../../lib/annotationPixels"
import { AnnotationCard, AxisValueInput, LayerRow } from "./controls"
import {
	BorderSection,
	CoordSystemSelect,
	FillSection,
	coordHelpFor,
	usePlotDims,
} from "./sections"

/** The px / % unit dropdown's options, in display order. */
const RADIUS_UNITS: ReadonlyArray<readonly [RadiusUnit, string]> = [
	["px", "px"],
	["percent", "%"],
]

const RADIUS_AXIS_SEGMENTS = [
	{ key: "x", label: "x" },
	{ key: "y", label: "y" },
] as const

/** Helper line under the radius box when its axis has no data units. */
const radiusUnitHelpFor = (axis: "x" | "y"): string =>
	`The ${axis} axis has no data units, so the radius is a fixed px size or a % of the plot's ${axis === "x" ? "width" : "height"}.`

/** Sidebar editor for circle annotations. Mirrors RectangleEditor, but a
 *  circle is center + radius rather than four edges. The radius is measured
 *  against a single chosen axis (`radiusAxis`) so it always renders as a true
 *  on-screen circle — see `circleAnnotationGeometry.ts` for the placement.
 *  When that axis has no data units (categorical / string-ordinal /
 *  temporal), the Values-mode radius box grows a px / % unit toggle beside
 *  it (`radiusUnit`), since there is no axis unit a radius could count in. */
export const CircleEditor = ({
	circle,
	defaults,
	onChange,
	onRemove,
	open,
	onToggle,
	xAxis,
	yAxis,
	isRadar,
	disableValues,
	fallbackName,
	facetScope,
}: {
	circle: CircleAnnotation
	/** Theme-seeded style baseline the reset links compare against. */
	defaults: BoxAnnotationStyle
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
	/** Name shown when the stored one is blank (pre-default-name saves). */
	fallbackName: string
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
	const dims = usePlotDims()
	// Pixels-mode radius converts against the radius axis's plot extent.
	const radiusExtentPx =
		dims === null
			? null
			: circle.radiusAxis === "x"
				? dims.widthPx
				: dims.heightPx
	// A categorical / string-ordinal / temporal radius axis has no data units,
	// so in values mode the radius carries its own unit — on-screen px, or a
	// fraction of that axis's plot extent — picked by the toggle beside the
	// radius box. Radar keeps its r-axis rule (`computePolarCirclePixels`).
	const radiusUnit = radiusUnitOf(circle)
	const showRadiusUnit =
		!isRadar &&
		circle.coordSystem === "values" &&
		!hasDataUnits(radiusAxisInfo)
	const setRadiusUnit = (next: RadiusUnit) => {
		if (next === radiusUnit) return
		// Convert the stored number so the circle keeps its on-screen size.
		onChange({
			radiusUnit: next,
			radius: convertRadiusUnit(circle.radius, radiusUnit, next, radiusExtentPx),
		})
	}
	return (
		<AnnotationCard
			kind="circle"
			name={circle.name}
			fallbackName={fallbackName}
			onNameChange={(name) => onChange({ name })}
			onRemove={onRemove}
			open={open}
			onToggle={onToggle}
		>
			{facetScope}

			<CollapsibleSubsection title="Position">
				<div className="flex flex-col gap-2">
					<CoordSystemSelect
						value={circle.coordSystem}
						disableValues={disableValues}
						onChange={(next) => {
							// Convert center + radius so the new boxes show the equivalent
							// position in the target system, same as RectangleEditor.
							const cur = circle.coordSystem
							onChange({
								coordSystem: next,
								centerX: convertCoord(
									circle.centerX,
									cur,
									next,
									xAxis,
									"x",
									dims
								),
								centerY: convertCoord(
									circle.centerY,
									cur,
									next,
									yAxis,
									"y",
									dims
								),
								radius: convertRadius(
									circle.radius,
									cur,
									next,
									radiusAxisInfo,
									radiusExtentPx,
									radiusUnit
								),
							})
						}}
					/>

					{isPercentSystem(circle.coordSystem) ? (
						<div className="flex flex-col gap-2">
							<NumberInput
								label="Center X"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.centerX) * 100)}
								step={1}
								onChange={(v) => onChange({ centerX: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="Center Y"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.centerY) * 100)}
								step={1}
								onChange={(v) => onChange({ centerY: v / 100 })}
								suffix="%"
							/>
							<NumberInput
								label="Radius"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.radius) * 100)}
								step={1}
								min={0}
								onChange={(v) => onChange({ radius: v / 100 })}
								suffix="%"
							/>
						</div>
					) : circle.coordSystem === "values" ? (
						<div className="flex flex-col gap-2">
							<AxisValueInput
								label={isRadar ? "Center angle" : "Center X"}
								labelClassName={LABEL_COL}
								value={circle.centerX}
								axis={xAxis}
								onChange={(v) => onChange({ centerX: v })}
							/>
							<AxisValueInput
								label={isRadar ? "Center R" : "Center Y"}
								labelClassName={LABEL_COL}
								value={circle.centerY}
								axis={yAxis}
								onChange={(v) => onChange({ centerY: v })}
							/>
							{showRadiusUnit ? (
								// Unit dropdown beside the box — the same pattern as the
								// Caption panel's px / % offset fields.
								<NumberInput
									label={`Radius (${circle.radiusAxis.toUpperCase()})`}
									labelClassName={LABEL_COL}
									value={cleanNumber(
										radiusUnit === "px"
											? toNumber(circle.radius)
											: toNumber(circle.radius) * 100
									)}
									step={1}
									min={0}
									onChange={(v) =>
										onChange({ radius: radiusUnit === "px" ? v : v / 100 })
									}
									suffix={
										<Select
											aria-label="Radius unit"
											value={radiusUnit}
											onChange={(e) =>
												setRadiusUnit(e.target.value as RadiusUnit)
											}
										>
											{RADIUS_UNITS.map(([unit, text]) => (
												<option key={unit} value={unit}>
													{text}
												</option>
											))}
										</Select>
									}
								/>
							) : (
								<NumberInput
									label={isRadar ? "Radius (R)" : `Radius (${circle.radiusAxis.toUpperCase()})`}
									labelClassName={LABEL_COL}
									value={cleanNumber(toNumber(circle.radius))}
									step={1}
									min={0}
									onChange={(v) => onChange({ radius: v })}
								/>
							)}
							{showRadiusUnit && (
								<p className="vc-help">{radiusUnitHelpFor(circle.radiusAxis)}</p>
							)}
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<NumberInput
								label="Center X"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.centerX))}
								step={1}
								onChange={(v) => onChange({ centerX: v })}
								suffix="px"
							/>
							<NumberInput
								label="Center Y"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.centerY))}
								step={1}
								onChange={(v) => onChange({ centerY: v })}
								suffix="px"
							/>
							<NumberInput
								label="Radius"
								labelClassName={LABEL_COL}
								value={cleanNumber(toNumber(circle.radius))}
								step={1}
								min={0}
								onChange={(v) => onChange({ radius: v })}
								suffix="px"
							/>
						</div>
					)}
					{coordHelpFor(circle.coordSystem) && (
						<p className="vc-help">{coordHelpFor(circle.coordSystem)}</p>
					)}

					{/* Radar radius is always measured on the r-axis, so the x/y
					    radius-axis choice is meaningless there — hide it. */}
					{!isRadar && (
						<div className="flex items-center gap-2 text-sm">
							<span className={`shrink-0 ${LABEL_COL}`}>Radius axis</span>
							<Segmented
								ariaLabel="Radius axis"
								value={circle.radiusAxis}
								segments={RADIUS_AXIS_SEGMENTS}
								onChange={(radiusAxis) => onChange({ radiusAxis })}
							/>
						</div>
					)}
				</div>
				<LayerRow
					zOrder={circle.zOrder}
					onChange={(zOrder) => onChange({ zOrder })}
				/>
			</CollapsibleSubsection>

			<FillSection style={circle} defaults={defaults} onChange={onChange} />

			<BorderSection
				style={circle}
				defaults={defaults}
				onChange={onChange}
				ariaContext="circle border"
			/>
		</AnnotationCard>
	)
}
