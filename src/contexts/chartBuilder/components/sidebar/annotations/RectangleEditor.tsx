import type { ReactNode } from "react"
import {
	type BoxAnnotationStyle,
	type RectangleAnnotation,
	type RectangleTextStyle,
} from "../../../lib/annotationsConfig"
import type { AxisInfo } from "./axisInfo"
import { AnnotationCard, LayerRow } from "./controls"
import {
	BorderSection,
	EdgePositionSection,
	FillSection,
	TextStyleSection,
} from "./sections"

/** Sidebar editor for rectangle annotations. The position math is
 *  plot-area-normalized — see `annotationsConfig.ts` for the coordinate
 *  convention. The actual drawing happens in PlotCanvas, which converts
 *  the percent coords to pixel coords against each panel's `inner` rect. */
export const RectangleEditor = ({
	rect,
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
	rect: RectangleAnnotation
	/** Theme-seeded style baseline the reset links compare against. */
	defaults: BoxAnnotationStyle & RectangleTextStyle
	onChange: (patch: Partial<RectangleAnnotation>) => void
	onRemove: () => void
	/** Whether the editor body is expanded; the name row always shows. */
	open: boolean
	onToggle: () => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out the "Values (data units)" option — used on polar charts
	 *  (radar / pie) where a rectangle has no cartesian axes to map against. */
	disableValues?: boolean
	/** Light suggestion shown when the user hasn't named the annotation. */
	namePlaceholder?: string
	/** Facet-targeting control, rendered at the top when faceted (else null). */
	facetScope?: ReactNode
}) => (
	<AnnotationCard
		kind="rectangle"
		name={rect.name}
		namePlaceholder={namePlaceholder}
		onNameChange={(name) => onChange({ name })}
		onRemove={onRemove}
		open={open}
		onToggle={onToggle}
	>
		{facetScope}

		<EdgePositionSection
			coords={rect}
			onChange={onChange}
			xAxis={xAxis}
			yAxis={yAxis}
			disableValues={disableValues}
		/>

		<FillSection style={rect} defaults={defaults} onChange={onChange} />

		<BorderSection
			style={rect}
			defaults={defaults}
			onChange={onChange}
			ariaContext="rectangle border"
		/>

		<TextStyleSection
			style={rect}
			defaults={defaults}
			onChange={onChange}
			placeholder="Label drawn inside the rectangle…"
		/>

		<LayerRow
			zOrder={rect.zOrder}
			onChange={(zOrder) => onChange({ zOrder })}
		/>
	</AnnotationCard>
)
