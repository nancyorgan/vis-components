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
	if (isNoOpSlot(from, slot)) return null
	const colors = moveToSlot(palette.colors, from, slot)
	if (!palette.patternInks) return { colors }
	// Pad sparse inks to the color count first so the same permutation
	// applies to both arrays.
	const inks = [...palette.patternInks]
	while (inks.length < palette.colors.length) inks.push(null)
	return {
		colors,
		patternInks: moveToSlot(inks.slice(0, palette.colors.length), from, slot),
	}
}

/** Drag-reorder a whole palette within its list (categorical or ordinal):
 *  same insertion-gap contract as `reorderPaletteColors`. Returns null for
 *  a no-op drop. Palette defaults are tracked by id, so moving a card never
 *  changes which palette is the default. */
export const reorderPalettes = <T>(
	palettes: T[],
	from: number,
	slot: number
): T[] | null =>
	isNoOpSlot(from, slot) ? null : moveToSlot(palettes, from, slot)

/** The gaps on either side of the dragged item leave the order unchanged. */
const isNoOpSlot = (from: number, slot: number) =>
	slot === from || slot === from + 1

/** Pull `from` out and re-insert it at insertion gap `slot`, indexed
 *  against the ORIGINAL list (so slot n appends). */
const moveToSlot = <T>(list: T[], from: number, slot: number): T[] => {
	const to = slot > from ? slot - 1 : slot
	const next = [...list]
	const [item] = next.splice(from, 1)
	next.splice(to, 0, item as T)
	return next
}
