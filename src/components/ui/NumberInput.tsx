import { useEffect, useId, useRef, useState } from "react"
import { combine as c } from "../../lib/cls"

import { LabeledField } from "./LabeledField"

/** Numeric input bound to a controlled `value`, with optional min/max/step
 *  guards and a label that's properly associated via `<label htmlFor>`.
 *
 *  Clamping is OPT-IN via `clamp: true` — without it, the input simply
 *  reports raw user input through `onChange` (so a panel that wants to
 *  validate-on-blur can do its own thing). With clamp on, we coerce the
 *  parsed number into [min, max] before firing `onChange`.
 *
 *  Implementation note: this is a `type="text"` input (with
 *  `inputMode="decimal"`) backed by a local string draft — NOT a native
 *  `type="number"`. A controlled number input can't hold a lone "-" or a
 *  trailing "." mid-edit (the browser reports `value === ""`, so React
 *  snaps the field back to the committed number and you can't type a
 *  leading minus). The draft lets the user type "-", "1.", "-0.5", etc.
 *  freely; we commit to `onChange` only once the text parses to a finite
 *  number. Custom ▲▼ spinner buttons (and the Up/Down arrow keys) step by
 *  `step`, replacing the native number-input spinners that a text input
 *  doesn't provide — so users keep click-to-step AND can type negatives. */
