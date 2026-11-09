/** What the Annotations panel's "+ Add" does, shared with the settings
 * path: a new entry of a kind gets the theme's style, the next free name
 * and a fresh id. */

import {
	newCircle,
	newImageAnnotation,
	newLineSegment,
	newRectangle,
	newTextAnnotation,
	type AnnotationsConfig,
} from "./annotationsConfig"
import {
	boxAnnotationStyleFromTheme,
	lineAnnotationStyleFromTheme,
	rectangleStyleFromTheme,
	textAnnotationStyleFromTheme,
} from "./themeConfig"
import type { Theme } from "./types"

export type AnnotationList = keyof AnnotationsConfig
export type AnnotationEntry<L extends AnnotationList> = AnnotationsConfig[L][number]

export const ANNOTATION_LISTS: readonly AnnotationList[] = [
	"rectangles",
	"circles",
	"lineSegments",
	"texts",
	"images",
]

const BASE_NAME: Record<AnnotationList, string> = {
	rectangles: "Rectangle",
	circles: "Circle",
	lineSegments: "Line",
	texts: "Text",
	images: "Image",
}

const ID_PREFIX: Record<AnnotationList, string> = {
	rectangles: "rect",
	circles: "circle",
	lineSegments: "line",
	texts: "text",
	images: "image",
}

export const nameSuggestion = (base: string, index: number): string => `${base} ${index + 1}`

/** The next "Base N" not already used by an entry (case-insensitive). */
export const nextAnnotationName = (
	base: string,
	existing: ReadonlyArray<{ name: string }>
): string => {
	const taken = new Set(existing.map((a) => a.name.trim().toLowerCase()))
	let n = existing.length + 1
	while (taken.has(`${base} ${n}`.toLowerCase())) n += 1
	return `${base} ${n}`
}

export const newAnnotationId = (list: AnnotationList): string =>
	`${ID_PREFIX[list]}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** A new entry for `list` as the panel adds one: theme style (built-in
 * defaults without a theme), the next free name, percent coordinates. */
export const newAnnotation = <L extends AnnotationList>(
	list: L,
	existing: ReadonlyArray<{ name: string }>,
	theme: Theme | null,
	id: string = newAnnotationId(list)
): AnnotationEntry<L> => {
	const name = nextAnnotationName(BASE_NAME[list], existing)
	switch (list) {
		case "rectangles":
			return { ...newRectangle(id, theme ? rectangleStyleFromTheme(theme) : undefined), name } as AnnotationEntry<L>
		case "circles":
			return { ...newCircle(id, theme ? boxAnnotationStyleFromTheme(theme) : undefined), name } as AnnotationEntry<L>
		case "lineSegments":
			return { ...newLineSegment(id, theme ? lineAnnotationStyleFromTheme(theme) : undefined), name } as AnnotationEntry<L>
		case "images":
			// Not theme-seeded: a picture brings its own ink.
			return { ...newImageAnnotation(id), name } as AnnotationEntry<L>
		default:
			return { ...newTextAnnotation(id, theme ? textAnnotationStyleFromTheme(theme) : undefined), name } as AnnotationEntry<L>
	}
}

/** `cfg` with a new entry appended to `list`, and the entry's id. */
export const addAnnotation = <L extends AnnotationList>(
	cfg: AnnotationsConfig,
	list: L,
	theme: Theme | null
): { cfg: AnnotationsConfig; id: string } => {
	const existing = (cfg[list] ?? []) as ReadonlyArray<AnnotationEntry<L>>
	const entry = newAnnotation(list, existing, theme)
	return { cfg: { ...cfg, [list]: [...existing, entry] }, id: entry.id }
}
