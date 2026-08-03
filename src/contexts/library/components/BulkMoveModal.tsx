import { useState } from "react"
import { useAtomValue } from "jotai"
import { foldersAtom } from "../../chartBuilder/store/atoms"

import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"

type Props = {
	open: boolean
	count: number
	onCancel: () => void
	onConfirm: (folderId: string | null) => void
}

export const BulkMoveModal = ({ open, count, onCancel, onConfirm }: Props) => {
	const folders = useAtomValue(foldersAtom)
	const [target, setTarget] = useState<string | null>(null)

	const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name))

	return (
		<Modal
			open={open}
			onClose={onCancel}
			title={`Move ${count} visualization${count === 1 ? "" : "s"}`}
			widthClass="max-w-md"
		>
			<div className="flex flex-col gap-4">
				<p className="text-sm text-stone-700 dark:text-stone-300">
					Pick a destination folder.
				</p>
				<div className="max-h-64 overflow-y-auto rounded border border-stone-200 dark:border-stone-700">
					<button
						type="button"
						onClick={() => setTarget(null)}
						className={`w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700 ${
							target === null
								? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
								: "text-stone-700 dark:text-stone-300"
						}`}
					>
						Root (no folder)
					</button>
					{sorted.map((f) => (
						<button
							key={f.id}
							type="button"
							onClick={() => setTarget(f.id)}
							className={`w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700 ${
								target === f.id
									? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
									: "text-stone-700 dark:text-stone-300"
							}`}
							style={{
								paddingLeft: `${12 + (f.parentId ? 12 : 0)}px`,
							}}
						>
							{f.name}
						</button>
					))}
				</div>
				<div className="flex justify-end gap-2">
					<Button compact outline onClick={onCancel}>
						Cancel
					</Button>
					<Button compact onClick={() => onConfirm(target)}>
						Move
					</Button>
				</div>
			</div>
		</Modal>
	)
}
