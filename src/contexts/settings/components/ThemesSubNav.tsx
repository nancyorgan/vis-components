import { useRef, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import {
	isManagedTheme,
	normalizeSavedTheme,
	SYSTEM_LIGHT_THEME,
	themeOf,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import {
	editingThemeIdAtom,
	themesAtom,
	unlockedThemeIdAtom,
} from "../../chartBuilder/store/atoms"
import { combine as c } from "../../../lib/cls"
import {
	decodeThemeDrag,
	encodeThemeDrag,
	groupThemesByFolder,
	moveNeedsAdminGate,
	moveThemeToFolder,
	THEME_DRAG_TYPE,
	THEME_FOLDER_LABEL,
	type ThemeFolder,
} from "../lib/themeFolders"

import { Button } from "../../../components/ui/Button"
import { SectionChevron } from "../../../components/ui/Chevron"
import { Modal } from "../../../components/ui/Modal"

import { ManagedThemeGate } from "../../chartBuilder/components/ManagedThemeGate"

const newThemeId = (): string =>
	`th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** What the user was trying to do when the administrator gate stopped
 *  them. Kept as data rather than a stashed callback so the dialog's
 *  "Yes, proceed" replays exactly one intent, with no closure captured
 *  from the render that opened it. */
type GatedAction =
	| { kind: "select"; themeId: string }
	| { kind: "toggle-folder" }
	| { kind: "move"; themeId: string; target: ThemeFolder }

const LockIcon = () => (
	<svg
		viewBox="0 0 12 12"
		width={10}
		height={10}
		aria-hidden="true"
		className="flex-shrink-0"
	>
		<path
			d="M3.25 5.25V3.75a2.75 2.75 0 015.5 0v1.5"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			strokeLinecap="round"
		/>
		<rect
			x="2.25"
			y="5.25"
			width="7.5"
			height="5"
			rx="1"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
		/>
	</svg>
)

export const ThemesSubNav = () => {
	const [themes, setThemes] = useAtom(themesAtom)
	const [editingThemeId, setEditingThemeId] = useAtom(editingThemeIdAtom)
	const setUnlockedThemeId = useSetAtom(unlockedThemeIdAtom)
	const [addOpen, setAddOpen] = useState(false)

	// Both folders start open: seeing WHICH themes are managed is not
	// editing them, and hiding the list would only make the two system
	// themes look missing. The gate is on touching them — every time, so
	// one "Yes, proceed" can't quietly disarm the warning for the rest of
	// the session.
	const [expanded, setExpanded] = useState<Record<ThemeFolder, boolean>>({
		managed: true,
		custom: true,
	})
	const [gated, setGated] = useState<GatedAction | null>(null)
	// Same component owns both ends of the drag, so the dragged id can live
	// in state — no dataTransfer mirror needed for the dragover highlight
	// (getData() is spec-blocked while hovering).
	const [draggingId, setDraggingId] = useState<string | null>(null)
	const [dragOver, setDragOver] = useState<ThemeFolder | null>(null)

	// Prefer the first custom theme when no explicit selection has been
	// made — landing on a managed theme would spend the user's first click
	// on the administrator dialog.
	const editingTheme: SavedTheme =
		themes.find((t) => t.id === editingThemeId) ??
		themes.find((t) => !isManagedTheme(t)) ??
		themes[0] ??
		SYSTEM_LIGHT_THEME

	const groups = groupThemesByFolder(themes)

	const perform = (action: GatedAction) => {
		if (action.kind === "select") {
			// Passing the gate grants edit access to THIS theme only — the
			// editor re-locks as soon as a different managed theme is picked.
			setUnlockedThemeId(action.themeId)
			setEditingThemeId(action.themeId)
		} else if (action.kind === "toggle-folder")
			setExpanded((prev) => ({ ...prev, managed: !prev.managed }))
		else
			setThemes((prev) =>
				moveThemeToFolder(prev, action.themeId, action.target)
			)
	}

	/** Park an action behind the administrator dialog. Always — reaching for
	 *  a managed theme is exactly what the warning is for, so it fires on
	 *  every click rather than once per session. */
	const gate = (action: GatedAction) => setGated(action)

	const confirmGate = () => {
		const action = gated
		setGated(null)
		if (action) perform(action)
	}

	// "No, exit" backs all the way out of the managed area rather than
	// leaving the user parked in front of themes they just said they may
	// not touch.
	const cancelGate = () => {
		setGated(null)
		setExpanded((prev) => ({ ...prev, managed: false }))
	}

	const dropOnFolder = (target: ThemeFolder) => (e: React.DragEvent) => {
		e.preventDefault()
		setDragOver(null)
		const raw = e.dataTransfer.getData(THEME_DRAG_TYPE)
		const themeId = decodeThemeDrag(raw)?.themeId ?? draggingId
		setDraggingId(null)
		if (!themeId) return
		const action: GatedAction = { kind: "move", themeId, target }
		if (moveNeedsAdminGate(themes, themeId, target)) gate(action)
		else perform(action)
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
			if (first) setEditingThemeId(first.id)
			setAddOpen(false)
		} catch (error) {
			window.alert(
				`Couldn't import theme: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}

	const renderFolder = (folder: ThemeFolder) => {
		const managed = folder === "managed"
		const open = expanded[folder]
		const entries = groups[folder]
		return (
			<div
				key={folder}
				onDragOver={(e) => {
					if (!draggingId) return
					e.preventDefault()
					e.dataTransfer.dropEffect = "move"
					setDragOver(folder)
				}}
				onDragLeave={() => setDragOver((prev) => (prev === folder ? null : prev))}
				onDrop={dropOnFolder(folder)}
				className={c(
					"rounded",
					dragOver === folder && "bg-blue-50 dark:bg-blue-900/20"
				)}
			>
				<button
					type="button"
					onClick={() =>
						managed
							? gate({ kind: "toggle-folder" })
							: setExpanded((prev) => ({ ...prev, [folder]: !prev[folder] }))
					}
					className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
				>
					<SectionChevron open={open} />
					<span className="min-w-0 flex-1 truncate">
						{THEME_FOLDER_LABEL[folder]}
					</span>
					{managed && <LockIcon />}
				</button>
				{open && (
					<div className="flex flex-col gap-0.5 pl-3">
						{entries.length === 0 && (
							<p className="px-2 py-1 text-[11px] italic text-stone-400 dark:text-stone-500">
								{managed
									? "Drag a theme here to manage it"
									: "No custom themes yet"}
							</p>
						)}
						{entries.map((t) => {
							const isActive = t.id === editingTheme.id
							return (
								<button
									key={t.id}
									type="button"
									draggable={!t.isSystem}
									onDragStart={(e) => {
										e.dataTransfer.setData(
											THEME_DRAG_TYPE,
											encodeThemeDrag(t.id)
										)
										e.dataTransfer.effectAllowed = "move"
										setDraggingId(t.id)
									}}
									onDragEnd={() => {
										setDraggingId(null)
										setDragOver(null)
									}}
									onClick={() =>
										managed
											? gate({ kind: "select", themeId: t.id })
											: setEditingThemeId(t.id)
									}
									className={c(
										"flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs",
										draggingId === t.id && "opacity-50",
										isActive
											? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200"
											: "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
									)}
								>
									<span className="min-w-0 flex-1 truncate">{t.name}</span>
									{managed && (
										<span className="text-stone-400 dark:text-stone-500">
											<LockIcon />
										</span>
									)}
								</button>
							)
						})}
					</div>
				)}
			</div>
		)
	}

	return (
		<div className="ml-4 flex flex-col gap-1 border-l border-stone-200 pl-2 dark:border-stone-700">
			{renderFolder("managed")}
			{renderFolder("custom")}
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
			<ManagedThemeGate
				open={gated !== null}
				onCancel={cancelGate}
				onConfirm={confirmGate}
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
