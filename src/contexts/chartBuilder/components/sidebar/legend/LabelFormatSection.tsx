import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { effectiveType } from "../../../lib/fieldType"
import {
	DEFAULT_LEGEND_CHANNEL_CONFIG,
	LEGEND_FRIENDLY_NAME,
	type LegendChannelConfig,
} from "../../../lib/labelsConfig"
import { QuantLegendChannelControls } from "./LegendBreaksRows"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** "Label format" — number format and breaks for each quantitative legend. */
export const LabelFormatSection = ({ m }: { m: LegendPanelModel }) => {
	const {
		merged,
		update,
		groupChanged,
		overrides,
		dataset,
		quantChannelGroups,
		updateChannelGroup,
		measureFormatGroups,
		measureLabel,
		swatchBreakFields,
	} = m
	if (!dataset) return null
	return (
		<CollapsibleSubsection
				title="Label format"
				changed={groupChanged("formatting")}
			>
			{measureFormatGroups.map(({ channel, values }) => {
				const channelCfg: LegendChannelConfig = {
					...DEFAULT_LEGEND_CHANNEL_CONFIG,
					...(merged.channels?.[channel] ?? {}),
				}
				return (
					<QuantLegendChannelControls
						key={`measure-${channel}`}
						sectionLabel={`${measureLabel} legend formatting`}
						values={values}
						fieldType="quantitative"
						cfg={channelCfg}
						onChange={(next) =>
							update({
								channels: { ...(merged.channels ?? {}), [channel]: next },
							})
						}
					/>
				)
			})}
			{quantChannelGroups.map(({ field, channels }) => {
				const t = effectiveType(dataset, field, overrides) as
					| "quantitative"
					| "temporal"
					| "ordinal"
				const values = dataset.rows.map((r) => r[field])
				const primary = channels[0]
				const channelCfg: LegendChannelConfig = {
					...DEFAULT_LEGEND_CHANNEL_CONFIG,
					...(merged.channels?.[primary] ?? {}),
				}
				const headerName =
					channels.length === 1
						? LEGEND_FRIENDLY_NAME[primary]
						: channels.map((c) => LEGEND_FRIENDLY_NAME[c]).join(" · ")
				return (
					<QuantLegendChannelControls
						key={field}
						sectionLabel={`${headerName} legend formatting`}
						values={values}
						fieldType={t}
						cfg={channelCfg}
						onChange={(next) => updateChannelGroup(channels, next)}
						showBreaks={!swatchBreakFields.has(field)}
					/>
				)
			})}
		</CollapsibleSubsection>
	)
}
