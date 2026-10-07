import { forwardRef } from "react"
import { combine as c } from "../../lib/cls"

// Generic text input / textarea with the same Tailwind treatment used
// across the app (sidebar panels, settings pages, modals). Keeps form
// styling consistent — sidebar call sites must use these (or NumberInput /
// Select) rather than hand-rolling a bordered <input>; the few deliberate
// exceptions are the borderless SaveBar title and the inline-rename boxes.

/** Shared box treatment for Input, Textarea and Select (Select.tsx keeps
 *  its own copy minus the placeholder variants). */
const INPUT_CLASS =
	"min-w-0 rounded-control border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 transition-colors outline-none placeholder:text-stone-400 hover:border-stone-400 focus:border-stone-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:placeholder:text-stone-500 dark:hover:border-stone-600 dark:focus:border-stone-500"

export type InputProps = Omit<JSX.IntrinsicElements["input"], "ref">
export type TextareaProps = Omit<JSX.IntrinsicElements["textarea"], "ref">

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
	{ className, type = "text", ...p },
	ref
) {
	return (
		<input
			ref={ref}
			type={type}
			className={c(INPUT_CLASS, className)}
			{...p}
		/>
	)
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
	function Textarea({ className, ...p }, ref) {
		return <textarea ref={ref} className={c(INPUT_CLASS, className)} {...p} />
	}
)
