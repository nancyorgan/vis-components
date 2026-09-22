import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { nameCollides } from "../lib/nameUniqueness"
import {
	currentVisualIdAtom,
	currentVisualNameAtom,
	liveVisualsAtom,
} from "../store/atoms"
import {
	canRedoAtom,
	canUndoAtom,
	useRedo,
	useUndo,
} from "../store/editorHistory"
import { useSaveVisual } from "../store/saveVisual"

import { Button } from "../../../components/ui/Button"
import { ExportModal } from "./ExportModal"

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

/** Arrow out of a tray: the compact stand-in for the "Export" label. */
const ExportIcon = () => (
	<svg {...iconProps}>
		<path d="M8 10V2.5" />
		<path d="M5 5.5l3-3 3 3" />
		<path d="M3 9.5v3a1 1 0 001 1h8a1 1 0 001-1v-3" />
	</svg>
)

/** The editor's action group — undo / redo, Export, Save — plus the ⌘S
 *  shortcut and the export modal. Rendered in exactly ONE place at a time:
 *  the SaveBar on wide layouts, the data tray's bottom strip on narrow ones
 *  (thumb reach, and the save bar shrinks to the name). `compact` swaps the
 *  Export label for an icon so the strip fits a 360px phone. */
export const EditorActions = ({ compact = false }: { compact?: boolean }) => {
	const name = useAtomValue(currentVisualNameAtom)
	const visualId = useAtomValue(currentVisualIdAtom)
	// Live visuals only: a name sitting in the Trash is free to reuse (a
	// restore renames the trashed one if it still collides).
	const visuals = useAtomValue(liveVisualsAtom)
	const saveVisual = useSaveVisual()
	const navigate = useNavigate()
	const [saving, setSaving] = useState(false)
	const [exportOpen, setExportOpen] = useState(false)
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
			if (nameTaken) return
			void onSave()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
		// `onSave` is a fresh closure every render but reads atom/state via
		// hooks, so we depend on the values it closes over rather than the
		// function reference itself.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [saving, visualId, nameTaken])

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
			{visualId && (
				<Button
					compact
					onClick={() => setExportOpen(true)}
					title="Embed or export this visualization"
					aria-label={compact ? "Export" : undefined}
					className={iconBtn}
				>
					{compact ? <ExportIcon /> : "Export"}
				</Button>
			)}
			<Button compact onClick={onSave} disabled={saving || nameTaken}>
				{visualId ? "Save" : compact ? "Save" : "Save visualization"}
			</Button>
			<ExportModal
				open={exportOpen}
				onClose={() => setExportOpen(false)}
				visualId={visualId}
			/>
		</div>
	)
}
