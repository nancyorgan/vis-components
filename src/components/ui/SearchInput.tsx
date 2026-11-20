import { Input, type InputProps } from "./Input"

/** A text `Input` with a magnifier inside its left edge, for the library's
 *  "filter this list as I type" boxes. `className` sizes the wrapper
 *  (`w-full sm:w-64`); the input fills it. */
export const SearchInput = ({ className, ...p }: InputProps) => (
	<div className={`relative ${className ?? ""}`}>
		<svg
			viewBox="0 0 16 16"
			width={14}
			height={14}
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.6}
			strokeLinecap="round"
			className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 vc-muted"
		>
			<circle cx={7} cy={7} r={4.5} />
			<path d="m10.5 10.5 3 3" />
		</svg>
		<Input {...p} className="w-full pl-7" />
	</div>
)
