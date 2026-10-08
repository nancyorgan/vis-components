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
				className={`vc-title-input min-w-0 px-2 py-1 text-sm font-medium ${
					nameTaken ? "vc-title-input-taken" : ""
				}`}
			/>
			{nameTaken && (
				<span className="vc-text-danger px-2 text-xs">
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
			className="vc-icon-btn-plain flex h-8 w-8 flex-shrink-0 items-center justify-center rounded"
		>
			<DisclosureChevron open />
		</button>
	)

	if (narrow) {
		return (
			<div className="vc-rule-b vc-bg">
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
						<span className="vc-text-faint truncate text-xs">
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
		<div className="vc-rule-b vc-bg flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
			{nameField}
			<VersionBadge />
			{indicator && (
				<span className="vc-text-muted hidden text-sm sm:inline">
					{indicator}
				</span>
			)}
			<div className="ml-auto">
				<EditorActions />
			</div>
		</div>
	)
}
