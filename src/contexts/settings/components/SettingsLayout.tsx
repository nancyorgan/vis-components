import { useState } from "react"
import { Link, Outlet, useNavigate } from "@tanstack/react-router"
import { combine as c } from "../../../lib/cls"
import { useNarrowLayout } from "../../../lib/useMediaQuery"
import { SectionChevron } from "../../../components/ui/Chevron"

import { ThemesSubNav } from "./ThemesSubNav"

const navLink =
	"flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors pointer-coarse:py-2"
const navIdle =
	"text-brand-700 hover:bg-stone-100 hover:text-brand-900 dark:text-brand-300 dark:hover:bg-stone-800 dark:hover:text-brand-200"
const navActive = "vc-nav-active font-medium text-brand-700 dark:text-brand-300"

const NavLink = ({ to, children }: { to: string; children: string }) => (
	<Link
		to={to}
		className={c(navLink, navIdle)}
		activeProps={{ className: c(navLink, navActive) }}
	>
		{children}
	</Link>
)

/** Narrow (phone / tablet-portrait) header: the page links in one row, and
 *  the theme list — which the wide rail shows inline — behind a disclosure
 *  so it doesn't push the editor below the fold on every visit. */
const NarrowSettingsNav = () => {
	const [themesOpen, setThemesOpen] = useState(false)
	return (
		<div className="border-b border-stone-200 bg-white px-2 py-2 dark:border-stone-700 dark:bg-stone-900">
			<nav className="flex flex-wrap items-center gap-1">
				<NavLink to="/settings/themes">Themes</NavLink>
				<NavLink to="/settings/fonts">Fonts</NavLink>
				<NavLink to="/settings/sharing">Sharing</NavLink>
				<button
					type="button"
					onClick={() => setThemesOpen((v) => !v)}
					aria-expanded={themesOpen}
					aria-controls="settings-theme-list"
					className={c(
						navLink,
						"ml-auto text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
					)}
				>
					<SectionChevron open={themesOpen} />
					Theme list
				</button>
			</nav>
			{themesOpen && (
				<div id="settings-theme-list" className="pt-2">
					<ThemesSubNav onThemeOpened={() => setThemesOpen(false)} />
				</div>
			)}
		</div>
	)
}

export const SettingsLayout = () => {
	const narrow = useNarrowLayout()
	const navigate = useNavigate()
	/** Clicking the rail's empty space — below Sharing, not on a link — shows
	 *  every theme, the way the library's tree shows "Not in a folder". Only
	 *  a click that lands on the container itself counts. */
	const showAllThemes = (e: React.MouseEvent) => {
		if (e.target !== e.currentTarget) return
		void navigate({ to: "/settings/themes" })
	}

	if (narrow) {
		return (
			<div className="flex flex-col">
				<NarrowSettingsNav />
				<div className="relative min-w-0">
					<Outlet />
				</div>
			</div>
		)
	}

	return (
		<div className="flex">
			{/* Sidebar navigation — sticky beneath the header while the page
			 *  (content + footer) scrolls as one document. */}
			{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the empty-space click is a convenience; the keyboard path is the "Themes" link */}
			<aside
				className="vc-sticky-rail flex w-52 flex-shrink-0 flex-col border-r border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900"
				onClick={showAllThemes}
			>
				<div className="border-b border-stone-200 px-4 py-3 dark:border-stone-700">
					{/* The rail's heading is the way back to the landing page (the
					 *  theme gallery) from anywhere in Settings, editor included. */}
					<h2 className="text-sm font-semibold text-stone-900 dark:text-white">
						<Link
							to="/settings/themes"
							className="rounded hover:text-brand-700 dark:hover:text-brand-300"
						>
							Settings
						</Link>
					</h2>
				</div>
				{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- see the aside */}
				<nav className="flex flex-col gap-0.5 px-2 py-2" onClick={showAllThemes}>
					<NavLink to="/settings/themes">Themes</NavLink>
					<ThemesSubNav />
					<NavLink to="/settings/fonts">Fonts</NavLink>
					<NavLink to="/settings/sharing">Sharing</NavLink>
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
