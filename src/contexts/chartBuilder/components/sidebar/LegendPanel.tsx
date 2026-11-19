import { AuxSwatchSection } from "./legend/AuxSwatchSection"
import { GradientStyleSection } from "./legend/GradientStyleSection"
import { LabelFormatSection } from "./legend/LabelFormatSection"
import { LegendBoxSection } from "./legend/LegendBoxSection"
import { LegendPropertiesSection } from "./legend/LegendPropertiesSection"
import { LegendsShownSection } from "./legend/LegendsShownSection"
import { LegendTextSection } from "./legend/LegendTextSection"
import { ShapeSwatchSection } from "./legend/ShapeSwatchSection"
import { SwatchSection } from "./legend/SwatchSection"
import { useLegendPanelModel } from "./legend/useLegendPanelModel"

/** The Legend sidebar panel. Each subsection lives in `./legend/`; this file
 *  decides which ones the current chart gets, in order. The shared model
 *  (`useLegendPanelModel`) is computed once here and handed to each. */
export const LegendPanel = () => {
	const m = useLegendPanelModel()

	return (
		<div className="vc-option-panel">
			{/* "Legends shown" comes first — every other control on the
			 *  panel is downstream of which channels are visible. Hiding all
			 *  channels here is also how the user disables the legend now
			 *  that the "Show legend" master toggle has been retired. */}
			{(m.mappedLegendChannels.length > 0 ||
				m.rugLegendMapped ||
				m.densityCurveLegendMapped) && <LegendsShownSection m={m} />}

			{m.anyLegendVisible && <LegendPropertiesSection m={m} />}

			{/* Box — the legend box's fill and border. Corner radius rounds the
			 *  border, so it (and the border color) only shows while Border is
			 *  on. */}
			{m.anyLegendVisible && <LegendBoxSection m={m} />}

			{/* Legend text — the labels beside each swatch. Separate from
			 *  "Legend titles" in the Labels panel (those style the section
			 *  headings) and from the theme's Legend text defaults, which this
			 *  overrides per visual. */}
			{m.anyLegendVisible && <LegendTextSection m={m} />}

			{(m.quantChannelGroups.length > 0 || m.measureFormatGroups.length > 0) &&
				m.dataset && <LabelFormatSection m={m} />}

			{(m.showGradientLegendStyle || m.rampChannels.length > 0) && (
				<GradientStyleSection m={m} />
			)}

			{m.showAuxSwatchColor && <AuxSwatchSection m={m} />}

			{m.swatchShapeSections.map((ch) => (
				<SwatchSection key={ch} m={m} ch={ch} />
			))}

			{m.showShapeSwatch && <ShapeSwatchSection m={m} />}
		</div>
	)
}
