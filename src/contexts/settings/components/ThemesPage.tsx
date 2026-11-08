import { useEffect, useMemo, useRef, useState } from "react"
import { useAtom } from "jotai"
import {
	isManagedTheme,
	normalizeSavedTheme,
	SYSTEM_LIGHT_THEME,
	themeOf,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme, Theme } from "../../chartBuilder/lib/types"
import {
	themesAtom,
	unlockedThemeIdAtom,
	userDefaultThemeIdAtom,
} from "../../chartBuilder/store/atoms"
import { stringifyJsonDangerous } from "../../../lib/json"
import { deepEqual } from "../../../lib/deepEqual"
import {
	pickSaveTarget,
	writeSaveTarget,
} from "../../chartBuilder/lib/saveFile"
import type { SaveFileType } from "../../chartBuilder/lib/saveFile"

import { ConfirmDialog, Modal } from "../../../components/ui/Modal"

import { ManagedThemeGate } from "../../chartBuilder/components/ManagedThemeGate"

import { AestheticRangesSection } from "./themeSections/AestheticRangesSection"
import { ExportingSection } from "./themeSections/ExportingSection"
import { AnnotationsSection } from "./themeSections/AnnotationsSection"
import { AxesSection } from "./themeSections/AxesSection"
import { DistributionRegressionSection } from "./themeSections/DistributionRegressionSection"
import { GlobalAestheticsSection } from "./themeSections/GlobalAestheticsSection"
import { GradientsSection } from "./themeSections/GradientsSection"
import { LegendSection } from "./themeSections/LegendSection"
import { MapsSection } from "./themeSections/MapsSection"
import { MarkSection } from "./themeSections/MarkSection"
import { PalettesSection } from "./themeSections/PalettesSection"
import { PatternsSection } from "./themeSections/PatternsSection"
import { TextSection } from "./themeSections/TextSection"
import { TooltipsSection } from "./themeSections/TooltipsSection"
import { DataTablesSection } from "./themeSections/DataTablesSection"
import { Button } from "../../../components/ui/Button"
import { ThemePreview } from "./ThemePreview"
import { ThemeSamplerPreview } from "./ThemeSamplerPreview"
import { ThemeTooltipTablePreview } from "./ThemeTooltipTablePreview"
import { Input } from "../../../components/ui/Input"

/** What the Save-as dialog offers for a single-theme export. */
const THEME_FILE_TYPE: SaveFileType = {
	description: "Theme (JSON)",
	mimeType: "application/json",
	extensions: [".json"],
}

/** A navigation guard: the route calls it before leaving the page, and
 *  the answer — `true` lets the navigation through, `false` keeps the
 *  page — may arrive later, once the user has answered a dialog. */
export type NavigationGuard = () => boolean | Promise<boolean>

/** What the editor edits: the theme's values plus its name. Identity — the
 *  id, the folder it's filed in, the system flag — stays with the library
 *  entry, so a folder move made from the rail while the editor is open
 *  isn't undone by a later Done. */
type ThemeDraft = Theme & { name: string }
const draftOf = (saved: SavedTheme): ThemeDraft => ({
	name: saved.name,
	...themeOf(saved),
})
/** Stands in while the routed theme doesn't exist (the not-found notice is
 *  what renders then) so the hooks above the early return stay unconditional. */
const MISSING_THEME_DRAFT = draftOf(SYSTEM_LIGHT_THEME)

/** The editor's live previews: the gallery card's bar chart, a sampler of
 *  what it leaves out, and (editor only) the HTML tooltip box and data
 *  table. All draw the DRAFT, so every edit below redraws them at once —
 *  before anything is saved. */
const EditorPreviews = ({ theme, name }: { theme: Theme; name: string }) => (
	<div
		className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
		data-tip="theme-previews"
	>
		<div className="min-w-0 overflow-hidden rounded-card border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
			<ThemePreview theme={theme} name={name} className="block aspect-[4/3] w-full" />
		</div>
		<div className="min-w-0 overflow-hidden rounded-card border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
			<ThemeSamplerPreview
				theme={theme}
				name={name}
				className="block aspect-[4/3] w-full"
			/>
		</div>
		<div className="min-w-0 overflow-hidden rounded-card border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
			<ThemeTooltipTablePreview
				theme={theme}
				name={name}
				className="aspect-[4/3] w-full"
			/>
		</div>
	</div>
)

