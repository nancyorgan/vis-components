import { CopyIcon } from "../../../components/ui/CopyButton"

type Props = {
	visualId: string
	visualName: string
	/** Opens the destination picker; the page does the actual copy. */
	onDuplicate: (visualId: string) => void
}

/**
 * Hover-over-tile button that asks where to put an independent copy of a
 * visual (the picker defaults to the original's folder).
 */
export const DuplicateVisualButton = ({
	visualId,
	visualName,
	onDuplicate,
}: Props) => {
	const onClick = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		onDuplicate(visualId)
	}

	return (
		<button
			type="button"
			onClick={onClick}
			title="Duplicate"
			aria-label={`Duplicate ${visualName}`}
			className="flex h-6 w-6 items-center justify-center rounded bg-white/90 shadow-sm ring-1 ring-stone-200 hover:bg-stone-100 hover:text-stone-700 dark:bg-stone-800/90 dark:ring-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200 vc-muted"
		>
			<CopyIcon />
		</button>
	)
}
