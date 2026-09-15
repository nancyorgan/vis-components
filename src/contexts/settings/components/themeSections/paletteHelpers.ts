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

/** Drag-reorder one swatch: pull `from` out and re-insert it at `slot`, an
 *  insertion gap indexed against the ORIGINAL list (so slot n appends).
 *  The per-hue pattern inks ride along so an ink override keeps pointing
 *  at the color it was set for. Returns null for a no-op drop (onto its
 *  own position). */
export const reorderPaletteColors = (
	palette: SavedCategoricalPalette,
	from: number,
	slot: number
): Pick<SavedCategoricalPalette, "colors" | "patternInks"> | null => {
	if (slot === from || slot === from + 1) return null
	const to = slot > from ? slot - 1 : slot
	const move = <T>(list: T[]): T[] => {
		const next = [...list]
		const [item] = next.splice(from, 1)
		next.splice(to, 0, item as T)
		return next
	}
	const colors = move(palette.colors)
	if (!palette.patternInks) return { colors }
	// Pad sparse inks to the color count first so the same permutation
	// applies to both arrays.
	const inks = [...palette.patternInks]
	while (inks.length < palette.colors.length) inks.push(null)
	return { colors, patternInks: move(inks.slice(0, palette.colors.length)) }
}