/** Put up when a navigation would drop unsaved edits. Three ways out, in
 *  the order a reader weighs them: stay, go without the edits, or save and
 *  go. Escape and the backdrop count as staying — the one answer that
 *  loses nothing. */
const UnsavedChangesDialog = ({
	open,
	themeName,
	onKeepEditing,
	onDiscard,
	onSave,
}: {
	open: boolean
	themeName: string
	onKeepEditing: () => void
	onDiscard: () => void
	onSave: () => void
}) => (
	// One step wider than the default so the three answers fit on one row;
	// they still wrap on a phone.
	<Modal
		open={open}
		onClose={onKeepEditing}
		title="You have unsaved changes"
		widthClass="max-w-lg"
	>
		<div className="flex flex-col gap-4">
			<p className="text-sm vc-text">
				Your edits to{" "}
				<span className="font-medium vc-heading">&ldquo;{themeName}&rdquo;</span>{" "}
				haven&rsquo;t been saved. Save them before leaving, or leave and lose
				them?
			</p>
			<div className="flex flex-wrap justify-end gap-2">
				<Button compact onClick={onKeepEditing}>
					Keep editing
				</Button>
				<Button compact danger onClick={onDiscard}>
					Leave without saving
				</Button>
				<Button compact onClick={onSave}>
					Save and leave
				</Button>
			</div>
		</div>
	</Modal>
)

/** The editor for one theme. It edits a DRAFT: the library's copy is left
 *  alone until Done (or the leave dialog's "Save and leave") writes the
 *  draft back, and leaving any other way drops it. Router-free on purpose:
 *  `ThemeEditorPage` reads the `$themeId` route param and passes it in,
 *  along with the way back to the gallery, what to do once this theme is
 *  deleted, and where to register the unsaved-changes guard. */
