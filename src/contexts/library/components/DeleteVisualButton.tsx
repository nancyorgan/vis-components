import { useState } from "react"
import { useSetAtom } from "jotai"
import { removeInstancesForVisual } from "../../chartBuilder/lib/embedInstances"
import { embedInstancesAtom, visualsAtom } from "../../chartBuilder/store/atoms"

import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"

type Props = {
	visualId: string
	visualName: string
	/** `icon` for the hover-over-tile treatment; `text` for the table row. */
	variant?: "icon" | "text"
}

const TrashIcon = () => (
	<svg
		viewBox="0 0 16 16"
		width={12}
		height={12}
		aria-hidden="true"
		fill="currentColor"
	>
		<path d="M5.5 1h5a.5.5 0 01.5.5V2h3a.5.5 0 010 1h-.66l-.64 10.27A2 2 0 0110.7 15H5.3a2 2 0 01-1.99-1.73L2.66 3H2a.5.5 0 010-1h3v-.5a.5.5 0 01.5-.5zM6 2v.5h4V2H6zM4.41 13.14a1 1 0 00.99.86h5.2a1 1 0 00.99-.86L12.28 3H3.72l.69 10.14zM6 5.5a.5.5 0 011 0v6a.5.5 0 01-1 0v-6zm3 0a.5.5 0 011 0v6a.5.5 0 01-1 0v-6z" />
	</svg>
)

export const DeleteVisualButton = ({
	visualId,
	visualName,
	variant = "icon",
}: Props) => {
	const [open, setOpen] = useState(false)
	const setVisuals = useSetAtom(visualsAtom)
	const setEmbedInstances = useSetAtom(embedInstancesAtom)

	const onConfirm = () => {
		setVisuals((prev) => prev.filter((v) => v.id !== visualId))
		// Cascade: drop every embed instance belonging to this visual so the
		// landing page doesn't keep referring to a now-missing id.
		setEmbedInstances((prev) => removeInstancesForVisual(prev, visualId))
		setOpen(false)
	}

	const trigger =
		variant === "icon" ? (
			<button
				type="button"
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					setOpen(true)
				}}
				title="Delete visualization"
				aria-label={`Delete ${visualName}`}
				className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-stone-500 shadow-sm ring-1 ring-stone-200 hover:bg-red-50 hover:text-red-700 dark:bg-stone-800/90 dark:text-stone-400 dark:ring-stone-700 dark:hover:bg-red-900/30 dark:hover:text-red-300"
			>
				<TrashIcon />
			</button>
		) : (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="text-sm text-stone-500 hover:text-red-700 dark:text-stone-400 dark:hover:text-red-300"
			>
				Delete
			</button>
		)

	return (
		<>
			{trigger}
			<Modal
				open={open}
				onClose={() => setOpen(false)}
				title="Delete visualization?"
				widthClass="max-w-md"
			>
				<div className="flex flex-col gap-4">
					<p className="text-sm text-stone-700 dark:text-stone-300">
						Are you sure you want to delete{" "}
						<span className="font-medium text-stone-900 dark:text-white">
							{visualName}
						</span>
						? This can&rsquo;t be undone. Any iframe embeds pointing to this
						visualization will stop working.
					</p>
					<div className="flex justify-end gap-2">
						<Button compact outline onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<button
							type="button"
							onClick={onConfirm}
							className="rounded-sm bg-red-600 px-3 py-1.5 text-sm font-medium tracking-wider text-white shadow transition-all hover:bg-red-700 hover:shadow-lg"
						>
							Yes, delete this visualization
						</button>
					</div>
				</div>
			</Modal>
		</>
	)
}
