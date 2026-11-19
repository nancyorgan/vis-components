import { useState } from "react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useAtom, useSetAtom } from "jotai"
import { themesAtom, unlockedThemeIdAtom } from "../../chartBuilder/store/atoms"
import { combine as c } from "../../../lib/cls"
import {
	canDropIntoFolder,
	decodeThemeDrag,
	encodeThemeDrag,
	groupThemesByFolder,
	moveNeedsAdminGate,
	moveThemeToFolder,
	THEME_DRAG_TYPE,
	THEME_FOLDER_LABEL,
	THEME_FOLDERS,
	type ThemeFolder,
} from "../lib/themeFolders"

import { SectionChevron } from "../../../components/ui/Chevron"

import { ManagedThemeGate } from "../../chartBuilder/components/ManagedThemeGate"

import { AddThemeButton } from "./AddThemeButton"
import { LockIcon } from "./LockIcon"
import { IconButton } from "../../../components/ui/IconButton"

/** What the user was trying to do when the administrator gate stopped
 *  them. Kept as data rather than a stashed callback so the dialog's
 *  "Yes, proceed" replays exactly one intent, with no closure captured
 *  from the render that opened it. */
type GatedAction =
	| { kind: "select"; themeId: string }
	| { kind: "move"; themeId: string; target: ThemeFolder }

