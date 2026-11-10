import { useMemo, useState } from "react"
import { useAtomValue } from "jotai"

import { Button } from "../../../components/ui/Button"
import { Checkbox } from "../../../components/ui/Checkbox"
import { Modal } from "../../../components/ui/Modal"
import type { Visual } from "../../chartBuilder/lib/types"
import { isTemplate } from "../../chartBuilder/lib/visualTrash"
import { foldersAtom, liveVisualsAtom } from "../../chartBuilder/store/atoms"
import { folderTreeOrder } from "../lib/folderOrder"
import { folderSelectionPredicate } from "../lib/folderSubtree"

// Cards borrow the Themes gallery's look (ThemesGalleryPage `CARD_GRID` /
// `cardClass`), narrowed so two or three fit beside the rail.
const CARD_GRID =
	"grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-3"
const CARD =
	"block w-full overflow-hidden rounded-card border bg-white text-left shadow-sm transition-shadow hover:shadow-md dark:bg-stone-800"
const CARD_IDLE = "border-stone-200 dark:border-stone-700"
const CARD_SELECTED =
	"border-brand-500 ring-2 ring-brand-400 dark:border-brand-400 dark:ring-brand-500"
const RAIL_ITEM = "block w-full truncate rounded px-2 py-1 text-left text-sm"
const RAIL_IDLE = "vc-muted hover:bg-stone-100 dark:hover:bg-stone-800"

/**
 * "New from template…": pick the template a new visual starts from. The
 * rail lists "All templates" plus every folder whose subtree holds a live
 * template (library semantics: a folder shows its whole subtree), in the
 * library tree's order; the grid shows the selected folder's templates.
 * Click selects, double-click / Enter / "Use template" picks. When the
 * editor already has a data set, a checkbox passes it along so the snap
 * happens at once.
 */
export const TemplatePickerModal = ({
	open,
	onClose,
	onPick,
	currentDatasetName,
}: {
	open: boolean
	onClose: () => void
	onPick: (templateId: string, useCurrentDataset: boolean) => void
	/** The editor's bound data set; absent hides the checkbox. */
	currentDatasetName?: string
}) => (
	<Modal
		open={open}
		onClose={onClose}
		title="New from template"
		widthClass="max-w-4xl"
		panelClassName="flex h-[70vh] max-h-[640px] flex-col"
		bodyClassName="flex min-h-0 flex-1 flex-col"
	>
		{/* Modal unmounts its children while closed, so each opening starts
		 *  with a fresh selection. */}
		<PickerBody
			onClose={onClose}
			onPick={onPick}
			currentDatasetName={currentDatasetName}
		/>
	</Modal>
)

const PickerBody = ({
	onClose,
	onPick,
	currentDatasetName,
}: {
	onClose: () => void
	onPick: (templateId: string, useCurrentDataset: boolean) => void
	currentDatasetName?: string
}) => {
	const liveVisuals = useAtomValue(liveVisualsAtom)
	const folders = useAtomValue(foldersAtom)
	const templates = useMemo(
		() => liveVisuals.filter((v) => isTemplate(v)),
		[liveVisuals]
	)
	const railFolders = useMemo(
		() =>
			folderTreeOrder(folders).filter(({ folder }) => {
				const inFolder = folderSelectionPredicate(folders, folder.id)
				return templates.some((t) => inFolder(t.folderId))
			}),
		[folders, templates]
	)

	const [folderId, setFolderId] = useState<string | null>(null)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [useCurrent, setUseCurrent] = useState(false)

	const shown = useMemo(() => {
		const inFolder = folderSelectionPredicate(folders, folderId)
		return templates
			.filter((t) => inFolder(t.folderId))
			.sort((a, b) => a.name.localeCompare(b.name))
	}, [folders, folderId, templates])

	const pick = (id: string | null) => {
		if (id === null || !templates.some((t) => t.id === id)) return
		onPick(id, currentDatasetName !== undefined && useCurrent)
	}

	return (
		<>
			{templates.length === 0 ? (
				<p className="flex flex-1 items-center justify-center text-sm vc-faint">
					No templates yet. Save one from the editor&apos;s Save menu.
				</p>
			) : (
				<div className="flex min-h-0 flex-1 gap-4">
					<nav
						aria-label="Template folders"
						className="flex w-48 flex-shrink-0 flex-col gap-0.5 overflow-y-auto"
					>
						<RailItem
							label="All templates"
							depth={0}
							active={folderId === null}
							onClick={() => setFolderId(null)}
						/>
						{railFolders.map(({ folder, depth }) => (
							<RailItem
								key={folder.id}
								label={folder.name}
								depth={depth}
								active={folderId === folder.id}
								onClick={() => setFolderId(folder.id)}
							/>
						))}
					</nav>
					<div className="min-h-0 flex-1 overflow-y-auto p-1">
						<ul className={CARD_GRID} aria-label="Templates">
							{shown.map((t) => (
								<li key={t.id}>
									<TemplateCard
										template={t}
										selected={selectedId === t.id}
										onSelect={() => setSelectedId(t.id)}
										onPick={() => pick(t.id)}
									/>
								</li>
							))}
						</ul>
					</div>
				</div>
			)}
			<div className="mt-4 flex items-center gap-4 border-t border-stone-200 pt-4 dark:border-stone-700">
				{currentDatasetName !== undefined && templates.length > 0 && (
					<Checkbox
						label={`Use the current data set (${currentDatasetName})`}
						checked={useCurrent}
						onChange={setUseCurrent}
					/>
				)}
				<div className="ml-auto flex gap-2">
					<Button compact onClick={onClose}>
						Cancel
					</Button>
					<Button
						compact
						disabled={selectedId === null}
						onClick={() => pick(selectedId)}
					>
						Use template
					</Button>
				</div>
			</div>
		</>
	)
}

const RailItem = ({
	label,
	depth,
	active,
	onClick,
}: {
	label: string
	depth: number
	active: boolean
	onClick: () => void
}) => (
	<button
		type="button"
		onClick={onClick}
		aria-current={active ? "true" : undefined}
		className={`${RAIL_ITEM} ${active ? "vc-nav-active" : RAIL_IDLE}`}
		style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
		title={label}
	>
		{label}
	</button>
)

const TemplateCard = ({
	template,
	selected,
	onSelect,
	onPick,
}: {
	template: Visual
	selected: boolean
	onSelect: () => void
	onPick: () => void
}) => {
	const fieldCount = template.template?.sourceFields.length ?? 0
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			onDoubleClick={onPick}
			onKeyDown={(e) => {
				// Enter picks the focused card; Space keeps the native select.
				if (e.key !== "Enter") return
				e.preventDefault()
				onPick()
			}}
			className={`${CARD} ${selected ? CARD_SELECTED : CARD_IDLE}`}
		>
			<div
				className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-stone-50 dark:bg-stone-900"
				style={
					template.channelConfigs?.backgroundColor
						? { backgroundColor: template.channelConfigs.backgroundColor }
						: undefined
				}
			>
				{template.thumbnail ? (
					<img
						src={template.thumbnail}
						alt=""
						draggable={false}
						className="h-full w-full object-contain"
					/>
				) : (
					<div className="text-sm vc-faint">No preview</div>
				)}
			</div>
			<div className="flex flex-col gap-0.5 px-3 py-2">
				<div className="truncate text-sm vc-heading font-medium">
					{template.name}
				</div>
				<div className="text-xs vc-muted">
					{fieldCount} {fieldCount === 1 ? "field" : "fields"}
				</div>
			</div>
		</button>
	)
}
