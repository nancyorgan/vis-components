import type { ReactNode } from "react"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import {
	type LineAnnotationStyle,
	type LineSegmentAnnotation,
} from "../../../lib/annotationsConfig"
import { DashStylePicker } from "../channelOptions/dashControls"
import type { AxisInfo } from "./axisInfo"
import { AnnotationCard, LayerRow } from "./controls"
import { EdgePositionSection } from "./sections"

/** Sidebar editor for line-segment annotations. Endpoint A = (xMin, yMin),
 *  endpoint B = (xMax, yMax) — labeled "start"/"end" in the UI. Mirrors
 *  RectangleEditor's coordinate handling (shared percent↔values conversion)
 *  but styles a stroke instead of a fill + border. */
export const LineSegmentEditor = ({
	line,
	defaults,
	onChange,
	onRemove,
	open,
	onToggle,
	xAxis,
	yAxis,
	disableValues,
	namePlaceholder,
	facetScope,
}: {
	line: LineSegmentAnnotation
	/** Theme-seeded style baseline the reset links compare against. */
	defaults: LineAnnotationStyle
	onChange: (patch: Partial<LineSegmentAnnotation>) => void
	onRemove: () => void
	/** Whether the editor body is expanded; the name row always shows. */
	open: boolean
	onToggle: () => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out "Values (data units)" on polar charts (radar / pie), which
	 *  have no cartesian axes for a straight segment to map against. */
	disableValues?: boolean
	/** Light suggestion shown when the user hasn't named the annotation. */
	namePlaceholder?: string
	/** Facet-targeting control, rendered at the top when faceted (else null). */
	facetScope?: ReactNode
}) => {
	return (
		<AnnotationCard
			kind="line"
			name={line.name}
			namePlaceholder={namePlaceholder}
			onNameChange={(name) => onChange({ name })}
			onRemove={onRemove}
			open={open}
			onToggle={onToggle}
		>
			{facetScope}

			<EdgePositionSection
				coords={line}
				onChange={onChange}
				xAxis={xAxis}
				yAxis={yAxis}
				disableValues={disableValues}
			/>

			<CollapsibleSubsection title="Line">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<ColorInput
							label="Line"
							labelClassName={LABEL_COL}
							value={line.lineColor}
							onChange={(c) => onChange({ lineColor: c })}
						/>
						{line.lineColor !== defaults.lineColor && (
							<ResetLink
								onClick={() => onChange({ lineColor: defaults.lineColor })}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Thickness"
							labelClassName={LABEL_COL}
							value={line.lineThickness}
							step={0.5}
							min={0}
							onChange={(v) => onChange({ lineThickness: v })}
							suffix="px"
						/>
						{line.lineThickness !== defaults.lineThickness && (
							<ResetLink
								onClick={() =>
									onChange({ lineThickness: defaults.lineThickness })
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Opacity"
							labelClassName={LABEL_COL}
							value={line.lineOpacity}
							step={0.05}
							min={0}
							max={1}
							onChange={(v) => onChange({ lineOpacity: v })}
						/>
						{line.lineOpacity !== defaults.lineOpacity && (
							<ResetLink
								onClick={() => onChange({ lineOpacity: defaults.lineOpacity })}
							/>
						)}
					</div>
					<div className="flex items-start gap-2 text-sm">
						<span className={`${LABEL_COL} shrink-0 pt-1.5`}>Dash</span>
						<DashStylePicker
							pattern={line.lineDash}
							customDasharray={line.lineDasharray ?? null}
							onChange={({ pattern, customDasharray }) =>
								onChange({ lineDash: pattern, lineDasharray: customDasharray })
							}
							ariaContext="line annotation"
						/>
					</div>
				</div>
			</CollapsibleSubsection>

			<LayerRow
				zOrder={line.zOrder}
				onChange={(zOrder) => onChange({ zOrder })}
			/>
		</AnnotationCard>
	)
}
