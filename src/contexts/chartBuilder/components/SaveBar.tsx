import { Fragment, useId, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import { nameCollides } from "../lib/nameUniqueness"
import type { Visual } from "../lib/types"
import { firstName } from "../../../lib/currentUser"
import {
	currentVisualIdAtom,
	currentVisualNameAtom,
	currentVisualPublishedAtom,
	foldersAtom,
	newVisualFolderIdAtom,
	liveVisualsAtom,
	republishOnSaveFor,
	republishOnSaveVisualsAtom,
	saveStatusAtom,
	visualsAtom,
} from "../store/atoms"
import { republishStateAtom, useRepublishVisual } from "../store/republishVisual"
import { useEffectiveGeographyLevel } from "../store/useEffectiveGeographyLevel"
import { getStorageAdapter } from "../lib/storage/registry"
import { folderAncestors } from "../../library/lib/folderSubtree"
import { useMediaQuery, useNarrowLayout } from "../../../lib/useMediaQuery"
import { pageTitle, useDocumentTitle } from "../../../lib/documentTitle"

import { Button } from "../../../components/ui/Button"
import { DisclosureChevron } from "../../../components/ui/Chevron"
import { EditorActions } from "./EditorActions"
import { UpdateTemplateButton } from "./UpdateTemplateButton"
import { VersionBadge } from "./VersionBadge"

/** "9:25 AM" for a save today, "Oct 14" for an earlier one this year,
 *  "Oct 14, 2025" before that. */
const formatSavedWhen = (ts: number, now = Date.now()) => {
	const d = new Date(ts)
	const today = new Date(now)
	if (d.toDateString() === today.toDateString()) {
		return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
	}
	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
	})
}

/** The status beside the name: "Saving…" mid-save, else the stored visual's
 *  last save — "Saved by Nancy at 9:25 AM" when the server named the saver,
 *  "Saved · 9:25 AM" when it didn't (local mode, older visuals). Read off
 *  the stored visual, so it's right from the moment a visual opens, not
 *  only after this session saves it. Exported for tests. */
export const saveIndicatorText = (
	saving: boolean,
	saved: Pick<Visual, "updatedAt" | "updatedBy"> | undefined,
	now = Date.now()
): string | null => {
	if (saving) return "Saving…"
	if (!saved) return null
	const when = formatSavedWhen(saved.updatedAt, now)
	if (!saved.updatedBy) return `Saved · ${when}`
	const today = new Date(saved.updatedAt).toDateString() === new Date(now).toDateString()
	return `Saved by ${firstName(saved.updatedBy.name)} ${today ? "at" : "on"} ${when}`
}

/** One-click Republish for every published pin of the open visual (same
 *  urls, fresh snapshot — see `store/republishVisual.ts`). Shown only when
 *  the visual is published AND this session runs in server mode: in a
 *  browser-local session there is nowhere public to publish to. Beside the
 *  button, the last result: "Republished · 9:25 AM" after a pass that
 *  pushed at least one pin, or the first error of a failed pass — and a
 *  "Republishes on save" chip when this user has set the visual to
 *  republish on every save here (the library's Template chip, restyled as
 *  a status). */
const RepublishControl = ({ visualId }: { visualId: string }) => {
	const { busy, error, lastAt } = useAtomValue(republishStateAtom)
	const republishOnSave = republishOnSaveFor(
		useAtomValue(republishOnSaveVisualsAtom),
		visualId
	)
	const republish = useRepublishVisual()
	// ZIP-level maps inline their boundary topology into the payload — the
	// same flag the Export modal's Embed tab passes.
	const geographyLevel = useEffectiveGeographyLevel()
	return (
		<div className="flex min-w-0 items-center gap-2">
			<Button
				compact
				disabled={busy}
				onClick={() =>
					void republish(visualId, { includeZctaTopology: geographyLevel === "zcta" })
				}
			>
				{busy ? "Publishing…" : "Republish"}
			</Button>
			{republishOnSave && (
				<span
					title="Republishes on every save (your setting, on this browser)"
					className="inline-flex flex-shrink-0 items-center rounded bg-brand-100 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-brand-800 uppercase dark:bg-brand-900/40 dark:text-brand-200"
				>
					Republishes on save
				</span>
			)}
			<span
				role="status"
				className={
					error !== null
						? "truncate text-xs text-red-700 dark:text-red-300"
						: lastAt !== null
							? "truncate text-xs vc-muted"
							: "sr-only"
				}
				title={error ?? undefined}
			>
				{error !== null
					? error
					: lastAt !== null
						? `Republished · ${formatSavedWhen(lastAt)}`
						: null}
			</span>
		</div>
	)
}

/** The visual's folder path, each crumb a link back to that folder's
 *  library view. A saved visual's crumbs come off the stored record; a
 *  never-saved one shows the destination the header's "New…" menu picked
 *  (`newVisualFolderIdAtom`), so the choice is visible before the first
 *  save files it. Renders nothing at the root. */
