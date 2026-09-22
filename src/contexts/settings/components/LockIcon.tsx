/** The small padlock that marks Managed Themes — in the settings rail's
 *  folder header and rows, and on the gallery cards. */
export const LockIcon = ({ size = 10 }: { size?: number }) => (
	<svg
		viewBox="0 0 12 12"
		width={size}
		height={size}
		aria-hidden="true"
		className="flex-shrink-0"
	>
		<path
			d="M3.25 5.25V3.75a2.75 2.75 0 015.5 0v1.5"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			strokeLinecap="round"
		/>
		<rect
			x="2.25"
			y="5.25"
			width="7.5"
			height="5"
			rx="1"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
		/>
	</svg>
)
