import { Link, Outlet } from "@tanstack/react-router"
import { combine as c } from "../../../lib/cls"

import { ThemesSubNav } from "./ThemesSubNav"

const navLink =
	"flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors"
const navIdle =
	"text-brand-700 hover:bg-stone-100 hover:text-brand-900 dark:text-brand-300 dark:hover:bg-stone-800 dark:hover:text-brand-200"
const navActive = "vc-nav-active font-medium text-brand-700 dark:text-brand-300"

export const SettingsLayout = () => {
	return (
		<div className="flex">
			{/* Sidebar navigation — sticky beneath the header while the page
			 *  (content + footer) scrolls as one document. */}
			<aside className="vc-sticky-rail flex w-52 flex-shrink-0 flex-col border-r border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
				<div className="border-b border-stone-200 px-4 py-3 dark:border-stone-700">
					<h2 className="text-sm font-semibold text-stone-900 dark:text-white">
						Settings
					</h2>
				</div>
				<nav className="flex flex-col gap-0.5 px-2 py-2">
					<Link
						to="/settings/themes"
						className={c(navLink, navIdle)}
						activeProps={{ className: c(navLink, navActive) }}
					>
						Themes
					</Link>
					<ThemesSubNav />
					<Link
						to="/settings/fonts"
						className={c(navLink, navIdle)}
						activeProps={{ className: c(navLink, navActive) }}
					>
						Fonts
					</Link>
					<Link
						to="/settings/sharing"
						className={c(navLink, navIdle)}
						activeProps={{ className: c(navLink, navActive) }}
					>
						Sharing
					</Link>
					{/* Future settings pages go here */}
				</nav>
			</aside>
			{/* Content area. `relative` makes this the containing block for the
			 * absolutely-positioned bits inside the form controls (sr-only labels,
			 * NumberInput spinner arrows) so they position against this pane
			 * rather than the document and can't inflate the page height. The
			 * pane itself doesn't scroll: the window does, footer included. */}
			<div className="relative min-w-0 flex-1">
				<Outlet />
			</div>
		</div>
	)
}
