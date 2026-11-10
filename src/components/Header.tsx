import { useCallback, useEffect, useRef, useState } from "react"
import { DisclosureChevron } from "./ui/Chevron"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import { useAtomCallback } from "jotai/utils"
import {
	accessibilityCheckAtom,
	accessibilityFindingCountAtom,
	blackAndWhiteModeAtom,
	currentDatasetIdAtom,
	currentVisualIdAtom,
	datasetIndexAtom,
	foldersAtom,
	liveVisualsAtom,
	visualsAtom,
} from "../contexts/chartBuilder/store/atoms"
import {
	FolderPickerModal,
	type NameField,
} from "../contexts/library/components/FolderPickerModal"
import { TemplatePickerModal } from "../contexts/library/components/TemplatePickerModal"
import { UNFILED_FOLDER_ID } from "../contexts/library/lib/folderSubtree"
import { isTemplate } from "../contexts/chartBuilder/lib/visualTrash"
import { parseLibraryBundle } from "../contexts/chartBuilder/lib/libraryBundle"
import {
	UNTITLED_VISUAL_NAME,
	nameCollides,
} from "../contexts/chartBuilder/lib/nameUniqueness"
import { ImportProblemList } from "./ImportProblemList"
import {
	MENU_HINT,
	MENU_ITEM,
	MENU_ITEM_DIVIDED,
	MENU_PANEL,
	MENU_TITLE,
} from "./ui/menuStyles"
import {
	useImportLibraryBundle,
	type ImportBundleOutcome,
} from "../contexts/chartBuilder/store/importBundle"
import { getSignOutUrl } from "../lib/signOutUrl"
import { EditorPresence } from "./EditorPresence"
import { Button } from "./ui/Button"
import { Modal } from "./ui/Modal"

export const Header = () => {
	// Settings is about configuring the tool, not making charts — the
	// "New visualization" call to action stays on the library and editor.
	const inSettings = useRouterState({
		select: (st) => st.location.pathname.startsWith("/settings"),
	})
	return (
		<header className="sticky top-0 z-30 flex h-(--vc-header-h) items-center justify-between bg-white px-4 shadow-md shadow-stone-200/60 dark:bg-stone-900 dark:shadow-stone-950/40">
			<div className="flex items-center gap-6">
				<Link
					to="/"
					className="font-brand flex items-center gap-2 text-lg font-bold text-stone-900 dark:text-white"
				>
					<svg viewBox="0 0 32 32" width={28} height={28} aria-hidden="true">
						{/* Abstract gemstone: a dot lattice in the classic crown-over-pavilion profile (4/6/5/3/2/1), lit from top-left so it ramps pale blue → violet. One hero dot on the girdle plus three medium dots give it a size hierarchy; the rest stay small so nothing overlaps. Same drawing as the favicon in index.html. */}
						<circle cx={9.18} cy={6.5} r={1.55} fill="#bfdbfe" />
						<circle cx={13.73} cy={6.5} r={1.55} fill="#93c5fd" />
						<circle cx={18.27} cy={6.5} r={1.55} fill="#60a5fa" />
						<circle cx={22.83} cy={6.5} r={2.3} fill="#3b82f6" />
						<circle cx={4.63} cy={11.5} r={1.55} fill="#bfdbfe" />
						<circle cx={9.18} cy={11.5} r={1.55} fill="#93c5fd" />
						<circle cx={13.73} cy={11.5} r={3.15} fill="#60a5fa" />
						<circle cx={18.27} cy={11.5} r={1.55} fill="#3b82f6" />
						<circle cx={22.83} cy={11.5} r={1.55} fill="#6366f1" />
						<circle cx={27.38} cy={11.5} r={2.3} fill="#7c3aed" />
						<circle cx={6.9} cy={16.5} r={1.55} fill="#60a5fa" />
						<circle cx={11.45} cy={16.5} r={1.55} fill="#3b82f6" />
						<circle cx={16} cy={16.5} r={1.55} fill="#6366f1" />
						<circle cx={20.55} cy={16.5} r={1.55} fill="#6366f1" />
						<circle cx={25.1} cy={16.5} r={1.55} fill="#7c3aed" />
						<circle cx={11.45} cy={21.3} r={1.55} fill="#6366f1" />
						<circle cx={16} cy={21.3} r={2.3} fill="#7c3aed" />
						<circle cx={20.55} cy={21.3} r={1.55} fill="#7c3aed" />
						<circle cx={13.73} cy={25.7} r={1.45} fill="#7c3aed" />
						<circle cx={18.27} cy={25.7} r={1.45} fill="#6d28d9" />
						<circle cx={16} cy={29.5} r={1.3} fill="#6d28d9" />
					</svg>
					Zafiro
				</Link>
				{/* Hidden on phones: the header must stay one line tall (the
				 *  editor's page-fill height assumes `--vc-header-h`), and the
				 *  badge is the first thing to give. */}
				<span
					className="-ml-4 hidden rounded bg-vc-option-panel px-1.5 py-0.5 text-[11px] font-medium text-vc-section-header tabular-nums sm:inline dark:bg-vc-brand-text/20 dark:text-brand-200"
					title={`Built ${new Date(__BUILD_DATE__).toLocaleString(undefined, {
						dateStyle: "medium",
						timeStyle: "short",
					})}`}
				>
					v{__APP_VERSION__}
				</span>
			</div>
			<div className="flex items-center gap-3">
				<EditorPresence />
				{!inSettings && <NewVisualizationButton />}
				<EditorOnlyBlackAndWhiteToggle />
				<Link
					to="/settings"
					className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-stone-100 hover:text-stone-900 pointer-coarse:h-10 pointer-coarse:w-10 dark:hover:bg-stone-800 dark:hover:text-white vc-muted"
					title="Settings"
					data-tip="settings"
				>
					<svg
						viewBox="0 0 20 20"
						width={18}
						height={18}
						aria-hidden="true"
						fill="currentColor"
					>
						<path
							fillRule="evenodd"
							d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
							clipRule="evenodd"
						/>
					</svg>
				</Link>
				<SignOutButton />
			</div>
		</header>
	)
}

