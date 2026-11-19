import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { DEFAULT_FILL } from "../../../lib/channelConfig"
import { resolveLegendSwatchSize } from "../../../lib/labelsConfig"
import { type SwatchMember } from "../../../lib/legendSwatchControls"
import { DEFAULT_SWATCH_STROKE } from "./legendSwatchPlan"
import { PatternFillRows } from "./PatternFillRows"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** The Shape legend's swatch subsection ("Shape swatch", or "Size · Shape
 *  swatch" when a same-field channel folded in). */
export const ShapeSwatchSection = ({ m }: { m: LegendPanelModel }) => {
	const {
		merged,
		update,
		theme,
		groupChanged,
		configs,
		renderConfigs,
		setSwatchSize,
		shapeMembers,
		shapeControls,
		shapeSectionCombined,
		resolvedAuxSwatchColor,
		shapeSwatchHeader,
	} = m
	return (
		<CollapsibleSubsection
				title={`${shapeSwatchHeader} swatch`}
				changed={
					groupChanged("shapeSwatch") || groupChanged("swatch:shape")
				}
			>
			<div className="flex flex-col gap-2">
			{/* Fill per legendSwatchControls: Color owns it; a Pattern
			 *  member tiles it (Background + Pattern color); else the
			 *  shape swatch color. Defaults shown are what the renderer
			 *  draws: the standalone Shape legend's neutral gray, or the
			 *  combined legend's aux / theme swatch color. */}
			{shapeControls.fill === "pattern" && <PatternFillRows m={m} />}
			{shapeControls.fill === "color" && (
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Swatch color"
					labelClassName={LABEL_COL}
					value={
						merged.shapeLegendFillColor ??
						(!shapeSectionCombined
							? "#9ca3af"
							: shapeMembers.some((c) =>
										(
											[
												"opacity",
												"saturation",
												"brightness",
												"area",
												"length",
												"angle",
											] as SwatchMember[]
										).includes(c)
								  )
								? resolvedAuxSwatchColor
								: (theme.legendSwatchColor ??
									renderConfigs.defaultFill ??
									DEFAULT_FILL))
					}
					onChange={(shapeLegendFillColor) =>
						update({ shapeLegendFillColor })
					}
					showHexInput={false}
				/>
				{merged.shapeLegendFillColor !== null &&
					merged.shapeLegendFillColor !== undefined && (
						<ResetLink onClick={() => update({ shapeLegendFillColor: null })} />
					)}
			</div>
			)}
			{/* Outline color: hidden when an Outline color channel
			 *  shares the field (it strokes each glyph). Default shown is
			 *  what the renderer draws: the combined legend follows the
			 *  marks' outline (Shape menu), the standalone one a dark
			 *  contrast stroke. */}
			{shapeControls.outlineColor && (
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Outline color"
					labelClassName={LABEL_COL}
					value={
						merged.shapeLegendStrokeColor ??
						(shapeSectionCombined
							? (configs.shape?.outlineColor ?? DEFAULT_SWATCH_STROKE)
							: "#1f2937")
					}
					onChange={(shapeLegendStrokeColor) =>
						update({ shapeLegendStrokeColor })
					}
					showHexInput={false}
				/>
				{merged.shapeLegendStrokeColor !== null &&
					merged.shapeLegendStrokeColor !== undefined && (
						<ResetLink onClick={() => update({ shapeLegendStrokeColor: null })} />
					)}
			</div>
			)}
			<div className="flex items-center gap-2">
				<NumberInput
					label="Outline thickness"
					labelClassName={LABEL_COL}
					value={merged.shapeLegendStrokeWidth ?? 1}
					min={0}
					max={5}
					step={0.5}
					clamp
					onChange={(shapeLegendStrokeWidth) =>
						update({ shapeLegendStrokeWidth })
					}
					inputClassName="w-16"
					suffix="px"
				/>
				{merged.shapeLegendStrokeWidth != null && (
					<ResetLink onClick={() => update({ shapeLegendStrokeWidth: null })} />
				)}
			</div>
			{/* Glyph radius for shape swatches. Hidden when the Size (area)
			 *  channel merged into this section — the size scale then owns
			 *  each swatch's radius and this input would be inert. */}
			{shapeControls.size && (
				<div className="flex items-center gap-2">
					<NumberInput
						label="Swatch size"
						labelClassName={LABEL_COL}
						value={resolveLegendSwatchSize(merged, theme, "shape")}
						min={3}
						max={20}
						step={1}
						clamp
						onChange={(size) => setSwatchSize("shape", size)}
						suffix="px"
					/>
					{resolveLegendSwatchSize(merged, theme, "shape") !==
						theme.legendSwatchSize && (
						<ResetLink
							onClick={() => setSwatchSize("shape", theme.legendSwatchSize)}
						/>
					)}
				</div>
			)}
			</div>
		</CollapsibleSubsection>
	)
}
