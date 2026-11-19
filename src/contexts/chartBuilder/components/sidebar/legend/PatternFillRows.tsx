import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { DEFAULT_FILL } from "../../../lib/channelConfig"
import { DEFAULT_PATTERN_INK } from "../../../lib/patterns"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** No-hue pattern tiles (a section with Pattern but no Color — pattern-,
 *  saturation-, brightness-, opacity-, outline- or shape-led): the tiles
 *  ARE the fill, defaulting to the Pattern menu's Background (else gray)
 *  under a near-black ink — offer both as legend-side overrides.
 *  Per-category ink overrides from the Pattern menu still win in the
 *  renderer. Shared by every swatch subsection whose fill control is
 *  "pattern" (legendSwatchControls). */
export const PatternFillRows = ({ m }: { m: LegendPanelModel }) => {
	const {
		merged,
		update,
		renderConfigs,
	} = m
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Background"
					labelClassName={LABEL_COL}
					value={
						merged.patternLegendBgColor ??
						// As drawn: an area body on Auto takes the theme's fill color.
						renderConfigs.defaultFill ??
						DEFAULT_FILL
					}
					onChange={(patternLegendBgColor) =>
						update({ patternLegendBgColor })
					}
					showHexInput
				/>
				{merged.patternLegendBgColor != null && (
					<ResetLink
						onClick={() =>
							update({ patternLegendBgColor: null })
						}
					/>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Pattern color"
					labelClassName={LABEL_COL}
					value={
						merged.patternLegendInkColor ??
						DEFAULT_PATTERN_INK
					}
					onChange={(patternLegendInkColor) =>
						update({ patternLegendInkColor })
					}
					showHexInput
				/>
				{merged.patternLegendInkColor != null && (
					<ResetLink
						onClick={() =>
							update({ patternLegendInkColor: null })
						}
					/>
				)}
			</div>
		</>
	)
}