const FolderBreadcrumbs = ({ visualId }: { visualId: string | null }) => {
	// Id lookup, so the full list (a trashed visual still has a folder).
	const visuals = useAtomValue(visualsAtom)
	const folders = useAtomValue(foldersAtom)
	const pendingFolderId = useAtomValue(newVisualFolderIdAtom)
	const saved = visuals.find((v) => v.id === visualId)
	const folderId = saved ? (saved.folderId ?? null) : pendingFolderId
	const path = folderAncestors(folders, folderId)
	if (path.length === 0) return null
	return (
		<nav aria-label="Folder" className="flex min-w-0 shrink items-center">
			{path.map((folder) => (
				<Fragment key={folder.id}>
					<Link
						to="/"
						search={{ folder: folder.id }}
						title={folder.name}
						className="max-w-40 min-w-0 truncate rounded px-1 text-sm vc-muted hover:text-brand-700 hover:underline dark:hover:text-brand-300"
					>
						{folder.name}
					</Link>
					<span aria-hidden className="flex-shrink-0 px-0.5 text-sm vc-muted">
						›
					</span>
				</Fragment>
			))}
		</nav>
	)
}

export const SaveBar = () => {
	const [name, setName] = useAtom(currentVisualNameAtom)
	const [visualId] = useAtom(currentVisualIdAtom)
	// Live visuals only: a name sitting in the Trash is free to reuse (a
	// restore renames the trashed one if it still collides).
	const visuals = useAtomValue(liveVisualsAtom)
	// Id lookup, so the full list — the editor's own visual.
	const savedVisual = useAtomValue(visualsAtom).find((v) => v.id === visualId)
	const saveStatus = useAtomValue(saveStatusAtom)
	const published = useAtomValue(currentVisualPublishedAtom)
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

	const indicator = saveIndicatorText(saveStatus === "saving", savedVisual)
	const nameErrorId = useId()
	const displayName = name.trim() || "Untitled visualization"
	useDocumentTitle(pageTitle(displayName))
	// The editor's page heading for assistive tech; the visible title is the
	// editable box below. sr-only = absolutely positioned, so it takes no
	// space in the bar's flex rows.
	const pageHeading = <h1 className="sr-only">{displayName}</h1>

	const nameField = (
		<div className="flex min-w-32 flex-1 flex-col">
			<div className="flex min-w-0 items-center">
				<FolderBreadcrumbs visualId={visualId} />
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Untitled visualization"
					aria-label="Visualization title"
					data-tip="visual-title"
					aria-invalid={nameTaken ? true : undefined}
					aria-describedby={nameTaken ? nameErrorId : undefined}
					className={`vc-focus-ring min-w-24 flex-1 rounded-control border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-stone-900 transition-colors hover:border-stone-200 focus:border-stone-600 dark:text-white dark:hover:border-stone-700 dark:focus:border-stone-500 ${
						nameTaken ? "border-red-400 dark:border-red-500" : ""
					}`}
				/>
			</div>
			{nameTaken && (
				<span
					id={nameErrorId}
					className="px-2 text-xs text-red-700 dark:text-red-300"
				>
					A visualization named &ldquo;{name.trim()}&rdquo; already exists.
				</span>
			)}
		</div>
	)

	// Server mode only: `remoteLoad` is true exactly when the boot probe found
	// the self-host server and installed the HTTP adapter.
	const republishControl =
		published && visualId !== null && getStorageAdapter().capabilities.remoteLoad ? (
			<RepublishControl visualId={visualId} />
		) : null

	const collapseButton = (
		<button
			type="button"
			onClick={() => setBarOpen(false)}
			aria-expanded
			aria-label="Collapse title and actions"
			title="Collapse title and actions"
			className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded hover:bg-stone-100 dark:hover:bg-stone-800 vc-muted"
		>
			<DisclosureChevron open />
		</button>
	)

	if (narrow) {
		return (
			<div className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
				{pageHeading}
				{barOpen && oneRow ? (
					<div className="flex flex-wrap items-center gap-3 px-4 py-2">
						{nameField}
						<UpdateTemplateButton />
						<VersionBadge compact />
						{republishControl}
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
							<UpdateTemplateButton />
							<VersionBadge compact />
							{republishControl}
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
						<span className="truncate text-xs vc-muted">
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
			{pageHeading}
			{nameField}
			<UpdateTemplateButton />
			<VersionBadge />
			{/* Always mounted so screen readers hear "Saving…" / "Saved" as
			 *  it changes; screen-reader-only below `sm` (where it used to be
			 *  display:none) and while empty, so it takes no room there. */}
			<span
				role="status"
				className={
					indicator ? "sr-only text-sm sm:not-sr-only vc-muted" : "sr-only"
				}
				title={
					savedVisual && saveStatus !== "saving"
						? `${savedVisual.updatedBy ? `${savedVisual.updatedBy.name}, ` : ""}${new Date(
								savedVisual.updatedAt
							).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
						: undefined
				}
			>
				{indicator}
			</span>
			{republishControl}
			<div className="ml-auto">
				<EditorActions />
			</div>
		</div>
	)
}