export const ThemesSubNav = ({
	onThemeOpened,
}: {
	/** Fires after a theme is opened in the editor — the narrow layout's
	 *  disclosure closes itself so the editor isn't pushed below the fold. */
	onThemeOpened?: () => void
} = {}) => {
	const [themes, setThemes] = useAtom(themesAtom)
	const setUnlockedThemeId = useSetAtom(unlockedThemeIdAtom)
	const navigate = useNavigate()
	// The theme open in the editor, if any — the route is the source of
	// truth, so the rail highlights nothing while the gallery is showing.
	const params = useParams({ strict: false }) as { themeId?: string }
	const openThemeId = params.themeId ?? null
	// Which folder the gallery is narrowed to, if any — highlighted on its
	// header the way the open theme is highlighted on its row. Only
	// meaningful on the gallery itself; the editor and the other settings
	// pages carry no filter.
	const search = useSearch({ strict: false }) as { folder?: ThemeFolder }
	const selectedFolder = openThemeId === null ? (search.folder ?? null) : null

	/** Every way of picking a theme lands the editor on it. The sub-nav is
	 *  mounted on EVERY settings page (Fonts, Sharing, …), so it routes
	 *  rather than only recording a selection. */
	const openTheme = (themeId: string) => {
		void navigate({ to: "/settings/themes/$themeId", params: { themeId } })
		onThemeOpened?.()
	}

	/** A folder header narrows the gallery to that folder, like clicking a
	 *  folder in the library's tree. Folding is the chevron's job. */
	const showFolder = (folder: ThemeFolder) => {
		void navigate({ to: "/settings/themes", search: { folder } })
		onThemeOpened?.()
	}

	// Every folder starts open, and folding / unfolding one is never gated:
	// seeing WHICH themes are managed is not editing them, and hiding the
	// list would only make themes look missing. The gate is on touching a
	// managed theme — every time, so one "Yes, proceed" can't quietly
	// disarm the warning for the rest of the session. System themes open
	// ungated: there is nothing to edit there, the editor shows them
	// read-only.
	const [expanded, setExpanded] = useState<Record<ThemeFolder, boolean>>({
		system: true,
		managed: true,
		custom: true,
	})
	const [gated, setGated] = useState<GatedAction | null>(null)
	// Same component owns both ends of the drag, so the dragged id can live
	// in state — no dataTransfer mirror needed for the dragover highlight
	// (getData() is spec-blocked while hovering).
	const [draggingId, setDraggingId] = useState<string | null>(null)
	const [dragOver, setDragOver] = useState<ThemeFolder | null>(null)

	const groups = groupThemesByFolder(themes)

	const perform = (action: GatedAction) => {
		if (action.kind === "select") {
			// Passing the gate grants edit access to THIS theme only — the
			// editor re-locks as soon as a different managed theme is picked.
			setUnlockedThemeId(action.themeId)
			openTheme(action.themeId)
		} else
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

	/** Move a theme between the two folders — the drop's outcome, shared
	 *  with the tap fallback on each row. */
	const moveByTap = (themeId: string, target: ThemeFolder) => {
		const action: GatedAction = { kind: "move", themeId, target }
		if (moveNeedsAdminGate(themes, themeId, target)) gate(action)
		else perform(action)
	}

	const dropOnFolder = (target: ThemeFolder) => (e: React.DragEvent) => {
		e.preventDefault()
		setDragOver(null)
		const raw = e.dataTransfer.getData(THEME_DRAG_TYPE)
		const themeId = decodeThemeDrag(raw)?.themeId ?? draggingId
		setDraggingId(null)
		if (!themeId) return
		moveByTap(themeId, target)
	}

	const renderFolder = (folder: ThemeFolder) => {
		const managed = folder === "managed"
		const system = folder === "system"
		const open = expanded[folder]
		const entries = groups[folder]
		return (
			<div
				key={folder}
				data-theme-folder={folder}
				onDragOver={(e) => {
					if (!draggingId || !canDropIntoFolder(folder)) return
					e.preventDefault()
					e.dataTransfer.dropEffect = "move"
					setDragOver(folder)
				}}
				onDragLeave={() => setDragOver((prev) => (prev === folder ? null : prev))}
				onDrop={canDropIntoFolder(folder) ? dropOnFolder(folder) : undefined}
				className={c(
					"rounded",
					dragOver === folder && "vc-nav-active"
				)}
			>
				{/* Pointer target row: a click anywhere shows the folder. The
				 *  chevron (fold) and the label (show) are sibling buttons — a
				 *  button can't contain another one. */}
				{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer convenience; the label button is the keyboard path */}
				<div
					onClick={() => showFolder(folder)}
					className={c(
						"flex w-full cursor-default items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide",
						selectedFolder === folder
							? "vc-nav-active"
							: "text-stone-900 hover:bg-stone-100 dark:text-white dark:hover:bg-stone-800"
					)}
				>
					<button
						type="button"
						aria-label={`${open ? "Collapse" : "Expand"} ${THEME_FOLDER_LABEL[folder]}`}
						aria-expanded={open}
						onClick={(e) => {
							e.stopPropagation()
							setExpanded((prev) => ({ ...prev, [folder]: !prev[folder] }))
						}}
						className="relative flex h-4 w-4 flex-shrink-0 items-center justify-center rounded before:absolute before:-inset-1 before:content-[''] hover:bg-stone-200 pointer-coarse:h-7 pointer-coarse:w-7 dark:hover:bg-stone-700"
					>
						<SectionChevron open={open} />
					</button>
					<button
						type="button"
						aria-current={selectedFolder === folder ? "page" : undefined}
						className="flex min-w-0 flex-1 items-center gap-1 text-left font-semibold uppercase tracking-wide"
					>
						<span className="min-w-0 flex-1 truncate">
							{THEME_FOLDER_LABEL[folder]}
						</span>
						{(managed || system) && <LockIcon />}
					</button>
				</div>
				{open && (
					<div className="flex flex-col gap-0.5 pl-3">
						{entries.length === 0 && (
							<p className="px-2 py-1 text-xs italic vc-faint">
								{managed
									? "Drag a theme here to manage it"
									: system
										? "No system themes"
										: "No custom themes yet"}
							</p>
						)}
						{entries.map((t) => {
							const isActive = t.id === openThemeId
							return (
								// The row is a plain container: the theme's name button
								// (draggable, as the whole row used to be) and the move
								// button sit side by side — a button can't nest another.
								<div
									key={t.id}
									className={c(
										"group/themerow flex w-full items-center gap-1 rounded pr-2 text-xs pointer-coarse:py-1",
										draggingId === t.id && "opacity-50",
										isActive
											? "vc-nav-active"
											: "hover:bg-stone-100 dark:hover:bg-stone-800 vc-text"
									)}
								>
									<button
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
												: openTheme(t.id)
										}
										aria-current={isActive ? "true" : undefined}
										className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-2 text-left"
									>
										<span className="min-w-0 flex-1 truncate">{t.name}</span>
										{(managed || system) && (
											<span className="vc-muted">
												<LockIcon />
											</span>
										)}
									</button>
									{/* Non-drag path for the move between folders: a drag
									 *  can't start from a finger in every mobile browser,
									 *  and a keyboard can't drag at all. Shown on coarse
									 *  pointers, and for a keyboard user once focus is in
									 *  the row; same administrator gate as the drop. */}
									{!t.isSystem && (
										<IconButton
											aria-label={
												managed
													? `Move ${t.name} to Custom Themes`
													: `Move ${t.name} to Managed Themes`
											}
											onClick={() =>
												moveByTap(t.id, managed ? "custom" : "managed")
											}
											className="hidden h-7 w-7 flex-shrink-0 items-center justify-center kbd:group-has-focus-visible/themerow:flex pointer-coarse:flex"
										>
											<span aria-hidden="true">{managed ? "↓" : "↑"}</span>
										</IconButton>
									)}
								</div>
							)
						})}
					</div>
				)}
			</div>
		)
	}

	return (
		<div className="ml-4 flex flex-col gap-1 border-l border-stone-200 pl-2 dark:border-stone-700">
			{THEME_FOLDERS.map(renderFolder)}
			<AddThemeButton
				className="mt-1 self-start"
				onThemeAdded={onThemeOpened}
			/>
			<ManagedThemeGate
				open={gated !== null}
				onCancel={cancelGate}
				onConfirm={confirmGate}
			/>
		</div>
	)
}
