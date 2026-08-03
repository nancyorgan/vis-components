import { useSetAtom } from "jotai"
import { duplicateVisual } from "../../chartBuilder/lib/duplicateVisual"
import { visualsAtom } from "../../chartBuilder/store/atoms"

type Props = {
	visualId: string
	visualName: string
}

const CopyIcon = () => (
	<svg
		viewBox="0 0 16 16"
		width={12}
		height={12}
		aria-hidden="true"
		fill="currentColor"
	>
		<path d="M5 1.5A1.5 1.5 0 016.5 0h5A1.5 1.5 0 0113 1.5v7A1.5 1.5 0 0111.5 10h-5A1.5 1.5 0 015 8.5v-7zm1.5-.5a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h5a.5.5 0 00.5-.5v-7a.5.5 0 00-.5-.5h-5z" />
		<path d="M3 5.5a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V12h1v1.5A1.5 1.5 0 018 15H3a1.5 1.5 0 01-1.5-1.5v-7A1.5 1.5 0 013 5h1v1H3z" />
	</svg>
)

/**
 * Hover-over-tile button that drops an independent copy of a visual into the
 * library. Non-destructive, so it acts immediately without a confirmation
 * modal (unlike delete).
 */
export const DuplicateVisualButton = ({ visualId, visualName }: Props) => {
	const setVisuals = useSetAtom(visualsAtom)

	const onClick = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setVisuals((prev) => {
			const original = prev.find((v) => v.id === visualId)
			if (!original) return prev
			return [duplicateVisual(original), ...prev]
		})
	}

	return (
		<button
			type="button"
			onClick={onClick}
			title="Duplicate visualization"
			aria-label={`Duplicate ${visualName}`}
			className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-stone-500 shadow-sm ring-1 ring-stone-200 hover:bg-stone-100 hover:text-stone-700 dark:bg-stone-800/90 dark:text-stone-400 dark:ring-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
		>
			<CopyIcon />
		</button>
	)
}
