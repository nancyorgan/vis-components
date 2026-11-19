import { labelEntry } from "../../lib/dataLabelsSelection"

import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import {
	SidebarJumpText,
	dataLabelJump,
} from "../../../../components/ui/SidebarJumpLink"
import { ChannelMappingRows } from "./dataLabels/ChannelMappingRows"
import { LabelSelectionSection } from "./dataLabels/LabelSelectionSection"
import { PositionAlignmentSection } from "./dataLabels/PositionAlignmentSection"
import { TextBackgroundPanel } from "./dataLabels/TextBackgroundPanel"
import { TextPropertiesPanel } from "./dataLabels/TextPropertiesPanel"
import { useDataLabelsPanelModel } from "./dataLabels/useDataLabelsPanelModel"

/** Sidebar section that lets the user encode an independent label layer
 * on top of the main visualization. The layer's encodings are stored in
 * `currentDataLabelsEncodingsAtom`; appearance + offsets + scale knobs
 * live in `currentDataLabelsConfigAtom`. */
export const DataLabelsPanel = () => {
	// Everything the sections share — the layer's encodings and config, the
	// chart-mode gates, the composed-label keys (see the hook).
	const m = useDataLabelsPanelModel()
	const {
		merged,
		updateCfg,
		themeDefaults,
		vizBackground,
		fineTuningApplies,
		multiFields,
		labelTitles,
		perVariable,
		styleFields,
		sectionKeys,
		splitToggleFor,
	} = m

	// Text Properties compares against the THEME's data-label defaults — the
	// same baseline the panel's reset links restore. With per-variable
	// blocks (which replace the layer-wide controls) any variable's own
	// entry lights it.
	const textPropertiesChanged = styleFields.length > 0
		? styleFields.some((k) =>
				sectionKeys("text")(k).some(
					(kk) =>
						Object.keys(labelEntry(merged, "fieldFonts", kk) ?? {}).length > 0
				)
			)
		: merged.fontFamily !== themeDefaults.fontFamily ||
			merged.fontWeight !== themeDefaults.fontWeight ||
			(merged.italic ?? false) !== (themeDefaults.italic ?? false) ||
			(merged.underline ?? false) !== (themeDefaults.underline ?? false)
	// Every other background control is gated behind the toggle, so the
	// toggle alone decides the dot (stored-but-hidden values don't count);
	// per-variable blocks light it when any variable's background is on.
	const textBackgroundChanged = perVariable
		? multiFields.some(
				(f) =>
					(merged.fieldBackgrounds?.[f]?.textBackground ??
						merged.textBackground) === true
			)
		: merged.textBackground === true

	return (
		<div className="flex flex-col gap-2">

			{/* Channel mapping rows lead the panel and sit OUTSIDE the purple
			 *  box — choosing what each label encodes (position, value, color,
			 *  size) is the primary action and reads as its own list; the
			 *  selection / overlap / position fine-tuning lives in the purple
			 *  group below. */}
			<ChannelMappingRows m={m} />

			{/* One purple panel wraps the layer-wide fine-tuning so it reads as
			 *  a single group, distinct from the per-channel mappings above. */}
			<div className="vc-option-panel">
			{/* Layer-wide selection: which labels to keep (and, on faceted
			 *  charts / maps, where). Grouped under their own subsection so
			 *  they read as a distinct concern from the per-channel mappings
			 *  above. Overlap avoidance lives with the other placement knobs
			 *  under "Position and alignment". */}
			{/* Selection / overlap / position controls act on the shared label
			 *  layer's positioned labels — inert for the self-drawn treemap
			 *  labels, so they stand down there (as does Text Background,
			 *  which that renderer doesn't draw). Packed circles and the
			 *  sunburst render through the layer, so they keep them. */}
			{fineTuningApplies && (
			<>
			<LabelSelectionSection m={m} />

			<PositionAlignmentSection m={m} />
			</>
			)}

			<CollapsibleSubsection title="Text" changed={textPropertiesChanged}>
				<TextPropertiesPanel
					cfg={merged}
					onChange={updateCfg}
					themeDefaults={themeDefaults}
					multiFields={styleFields}
					titles={labelTitles}
					splitToggle={splitToggleFor("text")}
					keysFor={sectionKeys("text")}
				/>
				{/* Font size is the Size row's (it maps like Color), so Text
				 *  points there rather than repeating the control. */}
				<p className="vc-help">
					Set the font size under{" "}
					<SidebarJumpText target={dataLabelJump("size")}>Size</SidebarJumpText>.
				</p>
			</CollapsibleSubsection>

			{fineTuningApplies && (
			<CollapsibleSubsection title="Box" changed={textBackgroundChanged}>
				<TextBackgroundPanel
					cfg={merged}
					onChange={updateCfg}
					vizBackground={vizBackground}
					multiFields={perVariable ? multiFields : []}
					titles={labelTitles}
				/>
			</CollapsibleSubsection>
			)}
			</div>
		</div>
	)
}