/** "Log out", only when the host advertised a sign-out endpoint. A real
 *  form POST rather than a fetch: the host ends the session and answers
 *  with a redirect to its own sign-in page, which the browser simply
 *  follows — nothing in this SPA needs unwinding. Not a router Link: the
 *  endpoint belongs to the host, not this app.
 *
 *  The label is text from `sm` up and the usual leave-through-the-door
 *  glyph below it: with the text, the editor's header overran a 360px
 *  phone by a few pixels. */
const SignOutButton = () => {
	const action = getSignOutUrl()
	if (!action) return null
	return (
		<form method="post" action={action} className="flex">
			<button
				type="submit"
				title="Log out"
				aria-label="Log out"
				className="flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-sm font-medium whitespace-nowrap transition-colors hover:bg-stone-100 hover:text-stone-900 pointer-coarse:h-10 pointer-coarse:min-w-10 sm:px-2.5 dark:hover:bg-stone-800 dark:hover:text-white vc-muted"
			>
				<svg
					className="sm:hidden"
					viewBox="0 0 20 20"
					width={18}
					height={18}
					aria-hidden="true"
					fill="none"
					stroke="currentColor"
					strokeWidth={1.8}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M8.5 3.5H4.5v13h4" />
					<path d="M12.5 6.5 16 10l-3.5 3.5" />
					<path d="M16 10H8" />
				</svg>
				<span className="hidden sm:inline">Log out</span>
			</button>
		</form>
	)
}

/** "New" on phones, the full label from `sm` up — the header has to fit
 *  brand + this button + two icon links + "Log out" on a 360px screen in
 *  one line. */
const NewVisualizationLabel = () => (
	<>
		New<span className="hidden sm:inline"> visualization</span>
	</>
)


/** What a menu item is waiting on: the destination-and-name dialog that
 *  precedes it. An import holds the file already chosen, and the name of
 *  the visual inside it when there is exactly one (the only case a rename
 *  box makes sense for). */
