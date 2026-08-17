import type { Theme } from "../../../chartBuilder/lib/types"

/** The single-key setter every theme section writes through. Owned by
 *  `ThemesPage`, which knows which SavedTheme is being edited and swallows
 *  writes to read-only system themes. */
export type ThemeSetter = <K extends keyof Theme>(
	key: K,
	value: Theme[K]
) => void

/** Props shared by every section of the theme editor. Sections read the
 *  plain `Theme` view (no SavedTheme metadata) and write through `set`;
 *  `isReadOnly` only drives the disabled fieldset around the rows. */
export type ThemeSectionProps = {
	theme: Theme
	set: ThemeSetter
	isReadOnly: boolean
}
