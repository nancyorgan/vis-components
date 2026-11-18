import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { downloadVisualsBundle } from "../lib/downloadVisuals"
import { nameCollides } from "../lib/nameUniqueness"
import { getStorageAdapter } from "../lib/storage/registry"
import {
	currentVisualIdAtom,
	currentVisualNameAtom,
	currentVisualPublishedAtom,
	liveVisualsAtom,
	templatePendingAtom,
} from "../store/atoms"
import {
	canRedoAtom,
	canUndoAtom,
	useRedo,
	useUndo,
} from "../store/editorHistory"
import { republishStateAtom, useRepublishVisual } from "../store/republishVisual"
import { useSaveVisual } from "../store/saveVisual"
import { useEffectiveGeographyLevel } from "../store/useEffectiveGeographyLevel"

import { Button } from "../../../components/ui/Button"
import { DisclosureChevron } from "../../../components/ui/Chevron"
import {
	MENU_HINT,
	MENU_ITEM,
	MENU_ITEM_DIVIDED,
	MENU_PANEL,
	MENU_TITLE,
} from "../../../components/ui/menuStyles"
import { ExportModal, type ExportTab } from "./ExportModal"
import { SaveTemplateButton } from "./SaveTemplateButton"

/** "⌘" on Apple platforms, "Ctrl" elsewhere — for the shortcut hints. */
const modKey = (): string => {
	if (typeof window === "undefined") return "Ctrl"
	const platform = window.navigator.platform || window.navigator.userAgent || ""
	return /Mac|iPhone|iPad|iPod/.test(platform) ? "⌘" : "Ctrl"
}

const iconProps = {
	viewBox: "0 0 16 16",
	width: 14,
	height: 14,
	"aria-hidden": true,
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.7,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const

const UndoIcon = () => (
	<svg {...iconProps}>
		<path d="M3.5 6.5h6a3.25 3.25 0 010 6.5H8" />
		<path d="M6 3.5l-3 3 3 3" />
	</svg>
)

const RedoIcon = () => (
	<svg {...iconProps}>
		<path d="M12.5 6.5h-6a3.25 3.25 0 000 6.5H8" />
		<path d="M10 3.5l3 3-3 3" />
	</svg>
)

/** Arrow out of a tray: the compact stand-in for the "Publish" label. */
const PublishIcon = () => (
	<svg {...iconProps}>
		<path d="M8 10V2.5" />
		<path d="M5 5.5l3-3 3 3" />
		<path d="M3 9.5v3a1 1 0 001 1h8a1 1 0 001-1v-3" />
	</svg>
)

/** A split button's dropdown: open state, the wrapper ref a pointer-down
 *  outside of closes it, and the wrapper's Escape handler, which closes it
 *  and hands focus back to the arrow segment. */
const useSplitMenu = () => {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const onPointerDown = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener("pointerdown", onPointerDown)
		return () => document.removeEventListener("pointerdown", onPointerDown)
	}, [open])
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== "Escape" || !open) return
		e.stopPropagation()
		setOpen(false)
		ref.current?.querySelector<HTMLElement>("[aria-haspopup=menu]")?.focus()
	}
	return { open, setOpen, ref, onKeyDown }
}

/** The editor's action group — undo / redo, Publish, Save — plus the ⌘S
 *  shortcut and the export modal. Rendered in exactly ONE place at a time:
 *  the SaveBar on wide layouts, the data tray's bottom strip on narrow ones
 *  (thumb reach, and the save bar shrinks to the name). `compact` swaps the
 *  Publish label for an icon so the strip fits a 360px phone.
 *
 *  The export modal has two ways in, named by what the user wants: the
 *  Save menu's "Save image…" opens it on Save image, the Publish button on
 *  Publish. */