type PendingAction =
	| { kind: "keep" }
	| { kind: "fresh" }
	| { kind: "import"; file: File; singleVisualName: string | null }
	| { kind: "template"; templateId: string; keepDatasetId?: string }

/** The name of the one visual a bundle file holds, or null for anything
 *  else (several visuals, or a file the import will reject anyway — the
 *  import reports that itself). */
const singleVisualNameIn = (text: string): string | null => {
	const parsed = parseLibraryBundle(text)
	if (!parsed.ok || parsed.bundle.visuals.length !== 1) return null
	return parsed.bundle.visuals[0]?.name ?? null
}

/**
 * A split button. The main segment starts a new visualization on a clean
 * slate (no dataset, at the root); the arrow segment opens a menu: in the
 * editor with a dataset bound, carrying that dataset forward or starting
 * clean, and everywhere, starting from a template (a picker first,
 * optionally carrying the editor's data set along) or importing a JSON
 * file — one visual's "Download bundle" or a whole library bundle (the same
 * format), merged additively
 * exactly as Settings → Sharing does. Each menu item first asks what to
 * call the result and where it should go (the Move/Duplicate folder
 * picker plus a name box, pre-set to the open visual's folder or the
 * library folder being viewed).
 */
const NewVisualizationButton = () => {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	const inEditor = pathname.startsWith("/editor")
	const inLibrary = pathname === "/"
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const datasets = useAtomValue(datasetIndexAtom)
	// Only the editor can "keep" a dataset: the atom may still hold the last
	// opened one on the library page, where there is nothing to carry forward.
	const currentDataset =
		inEditor && datasetId ? datasets[datasetId] : undefined

	const folders = useAtomValue(foldersAtom)
	// Live visuals only, like the Save button: a name in the Trash is free.
	const liveVisuals = useAtomValue(liveVisualsAtom)
	const hasTemplates = liveVisuals.some((v) => isTemplate(v))
	const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
	// The picker's starting point: the open visual's folder in the editor,
	// the folder being browsed on the library page (its `?folder=` param;
	// the "unfiled" pseudo-folder means the root). Id lookup on the full
	// list — the editor's own visual.
	const currentVisualId = useAtomValue(currentVisualIdAtom)
	const visuals = useAtomValue(visualsAtom)
	const libraryFolder = useRouterState({
		select: (s) =>
			(s.location.search as Record<string, unknown> | undefined)?.folder,
	})
	const defaultFolderId = ((): string | null => {
		const candidate = inEditor
			? visuals.find((v) => v.id === currentVisualId)?.folderId
			: inLibrary && typeof libraryFolder === "string"
				? libraryFolder
				: null
		return candidate && candidate !== UNFILED_FOLDER_ID && folders.some((f) => f.id === candidate)
			? candidate
			: null
	})()
	const [pending, setPending] = useState<PendingAction | null>(null)

	const navigate = useNavigate()
	const clearDataset = useAtomCallback(
		useCallback((_get, set) => {
			set(currentDatasetIdAtom, null)
		}, [])
	)
	const { importing, importBundle } = useImportLibraryBundle()
	const [importOutcome, setImportOutcome] =
		useState<ImportBundleOutcome | null>(null)
	const importInputRef = useRef<HTMLInputElement>(null)

	const [open, setOpen] = useState(false)
	const wrapperRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const onClick = (e: MouseEvent) => {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(e.target as Node)
			) {
				setOpen(false)
			}
		}
		const id = window.setTimeout(
			() => window.addEventListener("click", onClick),
			0
		)
		return () => {
			window.clearTimeout(id)
			window.removeEventListener("click", onClick)
		}
	}, [open])

	/** Land on a fresh editor. The dataset id, destination folder and name
	 *  ride the search params so VisualLoaderForNew can re-apply them after
	 *  its reset; each is left off the URL when unset — the untouched
	 *  default name included, since the reset produces it anyway. */
	const startNew = async (
		keepDatasetId: string | undefined,
		folderId: string | null,
		name: string | null,
		templateId?: string
	) => {
		const search = {
			...(templateId ? { templateId } : {}),
			...(keepDatasetId ? { datasetId: keepDatasetId } : {}),
			...(folderId ? { folderId } : {}),
			...(name && name !== UNTITLED_VISUAL_NAME ? { name } : {}),
		}
		await navigate(
			Object.keys(search).length > 0
				? { to: "/editor/new", search }
				: { to: "/editor/new" }
		)
	}
	const runImport = async (
		file: File,
		folderId: string | null,
		visualName: string | null
	) => {
		if (importing) return
		setImportOutcome(
			await importBundle(file, { destinationFolderId: folderId, visualName })
		)
	}
	/** Run a menu action with the dialog's answers: destination folder and
	 *  (for anything that makes one visual) its name. */
	const perform = async (
		action: PendingAction,
		folderId: string | null,
		name: string | null
	) => {
		switch (action.kind) {
			case "keep":
				if (!currentDataset) return
				await startNew(currentDataset.id, folderId, name)
				return
			case "fresh":
				// Clear the bound dataset explicitly: /editor/new alone resets the
				// draft, but a dataset the editor still holds would be re-bound.
				clearDataset()
				await startNew(undefined, folderId, name)
				return
			case "import":
				await runImport(action.file, folderId, name)
				return
			case "template":
				await startNew(action.keepDatasetId, folderId, name, action.templateId)
				return
		}
	}

	/** Open the dialog — unless it would have nothing to ask (no folders
	 *  to choose from and nothing to name, i.e. a multi-visual import into
	 *  a folderless library), in which case the action just runs. */
	const request = (action: PendingAction) => {
		if (folders.length === 0 && nameFieldFor(action) === undefined) {
			void perform(action, null, null)
		} else {
			setPending(action)
		}
	}

	const onKeepDataset = () => {
		if (!currentDataset) return
		setOpen(false)
		request({ kind: "keep" })
	}
	// The main segment: always a clean slate at the root, no questions.
	const onFreshDataset = async () => {
		setOpen(false)
		await perform({ kind: "fresh" }, null, null)
	}
	const onFreshDatasetInto = () => {
		setOpen(false)
		request({ kind: "fresh" })
	}
	const onPickTemplate = () => {
		if (!hasTemplates) return
		setOpen(false)
		setTemplatePickerOpen(true)
	}
	// The picker answers WHICH template; the folder + name step follows.
	const onTemplatePicked = (templateId: string, useCurrent: boolean) => {
		setTemplatePickerOpen(false)
		request({
			kind: "template",
			templateId,
			keepDatasetId: useCurrent ? currentDataset?.id : undefined,
		})
	}
	const onPickImport = () => {
		setOpen(false)
		importInputRef.current?.click()
	}
	// The file comes first (the native picker has no room for a question);
	// the name and destination are asked once there is something to place.
	const onImportFile = async (file: File) => {
		if (importing) return
		let singleVisualName: string | null = null
		try {
			singleVisualName = singleVisualNameIn(await file.text())
		} catch {
			// Unreadable: the import itself will say so.
		}
		request({ kind: "import", file, singleVisualName })
	}
	const pickerTitle =
		pending?.kind === "import"
			? `Import ${pending.file.name}`
			: pending?.kind === "template"
				? `New from template: ${
						liveVisuals.find((v) => v.id === pending.templateId)?.name ??
						"template"
					}`
				: "New visualization"
	// New visuals must not take a live name (the Save button refuses one);
	// an import may duplicate by design, so there the clash only warns. The
	// box starts with the name the visual would get anyway — "Untitled" —
	// and that default is let through even beside an existing "Untitled",
	// exactly as the editor's reset + autosave would have filed it.
	const nameFieldFor = (action: PendingAction): NameField | undefined =>
		action.kind === "import"
			? action.singleVisualName === null
				? undefined
				: {
						label: "Name",
						initial: action.singleVisualName,
						collision: {
							test: (n) => nameCollides(n, liveVisuals),
							message:
								"A visualization with this name already exists. The import will add a second one.",
							blocks: false,
						},
					}
			: {
					label: "Name",
					// A template draft starts "Untitled" too: templates share the
					// namespace, so defaulting to the template's own name would
					// block Start every time. The template is named in the title.
					initial: UNTITLED_VISUAL_NAME,
					collision: {
						test: (n) =>
							n !== UNTITLED_VISUAL_NAME && nameCollides(n, liveVisuals),
						message: "A visualization with this name already exists.",
						blocks: true,
					},
				}
	const nameField = pending === null ? undefined : nameFieldFor(pending)

	// Escape closes the menu and hands focus back to the arrow segment, so a
	// keyboard user isn't stranded on a menu item that just disappeared.
	const onMenuKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== "Escape" || !open) return
		e.stopPropagation()
		setOpen(false)
		wrapperRef.current
			?.querySelector<HTMLElement>("[aria-haspopup=menu]")
			?.focus()
	}

	return (
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape-to-close for the menu below; the interactive elements are the buttons inside
		<div className="relative" ref={wrapperRef} onKeyDown={onMenuKeyDown}>
			<div className="flex">
				<Button
					compact
					className="rounded-r-none whitespace-nowrap"
					onClick={onFreshDataset}
					title="Start a new visualization"
					data-tip="new-visual"
				>
					<NewVisualizationLabel />
				</Button>
				<Button
					compact
					className="rounded-l-none border-l border-l-white/30 px-2"
					onClick={() => setOpen((v) => !v)}
					aria-label="More ways to start"
					data-tip="new-visual-menu"
					aria-haspopup="menu"
					aria-expanded={open}
				>
					<DisclosureChevron open={open} />
				</Button>
			</div>
			{open && (
				<div className={MENU_PANEL} role="menu">
					{currentDataset && (
						<>
							<button
								type="button"
								role="menuitem"
								onClick={onKeepDataset}
								className={MENU_ITEM}
							>
								<div className={MENU_TITLE}>New with this data set</div>
								<div className={MENU_HINT}>
									Keep {currentDataset.name}; clear encodings and styling.
								</div>
							</button>
							{/* Same as the main segment — listed here so the editor's
							 *  menu spells out both ways to start side by side. */}
							<button
								type="button"
								role="menuitem"
								onClick={onFreshDatasetInto}
								className={MENU_ITEM_DIVIDED}
							>
								<div className={MENU_TITLE}>New with a new data set</div>
								<div className={MENU_HINT}>
									Totally clean slate — upload a CSV to start.
								</div>
							</button>
						</>
					)}
					<button
						type="button"
						role="menuitem"
						onClick={onPickTemplate}
						disabled={!hasTemplates}
						title={
							hasTemplates
								? undefined
								: "Save a template from the editor's Save menu first"
						}
						className={currentDataset ? MENU_ITEM_DIVIDED : MENU_ITEM}
					>
						<div className={MENU_TITLE}>New from template…</div>
						<div className={MENU_HINT}>
							Start from a saved design, then attach data.
						</div>
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={onPickImport}
						disabled={importing}
						className={MENU_ITEM_DIVIDED}
					>
						<div className={MENU_TITLE}>
							{importing ? "Importing…" : "Import from JSON…"}
						</div>
						<div className={MENU_HINT}>
							Add a downloaded visualization or library bundle to your
							library.
						</div>
					</button>
				</div>
			)}
			<input
				ref={importInputRef}
				type="file"
				accept="application/json,.json"
				className="hidden"
				aria-label="Import visualization JSON"
				onChange={(e) => {
					const file = e.target.files?.[0]
					e.target.value = ""
					if (file) void onImportFile(file)
				}}
			/>
			<TemplatePickerModal
				open={templatePickerOpen}
				onClose={() => setTemplatePickerOpen(false)}
				onPick={onTemplatePicked}
				currentDatasetName={currentDataset?.name}
			/>
			<FolderPickerModal
				open={pending !== null}
				title={pickerTitle}
				confirmLabel={pending?.kind === "import" ? "Import" : "Start"}
				initialTarget={defaultFolderId}
				nameField={nameField}
				onCancel={() => setPending(null)}
				onConfirm={(folderId, name) => {
					const action = pending
					setPending(null)
					if (action) void perform(action, folderId, name || null)
				}}
			/>
			<ImportOutcomeModal
				outcome={importOutcome}
				showOpenLibrary={!inLibrary}
				onClose={() => setImportOutcome(null)}
				onOpenLibrary={async () => {
					setImportOutcome(null)
					await navigate({ to: "/" })
				}}
			/>
		</div>
	)
}

