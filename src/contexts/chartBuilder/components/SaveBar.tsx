import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import { nameCollides } from "../lib/nameUniqueness"
import {
	currentVisualIdAtom,
	currentVisualNameAtom,
	lastSavedAtAtom,
	saveStatusAtom,
	visualsAtom,
} from "../store/atoms"
import { useSaveVisual } from "../store/saveVisual"

import { Button } from "../../../components/ui/Button"
import { ExportModal } from "./ExportModal"
import { VersionBadge } from "./VersionBadge"

const formatSavedTime = (ts: number) => {
	const d = new Date(ts)
	return d.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	})
}

export const SaveBar = () => {
	const [name, setName] = useAtom(currentVisualNameAtom)
	const [visualId] = useAtom(currentVisualIdAtom)
	const visuals = useAtomValue(visualsAtom)
	const lastSavedAt = useAtomValue(lastSavedAtAtom)
	const saveStatus = useAtomValue(saveStatusAtom)
	const saveVisual = useSaveVisual()
	const navigate = useNavigate()
	const [saving, setSaving] = useState(false)
	const [exportOpen, setExportOpen] = useState(false)

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

	const indicator = (() => {
		if (saving || saveStatus === "saving") return "Saving…"
		if (lastSavedAt) return `Saved · ${formatSavedTime(lastSavedAt)}`
		return null
	})()

	return (
		<div className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2 dark:border-stone-800 dark:bg-stone-900">
			<div className="flex min-w-0 flex-1 flex-col">
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Untitled visualization"
					className={`min-w-0 rounded-sm border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-stone-900 transition-colors outline-none hover:border-stone-200 focus:border-stone-400 dark:text-white dark:hover:border-stone-700 dark:focus:border-stone-500 ${
						nameTaken ? "border-red-400 dark:border-red-500" : ""
					}`}
				/>
				{nameTaken && (
					<span className="px-2 text-xs text-red-700 dark:text-red-300">
						A visualization named &ldquo;{name.trim()}&rdquo; already exists.
					</span>
				)}
			</div>
			<VersionBadge />
			{indicator && (
				<span className="hidden text-sm text-stone-600 sm:inline dark:text-stone-400">
					{indicator}
				</span>
			)}
			{visualId && (
				<Button
					compact
					onClick={() => setExportOpen(true)}
					title="Embed or export this visualization"
				>
					Export
				</Button>
			)}
			<Button compact onClick={onSave} disabled={saving || nameTaken}>
				{visualId ? "Save" : "Save visualization"}
			</Button>
			<ExportModal
				open={exportOpen}
				onClose={() => setExportOpen(false)}
				visualId={visualId}
			/>
		</div>
	)
}
