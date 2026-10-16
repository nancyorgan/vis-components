/** The doc comment and declared type of every setting, by path, read from
 *  the config types at build time (tooling/setting-catalog.js). */

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
	docs: Record<string, string>
	types: Record<string, SettingType>
}

export const SETTING_CATALOG: SettingCatalog = CATALOG
