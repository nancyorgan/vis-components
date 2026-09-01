import { atom } from "jotai"

import type { ChannelConfigs, DataLabelsConfig } from "../lib/channelConfig"
import {
	applyDollarDefaultsToChannelConfigs,
	applyDollarDefaultsToDataLabels,
	applyDollarDefaultsToLegendConfig,
	dollarFieldSet,
} from "../lib/dollarFormatDefaults"
import type { LegendConfig } from "../lib/labelsConfig"

import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentEncodingsAtom,
	currentLegendConfigAtom,
} from "./atoms"
import { currentDatasetViewAtom } from "./useCurrentDatasetView"

/** Names of the current view's fields whose raw cells were dollar-formatted
 * ("$1,234.56") — tagged by `applyDollarConversionToView` at the view seam. */
export const dollarFieldsAtom = atom(
	(get): ReadonlySet<string> => dollarFieldSet(get(currentDatasetViewAtom)),
)

/** RENDER-side channel configs: the stored configs with the dollar format
 * default folded in — an axis mapped to a dollar-hinted field whose Format
 * is still "Auto" renders as currency ("$1,234.56") without any config
 * write.
 *
 * Read these from the chart / legend / solver render path ONLY. The sidebar
 * panels and the persistence layer (save/autosave) must keep reading
 * `currentChannelConfigsAtom` — the stored value stays "", so the Format box
 * still shows Auto, the theme-diff "changed" dot stays honest, and clearing
 * a user spec returns to the dollar default rather than baking it in. */
export const renderChannelConfigsAtom = atom(
	(get): ChannelConfigs =>
		applyDollarDefaultsToChannelConfigs(
			get(currentChannelConfigsAtom),
			get(currentEncodingsAtom),
			get(dollarFieldsAtom),
		),
)

/** RENDER-side legend config — same contract as
 * {@link renderChannelConfigsAtom}, for the quantitative legend channels'
 * break-label formats. */
export const renderLegendConfigAtom = atom(
	(get): LegendConfig =>
		applyDollarDefaultsToLegendConfig(
			get(currentLegendConfigAtom),
			get(currentEncodingsAtom),
			get(dollarFieldsAtom),
		),
)

/** RENDER-side data-labels config — same contract as
 * {@link renderChannelConfigsAtom}, for per-field label formats. */
export const renderDataLabelsConfigAtom = atom(
	(get): DataLabelsConfig =>
		applyDollarDefaultsToDataLabels(
			get(currentDataLabelsConfigAtom),
			get(dollarFieldsAtom),
		),
)
