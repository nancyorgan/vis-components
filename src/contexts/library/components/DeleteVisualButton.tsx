import { useTrashVisuals } from "../../chartBuilder/store/useDeleteVisuals"

type Props = {
	visualId: string
	visualName: string
	/** `icon` for the hover-over-tile treatment; `text` for the table row. */
	variant?: "icon" | "text"
}

export const TrashIcon = ({ size = 12 }: { size?: number }) => (
	<svg
		viewBox="0 0 16 16"
		width={size}
		height={size}
		aria-hidden="true"
		fill="currentColor"
	>
		<path d="M5.5 1h5a.5.5 0 01.5.5V2h3a.5.5 0 010 1h-.66l-.64 10.27A2 2 0 0110.7 15H5.3a2 2 0 01-1.99-1.73L2.66 3H2a.5.5 0 010-1h3v-.5a.5.5 0 01.5-.5zM6 2v.5h4V2H6zM4.41 13.14a1 1 0 00.99.86h5.2a1 1 0 00.99-.86L12.28 3H3.72l.69 10.14zM6 5.5a.5.5 0 011 0v6a.5.5 0 01-1 0v-6zm3 0a.5.5 0 011 0v6a.5.5 0 01-1 0v-6z" />
	</svg>
)

/** Moves one visual to the Trash. No confirm step: the Trash (the floating
 * can on the library page) restores it in one click, and nothing cascades
 * until it is purged from there. */
export const DeleteVisualButton = ({
	visualId,
	visualName,
	variant = "icon",
}: Props) => {
	const trashVisuals = useTrashVisuals()

	if (variant === "icon") {
		return (
			<button
				type="button"
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					trashVisuals([visualId])
				}}
				title="Move to trash"
				aria-label={`Move ${visualName} to trash`}
				className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-stone-500 shadow-sm ring-1 ring-stone-200 hover:bg-red-50 hover:text-red-700 dark:bg-stone-800/90 dark:text-stone-400 dark:ring-stone-700 dark:hover:bg-red-900/30 dark:hover:text-red-300"
			>
				<TrashIcon />
			</button>
		)
	}
	return (
		<button
			type="button"
			onClick={() => trashVisuals([visualId])}
			title="Move to trash"
			className="text-sm text-stone-500 hover:text-red-700 dark:text-stone-400 dark:hover:text-red-300"
		>
			Delete
		</button>
	)
}
