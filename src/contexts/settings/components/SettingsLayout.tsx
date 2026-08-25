import { useRef, useState } from "react"
import { Link, Outlet } from "@tanstack/react-router"
import { useAtom } from "jotai"
import {
	normalizeSavedTheme,
	SYSTEM_LIGHT_THEME,
	themeOf,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import { editingThemeIdAtom, themesAtom } from "../../chartBuilder/store/atoms"
import { combine as c } from "../../../lib/cls"

import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"

const navLink =
	"flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors"
const navIdle =
	"text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white"
const navActive =
	"bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-300"

const newThemeId = (): string =>
	`th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const ThemesSubNav = () => {
	const [themes, setThemes] = useAtom(themesAtom)
	const [editingThemeId, setEditingThemeId] = useAtom(editingThemeIdAtom)
	const [addOpen, setAddOpen] = useState(false)

	// Prefer the first user-created theme when no explicit selection has
	// been made — system themes are read-only, so landing on one wastes
	// the user's first click. Falls back to a system theme only when
	// nothing else exists.
	const editingTheme: SavedTheme =
		themes.find((t) => t.id === editingThemeId) ??
		themes.find((t) => !t.isSystem) ??
		themes[0] ??
		SYSTEM_LIGHT_THEME

	const cloneTheme = (sourceId: string) => {
		const source = themes.find((t) => t.id === sourceId)
		if (!source) return
		const id = newThemeId()
		const seed = themeOf(source)
		setThemes((prev) => [
			...prev,
			{ id, name: `${source.name} (copy)`, isSystem: false, ...seed },
		])
		setEditingThemeId(id)
		setAddOpen(false)
	}

	const importInputRef = useRef<HTMLInputElement>(null)

	const importThemeFile = async (file: File) => {
		try {
			const text = await file.text()
			const parsed = JSON.parse(text)
			// Tolerate both shapes — the new single-theme export AND the older
			// `{themes: [...]}` multi-theme bundles.
			const candidates: SavedTheme[] = Array.isArray(parsed?.themes)
				? parsed.themes
				: parsed?.theme
					? [parsed.theme]
					: parsed?.id
						? [parsed]
						: []
			if (candidates.length === 0) {
				window.alert("That doesn't look like a theme export file.")
				return
			}
			// `normalizeSavedTheme` backfills fields the export file predates —
			// `themesAtom` readers take entries as-is, so a sparse import must
			// be completed before it lands in the list.
			const reKeyed = candidates.map((t) =>
				normalizeSavedTheme({
					...t,
					id: newThemeId(),
					isSystem: false,
					name: t.name ? `${t.name} (imported)` : "Imported theme",
				})
			)
			setThemes((prev) => [...prev, ...reKeyed])
			// Jump to the first imported theme so the user can see what they got.
			const first = reKeyed[0]
			if (first) setEditingThemeId(first.id)
			setAddOpen(false)
		} catch (error) {
			window.alert(
				`Couldn't import theme: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}

	return (
		<div className="ml-4 flex flex-col gap-0.5 border-l border-stone-200 pl-2 dark:border-stone-700">
			{themes.map((t) => {
				const isActive = t.id === editingTheme.id
				return (
					<button
						key={t.id}
						type="button"
						onClick={() => setEditingThemeId(t.id)}
						className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs ${
							isActive
								? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200"
								: "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
						}`}
					>
						<span className="min-w-0 flex-1 truncate">{t.name}</span>
						{t.isSystem && (
							<span className="text-[10px] text-stone-500 dark:text-stone-400">
								system
							</span>
						)}
					</button>
				)
			})}
			<button
				type="button"
				onClick={() => setAddOpen(true)}
				className="mt-1 rounded border border-dashed border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
			>
				+ Add a new theme
			</button>
			<AddThemeDialog
				open={addOpen}
				themes={themes}
				onCancel={() => setAddOpen(false)}
				onPickBase={cloneTheme}
				onPickImport={() => importInputRef.current?.click()}
			/>
			<input
				ref={importInputRef}
				type="file"
				accept="application/json,.json"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0]
					e.target.value = ""
					if (file) importThemeFile(file)
				}}
			/>
		</div>
	)
}

/** "Add a new theme" picker. The user either bases the new theme on an
 * existing one (system or user-saved) — modifications stay local to the
 * new copy — or imports a previously-exported theme JSON file. We don't
 * offer a "blank theme" option because every field has a meaningful
 * default and an empty template would just be system-light by another
 * name. */
const AddThemeDialog = ({
	open,
	themes,
	onCancel,
	onPickBase,
	onPickImport,
}: {
	open: boolean
	themes: SavedTheme[]
	onCancel: () => void
	onPickBase: (sourceId: string) => void
	onPickImport: () => void
}) => {
	const [selectedId, setSelectedId] = useState<string>("")
	return (
		<Modal open={open} onClose={onCancel} title="Add a new theme">
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium text-stone-800 dark:text-stone-200">
						Base on an existing theme
					</span>
					<select
						value={selectedId}
						onChange={(e) => setSelectedId(e.target.value)}
						className="rounded border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
					>
						<option value="">Pick a theme to copy…</option>
						{themes.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
								{t.isSystem ? " (system)" : ""}
							</option>
						))}
					</select>
					<div className="flex justify-end">
						<Button
							compact
							onClick={() => selectedId && onPickBase(selectedId)}
							disabled={!selectedId}
						>
							Create from copy
						</Button>
					</div>
				</div>
				<hr className="border-stone-200 dark:border-stone-700" />
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium text-stone-800 dark:text-stone-200">
						Import a JSON theme
					</span>
					<p className="text-xs text-stone-500 dark:text-stone-400">
						Loads a previously-exported theme file. The imported theme is added
						as a new entry — your other themes are untouched.
					</p>
					<div className="flex justify-end">
						<Button compact outline onClick={onPickImport}>
							Choose JSON file…
						</Button>
					</div>
				</div>
				<div className="flex justify-end border-t border-stone-200 pt-3 dark:border-stone-700">
					<Button compact outline onClick={onCancel}>
						Cancel
					</Button>
				</div>
			</div>
		</Modal>
	)
}

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
