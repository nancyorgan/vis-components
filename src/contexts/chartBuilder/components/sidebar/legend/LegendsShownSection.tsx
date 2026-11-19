import { Checkbox } from "../../../../../components/ui/Checkbox"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { PLAIN_ROWS } from "../../../../../components/ui/rowGroup"
import { LEGEND_FRIENDLY_NAME } from "../../../lib/labelsConfig"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** "Legends shown" — which legend channels draw at all, and whether
 *  same-variable legends combine. Every other subsection is downstream. */
export const LegendsShownSection = ({ m }: { m: LegendPanelModel }) => {
	const {
		update,
		groupChanged,
		effHidden,
		setHidden,
		mappedLegendChannels,
		rugLegendMapped,
		densityCurveLegendMapped,
		combineLegendSections,
		sharedVariableExists,
	} = m
	return (
		<CollapsibleSubsection
				title="Legends shown"
				changed={groupChanged("shown")}
			>
			{mappedLegendChannels.map((ch) => (
				<Checkbox
					key={ch}
					label={LEGEND_FRIENDLY_NAME[ch]}
					checked={!effHidden[ch]}
					onChange={(show) => setHidden(ch, !show)}
				/>
			))}
			{rugLegendMapped && (
				<Checkbox
					key="rug"
					label={LEGEND_FRIENDLY_NAME.rug}
					checked={!effHidden.rug}
					onChange={(show) => setHidden("rug", !show)}
				/>
			)}
			{densityCurveLegendMapped && (
				<Checkbox
					key="densityCurve"
					label={LEGEND_FRIENDLY_NAME.densityCurve}
					checked={!effHidden.densityCurve}
					onChange={(show) => setHidden("densityCurve", !show)}
				/>
			)}
			{/* Merge legends for encodings that share a field into one
			 *  section + one title, instead of a legend per channel. Only
			 *  offered when there's actually a shared field to combine. */}
			{sharedVariableExists && (
				<div className={PLAIN_ROWS}>
					<Checkbox
						label="Combine legends with same variables"
						checked={combineLegendSections}
						onChange={(combineSameVariable) =>
							update({ combineSameVariable })
						}
					/>
					<p className="vc-help">
						When more than one encoding maps to the same field, show one
						combined legend.
					</p>
				</div>
			)}
		</CollapsibleSubsection>
	)
}
