import type {
	SavedCategoricalPalette,
	Theme,
} from "../../../chartBuilder/lib/types"

import type { ThemeSetter } from "./types"

/** Patch one categorical palette in place. Shared by the palette editor and
 *  the pattern-ink overrides, which both write into the same theme array. */
export const updateCategoricalPalette = (
	theme: Theme,
	set: ThemeSetter,
	id: string,
	patch: Partial<SavedCategoricalPalette>
) =>
	set(
		"categoricalPalettes",
		theme.categoricalPalettes.map((p) =>
			p.id === id ? { ...p, ...patch } : p
		)
	)