export const EditorActions = ({ compact = false }: { compact?: boolean }) => {
	const name = useAtomValue(currentVisualNameAtom)
	const visualId = useAtomValue(currentVisualIdAtom)
	// Live visuals only: a name sitting in the Trash is free to reuse (a
	// restore renames the trashed one if it still collides).
	const visuals = useAtomValue(liveVisualsAtom)
	const saveVisual = useSaveVisual()
	// A template draft with no data set yet: nothing to save until one binds
	// (autosave waits for a data set too), so a data-less visual is never
	// written.
	const templatePending = useAtomValue(templatePendingAtom)
	const navigate = useNavigate()
	const [saving, setSaving] = useState(false)
	// The export modal, and the tab its next open lands on.
	const [exportOpen, setExportOpen] = useState(false)
	const [exportTab, setExportTab] = useState<ExportTab>("publish")
	const openExport = (tab: ExportTab) => {
		setExportTab(tab)
		setExportOpen(true)
	}
	// The Save button's arrow segment opens a menu of other ways to save:
	// as a template (the dialog is SaveTemplateButton's), as a Zafiro file,
	// as an image.
	const {
		open: saveMenuOpen,
		setOpen: setSaveMenuOpen,
		ref: saveMenuRef,
		onKeyDown: onSaveMenuKeyDown,
	} = useSplitMenu()
	// The Publish button grows an arrow once the visual is published, in
	// server mode only (`remoteLoad` is true exactly when the boot probe
	// found the self-host server; a browser-local session has nowhere public
	// to publish to). Its menu holds the one-click Republish: every published
	// pin of the open visual, same urls, fresh snapshot (see
	// `store/republishVisual.ts`). The result shows in the SaveBar.
	const {
		open: publishMenuOpen,
		setOpen: setPublishMenuOpen,
		ref: publishMenuRef,
		onKeyDown: onPublishMenuKeyDown,
	} = useSplitMenu()
	const published = useAtomValue(currentVisualPublishedAtom)
	const canRepublish = published && getStorageAdapter().capabilities.remoteLoad
	const republishBusy = useAtomValue(republishStateAtom).busy
	const republish = useRepublishVisual()
	// ZIP-level maps inline their boundary topology into the payload — the
	// same flag the export modal's Publish tab passes.
	const geographyLevel = useEffectiveGeographyLevel()
	// "Download as Zafiro file": this visualization as a library bundle
	// (JSON) — the same file Settings → Sharing writes and imports, so the
	// recipient gets the chart, its data set, its folder, and its custom
	// theme in one file. Named after the SAVED visual.
	const [bundleBusy, setBundleBusy] = useState(false)
	const [bundleError, setBundleError] = useState<string | null>(null)
	const onDownloadBundle = async () => {
		if (!visualId || bundleBusy) return
		setBundleBusy(true)
		setBundleError(null)
		try {
			const savedName = visuals.find((v) => v.id === visualId)?.name ?? "visualization"
			await downloadVisualsBundle([{ id: visualId, name: savedName }])
		} catch (e) {
			setBundleError(e instanceof Error ? e.message : String(e))
		} finally {
			setBundleBusy(false)
		}
	}
	const canUndo = useAtomValue(canUndoAtom)
	const canRedo = useAtomValue(canRedoAtom)
	const undo = useUndo()
	const redo = useRedo()

	// Live collision check against every other saved visual. Excludes the
	// current visual (if any) so typing your existing name back in doesn't
	// "collide with yourself".
	const nameTaken = nameCollides(name, visuals, visualId ?? undefined)

	const onSave = async () => {
		if (saving) return
		setSaving(true)
		try {
			const id = await saveVisual()
			if (!visualId) {
				await navigate({ to: "/editor/$visualId", params: { visualId: id } })
			}
		} finally {
			setSaving(false)
		}
	}

	// Cmd/Ctrl+S → save the visual instead of triggering the browser's
	// "save this page as HTML" download. We intercept on the document so
	// the shortcut works regardless of which input/panel currently has
	// focus, and bail out when the name is taken (matches the button's
	// disabled state — we don't silently save a colliding name).
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const isSaveShortcut =
				(e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === "s"
			if (!isSaveShortcut) return
			e.preventDefault()
			if (nameTaken || templatePending) return
			void onSave()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
		// `onSave` is a fresh closure every render but reads atom/state via
		// hooks, so we depend on the values it closes over rather than the
		// function reference itself.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [saving, visualId, nameTaken, templatePending])

	const mod = modKey()
	// Icon-only buttons lose the label's side padding in compact mode so the
	// whole group fits a 320px strip beside the tray's own controls.
	const iconBtn = compact ? "px-2" : undefined

	return (
		<div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
			{/* Undo / redo — the keyboard shortcuts (bound in useEditorHistory)
			 *  are the primary way in; the buttons make the history visible and
			 *  work while a text field has focus, where ⌘Z undoes the typing. */}
			<div className="flex items-center gap-1">
				<Button
					compact
					onClick={() => undo()}
					disabled={!canUndo}
					title={`Undo (${mod}Z)`}
					aria-label="Undo"
					data-tip="undo"
					className={iconBtn}
				>
					<UndoIcon />
				</Button>
				<Button
					compact
					onClick={() => redo()}
					disabled={!canRedo}
					title={`Redo (${mod === "⌘" ? "⇧⌘Z" : "Ctrl+Shift+Z"})`}
					aria-label="Redo"
					className={iconBtn}
				>
					<RedoIcon />
				</Button>
			</div>
			{/* Publish is a split button once there is something to republish:
			    the main segment opens the export modal on its Publish tab, the
			    arrow holds Republish. */}
			{visualId && (
				// eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape-to-close for the menu below; the interactive elements are the buttons inside
				<div className="relative" ref={publishMenuRef} onKeyDown={onPublishMenuKeyDown}>
					<div className="flex">
						<Button
							compact
							onClick={() => openExport("publish")}
							data-tip="export"
							aria-label={compact ? "Publish" : undefined}
							title={compact ? "Publish" : undefined}
							className={[iconBtn, canRepublish ? "rounded-r-none" : undefined]
								.filter(Boolean)
								.join(" ")}
						>
							{compact ? <PublishIcon /> : "Publish"}
						</Button>
						{canRepublish && (
							<Button
								compact
								className="rounded-l-none border-l border-l-white/30 px-2"
								onClick={() => setPublishMenuOpen((v) => !v)}
								aria-label="More ways to publish"
								aria-haspopup="menu"
								aria-expanded={publishMenuOpen}
							>
								<DisclosureChevron open={publishMenuOpen} />
							</Button>
						)}
					</div>
					{canRepublish && publishMenuOpen && (
						<div className={MENU_PANEL} role="menu">
							<button
								type="button"
								role="menuitem"
								disabled={republishBusy}
								onClick={() => {
									setPublishMenuOpen(false)
									void republish(visualId, {
										includeZctaTopology: geographyLevel === "zcta",
									})
								}}
								className={MENU_ITEM}
							>
								<div className={MENU_TITLE}>
									{republishBusy ? "Publishing…" : "Republish"}
								</div>
								<div className={MENU_HINT}>
									Update everything already published with the saved visualization.
									Links stay the same.
								</div>
							</button>
						</div>
					)}
				</div>
			)}
			{/* Save is a split button like the header's New visualization: the
			    main segment saves, the arrow opens the other ways to save. The
			    menu only exists for a saved visual (a template is built from
			    the saved row). */}
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape-to-close for the menu below; the interactive elements are the buttons inside */}
			<div className="relative" ref={saveMenuRef} onKeyDown={onSaveMenuKeyDown}>
				<div className="flex">
					<Button
						compact
						onClick={onSave}
						disabled={saving || nameTaken || templatePending}
						className={visualId ? "rounded-r-none whitespace-nowrap" : undefined}
					>
						{visualId ? "Save" : compact ? "Save" : "Save visualization"}
					</Button>
					{visualId && (
						<Button
							compact
							className="rounded-l-none border-l border-l-white/30 px-2"
							onClick={() => setSaveMenuOpen((v) => !v)}
							aria-label="More ways to save"
							aria-haspopup="menu"
							aria-expanded={saveMenuOpen}
							data-tip="save-menu"
						>
							<DisclosureChevron open={saveMenuOpen} />
						</Button>
					)}
				</div>
				{visualId && (
					<SaveTemplateButton
						visualId={visualId}
						trigger={(openDialog) =>
							saveMenuOpen ? (
								<div className={MENU_PANEL} role="menu">
									<button
										type="button"
										role="menuitem"
										onClick={() => {
											setSaveMenuOpen(false)
											openDialog()
										}}
										className={MENU_ITEM}
										data-tip="save-template"
									>
										<div className={MENU_TITLE}>Save as template…</div>
										<div className={MENU_HINT}>
											Keep this design to start new visualizations from, with new data.
										</div>
									</button>
									<button
										type="button"
										role="menuitem"
										disabled={bundleBusy}
										onClick={() => {
											setSaveMenuOpen(false)
											void onDownloadBundle()
										}}
										className={MENU_ITEM_DIVIDED}
									>
										<div className={MENU_TITLE}>
											{bundleBusy ? "Downloading…" : "Download as Zafiro file (.json)"}
										</div>
										<div className={MENU_HINT}>
											This visualization with its data set and theme, for importing into
											another Zafiro.
										</div>
									</button>
									<button
										type="button"
										role="menuitem"
										onClick={() => {
											setSaveMenuOpen(false)
											openExport("download")
										}}
										className={MENU_ITEM_DIVIDED}
									>
										<div className={MENU_TITLE}>Save image…</div>
										<div className={MENU_HINT}>
											A PNG, JPEG, SVG or PDF at the size you choose.
										</div>
									</button>
								</div>
							) : null
						}
					/>
				)}
				{bundleError !== null && (
					<span role="alert" className="absolute top-full right-0 mt-1 text-sm text-red-700 dark:text-red-300">
						{bundleError}
					</span>
				)}
			</div>
			<ExportModal
				open={exportOpen}
				onClose={() => setExportOpen(false)}
				visualId={visualId}
				initialTab={exportTab}
			/>
		</div>
	)
}