export const NumberInput = ({
	id,
	label,
	value,
	onChange,
	min,
	max,
	step,
	clamp,
	disabled,
	className,
	inputClassName,
	labelClassName,
	inline,
	placeholder,
	suffix,
	changed,
}: {
	/** Optional — auto-generated when omitted. Pass an explicit id when
	 *  the caller needs to reference it elsewhere (e.g. ARIA wiring). */
	id?: string
	label: React.ReactNode
	value: number
	onChange: (next: number) => void
	min?: number
	max?: number
	step?: number
	clamp?: boolean
	disabled?: boolean
	className?: string
	inputClassName?: string
	/** Tailwind classes applied to the `<label>` element — used to pin a
	 *  width / color so multiple rows in the same panel line up. */
	labelClassName?: string
	inline?: boolean
	placeholder?: string
	/** Optional unit indicator rendered to the right of the input — e.g.
	 *  "px", "%", "°". Plain string, not a click target. */
	suffix?: React.ReactNode
	/** Shows the per-line "changed" dot in front of the label (see
	 *  `LabeledField`). */
	changed?: boolean
}) => {
	// useId guarantees a stable id across renders without callers having
	// to thread one through; SSR-safe (React handles hydration).
	const generatedId = useId()
	const inputId = id ?? generatedId

	// Local edit buffer. `null` means "not editing" → the field mirrors the
	// committed `value` prop. A string means the user is mid-edit and we show
	// their raw text verbatim (including partial states like "-" or "1.").
	const [draft, setDraft] = useState<string | null>(null)

	// Drop a stale draft when `value` changes from OUTSIDE the field — a reset
	// button, loading another visual, or a sibling control. During typing the
	// draft's parsed number already equals `value` (every keystroke commits),
	// so this fires only for genuinely external changes: it never interrupts an
	// in-progress edit, and a partial "-" / "." draft leaves `value` untouched
	// (no commit) so the effect doesn't run. Without it, e.g. stepping the
	// spinner to 5 then hitting a reset-to-0 button leaves "5" showing while
	// the committed value is 0.
	useEffect(() => {
		if (draft === null) return
		const parsed = Number(draft.trim())
		if (!Number.isFinite(parsed) || parsed !== value) setDraft(null)
		// Only react to external `value` changes; `draft` is intentionally omitted.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value])

	// Coerce a number into [min, max]. Used unconditionally by the spinner /
	// arrow-key steppers (stepping should never overshoot a bound), and by
	// commit() only when `clamp` is opted in.
	const clampToBounds = (raw: number): number => {
		let next = raw
		if (typeof min === "number" && next < min) next = min
		if (typeof max === "number" && next > max) next = max
		return next
	}

	const applyClamp = (raw: number): number =>
		clamp ? clampToBounds(raw) : raw

	// Commit the draft text if it parses to a finite number. Partial inputs
	// ("", "-", ".", "-.") are intentionally NOT committed — they're valid
	// way-points toward a real number. Returns the clamped commit so the
	// caller can reflect it back into the draft when clamping kicked in.
	const commit = (text: string): number | null => {
		const trimmed = text.trim()
		if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.")
			return null
		const raw = Number(trimmed)
		if (!Number.isFinite(raw)) return null
		const next = applyClamp(raw)
		onChange(next)
		return next
	}

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const text = e.target.value
		const committed = commit(text)
		// Reflect a clamp immediately (e.g. typing 999 with max 12 shows 12),
		// otherwise keep the user's raw text so they can keep typing.
		setDraft(
			committed !== null && committed !== Number(text.trim())
				? String(committed)
				: text
		)
	}

	// On blur, drop any unresolved partial text and snap back to the
	// canonical committed value.
	const handleBlur = () => setDraft(null)

	// Resolve the number the next step should start from. Prefer the live
	// draft, then the committed value, then the placeholder (so an input
	// showing an auto-computed placeholder steps UP/DOWN from that displayed
	// value instead of snapping to 0/min), then `min`, then 0. This keeps the
	// first spinner click / arrow press a +1 nudge from what the user sees,
	// rather than dropping to the floor and climbing back up.
	const resolveBase = (): number => {
		const draftTrim = draft?.trim()
		const candidates: Array<number | undefined> = [
			draftTrim && draftTrim !== "-" && draftTrim !== "." && draftTrim !== "-."
				? Number(draftTrim)
				: undefined,
			value,
			placeholder !== undefined ? Number(placeholder) : undefined,
			typeof min === "number" ? min : undefined,
		]
		const found = candidates.find(
			(n): n is number => typeof n === "number" && Number.isFinite(n)
		)
		return found ?? 0
	}

	const stepSize = step ?? 1
	// Round to the step's precision to avoid float noise (0.1+0.2 etc.).
	const stepDecimals = (String(stepSize).split(".")[1] ?? "").length
	const stepFrom = (start: number, dir: 1 | -1): number =>
		// Stepping always clamps to bounds — overshooting a min/max via the
		// spinner or arrow keys is never intended (independent of the opt-in
		// `clamp`, which governs typed input).
		clampToBounds(Number((start + stepSize * dir).toFixed(stepDecimals)))

	// Step the value by ±`step` (default 1) from the displayed value. Shared by
	// the spinner buttons and the Up/Down keys.
	const stepValue = (dir: 1 | -1) => {
		const next = stepFrom(resolveBase(), dir)
		setDraft(String(next))
		onChange(next)
	}

	// Press-and-hold support for the spinner buttons: an initial step on press,
	// then after a short delay, repeated steps until release. We accumulate the
	// value locally so repeats don't read a stale `value`/`draft` from the
	// closure captured when the hold began.
	const repeatRef = useRef<{ timeout?: number; interval?: number }>({})
	const stopRepeat = () => {
		if (repeatRef.current.timeout !== undefined)
			window.clearTimeout(repeatRef.current.timeout)
		if (repeatRef.current.interval !== undefined)
			window.clearInterval(repeatRef.current.interval)
		repeatRef.current = {}
	}
	const startRepeat = (dir: 1 | -1) => {
		stopRepeat()
		let current = stepFrom(resolveBase(), dir)
		setDraft(String(current))
		onChange(current)
		repeatRef.current.timeout = window.setTimeout(() => {
			repeatRef.current.interval = window.setInterval(() => {
				current = stepFrom(current, dir)
				setDraft(String(current))
				onChange(current)
			}, 60)
		}, 400)
	}
	// Clean up a dangling repeat if the input unmounts mid-hold.
	useEffect(() => stopRepeat, [])

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
		e.preventDefault()
		stepValue(e.key === "ArrowUp" ? 1 : -1)
	}

	const display = draft ?? (Number.isFinite(value) ? String(value) : "")

	const spinnerButton = (dir: 1 | -1) => (
		<button
			type="button"
			// Don't let a spinner press steal focus from the input (which would
			// blur away an in-progress draft); step the value in place. Pressing
			// starts a hold-to-repeat; releasing (or leaving the button) stops it.
			onMouseDown={(e) => {
				e.preventDefault()
				if (!disabled) startRepeat(dir)
			}}
			onMouseUp={stopRepeat}
			onMouseLeave={stopRepeat}
			disabled={disabled}
			tabIndex={-1}
			aria-label={dir === 1 ? "Increment" : "Decrement"}
			className="flex flex-1 items-center justify-center px-1 text-[7px] leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-60 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100"
		>
			{dir === 1 ? "▲" : "▼"}
		</button>
	)

	return (
		<LabeledField
			id={inputId}
			label={label}
			className={className}
			labelClassName={labelClassName}
			inline={inline}
			changed={changed}
		>
			<div className="flex items-center gap-1">
				<div className="relative inline-flex">
					<input
						id={inputId}
						type="text"
						inputMode="decimal"
						value={display}
						onChange={handleChange}
						onBlur={handleBlur}
						onKeyDown={handleKeyDown}
						disabled={disabled}
						placeholder={placeholder}
						className={c(
							// `pr-5` reserves room for the spinner column so the
							// value text doesn't slide under the ▲▼ buttons.
							"w-20 rounded-sm border border-stone-300 bg-white py-1 pr-5 pl-1.5 text-sm text-stone-900 transition-colors outline-none hover:border-stone-400 focus:border-stone-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:border-stone-600 dark:focus:border-stone-500",
							inputClassName
						)}
					/>
					<div className="absolute inset-y-0 right-0 flex w-4 flex-col overflow-hidden rounded-r-sm border-l border-stone-300 dark:border-stone-700">
						{spinnerButton(1)}
						<div className="border-t border-stone-300 dark:border-stone-700" />
						{spinnerButton(-1)}
					</div>
				</div>
				{suffix !== undefined && (
					<span className="text-sm text-stone-500 dark:text-stone-400">
						{suffix}
					</span>
				)}
			</div>
		</LabeledField>
	)
}
