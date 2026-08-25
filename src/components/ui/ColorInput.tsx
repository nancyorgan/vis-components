import { useId, useState, useEffect } from "react"
import { combine as c } from "../../lib/cls"

import { LabeledField } from "./LabeledField"
import { PalettePickerButton } from "./PalettePickerButton"

/** Hex-color regex. Accepts 3-, 6-, or 8-digit hex (rgb / rgba via 8).
 *  Reused for live-validation of the text input — the swatch input only
 *  ever emits valid 6-digit hex itself. */
const HEX_PATTERN = /^#(?:[\dA-Fa-f]{3}|[\dA-Fa-f]{6}|[\dA-Fa-f]{8})$/

/** Paired color picker — a native `<input type="color">` swatch and a
 *  free-form hex text input that stay in sync. Both share the same id
 *  via `<label htmlFor>`, so clicking the visible label opens the
 *  swatch (the primary control).
 *
 *  The text input is intentionally `type="text"` (not `color`) so users
 *  can paste a hex code without the browser intercepting. It only fires
 *  `onChange` when the text is a valid hex — invalid intermediate
 *  states stay local until the user produces a parseable value. */
export const ColorInput = ({
	id,
	label,
	value,
	onChange,
	disabled,
	className,
	labelClassName,
	inline,
	showHexInput = true,
	changed,
	palette,
	pickerLabel,
	showPalettePicker = true,
}: {
	id?: string
	label: React.ReactNode
	value: string
	onChange: (hex: string) => void
	disabled?: boolean
	className?: string
	/** Tailwind classes for the `<label>` element. Used to pin a fixed
	 *  width when the caller wants multiple rows in a panel to align. */
	labelClassName?: string
	inline?: boolean
	/** When `false`, the hex text input is hidden and only the swatch
	 *  shows. Use this in dense layouts (e.g. per-category color
	 *  override rows) where the swatch alone is enough. */
	showHexInput?: boolean
	/** Shows the per-line "changed" dot in front of the label. */
	changed?: boolean
	/** Colors the circular-arrow picker offers beside the swatch. Defaults to
	 *  the theme's default categorical palette; pass a scheme when the row has
	 *  its own (a per-value swatch's palette, an outline palette). */
	palette?: readonly string[]
	/** a11y label for the picker button. Defaults to "Pick palette color for
	 *  {label}" when `label` is a plain string. */
	pickerLabel?: string
	/** Drops the palette picker. For the theme editor, where these swatches
	 *  DEFINE the palettes — offering a palette color to set a palette color
	 *  is circular. */
	showPalettePicker?: boolean
}) => {
	const generatedId = useId()
	const inputId = id ?? generatedId
	// Local mirror of the text input so the user can type freely without
	// every intermediate keystroke firing onChange. Synced back from
	// `value` whenever the parent updates it (so external resets work).
	const [textValue, setTextValue] = useState(value.toUpperCase())
	useEffect(() => {
		setTextValue(value.toUpperCase())
	}, [value])

	const handleSwatchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		// The native swatch always emits lowercase hex; normalize so
		// stored values (and the text box) stay uppercase.
		onChange(e.target.value.toUpperCase())
	}
	const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const next = e.target.value.toUpperCase()
		setTextValue(next)
		if (HEX_PATTERN.test(next)) onChange(next)
	}
	const handleTextBlur = () => {
		// On blur, snap back to the last-committed value if the user
		// left invalid intermediate text. Prevents the input from
		// looking out of sync with the swatch indefinitely.
		if (!HEX_PATTERN.test(textValue)) setTextValue(value.toUpperCase())
	}

	return (
		<LabeledField
			id={inputId}
			label={label}
			className={className}
			labelClassName={labelClassName}
			inline={inline}
			changed={changed}
		>
			<div className="flex items-center gap-2">
				{showHexInput && (
					<input
						type="text"
						value={textValue}
						onChange={handleTextChange}
						onBlur={handleTextBlur}
						disabled={disabled}
						spellCheck={false}
						className={c(
							"w-24 rounded-sm border border-stone-300 bg-white px-1.5 py-1 font-mono text-xs text-stone-900 transition-colors outline-none hover:border-stone-400 focus:border-stone-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:border-stone-600 dark:focus:border-stone-500",
							!HEX_PATTERN.test(textValue) &&
								"border-amber-400 focus:border-amber-500"
						)}
					/>
				)}
				<input
					id={inputId}
					type="color"
					value={value}
					onChange={handleSwatchChange}
					disabled={disabled}
					className="h-6 w-10 cursor-pointer rounded border border-stone-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700"
				/>
				{/* Every swatch in the app carries the on-palette shortcut — the
				 *  native picker is open-ended, so without this each row is one
				 *  eyeballed hex away from drifting off the theme. */}
				{showPalettePicker && !disabled && (
					<PalettePickerButton
						label={
							pickerLabel ??
							(typeof label === "string"
								? `Pick palette color for ${label}`
								: "Pick palette color")
						}
						palette={palette}
						current={value}
						onPick={onChange}
					/>
				)}
			</div>
		</LabeledField>
	)
}
