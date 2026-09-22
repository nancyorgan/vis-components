import { useState } from "react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"

import { themeOf } from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import {
	themesAtom,
	unlockedThemeIdAtom,
	userDefaultThemeIdAtom,
} from "../../chartBuilder/store/atoms"
import { combine as c } from "../../../lib/cls"
import {
	folderOfTheme,
	groupThemesByFolder,
	THEME_FOLDER_LABEL,
	THEME_FOLDERS,
	type ThemeFolder,
} from "../lib/themeFolders"

import { ManagedThemeGate } from "../../chartBuilder/components/ManagedThemeGate"

import { AddThemeButton } from "./AddThemeButton"
import { LockIcon } from "./LockIcon"
import { ThemePreview } from "./ThemePreview"

const FOLDER_HELP: Record<ThemeFolder, string> = {
	system:
		"Bundled with the app and read-only. Open one to see its values, or copy it to build your own.",
	managed:
		"Shared with everyone on this server. Editing one goes through the administrator check.",
	custom: "Editable by anyone. Drag one into Managed Themes in the rail to share it.",
}

const FOLDER_EMPTY: Record<ThemeFolder, string> = {
	system: "No system themes.",
	managed:
		"No managed themes. Drag a theme into Managed Themes in the rail to share it.",
	custom: "No custom themes yet. Add one to start from a copy of any theme.",
}

/** Each folder's box. System and Managed get a tinted, bordered panel so
 *  the two locked tiers read as different kinds of thing from the
 *  free-to-edit custom themes: stone for read-only, brand purple for the
 *  gated tier. */
const FOLDER_BOX: Record<ThemeFolder, string | false> = {
	system:
		"rounded-card border border-stone-200 bg-stone-50 p-4 sm:p-5 dark:border-stone-700 dark:bg-stone-900/40",
	managed:
		"rounded-card border border-brand-200 bg-brand-50/60 p-4 sm:p-5 dark:border-brand-800/60 dark:bg-brand-900/15",
	custom: false,
}

/** Fixed-width columns, not stretched: the boxed folders are narrower than
 *  the unboxed one, so a `1fr` grid would size the cards differently per
 *  folder. Every card is the same size everywhere, and leftover row space
 *  stays empty. `min(100%, …)` keeps a phone-width column from overflowing. */
const CARD_GRID =
	"grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),280px))] gap-4"

const cardClass =
	"group/card block w-full overflow-hidden rounded-card border border-stone-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md dark:border-stone-700 dark:bg-stone-800"

const Pill = ({
	children,
	tone,
}: {
	children: React.ReactNode
	tone: "amber" | "brand" | "stone"
}) => (
	<span
		className={c(
			"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
			tone === "amber" &&
				"bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
			tone === "brand" &&
				"bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200",
			tone === "stone" &&
				"bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300"
		)}
	>
		{children}
	</span>
)

/** The card's body: the live preview template above a caption row, shared
 *  by the link (custom themes) and button (managed themes, gated) shells. */
const CardBody = ({
	theme,
	isDefault,
}: {
	theme: SavedTheme
	isDefault: boolean
}) => {
	const folder = folderOfTheme(theme)
	return (
		<>
			<div className="aspect-[4/3] overflow-hidden bg-stone-50 dark:bg-stone-900">
				<ThemePreview
					theme={themeOf(theme)}
					name={theme.name}
					className="block h-full w-full"
				/>
			</div>
			<div className="flex items-start justify-between gap-2 border-t border-stone-200 px-3 py-2 dark:border-stone-700">
				<div className="min-w-0 truncate text-sm font-medium text-stone-900 dark:text-white">
					{theme.name}
				</div>
				<div className="flex flex-shrink-0 flex-wrap justify-end gap-1">
					{isDefault && <Pill tone="brand">Default</Pill>}
					{folder === "system" ? (
						<Pill tone="stone">
							<LockIcon />
							Read-only
						</Pill>
					) : folder === "managed" ? (
						<Pill tone="amber">
							<LockIcon />
							Managed
						</Pill>
					) : null}
				</div>
			</div>
		</>
	)
}

/** Settings → Themes landing page: every theme as a card, the way the
 *  library shows visualizations. Click a card to open that theme in the
 *  editor. Cards are grouped into the same three folders the rail shows:
 *  System (read-only, opens straight into the read-only editor), Managed
 *  (the administrator dialog first, exactly like its rail entry) and
 *  Custom (editable by anyone). */
