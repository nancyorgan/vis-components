import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react"
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
export type TextareaProps = Omit<JSX.IntrinsicElements["textarea"], "ref"> & {
	/** Grow the box to fit its content so long text never needs the
	 *  resize handle dragged open. `rows` stays the minimum height; the
	 *  manual resize grip is removed (a drag would be undone on the next
	 *  keystroke). Re-measures when the value changes, the box's width
	 *  changes (sidebar resize → different wrapping) and when webfonts
	 *  finish loading. */
	autoSize?: boolean
}

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

/** Fit a textarea's height to its content. Collapses to `auto` first so
 *  the box can shrink when text is deleted. happy-dom reports a 0
 *  scrollHeight (no layout), so a 0 measurement leaves the height alone
 *  rather than collapsing the box. */
const fitTextareaHeight = (el: HTMLTextAreaElement) => {
	el.style.height = "auto"
	const h = el.scrollHeight
	if (h <= 0) return
	// scrollHeight excludes the border but `height` (border-box) includes
	// it; without the correction the last line's descenders get clipped.
	el.style.height = `${h + el.offsetHeight - el.clientHeight}px`
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
	function Textarea({ className, autoSize = false, value, ...p }, ref) {
		const inner = useRef<HTMLTextAreaElement>(null)
		useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement)

		useLayoutEffect(() => {
			const el = inner.current
			if (!autoSize || !el) return
			fitTextareaHeight(el)
		}, [autoSize, value])

		useLayoutEffect(() => {
			const el = inner.current
			if (!autoSize || !el) return
			const refit = () => fitTextareaHeight(el)
			// Width changes re-wrap the text; webfont swaps change line
			// metrics. Both leave `value` unchanged, so they need their own
			// triggers.
			const ro =
				typeof ResizeObserver !== "undefined"
					? new ResizeObserver(refit)
					: null
			ro?.observe(el)
			const fonts = typeof document !== "undefined" ? document.fonts : undefined
			fonts?.addEventListener?.("loadingdone", refit)
			return () => {
				ro?.disconnect()
				fonts?.removeEventListener?.("loadingdone", refit)
			}
		}, [autoSize])

		return (
			<textarea
				ref={inner}
				value={value}
				className={c(
					INPUT_CLASS,
					autoSize && "resize-none overflow-hidden",
					className
				)}
				{...p}
			/>
		)
	}
)
