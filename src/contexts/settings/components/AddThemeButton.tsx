import { useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAtom } from "jotai"

import {
	isManagedTheme,
	normalizeSavedTheme,
	themeOf,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import { themesAtom } from "../../chartBuilder/store/atoms"

import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"

const newThemeId = (): string =>
	`th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** "+ Add a new theme" — the button, its picker dialog and the hidden file
 *  input behind "Import a JSON theme". One component so the theme gallery
 *  and the settings rail offer the identical flow: a copy of an existing
 *  theme (always filed under Custom Themes) or an imported export file,
 *  either of which opens straight into the editor. */
export const AddThemeButton = ({
	onThemeAdded,
	className,
}: {
	/** Fires after the new theme has been opened in the editor. */
	onThemeAdded?: () => void
	className?: string
}) => {
	const [themes, setThemes] = useAtom(themesAtom)
	const [open, setOpen] = useState(false)
	const navigate = useNavigate()
	const importInputRef = useRef<HTMLInputElement>(null)

	const openTheme = (themeId: string) => {
		void navigate({ to: "/settings/themes/$themeId", params: { themeId } })
		setOpen(false)
		onThemeAdded?.()
	}

	const cloneTheme = (sourceId: string) => {
		const source = themes.find((t) => t.id === sourceId)
		if (!source) return
		const id = newThemeId()
		const seed = themeOf(source)
		// A copy is always a CUSTOM theme, even when copied from a managed
		// one — that's the sanctioned way to build on a shared theme without
		// changing it for everyone. Promote it by dragging it back up.
		setThemes((prev) => [
			...prev,
			{
				id,
				name: `${source.name} (copy)`,
				isSystem: false,
				managed: false,
				...seed,
			},
		])
		openTheme(id)
	}

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
			// be completed before it lands in the list. `managed: false` is
			// forced for the same reason `isSystem` is: a file can't promote
			// itself into the shared folder just by carrying the flag.
			const reKeyed = candidates.map((t) =>
				normalizeSavedTheme({
					...t,
					id: newThemeId(),
					isSystem: false,
					managed: false,
					name: t.name ? `${t.name} (imported)` : "Imported theme",
				})
			)
			setThemes((prev) => [...prev, ...reKeyed])
			// Jump to the first imported theme so the user can see what they got.
			const first = reKeyed[0]
			if (first) openTheme(first.id)
			else setOpen(false)
		} catch (error) {
			window.alert(
				`Couldn't import theme: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}

	return (
		<>
			<Button compact onClick={() => setOpen(true)} className={className}>
				+ Add a new theme
			</Button>
			<AddThemeDialog
				open={open}
				themes={themes}
				onCancel={() => setOpen(false)}
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
					if (file) void importThemeFile(file)
				}}
			/>
		</>
	)
}

/** "Add a new theme" picker. The user either bases the new theme on an
 * existing one (managed or custom) — the copy lands in Custom Themes, so
 * modifications stay local to it — or imports a previously-exported theme
 * JSON file. We don't offer a "blank theme" option because every field has
 * a meaningful default and an empty template would just be system-light by
 * another name. */
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
								{isManagedTheme(t) ? " (managed)" : ""}
							</option>
						))}
					</select>
					<p className="text-xs text-stone-500 dark:text-stone-400">
						The copy is added to <strong>Custom Themes</strong> — copying a
						managed theme never changes the original.
					</p>
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
						<Button compact onClick={onPickImport}>
							Choose JSON file…
						</Button>
					</div>
				</div>
				<div className="flex justify-end border-t border-stone-200 pt-3 dark:border-stone-700">
					<Button compact onClick={onCancel}>
						Cancel
					</Button>
				</div>
			</div>
		</Modal>
	)
}
