import { isTemplate } from "../../chartBuilder/lib/visualTrash"
import type { Visual } from "../../chartBuilder/lib/types"

/** The library's Visuals | Templates | Data toggle, as carried in the
 *  `?kind=` search param. Absent (`undefined`) = ordinary visuals only, so
 *  the clean URL keeps showing what the library always showed. "data" is
 *  the data sets themselves — a different page body (`DataLibrary`), not a
 *  filter over visuals. */
export type LibraryKind = "templates" | "data"

/** `?kind=all` (the old third option, visuals and templates together) is
 *  gone; a bookmark carrying it lands on Visuals. */
export const parseLibraryKind = (raw: unknown): LibraryKind | undefined =>
	raw === "templates" || raw === "data" ? raw : undefined

/** Row predicate for the two kinds that list visuals: absent → not a
 *  template; "templates" → templates only. Shared by the grid, the table
 *  and the folder tree so the three listings always agree. */
export const kindPredicate = (
	kind: LibraryKind | undefined
): ((v: Pick<Visual, "template">) => boolean) =>
	kind === "templates" ? (v) => isTemplate(v) : (v) => !isTemplate(v)
