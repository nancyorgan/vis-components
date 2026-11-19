import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { LEGEND_FRIENDLY_NAME } from "../../../lib/labelsConfig"
import { SwatchShapePicker } from "../SwatchShapePicker"
import { SwatchBreaksRows } from "./LegendBreaksRows"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** The shared Length / Angle / Size (and Count / Density opacity) swatch
 *  subsection: the color those swatches paint with, plus the Size glyph's
 *  shape and outline. */
export const AuxSwatchSection = ({ m }: { m: LegendPanelModel }) => {
	const {
		merged,
		update,
		groupChanged,
		encodings,
		marksShape,
		auxSwatchDisplayChannels,
		auxBreakFields,
		breaksSet,
		auxSwatchHeader,
		resolvedAuxSwatchColor,
		showAuxSwatchStroke,
		resolvedAuxSwatchStroke,
	} = m
	return (
		<CollapsibleSubsection
				title={`${auxSwatchHeader} swatch`}
				changed={
					groupChanged("auxSwatch") || auxBreakFields.some(breaksSet)
				}
			>
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Swatch color"
					labelClassName={LABEL_COL}
					value={resolvedAuxSwatchColor}
					onChange={(auxLegendSwatchColor) =>
						update({ auxLegendSwatchColor })
					}
					showHexInput
				/>
				{merged.auxLegendSwatchColor !== null &&
					merged.auxLegendSwatchColor !== undefined && (
						<ResetLink onClick={() => update({ auxLegendSwatchColor: null })} />
					)}
			</div>
			{/* Size glyphs: shape (default: the marks' own) — Length /
			 *  Angle swatches are line segments, so only a Size legend
			 *  takes one — plus the outline color + width below. The chips
			 *  start on the label's row and wrap onto the control column
			 *  (MapsSection's no-data pattern row). */}
			{showAuxSwatchStroke && (
				<div className="flex items-start gap-2">
					<span className={`${LABEL_COL} shrink-0 pt-1 text-sm`}>
						Swatch shape
					</span>
					<SwatchShapePicker
						value={merged.auxLegendSwatchShape ?? marksShape}
						defaultShape={marksShape}
						options="glyphs"
						onChange={(shape) =>
							update({
								auxLegendSwatchShape:
									shape === marksShape || typeof shape !== "number"
										? null
										: shape,
							})
						}
					/>
				</div>
			)}
			{showAuxSwatchStroke && (
				<div className="flex flex-wrap items-center gap-2">
					<ColorInput
						label="Outline color"
						labelClassName={LABEL_COL}
						value={resolvedAuxSwatchStroke}
						onChange={(auxLegendSwatchStroke) =>
							update({ auxLegendSwatchStroke })
						}
						showHexInput
					/>
					{merged.auxLegendSwatchStroke !== null &&
						merged.auxLegendSwatchStroke !== undefined && (
							<ResetLink onClick={() => update({ auxLegendSwatchStroke: null })} />
						)}
				</div>
			)}
			{showAuxSwatchStroke && (
				<div className="flex items-center gap-2">
					<NumberInput
						label="Outline thickness"
						labelClassName={LABEL_COL}
						value={merged.auxLegendSwatchStrokeWidth ?? 1}
						min={0}
						max={5}
						step={0.5}
						clamp
						onChange={(w) =>
							update({ auxLegendSwatchStrokeWidth: w === 1 ? null : w })
						}
						inputClassName="w-16"
						suffix="px"
					/>
					{merged.auxLegendSwatchStrokeWidth != null && (
						<ResetLink
							onClick={() => update({ auxLegendSwatchStrokeWidth: null })}
						/>
					)}
				</div>
			)}
			{/* Quantitative Size / Length / Angle legends: how many stops
			 *  and where (one block per field; named when there are
			 *  several). The Size legend draws at least 3. */}
			{auxBreakFields.map((f) => {
				const chans = auxSwatchDisplayChannels.filter(
					(c) => encodings[c as keyof typeof encodings]?.field === f
				)
				const name = chans.map((c) => LEGEND_FRIENDLY_NAME[c]).join(" · ")
				return (
					<SwatchBreaksRows
						key={`breaks-${f}`}
						m={m}
						field={f}
						countLabel={auxBreakFields.length > 1 ? `${name} swatches` : "Swatches"}
						floorCount={chans.length === 1 && chans[0] === "area" ? 3 : 2}
					/>
				)
			})}
		</CollapsibleSubsection>
	)
}
