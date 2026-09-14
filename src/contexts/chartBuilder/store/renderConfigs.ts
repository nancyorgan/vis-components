import { atom } from "jotai"

import type { ChannelConfigs, DataLabelsConfig } from "../lib/channelConfig"
import {
	applyFormatHintsToChannelConfigs,
	applyFormatHintsToDataLabels,
	applyFormatHintsToLegendConfig,
	hintedFormats,
	type HintedFormats,
} from "../lib/formatHintDefaults"
import type { LegendConfig } from "../lib/labelsConfig"

import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentEncodingsAtom,
	currentLegendConfigAtom,
} from "./atoms"
import { currentDatasetViewAtom } from "./useCurrentDatasetView"

/** Default format spec per current-view field whose raw cells were
 * dollar-formatted ("$1,234.56") or percent-formatted ("14%") — tagged by
 * the cell conversions at the view seam. */
export const hintedFormatsAtom = atom(
	(get): HintedFormats => hintedFormats(get(currentDatasetViewAtom)),
)

/** RENDER-side channel configs: the stored configs with the format-hint
 * defaults folded in — an axis mapped to a dollar- or percent-hinted field
 * whose Format is still "Auto" renders as "$1,234.56" / "14%" without any
 * config write.
 *
 * Read these from the chart / legend / solver render path ONLY. The sidebar
 * panels and the persistence layer (save/autosave) must keep reading
 * `currentChannelConfigsAtom` — the stored value stays "", so the Format box
 * still shows Auto, the theme-diff "changed" dot stays honest, and clearing
 * a user spec returns to the hint default rather than baking it in. */
export const renderChannelConfigsAtom = atom(
	(get): ChannelConfigs =>
		applyFormatHintsToChannelConfigs(
			get(currentChannelConfigsAtom),
			get(currentEncodingsAtom),
			get(hintedFormatsAtom),
		),
)

/** RENDER-side legend config — same contract as
 * {@link renderChannelConfigsAtom}, for the quantitative legend channels'
 * break-label formats. */
export const renderLegendConfigAtom = atom(
	(get): LegendConfig =>
		applyFormatHintsToLegendConfig(
			get(currentLegendConfigAtom),
			get(currentEncodingsAtom),
			get(hintedFormatsAtom),
		),
)

/** RENDER-side data-labels config — same contract as
 * {@link renderChannelConfigsAtom}, for per-field label formats. */
export const renderDataLabelsConfigAtom = atom(
	(get): DataLabelsConfig =>
		applyFormatHintsToDataLabels(
			get(currentDataLabelsConfigAtom),
			get(hintedFormatsAtom),
		),
)
