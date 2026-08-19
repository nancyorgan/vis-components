/** Hooks that make the font pickers dynamic: the built-in
 * FONT_FAMILY_OPTIONS / FAMILY_WEIGHTS tables in labelsConfig stay static,
 * and these append the user font library (Settings → Fonts) on top. Every
 * Family picker and Weight picker reads through here so a newly added
 * Google Font appears everywhere at once. */

import { useMemo } from "react"
import { useAtomValue } from "jotai"

import {
	FONT_FAMILY_OPTIONS,
	fontWeightOptionsFor,
	type FontWeightOption,
} from "../lib/labelsConfig"
import {
	userFontFamilyOptions,
	userFontWeightsByStack,
} from "../lib/fontLibrary"
import { userFontsAtom } from "./atoms"

export type FontFamilyOption = { label: string; value: string }

/** Built-in family presets + the user's added Google Fonts. */
export const useFontFamilyOptions = (): FontFamilyOption[] => {
	const fonts = useAtomValue(userFontsAtom)
	return useMemo(
		() => [...FONT_FAMILY_OPTIONS, ...userFontFamilyOptions(fonts)],
		[fonts]
	)
}

/** Per-stack weight lists for the user's added fonts — pass as the third
 * argument to `fontWeightOptionsFor` so Weight pickers only offer weights
 * a library font actually ships. */
export const useUserFontWeights = (): Record<string, number[]> => {
	const fonts = useAtomValue(userFontsAtom)
	return useMemo(() => userFontWeightsByStack(fonts), [fonts])
}

/** Convenience wrapper for call sites that don't need the raw table. */
export const useFontWeightOptions = (
	family?: string | null,
	current?: number | null
): FontWeightOption[] => {
	const extra = useUserFontWeights()
	return fontWeightOptionsFor(family, current, extra)
}

/** Display name for a family stack — the picker label when the stack is a
 * known option (built-in or library), else the stack's first family. */
export const useFamilyDisplayName = (): ((family: string) => string) => {
	const options = useFontFamilyOptions()
	return useMemo(
		() => (family: string) =>
			options.find((o) => o.value === family)?.label ??
			family.split(",")[0].replaceAll(/["']/g, "").trim(),
		[options]
	)
}
