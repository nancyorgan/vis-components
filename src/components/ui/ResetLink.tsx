/** Small inline "reset" link, rendered only when a control differs from its
 *  default. The shared home for the idiom previously copy-pasted across the
 *  sidebar panels (LabelsPanel / CaptionPanel / OpacityOptionsPanel / …).
 *  `underline` covers the second in-tree variant of the same link;
 *  `className` appends extra classes (e.g. `self-start` so the link doesn't
 *  stretch inside a flex column). */
export const ResetLink = ({
	onClick,
	underline = false,
	label = "reset",
	className,
}: {
	onClick: () => void
	underline?: boolean
	label?: string
	className?: string
}) => (
	<button
		type="button"
		onClick={onClick}
		className={
			"text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white" +
			(underline ? " underline" : "") +
			(className ? ` ${className}` : "")
		}
	>
		{label}
	</button>
)