/** The header has no status line to report into (unlike Settings →
 *  Sharing), so an import's result is acknowledged in a dialog. Away from
 *  the library the imported work isn't on screen, so a success there also
 *  offers to go look at it. */
const ImportOutcomeModal = ({
	outcome,
	showOpenLibrary,
	onClose,
	onOpenLibrary,
}: {
	outcome: ImportBundleOutcome | null
	showOpenLibrary: boolean
	onClose: () => void
	onOpenLibrary: () => void
}) => (
	<Modal
		open={outcome !== null}
		onClose={onClose}
		title={outcome?.ok ? "Import complete" : "Import failed"}
	>
		<div className="flex flex-col gap-4">
			<div className="text-sm vc-text">
				{outcome?.message}
			</div>
			{outcome?.problems && <ImportProblemList problems={outcome.problems} />}
			<div className="flex justify-end gap-2">
				{outcome?.ok && showOpenLibrary && (
					<Button compact onClick={onOpenLibrary}>
						Open library
					</Button>
				)}
				<Button compact onClick={onClose}>
					Got it
				</Button>
			</div>
		</div>
	</Modal>
)

/** Wrapper that only mounts the B&W preview and accessibility check
 * toggles on editor routes — the landing and settings pages have no chart
 * for them to apply to. */
