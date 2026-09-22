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
				<button
					type="button"
					onClick={() => showFolder(folder)}
					aria-current={selectedFolder === folder ? "page" : undefined}
					className={c(
						"flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide",
						selectedFolder === folder
							? "vc-nav-active"
							: "text-stone-900 hover:bg-stone-100 dark:text-white dark:hover:bg-stone-800"
					)}
				>
					{/* The chevron folds the list without changing the page.
					 *  Nested interactive content is why it's a span with a
					 *  button role, like the rows' move affordance. */}
					<span
						role="button"
						tabIndex={0}
						aria-label={`${open ? "Collapse" : "Expand"} ${THEME_FOLDER_LABEL[folder]}`}
						aria-expanded={open}
						onClick={(e) => {
							e.stopPropagation()
							setExpanded((prev) => ({ ...prev, [folder]: !prev[folder] }))
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								e.stopPropagation()
								setExpanded((prev) => ({ ...prev, [folder]: !prev[folder] }))
							}
						}}
						className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded hover:bg-stone-200 pointer-coarse:h-7 pointer-coarse:w-7 dark:hover:bg-stone-700"
					>
						<SectionChevron open={open} />
					</span>
					<span className="min-w-0 flex-1 truncate">
						{THEME_FOLDER_LABEL[folder]}
					</span>
					{(managed || system) && <LockIcon />}
				</button>
				{open && (
					<div className="flex flex-col gap-0.5 pl-3">
						{entries.length === 0 && (
							<p className="px-2 py-1 text-[11px] italic text-stone-400 dark:text-stone-500">
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
											: openTheme(t.id)
									}
									className={c(
										"flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs",
										draggingId === t.id && "opacity-50",
										isActive
											? "vc-nav-active"
											: "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
									)}
								>
									<span className="min-w-0 flex-1 truncate">{t.name}</span>
									{(managed || system) && (
										<span className="text-stone-400 dark:text-stone-500">
											<LockIcon />
										</span>
									)}
									{/* Touch fallback for the drag between folders: a
									 *  drag can't start from a finger in every mobile
									 *  browser, so on coarse pointers each theme carries
									 *  a one-tap move to the other folder, through the
									 *  same administrator gate as the drop. Nested
									 *  interactive content is why this is a span with a
									 *  button role rather than a <button>. */}
									{!t.isSystem && (
										<span
											role="button"
											tabIndex={0}
											title={
												managed
													? "Move to Custom Themes"
													: "Move to Managed Themes"
											}
											aria-label={
												managed
													? `Move ${t.name} to Custom Themes`
													: `Move ${t.name} to Managed Themes`
											}
											onClick={(e) => {
												e.stopPropagation()
												moveByTap(t.id, managed ? "custom" : "managed")
											}}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault()
													e.stopPropagation()
													moveByTap(t.id, managed ? "custom" : "managed")
												}
											}}
											className="hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded text-stone-500 hover:bg-stone-200 pointer-coarse:flex dark:text-stone-400 dark:hover:bg-stone-700"
										>
											{managed ? "↓" : "↑"}
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
