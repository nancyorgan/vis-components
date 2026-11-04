import { atom } from "jotai"

import type { ChannelConfigs, DataLabelsConfig } from "../lib/channelConfig"
import {
	applyFormatHintsToChannelConfigs,
	applyFormatHintsToDataLabels,
	applyFormatHintsToLegendConfig,
	hintedFormats,
	type HintedFormats,
} from "../lib/formatHintDefaults"
import { resolveDataLabelPositions } from "../lib/dataLabelsPosition"
import { withColorSlotDefaults } from "../lib/colorSlotDefaults"
import { effectiveType } from "../lib/fieldType"
import { linkColorConfigs } from "../lib/linkedHueColors"
import type { LegendConfig } from "../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	type DataLabelsEncodings,
	type Theme,
} from "../lib/types"
import {
	tooltipFieldFormats,
	type TooltipFormats,
} from "../lib/tooltipFormats"

import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentLegendConfigAtom,
	currentThemeIdAtom,
	themeAtom,
	themesAtom,
} from "./atoms"
import { currentDatasetViewAtom } from "./useCurrentDatasetView"

/** Default format spec per current-view field whose raw cells were
 * dollar-formatted ("$1,234.56") or percent-formatted ("14%") — tagged by
 * the cell conversions at the view seam. */
const hintedFormatsAtom = atom(
	(get): HintedFormats => hintedFormats(get(currentDatasetViewAtom)),
)

/** The theme the current visual is on — the atom form of `useCurrentTheme`
 * (the LIVE `themesAtom` entry, else the legacy snapshot). */
export const currentThemeAtom = atom((get): Theme => {
	const id = get(currentThemeIdAtom)
	return get(themesAtom).find((t) => t.id === id) ?? get(themeAtom)
})

/** RENDER-side channel configs: the stored configs with the format-hint
 * defaults folded in — an axis mapped to a dollar- or percent-hinted field
 * whose Format is still "Auto" renders as "$1,234.56" / "14%" without any
 * config write — and with every secondary color encoding varying by the
 * Color variable seeded from Color's palette positions (`linkColorConfigs`),
 * after the untouched violin / box and density-curve fill slots take their
 * Color-following default (`withColorSlotDefaults`).
 *
 * Read these from the chart / legend / solver render path ONLY. The sidebar
 * panels and the persistence layer (save/autosave) must keep reading
 * `currentChannelConfigsAtom` — the stored value stays "", so the Format box
 * still shows Auto, the theme-diff "changed" dot stays honest, and clearing
 * a user spec returns to the hint default rather than baking it in. */
export const renderChannelConfigsAtom = atom((get): ChannelConfigs => {
	const encodings = get(currentEncodingsAtom)
	const hinted = applyFormatHintsToChannelConfigs(
		get(currentChannelConfigsAtom),
		encodings,
		get(hintedFormatsAtom),
	)
	const hueField = encodings.hue?.field ?? null
	const dataset = get(currentDatasetViewAtom)
	if (!dataset) return hinted
	const theme = get(currentThemeAtom)
	// With no Color variable the fills still default — to the fill-palette
	// color analogous to the marks' single color.
	if (!hueField) return withColorSlotDefaults(hinted, encodings, null, theme)
	const hueType = effectiveType(dataset, hueField, get(currentFieldOverridesAtom))
	return linkColorConfigs(
		withColorSlotDefaults(hinted, encodings, hueType, theme),
		encodings,
		hueType,
	)
})

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

/** RENDER-side data-labels encodings: every channel slot present (visuals
 * saved before a channel existed lack its key), and unset position slots
 * filled from the chart's own X / Y / Angle / R — see
 * `resolveDataLabelPositions`. The Data Labels shelf writes the raw atom. */
export const renderDataLabelsEncodingsAtom = atom(
	(get): DataLabelsEncodings =>
		resolveDataLabelPositions(
			{ ...emptyDataLabelsEncodings(), ...get(currentDataLabelsEncodingsAtom) },
			get(currentEncodingsAtom),
		),
)

/** Field name → the format the TOOLTIP should print that field with,
 * inherited from wherever the user already set one (axis beats legend
 * beats data label — see `lib/tooltipFormats.ts`). Built from the
 * render-side configs, so the dollar / percent hints reach the tooltip on
 * the same terms they reach the axis. */
export const tooltipFieldFormatsAtom = atom(
	(get): TooltipFormats =>
		tooltipFieldFormats({
			encodings: get(currentEncodingsAtom),
			channelConfigs: get(renderChannelConfigsAtom),
			legendConfig: get(renderLegendConfigAtom),
			dataLabels: get(renderDataLabelsConfigAtom),
		}),
)