const EditorOnlyBlackAndWhiteToggle = () => {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	if (!pathname.startsWith("/editor")) return null
	return (
		<>
			<BlackAndWhiteToggle />
			<AccessibilityCheckToggle />
		</>
	)
}

/** Top-bar toggle for the accessibility check (AccessibilityCheckPanel):
 * while on, a card over the chart lists what may be inaccessible. The
 * badge repeats the finding count the card's heading announces, so it is
 * aria-hidden. State is in-memory only. */
const AccessibilityCheckToggle = () => {
	const [active, setActive] = useAtom(accessibilityCheckAtom)
	const count = useAtomValue(accessibilityFindingCountAtom)
	return (
		<button
			type="button"
			onClick={() => setActive(!active)}
			title="Accessibility check"
			aria-label="Accessibility check"
			data-tip="a11y-check"
			aria-pressed={active}
			className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
				active
					? "vc-toggle-on"
					: "hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-white vc-muted"
			}`}
		>
			<svg
				viewBox="0 0 20 20"
				width={18}
				height={18}
				aria-hidden="true"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.6}
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx={10} cy={3.6} r={1.6} fill="currentColor" stroke="none" />
				<path d="M3.5 7l6.5 1.2L16.5 7M10 8.2v4.3m0 0L7 18m3-5.5L13 18" />
			</svg>
			{active && count > 0 && (
				<span
					aria-hidden="true"
					className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-xs leading-none font-semibold text-white"
				>
					{count > 99 ? "99+" : count}
				</span>
			)}
		</button>
	)
}

/** Top-bar toggle that flips a `grayscale(1)` filter on the chart wrapper —
 * a quick visual check ("does my color encoding still read in B&W?")
 * without altering the saved theme. State is in-memory only. */
const BlackAndWhiteToggle = () => {
	const [active, setActive] = useAtom(blackAndWhiteModeAtom)
	return (
		<button
			type="button"
			onClick={() => setActive(!active)}
			title={
				active
					? "Disable black-and-white preview"
					: "Black-and-white preview"
			}
			aria-pressed={active}
			data-tip="bw-toggle"
			className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
				active
					? "vc-toggle-on"
					: "hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-white vc-muted"
			}`}
		>
			<svg
				viewBox="0 0 20 20"
				width={18}
				height={18}
				aria-hidden="true"
				fill="currentColor"
			>
				<path d="M10 2a8 8 0 100 16V2z" />
				<circle
					cx={10}
					cy={10}
					r={8}
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
				/>
			</svg>
		</button>
	)
}
