import type { ReactNode } from "react"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import {
	LABEL_COL,
} from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { Segmented } from "../../../../../components/ui/Segmented"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import {
	ARROWHEAD_STYLES,
	DEFAULT_LINE_END_STYLE,
	type ArrowheadStyle,
	type LineAnnotationStyle,
	type LineSegmentAnnotation,
} from "../../../lib/annotationsConfig"
import { computeArrowhead, resolveLineEnds } from "../../../lib/arrowheadGeometry"
import { CHIP_INK, CHIP_INK_SELECTED } from "../../../lib/previewInk"
import { DashStylePicker } from "../channelOptions/dashControls"
import { PREVIEW_SIZE, swatchChipClass } from "../channelOptions/glyphShared"
import type { AxisInfo } from "./axisInfo"
import { AnnotationCard } from "./controls"
import { EdgePositionSection } from "./sections"

const ARROWHEAD_LABEL: Record<ArrowheadStyle, string> = {
	triangle: "Triangle",
	stealth: "Stealth",
	open: "Open",
	diamond: "Diamond",
	circle: "Circle",
}

/** Stroke width of the miniature line in the arrowhead chips. 2px makes the
 *  default-scale head 8px — it fills the chip without touching the edges. */
const GLYPH_THICKNESS = 2

/** A short line ending in the given head, drawn by the same geometry the
 *  chart uses, so the chip previews exactly the shape the pick produces. */
const ArrowheadGlyph = ({
	style,
	selected,
}: {
	style: ArrowheadStyle
	selected: boolean
}) => {
	const y = PREVIEW_SIZE / 2
	const head = computeArrowhead({
		x1: 2,
		y1: y,
		x2: PREVIEW_SIZE - 2,
		y2: y,
		thickness: GLYPH_THICKNESS,
		style,
		scale: 1,
		lineCap: "square",
	})
	const ink = selected ? CHIP_INK_SELECTED : CHIP_INK
	return (
		<svg
			width={PREVIEW_SIZE}
			height={PREVIEW_SIZE}
			viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
			aria-hidden="true"
		>
			<line
				x1={2}
				y1={y}
				x2={head?.lineEnd.x ?? PREVIEW_SIZE - 2}
				y2={y}
				stroke={ink}
				strokeWidth={GLYPH_THICKNESS}
			/>
			{head &&
				(head.filled ? (
					<path d={head.d} fill={ink} />
				) : (
					<path
						d={head.d}
						fill="none"
						stroke={ink}
						strokeWidth={GLYPH_THICKNESS}
						strokeLinejoin="miter"
					/>
				))}
		</svg>
	)
}

/** The arrowhead style chips — one gray glyph chip per style, in the same
 *  row style as the dash picker above it. */
export const ArrowheadStylePicker = ({
	value,
	onChange,
}: {
	value: ArrowheadStyle
	onChange: (next: ArrowheadStyle) => void
}) => (
	<div className="flex flex-wrap gap-1">
		{ARROWHEAD_STYLES.map((style) => {
			const selected = style === value
			return (
				<button
					key={style}
					type="button"
					onClick={() => onChange(style)}
					aria-pressed={selected}
					aria-label={`${ARROWHEAD_LABEL[style]} arrowhead`}
					className={swatchChipClass(selected, "w-7")}
				>
					<ArrowheadGlyph style={style} selected={selected} />
				</button>
			)
		})}
	</div>
)

/** Sidebar editor for line-segment annotations. Endpoint A = (xMin, yMin),
 *  endpoint B = (xMax, yMax) — the Position inputs call them left / bottom
 *  and right / top. Mirrors RectangleEditor's coordinate handling (shared
 *  percent↔values conversion) but styles a stroke instead of a fill +
 *  border, and adds the line's end treatment: the cap, and an optional
 *  arrowhead at B (see `lib/arrowheadGeometry.ts`). */
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
	fallbackName,
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
	/** Name shown when the stored one is blank (pre-default-name saves). */
	fallbackName: string
	/** Facet-targeting control, rendered at the top when faceted (else null). */
	facetScope?: ReactNode
}) => {
	// Cap + arrowhead with the built-in seed behind absent fields (lines
	// saved before the options existed). Not theme-driven, so these reset
	// against the constant rather than `defaults`.
	const ends = resolveLineEnds(line)
	return (
		<AnnotationCard
			kind="line"
			name={line.name}
			fallbackName={fallbackName}
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
				zOrder={line.zOrder}
				onZOrderChange={(zOrder) => onChange({ zOrder })}
			/>

			<CollapsibleSubsection title="Line properties">
				<div className="flex flex-col gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<ColorInput
							label="Color"
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

					{/* The line's ends: its cap, and the optional arrowhead at the
					 *  right / top endpoint. */}
					<div className="vc-divider-group">
						<div className="flex items-center gap-2 text-sm">
							<span className={`${LABEL_COL} shrink-0`}>Line cap</span>
							<Segmented
								ariaLabel="Line cap"
								value={ends.lineCap}
								segments={[
									{ key: "round", label: "Round" },
									{ key: "square", label: "Square" },
								]}
								onChange={(lineCap) => onChange({ lineCap })}
							/>
							{ends.lineCap !== DEFAULT_LINE_END_STYLE.lineCap && (
								<ResetLink
									onClick={() =>
										onChange({ lineCap: DEFAULT_LINE_END_STYLE.lineCap })
									}
								/>
							)}
						</div>
						<Checkbox
							label="Add arrowhead"
							checked={ends.arrowhead}
							onChange={(arrowhead) => onChange({ arrowhead })}
						/>
						{ends.arrowhead && (
							<div className="flex flex-col gap-2">
								<div className="flex items-start gap-2 text-sm">
									<span className={`${LABEL_COL} shrink-0 pt-1.5`}>
										Style
									</span>
									<ArrowheadStylePicker
										value={ends.arrowheadStyle}
										onChange={(arrowheadStyle) =>
											onChange({ arrowheadStyle })
										}
									/>
								</div>
								<div className="flex items-center gap-2">
									<NumberInput
										label="Scale"
										labelClassName={LABEL_COL}
										value={ends.arrowheadScale}
										step={0.25}
										min={0.1}
										onChange={(arrowheadScale) =>
											onChange({ arrowheadScale })
										}
										suffix="×"
									/>
									{ends.arrowheadScale !==
										DEFAULT_LINE_END_STYLE.arrowheadScale && (
										<ResetLink
											onClick={() =>
												onChange({
													arrowheadScale:
														DEFAULT_LINE_END_STYLE.arrowheadScale,
												})
											}
										/>
									)}
								</div>
								<p className="text-xs vc-muted">
									Points at the right / top endpoint. Sized from the line
									thickness; the scale multiplies that.
								</p>
							</div>
						)}
					</div>
				</div>
			</CollapsibleSubsection>
		</AnnotationCard>
	)
}
