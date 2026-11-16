import { useMemo } from "react"
import { useAtomValue } from "jotai"
import { effectiveType } from "../lib/fieldType"
import {
	facetSharesColorField,
	facetTitleLinkedColors,
} from "../lib/linkedHueColors"
import { resolveTextPickerPalette } from "../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
} from "./atoms"
import { useCurrentDatasetView } from "./useCurrentDatasetView"
import { useCurrentTheme } from "./useCurrentTheme"

const NONE: Record<string, string> = {}

/** Default "Color by facet" title colors (see `facetTitleLinkedColors`):
 *  the marks' colors per facet value when a facet slot varies by the Color
 *  variable, otherwise empty. Shared by the chart's facet titles and the
 *  Labels panel swatches so both show the same default. Reads the FULL
 *  dataset rows, like `useAestheticScales`, so the value → color pairing
 *  matches the marks. */
export const useFacetTitleLinkedColors = (): Record<string, string> => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const theme = useCurrentTheme()
	return useMemo(() => {
		const field = encodings.hue?.field ?? null
		// Gate before touching the rows: most charts don't facet by Color.
		if (!dataset || !field || !facetSharesColorField(encodings)) return NONE
		return facetTitleLinkedColors(
			encodings,
			configs,
			effectiveType(dataset, field, overrides),
			dataset.rows.map((r) => r[field]),
			resolveTextPickerPalette(theme)
		)
	}, [encodings, configs, overrides, dataset, theme])
}
