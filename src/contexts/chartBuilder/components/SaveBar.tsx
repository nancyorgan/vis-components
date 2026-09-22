import { useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { nameCollides } from "../lib/nameUniqueness"
import {
	currentVisualIdAtom,
	currentVisualNameAtom,
	lastSavedAtAtom,
	liveVisualsAtom,
	saveStatusAtom,
} from "../store/atoms"
import { useMediaQuery, useNarrowLayout } from "../../../lib/useMediaQuery"

import { DisclosureChevron } from "../../../components/ui/Chevron"
import { EditorActions } from "./EditorActions"
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
	// Live visuals only: a name sitting in the Trash is free to reuse (a
	// restore renames the trashed one if it still collides).
	const visuals = useAtomValue(liveVisualsAtom)
	const lastSavedAt = useAtomValue(lastSavedAtAtom)
	const saveStatus = useAtomValue(saveStatusAtom)
	// NARROW: the bar collapses up into a slim strip (name in small type +
	// chevron) so the chart can take the height back. Starts expanded;
	// transient. Below `sm` (portrait phones) the expanded bar is two rows —
	// the name, then version chip + action group; from `sm` up (landscape
	// phones, tablets in portrait) everything fits one row.
	const narrow = useNarrowLayout()
	const oneRow = useMediaQuery("(min-width: 640px)")
	const [barOpen, setBarOpen] = useState(true)

	// Live collision check against every other saved visual (the red border
	// here; the Save button and ⌘S in EditorActions run the same check).
	const nameTaken = nameCollides(name, visuals, visualId ?? undefined)

	const indicator = (() => {
		if (saveStatus === "saving") return "Saving…"
		if (lastSavedAt) return `Saved · ${formatSavedTime(lastSavedAt)}`
		return null
	})()

	const nameField = (
		<div className="flex min-w-32 flex-1 flex-col">
			<input
				type="text"
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="Untitled visualization"
				className={`min-w-0 rounded-control border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-stone-900 transition-colors outline-none hover:border-stone-200 focus:border-stone-400 dark:text-white dark:hover:border-stone-700 dark:focus:border-stone-500 ${
					nameTaken ? "border-red-400 dark:border-red-500" : ""
				}`}
			/>
			{nameTaken && (
				<span className="px-2 text-xs text-red-700 dark:text-red-300">
					A visualization named &ldquo;{name.trim()}&rdquo; already exists.
				</span>
			)}
		</div>
	)

	const collapseButton = (
		<button
			type="button"
			onClick={() => setBarOpen(false)}
			aria-expanded
			aria-label="Collapse title and actions"
			title="Collapse title and actions"
			className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
		>
			<DisclosureChevron open />
		</button>
	)

	if (narrow) {
		return (
			<div className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
				{barOpen && oneRow ? (
					<div className="flex flex-wrap items-center gap-3 px-4 py-2">
						{nameField}
						<VersionBadge compact />
						<EditorActions />
						{collapseButton}
					</div>
				) : barOpen ? (
					<div className="flex flex-col gap-1.5 px-4 py-2">
						<div className="flex items-center gap-2">
							{nameField}
							{collapseButton}
						</div>
						{/* `flex-wrap` is a safety net: an overflowing row would widen
						 *  the mobile layout viewport and let the page pan into blank
						 *  space. */}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<VersionBadge compact />
							<EditorActions compact />
						</div>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setBarOpen(true)}
						aria-expanded={false}
						aria-label="Show title and actions"
						title="Show title and actions"
						className="flex w-full items-center justify-between gap-2 px-4 py-1 text-left"
					>
						<span className="truncate text-xs text-stone-500 dark:text-stone-400">
							{name.trim() || "Untitled visualization"}
						</span>
						<DisclosureChevron open={false} />
					</button>
				)}
			</div>
		)
	}

	return (
		// `flex-wrap` is a safety net: an overflowing row would widen the
		// mobile layout viewport and let the whole page pan into blank space.
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-200 bg-white px-4 py-2 dark:border-stone-800 dark:bg-stone-900">
			{nameField}
			<VersionBadge />
			{indicator && (
				<span className="hidden text-sm text-stone-600 sm:inline dark:text-stone-400">
					{indicator}
				</span>
			)}
			<div className="ml-auto">
				<EditorActions />
			</div>
		</div>
	)
}