export const ThemesGalleryPage = () => {
	const themes = useAtomValue(themesAtom)
	const userDefaultId = useAtomValue(userDefaultThemeIdAtom)
	const setUnlockedThemeId = useSetAtom(unlockedThemeIdAtom)
	const navigate = useNavigate()
	const [gatedThemeId, setGatedThemeId] = useState<string | null>(null)
	// The rail's folder headers narrow the page to one folder (URL state,
	// like the library's `?folder=`); "Themes" and the rail's empty space
	// show every folder again.
	const search = useSearch({ strict: false }) as { folder?: ThemeFolder }
	const onlyFolder = search.folder ?? null
	const shownFolders = onlyFolder ? [onlyFolder] : THEME_FOLDERS

	const groups = groupThemesByFolder(themes)

	const confirmGate = () => {
		const themeId = gatedThemeId
		setGatedThemeId(null)
		if (!themeId) return
		// Passing the gate grants edit access to THIS theme only — the
		// editor re-locks as soon as a different managed theme is picked.
		setUnlockedThemeId(themeId)
		void navigate({ to: "/settings/themes/$themeId", params: { themeId } })
	}

	const renderFolder = (folder: ThemeFolder) => {
		const entries = groups[folder]
		const managed = folder === "managed"
		const locked = folder !== "custom"
		return (
			<section
				key={folder}
				aria-labelledby={`theme-folder-${folder}`}
				className={c(FOLDER_BOX[folder])}
			>
				<div className="mb-3">
					{/* Narrowed to one folder, the page heading already names it —
					 *  the section keeps only its help line. */}
					<h2
						id={`theme-folder-${folder}`}
						className={c(
							"flex items-center gap-1.5 text-sm font-semibold text-stone-900 dark:text-white",
							onlyFolder && "sr-only"
						)}
					>
						{THEME_FOLDER_LABEL[folder]}
						{locked && (
							<span className="text-stone-500 dark:text-stone-400">
								<LockIcon size={12} />
							</span>
						)}
					</h2>
					<p className="text-sm text-stone-600 dark:text-stone-400">
						{FOLDER_HELP[folder]}
					</p>
				</div>
				{entries.length === 0 ? (
					<p className="rounded-card border border-dashed border-stone-300 px-4 py-6 text-center text-sm italic text-stone-500 dark:border-stone-700 dark:text-stone-400">
						{FOLDER_EMPTY[folder]}
					</p>
				) : (
					<ul className={CARD_GRID}>
						{entries.map((t) => {
							const isDefault = t.id === userDefaultId
							return (
								<li key={t.id}>
									{managed ? (
										<button
											type="button"
											onClick={() => setGatedThemeId(t.id)}
											className={cardClass}
											aria-label={`Open ${t.name}`}
										>
											<CardBody theme={t} isDefault={isDefault} />
										</button>
									) : (
										<Link
											to="/settings/themes/$themeId"
											params={{ themeId: t.id }}
											className={cardClass}
											aria-label={`Open ${t.name}`}
										>
											<CardBody theme={t} isDefault={isDefault} />
										</Link>
									)}
								</li>
							)
						})}
					</ul>
				)}
			</section>
		)
	}

	return (
		<div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
			<div className="mb-8">
				<div>
					<h1 className="mb-1 text-xl font-semibold text-stone-900 dark:text-white">
						{onlyFolder ? THEME_FOLDER_LABEL[onlyFolder] : "Themes"}
					</h1>
					<p className="text-sm text-stone-600 dark:text-stone-400">
						Each card previews a theme&rsquo;s fonts and default palette.
						Click one to edit it. These values seed every new
						visualization that picks the theme.
						{onlyFolder && (
							<>
								{" "}
								<Link
									to="/settings/themes"
									className="underline hover:text-stone-900 dark:hover:text-white"
								>
									Show all themes
								</Link>
							</>
						)}
					</p>
				</div>
			</div>
			<div className="flex flex-col gap-10">{shownFolders.map(renderFolder)}</div>
			{/* Adding sits after the cards, bottom right, like the editor's
			 *  own footer action — the list is the page's subject. */}
			<div className="mt-8 flex justify-end">
				<AddThemeButton />
			</div>
			<ManagedThemeGate
				open={gatedThemeId !== null}
				onCancel={() => setGatedThemeId(null)}
				onConfirm={confirmGate}
			/>
		</div>
	)
}
