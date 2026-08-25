import { useState } from "react"
import { useAtomValue } from "jotai"
import { foldersAtom } from "../../chartBuilder/store/atoms"
import { folderTreeOrder } from "../lib/folderOrder"

type MoveToFolderButtonProps = {
	visualId: string
	currentFolderId: string | null
	onMove: (visualId: string, folderId: string | null) => void
}

export const MoveToFolderButton = ({
	visualId,
	currentFolderId,
	onMove,
}: MoveToFolderButtonProps) => {
	const folders = useAtomValue(foldersAtom)
	const [open, setOpen] = useState(false)

	if (folders.length === 0) return null

	return (
		<div className="relative">
			<button
				type="button"
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					setOpen(!open)
				}}
				className="rounded bg-white/90 px-1.5 py-0.5 text-sm text-stone-600 shadow-sm ring-1 ring-stone-200 hover:bg-white dark:bg-stone-800/90 dark:text-stone-300 dark:ring-stone-700"
			>
				Move
			</button>
			{open && (
				<div
					className="absolute top-full right-0 z-20 mt-1 max-h-48 w-44 overflow-y-auto rounded border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
					// click here only stops propagation so menu clicks don't
					// reach the card link underneath; the buttons inside are
					// the real (keyboard-accessible) interactions
					onClick={(e) => e.stopPropagation()}
					role="presentation"
				>
					<button
						type="button"
						onClick={(e) => {
							e.preventDefault()
							onMove(visualId, null)
							setOpen(false)
						}}
						className={`w-full px-3 py-1 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700 ${
							currentFolderId === null
								? "font-medium text-blue-600"
								: "text-stone-700 dark:text-stone-300"
						}`}
					>
						Root (no folder)
					</button>
					{folderTreeOrder(folders).map(({ folder: f, depth }) => (
						<button
							key={f.id}
							type="button"
							onClick={(e) => {
								e.preventDefault()
								onMove(visualId, f.id)
								setOpen(false)
							}}
							className={`w-full px-3 py-1 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700 ${
								currentFolderId === f.id
									? "font-medium text-blue-600"
									: "text-stone-700 dark:text-stone-300"
							}`}
							style={{ paddingLeft: `${12 + depth * 12}px` }}
						>
							{f.name}
						</button>
					))}
				</div>
			)}
		</div>
	)
}