export const ThemesPage = ({
	themeId,
	onDeleted,
	onDone,
	backLink,
	blockNavigation,
}: {
	themeId: string
	/** Fires after this theme has been deleted — the route leaves the editor. */
	onDeleted?: () => void
	/** The footer's "Done" — saves the draft to the library, then back to
	 *  the gallery. Until it's pressed, nothing the editor shows is saved. */
	onDone?: () => void
	/** The "← All themes" link, rendered above the editor's header. */
	backLink?: React.ReactNode
	/** Registers a guard the route consults before any navigation away, and
	 *  returns the unregister. The editor holds one only while the draft has
	 *  unsaved changes, and answers it from the leave dialog. */
	blockNavigation?: (guard: NavigationGuard) => () => void
}) => {
	const [themes, setThemes] = useAtom(themesAtom)
	const [userDefaultId, setUserDefaultId] = useAtom(
		userDefaultThemeIdAtom
	)
	const [unlockedThemeId, setUnlockedThemeId] = useAtom(unlockedThemeIdAtom)
	// Opened by the "unlock it to edit" link — the sidebar's gate normally
	// fires first, but the editor can be sitting on a managed theme that
	// was never unlocked (the very first render, or after "No, exit").
	const [gateOpen, setGateOpen] = useState(false)

	// The routed theme. A stale id (deleted in another tab, or a link
	// into a library that never had it) renders the not-found notice
	// below; the fallback here only keeps the hooks under it unconditional.
	const found = useMemo(
		() => themes.find((t) => t.id === themeId),
		[themes, themeId]
	)
	const editingTheme: SavedTheme = found ?? SYSTEM_LIGHT_THEME
	// Two separate locks. `isSystem` is absolute — the two bundled themes
	// ship with the app and are never editable, only copied. Every OTHER
	// managed theme is shared rather than read-only: it unlocks for editing
	// once the administrator dialog has been answered FOR THAT THEME. The
	// unlock then sticks for as long as this editor is open: the rail hands
	// the unlock to the NEXT managed theme before it navigates there, and if
	// the leave dialog stops that navigation, the theme still on screen has
	// to stay editable. A fresh editor (a route change remounts it) reads
	// the atom anew.
	const isManaged = isManagedTheme(editingTheme)
	const isSystem = editingTheme.isSystem
	const unlockedNow = unlockedThemeId === editingTheme.id
	const [unlockedHere, setUnlockedHere] = useState(unlockedNow)
	if (unlockedNow && !unlockedHere) setUnlockedHere(true)
	const isReadOnly = isSystem || (isManaged && !(unlockedNow || unlockedHere))

	// The editor works on a DRAFT. `saved` is the library's copy in the
	// editor's shape; `edits` holds the user's version from the first change
	// on, and is null until then. Only Done (or "Save and leave") writes the
	// draft back — leaving any other way drops it. Comparing by value means
	// an edit undone by hand doesn't count as a change.
	const saved = useMemo(() => (found ? draftOf(found) : null), [found])
	const [edits, setEdits] = useState<ThemeDraft | null>(null)
	const draft = edits ?? saved ?? MISSING_THEME_DRAFT
	const dirty = edits !== null && saved !== null && !deepEqual(edits, saved)
	// Plain Theme view (without the name) so the existing section components
	// can stay untouched.
	const { name: draftName, ...theme } = draft

	const set = <K extends keyof Theme>(key: K, value: Theme[K]) => {
		if (isReadOnly) return
		setEdits((prev) => ({ ...(prev ?? draft), [key]: value }))
	}

	const renameTheme = (name: string) => {
		if (isReadOnly) return
		setEdits((prev) => ({ ...(prev ?? draft), name }))
	}

	// Mirrors `dirty` for the navigation guard, which runs outside React's
	// render cycle: a save or a delete clears it by hand, so the navigation
	// each one triggers goes straight through instead of waiting on a
	// re-render the router won't see in time.
	const dirtyRef = useRef(false)
	useEffect(() => {
		dirtyRef.current = dirty
	})

	/** Writes the draft to the library. The entry's identity fields come from
	 *  the stored copy, so a folder move made while the editor was open
	 *  survives the save. */
	const saveDraft = () => {
		if (edits === null) return
		const next = edits
		setThemes((prev) =>
			prev.map((t) => (t.id === editingTheme.id ? { ...t, ...next } : t))
		)
		dirtyRef.current = false
	}
	const done = () => {
		saveDraft()
		onDone?.()
	}

	// --- Leaving with unsaved changes ---
	// While the draft is dirty a guard is registered with the route; the
	// editor page wires it to the router's history, which also puts up the
	// browser's own prompt on a reload or a closed tab. The guard parks the
	// navigation behind the dialog below, and `leaveRequest` is that
	// navigation's pending answer.
	const [leaveRequest, setLeaveRequest] = useState<
		((allow: boolean) => void) | null
	>(null)
	useEffect(() => {
		if (!blockNavigation || !dirty) return
		return blockNavigation(() => {
			if (!dirtyRef.current) return true
			return new Promise<boolean>((resolve) => setLeaveRequest(() => resolve))
		})
	}, [blockNavigation, dirty])
	const answerLeave = (allow: boolean) => {
		leaveRequest?.(allow)
		setLeaveRequest(null)
	}
	const keepEditing = () => answerLeave(false)
	const leaveWithoutSaving = () => {
		dirtyRef.current = false
		answerLeave(true)
	}
	const saveAndLeave = () => {
		saveDraft()
		answerLeave(true)
	}

	// Modal state for the styled confirm dialogs (delete + replace-default).
	// Pending file for import override is staged so we can preview the name in
	// the confirm dialog before committing.
	const [deleteOpen, setDeleteOpen] = useState(false)
	const [pendingDefault, setPendingDefault] = useState(false)
	const [pendingImport, setPendingImport] = useState<File | null>(null)

	// The two bundled themes are exempt: `withSystemThemes` re-adds them on
	// the next load, so "delete" would read as a bug rather than an action.
	const canDelete = !isReadOnly && !isSystem
	const requestDelete = () => {
		if (!canDelete) return
		const remaining = themes.filter((t) => t.id !== editingTheme.id)
		if (remaining.length === 0) return
		setDeleteOpen(true)
	}
	const confirmDelete = () => {
		setDeleteOpen(false)
		const remaining = themes.filter((t) => t.id !== editingTheme.id)
		if (remaining.length === 0) return
		setThemes(remaining)
		if (userDefaultId === editingTheme.id) {
			setUserDefaultId(SYSTEM_LIGHT_THEME.id)
		}
		// The draft dies with the theme: the route's exit mustn't ask about it.
		dirtyRef.current = false
		onDeleted?.()
	}

	// --- "Make this the default theme" toggle ---
	// The default theme is a SHARED setting — it seeds every new
	// visualization anyone makes on this server — so only a managed theme
	// can hold the slot, and claiming it goes through the same
	// administrator gate as any other edit to a managed theme.
	const isDefault = editingTheme.id === userDefaultId
	const requestSetDefault = (next: boolean) => {
		// System themes are the exception to `isReadOnly` here: which theme
		// new visualizations start from isn't an edit TO the theme, and
		// system-light is the app's own fallback default.
		if (!isManaged || (isReadOnly && !isSystem)) return
		if (!next) {
			// Toggling OFF means "no longer be the default" — fall back to
			// system-light, the safe pre-customization baseline.
			if (isDefault) setUserDefaultId(SYSTEM_LIGHT_THEME.id)
			return
		}
		// Toggling ON: if a different theme already holds the default slot,
		// confirm with the user before stealing it. The very first time
		// (default = system-light from a fresh install) we silently promote.
		if (userDefaultId && userDefaultId !== editingTheme.id) {
			setPendingDefault(true)
			return
		}
		setUserDefaultId(editingTheme.id)
	}
	const previousDefaultName = (() => {
		const t = themes.find((x) => x.id === userDefaultId)
		return t?.name ?? "the previous default"
	})()
	const confirmSetDefault = () => {
		setPendingDefault(false)
		setUserDefaultId(editingTheme.id)
	}

	// --- Single-theme JSON export / import ---
	// Single-theme exports keep the round-trip simple: one file = one theme.
	// The Add-theme dialog (in `SettingsLayout.tsx`) accepts both single-theme
	// shape and the older `{themes: [...]}` bundle for back-compat.
	const fileInputRef = useRef<HTMLInputElement>(null)

	const exportTheme = async () => {
		const safeName = (draftName || "theme")
			.toLowerCase()
			.replaceAll(/[^a-z0-9]+/g, "-")
			.replaceAll(/(^-|-$)/g, "")
		const filename = `vis-components-theme-${safeName || "export"}-${new Date().toISOString().slice(0, 10)}.json`
		// Save-as dialog where the browser has one (same flow as image and
		// bundle export); a cancelled dialog saves nothing.
		const target = await pickSaveTarget({
			suggestedName: filename,
			type: THEME_FILE_TYPE,
			rememberAs: "vis-export-theme",
		})
		if (target === null) return
		// What's on screen, unsaved edits included — the file matches the
		// previews the user is looking at.
		const payload = {
			version: 1,
			exportedAt: new Date().toISOString(),
			theme: { ...editingTheme, ...draft },
		}
		const blob = new Blob([stringifyJsonDangerous(payload as never)], {
			type: THEME_FILE_TYPE.mimeType,
		})
		await writeSaveTarget(target, blob, filename)
	}

	const performImportOverride = async (file: File) => {
		try {
			const text = await file.text()
			const parsed = JSON.parse(text)
			// Accept both the new single-theme shape and the older bundle for
			// import-into-current. We take only the FIRST theme because the
			// current-theme slot can only hold one.
			const candidate: SavedTheme | undefined = ((): SavedTheme | undefined => {
				if (parsed?.theme) return parsed.theme
				if (Array.isArray(parsed?.themes)) return parsed.themes[0]
				if (parsed?.id) return parsed
				return undefined
			})()
			if (!candidate) {
				window.alert("That doesn't look like a theme export file.")
				return
			}
			// Override the current theme's content but keep its identity —
			// id, name, and which folder it sits in. An import must not be
			// able to promote or demote a theme, or to strip `isSystem` off
			// one of the bundled two. It lands in the draft like any other
			// edit: Done is still what saves it.
			// `normalizeSavedTheme` backfills fields the export file predates —
			// `themesAtom` readers take entries as-is, so a sparse import must
			// be completed before it can be saved into the list.
			setEdits(
				draftOf(
					normalizeSavedTheme({
						...candidate,
						id: editingTheme.id,
						name: draftName,
						isSystem: editingTheme.isSystem,
						managed: isManaged,
					})
				)
			)
		} catch (error) {
			window.alert(
				`Couldn't import theme: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}
	const confirmImport = async () => {
		const file = pendingImport
		setPendingImport(null)
		if (file) await performImportOverride(file)
	}

	// Every editor group takes the same three props: the plain theme view, the
	// single-key setter, and the read-only flag that disables its fieldset.
	const sectionProps = { theme, set, isReadOnly }

	if (!found) {
		return (
			<div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
				{backLink && <div className="mb-4">{backLink}</div>}
				<h1 className="mb-1 text-xl vc-heading">
					Theme not found
				</h1>
				<p className="text-sm vc-muted">
					There is no theme with this id in your library. It may have been
					deleted.
				</p>
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
			{backLink && <div className="mb-4">{backLink}</div>}
			{/* Theme editor */}
			<div className="min-w-0">
				{/* Stacked on phones: the name gets the full width and the two
				 *  buttons sit in a row beneath it. */}
				<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
					<div className="min-w-0 flex-1">
						{isSystem ? (
							<span className="mb-1 inline-block rounded bg-stone-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-stone-600 dark:bg-stone-700 dark:text-stone-300">
								System
							</span>
						) : isManaged ? (
							<span className="mb-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
								Managed
							</span>
						) : null}
						<Input
							type="text"
							value={draftName}
							onChange={(e) => renameTheme(e.target.value)}
							disabled={isReadOnly}
							aria-label="Theme name"
							className="w-full text-xl font-semibold disabled:opacity-70"
						/>
						<p className="mt-1 text-sm vc-muted">
							{isSystem ? (
								"System themes are read-only. Copy this one from + Add a new theme to customize it."
							) : isReadOnly ? (
								<>
									This theme is managed by the administrator and shared with
									everyone. Copy it from <strong>+ Add a new theme</strong> to
									customize it, or{" "}
									<button
										type="button"
										onClick={() => setGateOpen(true)}
										className="underline hover:text-stone-900 dark:hover:text-white"
									>
										unlock it to edit
									</button>
									.
								</>
							) : isManaged ? (
								"Managed theme — these edits change the shared theme for everyone using this server."
							) : (
								"These values seed every new visualization that picks this theme."
							)}
						</p>
					</div>
					<div className="flex flex-wrap gap-1.5 sm:flex-col">
						<Button compact
							onClick={() => {
								void exportTheme()
							}}
							title={`Download "${draftName}" as a JSON file`}
						>
							Export theme
						</Button>
						<Button
							compact
							onClick={() => fileInputRef.current?.click()}
							disabled={isReadOnly}
							title="Replace this theme's settings with a JSON file"
						>
							Import theme…
						</Button>
						<input
							ref={fileInputRef}
							type="file"
							accept="application/json,.json"
							aria-label="Import theme file"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0]
								e.target.value = ""
								if (file) setPendingImport(file)
							}}
						/>
					</div>
				</div>
				{/* Default-theme toggle. Wraps the requestSetDefault flow so a user
				 *  flipping it ON when ANOTHER theme already holds the default slot
				 *  sees the styled confirm dialog. Managed themes only — the
				 *  default is what every new visualization on this server starts
				 *  from, so it isn't one person's custom theme to assign. */}
				{isManaged && (
					<label className="mb-6 flex items-center gap-2 rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900/50">
						<input
							type="checkbox"
							checked={isDefault}
							disabled={isReadOnly && !isSystem}
							onChange={(e) => requestSetDefault(e.target.checked)}
						/>
						<span className="vc-text">
							Make this the default theme for all new visualizations?
						</span>
					</label>
				)}
				{/* A custom theme can't claim the slot, but it can still HOLD one
				 *  it was given before that rule existed. Say so rather than
				 *  going silent — otherwise the theme everyone's charts start
				 *  from has no indication anywhere that it's the default. */}
				{!isManaged && isDefault && (
					<p className="mb-6 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
						This is currently the default theme for new visualizations. Only
						managed themes can be set as the default — move this into{" "}
						<strong>Managed Themes</strong> to keep it, or pick a managed
						theme and make that the default instead.
					</p>
				)}

				<EditorPreviews theme={theme} name={draftName} />

				<div className="flex flex-col gap-4">
					<GlobalAestheticsSection {...sectionProps} />
					<MarkSection {...sectionProps} />
					<AxesSection {...sectionProps} />
					<LegendSection {...sectionProps} />
					<TooltipsSection {...sectionProps} />
					<DataTablesSection {...sectionProps} />
					<TextSection {...sectionProps} />
					<PalettesSection {...sectionProps} />
					<GradientsSection {...sectionProps} />
					<PatternsSection {...sectionProps} />
					<DistributionRegressionSection {...sectionProps} />
					<AnnotationsSection {...sectionProps} />
					<MapsSection {...sectionProps} />
					<AestheticRangesSection {...sectionProps} />
					<ExportingSection {...sectionProps} />
				</div>

				{/* Footer: Delete on the left, Done on the right. Done is the one
				 *  way to save: it writes the draft back, and the hint beside it
				 *  says while there's something to write. Delete sits at
				 *  the bottom — destructive actions live below the thing they
				 *  destroy, not in the header where they're easy to hit by
				 *  accident — and is kept apart from Done so a reach for the
				 *  way out never lands on it. Suppressed for a locked managed
				 *  theme, and for the two bundled themes, which the bootstrap
				 *  re-adds. */}
				<div className="mt-10 flex items-center justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-700">
					<div>
						{canDelete && (
							<Button compact danger onClick={requestDelete}>
								Delete this theme
							</Button>
						)}
					</div>
					<div className="flex items-center gap-3">
						{dirty && (
							<span className="text-sm vc-muted">Unsaved changes</span>
						)}
						{onDone && (
							<Button compact onClick={done} data-tip="theme-done">
								Done
							</Button>
						)}
					</div>
				</div>
			</div>
			<ManagedThemeGate
				open={gateOpen}
				onCancel={() => setGateOpen(false)}
				onConfirm={() => {
					setGateOpen(false)
					setUnlockedThemeId(editingTheme.id)
				}}
			/>
			<ConfirmDialog
				open={deleteOpen}
				title="Delete this theme?"
				message={
					<>
						Delete the theme{" "}
						<span className="font-medium vc-heading">
							&ldquo;{draftName}&rdquo;
						</span>
						? This cannot be undone.
					</>
				}
				confirmLabel="Delete theme"
				destructive
				onCancel={() => setDeleteOpen(false)}
				onConfirm={confirmDelete}
			/>
			<ConfirmDialog
				open={pendingDefault}
				title="Replace the default theme?"
				message={
					<>
						This theme will replace{" "}
						<span className="font-medium vc-heading">
							&ldquo;{previousDefaultName}&rdquo;
						</span>{" "}
						as the default for all new visualizations. Continue?
					</>
				}
				confirmLabel="Make default"
				onCancel={() => setPendingDefault(false)}
				onConfirm={confirmSetDefault}
			/>
			<ConfirmDialog
				open={pendingImport !== null}
				title="Replace this theme?"
				message={
					<>
						Importing will overwrite the contents of{" "}
						<span className="font-medium vc-heading">
							&ldquo;{draftName}&rdquo;
						</span>
						. The theme&rsquo;s name stays the same. To import as a new theme
						instead, cancel and use <strong>+ Add a new theme</strong>.
					</>
				}
				confirmLabel="Replace theme"
				destructive
				onCancel={() => setPendingImport(null)}
				onConfirm={() => void confirmImport()}
			/>
			<UnsavedChangesDialog
				open={leaveRequest !== null}
				themeName={draftName}
				onKeepEditing={keepEditing}
				onDiscard={leaveWithoutSaving}
				onSave={saveAndLeave}
			/>
		</div>
	)
}
