import { Link, useNavigate, useParams } from "@tanstack/react-router"

import { ThemesPage } from "./ThemesPage"

/** `/settings/themes/$themeId` — the editor for one theme, reached from a
 *  gallery card or a rail entry. Owns the routing around the editor (the
 *  way back to the gallery, and leaving it after a delete) so `ThemesPage`
 *  itself stays router-free and mountable in tests. */
export const ThemeEditorPage = () => {
	const { themeId } = useParams({ from: "/settings/themes/$themeId" })
	const navigate = useNavigate()
	const backToGallery = () => void navigate({ to: "/settings/themes" })
	return (
		<ThemesPage
			themeId={themeId}
			onDeleted={backToGallery}
			onDone={backToGallery}
			backLink={
				<Link
					to="/settings/themes"
					className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
				>
					<span aria-hidden="true">&larr;</span> All themes
				</Link>
			}
		/>
	)
}
