/** The doc comment and declared type of every setting, by path, read from
 *  the `Visual` type at build time (tooling/setting-catalog.js). */

import CATALOG from "virtual:setting-catalog"

export type SettingKind = "string" | "number" | "boolean" | "null" | "list" | "object"

export type SettingType = {
	kinds: SettingKind[]
	/** The allowed strings, when the type is a union of string literals. */
	values?: string[]
	/** A list's element type. */
	items?: SettingType
}

export type SettingCatalog = {
	/** The keys of `Visual` a settings patch may write. */
	slices: string[]
	/** Path to doc comment. Paths are dot form: `*` stands for any key of
	 *  a map keyed by data, `[]` for a list's elements. */
	docs: Record<string, string>
	types: Record<string, SettingType>
	/** A list setting's path to the fields each of its elements must have. */
	required: Record<string, string[]>
	/** An object setting's path to the shapes it may take: the members it
	 *  must have, and the members fixed to one string that tell a union's
	 *  shapes apart (`{kind: "categorical"}`). */
	shapes: Record<string, SettingShape[]>
}

export type SettingShape = { must: string[]; tags: Record<string, string> }

export const SETTING_CATALOG: SettingCatalog = CATALOG
