import { Link, Outlet } from "@tanstack/react-router"
import { combine as c } from "../../../lib/cls"

import { ThemesSubNav } from "./ThemesSubNav"

const navLink =
	"flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors"
const navIdle =
	"text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white"
const navActive =
	"bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-300"

export const SettingsLayout = () => {
	return (
		<div className="flex h-[calc(100vh-57px)]">
			{/* Sidebar navigation */}
			<aside className="flex w-52 flex-shrink-0 flex-col border-r border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
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
			 * NumberInput spinner arrows). Without it, those escape this pane's
			 * overflow clipping and position against the document instead, which
			 * inflates the page height — giving a phantom window scrollbar (a
			 * second scrollbar beside this pane's) and a tall blank region below. */}
			<div className="relative flex-1 overflow-y-auto">
				<Outlet />
			</div>
		</div>
	)
}
