import type { ReactNode } from "react"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import {
	type RectangleTextStyle,
	type TextAnnotation,
	type TextAnnotationBoxStyle,
} from "../../../lib/annotationsConfig"
import type { AxisInfo } from "./axisInfo"
import { AnnotationCard, LayerRow } from "./controls"
import {
	BorderSection,
	FillSection,
	PointPositionSection,
	TextStyleSection,
} from "./sections"

/** Sidebar editor for free-standing text annotations. Same text / fill /
 *  border controls a rectangle has, plus a corner radius — the difference is
 *  position: a text annotation is anchored at ONE point, because its box is
 *  auto-sized to the label rather than dragged out by the user. `textAlign`
 *  picks which edge of that box lands on the anchor (see
 *  `lib/textAnnotationGeometry.ts`). */
export const TextAnnotationEditor = ({
	anno,
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
	anno: TextAnnotation
	/** Theme-seeded style baseline the reset links compare against. */
	defaults: TextAnnotationBoxStyle & RectangleTextStyle
	onChange: (patch: Partial<TextAnnotation>) => void
	onRemove: () => void
	/** Whether the editor body is expanded; the name row always shows. */
	open: boolean
	onToggle: () => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out the "Values (data units)" option — used on polar charts
	 *  (radar / pie) where the anchor has no cartesian axes to map against. */
	disableValues?: boolean
	/** Light suggestion shown when the user hasn't named the annotation. */
	namePlaceholder?: string
	/** Facet-targeting control, rendered at the top when faceted (else null). */
	facetScope?: ReactNode
}) => (
	<AnnotationCard
		kind="text"
		name={anno.name}
		namePlaceholder={namePlaceholder}
		onNameChange={(name) => onChange({ name })}
		onRemove={onRemove}
		open={open}
		onToggle={onToggle}
	>
		{facetScope}

		<PointPositionSection
			coords={anno}
			onChange={onChange}
			xAxis={xAxis}
			yAxis={yAxis}
			disableValues={disableValues}
			help="The label is centered on y. Alignment picks which side of it sits at x."
		/>

		<TextStyleSection
			style={anno}
			defaults={defaults}
			onChange={onChange}
			placeholder="Text drawn on the chart…"
			alignmentHelp="Also sets the anchor: left starts the text at x, center straddles it, right ends there."
		/>

		<FillSection style={anno} defaults={defaults} onChange={onChange} />

		<BorderSection
			style={anno}
			defaults={defaults}
			onChange={onChange}
			ariaContext="text annotation border"
		>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Corner radius"
					labelClassName={LABEL_COL}
					value={anno.cornerRadius}
					min={0}
					step={1}
					onChange={(v) => onChange({ cornerRadius: v })}
					suffix="px"
				/>
				{anno.cornerRadius !== defaults.cornerRadius && (
					<ResetLink
						onClick={() => onChange({ cornerRadius: defaults.cornerRadius })}
					/>
				)}
			</div>
		</BorderSection>

		<LayerRow
			zOrder={anno.zOrder}
			onChange={(zOrder) => onChange({ zOrder })}
		/>
	</AnnotationCard>
)
