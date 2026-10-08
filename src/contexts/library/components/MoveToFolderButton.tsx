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
				className="vc-library-tile-move rounded px-1.5 py-0.5 text-sm"
			>
				Move
			</button>
			{open && (
				<div
					className="vc-popover-soft absolute top-full right-0 z-20 mt-1 max-h-48 w-44 overflow-y-auto py-1"
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
						className={`vc-menu-item py-1 ${
							currentFolderId === null
								? "vc-library-menu-current font-medium"
								: "vc-text-2"
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
							className={`vc-menu-item py-1 ${
								currentFolderId === f.id
									? "vc-library-menu-current font-medium"
									: "vc-text-2"
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
