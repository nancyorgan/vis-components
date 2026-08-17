import {
	FONT_FAMILY_OPTIONS,
	fontWeightOptionsFor,
} from "../../../chartBuilder/lib/labelsConfig"
import { AlignmentControl } from "../../../chartBuilder/components/sidebar/LabelsPanel"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { symbolPath } from "../../../chartBuilder/lib/scales"

import { ColorInput as UiColorInput } from "../../../../components/ui/ColorInput"
import { NumberInput as UiNumberInput } from "../../../../components/ui/NumberInput"
import { SelectInput as UiSelectInput } from "../../../../components/ui/SelectInput"

export const Section = ({
	title,
	children,
}: {
	title: string
	children: React.ReactNode
}) => (
	<div className="flex flex-col gap-3">
		<h3 className="text-sm font-semibold text-stone-900 dark:text-white">
			{title}
		</h3>
		{/* Rows inset past the subheader so section titles overhang their
		    content — mirrors the group-header → subheader step above. */}
		<div className="flex flex-col gap-2 pl-5">{children}</div>
	</div>
)

/** One collapsible group of the theme editor. The disabled fieldset is what
 *  makes system themes read-only — every control inside inherits it, so no
 *  section needs to thread `disabled` down to individual rows. */
export const SectionGroup = ({
	title,
	isReadOnly,
	children,
}: {
	title: string
	isReadOnly: boolean
	children: React.ReactNode
}) => (
	<CollapsibleSubsection
		title={<span className="text-sm">{title}</span>}
		boxed={false}
	>
		<fieldset
			disabled={isReadOnly}
			className="flex flex-col gap-6 pl-3.5 disabled:opacity-70"
		>
			{children}
		</fieldset>
	</CollapsibleSubsection>
)

/** Fixed-width label column used by every settings row on this page so the
 *  controls line up vertically. Passed to the shared primitives via
 *  `labelClassName` (the established pattern for pinning width + color). */
export const THEME_LABEL_CLASS = "w-32 text-stone-600 dark:text-stone-400"

/** Thin page-local wrappers around the shared UI primitives — they only
 *  pin the page's label column so the ~45 call sites below stay terse. */
export const ColorInput = (props: {
	label: string
	value: string
	onChange: (v: string) => void
}) => <UiColorInput labelClassName={THEME_LABEL_CLASS} {...props} />

export const NumberInput = (props: {
	label: string
	value: number
	onChange: (v: number) => void
	min: number
	max: number
	step: number
	suffix?: string
}) => <UiNumberInput labelClassName={THEME_LABEL_CLASS} {...props} />

export const SelectInput = (props: {
	label: string
	value: string
	onChange: (v: string) => void
	options: Array<{ label: string; value: string }>
}) => (
	<UiSelectInput
		labelClassName={THEME_LABEL_CLASS}
		selectClassName="flex-1"
		{...props}
	/>
)

export const ShapeGlyph = ({
	idx,
	selected,
}: {
	idx: number
	selected: boolean
}) => (
	<svg width={20} height={20} viewBox="-10 -10 20 20" aria-hidden="true">
		<path d={symbolPath(idx, 6)} fill={selected ? "currentColor" : "#94a3b8"} />
	</svg>
)

/** Font-family select row for per-slot family defaults (subtitle / legend
 * titles / data labels). The "(default)" entry clears the slot so it falls
 * back to the shared family. */
export const FontFamilyRow = ({
	label,
	value,
	onChange,
	onDefault,
}: {
	label: string
	value: string | undefined
	onChange: (family: string) => void
	/** Called when the user picks the "(default)" entry. Omit to drop it. */
	onDefault?: () => void
}) => (
	<label className="flex items-center gap-2 text-sm">
		<span className={THEME_LABEL_CLASS}>
			{label}
			</span>
		<select
			value={value ?? ""}
			onChange={(e) =>
				e.target.value === "" ? onDefault?.() : onChange(e.target.value)
			}
			className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
		>
			{onDefault && <option value="">(default)</option>}
			{FONT_FAMILY_OPTIONS.map((opt) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	</label>
)

/** Alignment row for the title / subtitle / legend-title alignment defaults.
 * Uses the builder's AlignmentControl so both surfaces feel like the same
 * control; "center" is the default, so it doubles as the unset state. */
export const AlignmentRow = ({
	label,
	value,
	onChange,
}: {
	label: string
	value: "left" | "center" | "right" | undefined
	onChange: (a: "left" | "center" | "right") => void
}) => (
	/* div, not label: AlignmentControl is a button group, not a form control */
	<div className="flex items-center gap-2 text-sm">
		<span className={THEME_LABEL_CLASS}>
			{label}
			</span>
		<AlignmentControl value={value ?? "center"} onChange={onChange} />
	</div>
)

/** Font-weight select row shared by the font sections. Options come from
 * `fontWeightOptionsFor` so each family only offers weights it can actually
 * render — the same list the builder's Weight pickers show for that family.
 * When `onDefault` is provided, a leading "(default)" entry clears the
 * weight so the slot falls back to its render-site default. */
export const FontWeightRow = ({
	label = "Font weight",
	family,
	value,
	onChange,
	onDefault,
}: {
	label?: string
	family: string
	value: number | undefined
	onChange: (w: number) => void
	/** Called when the user picks the "(default)" entry. Omit to drop it. */
	onDefault?: () => void
}) => (
	<label className="flex items-center gap-2 text-sm">
		<span className={THEME_LABEL_CLASS}>
			{label}
			</span>
		<select
			value={value ?? ""}
			onChange={(e) =>
				e.target.value === ""
					? onDefault?.()
					: onChange(Number(e.target.value))
			}
			className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
		>
			{onDefault && <option value="">(default)</option>}
			{fontWeightOptionsFor(family, value).map((opt) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	</label>
)

/** Three-button B/I/U toggle row used inside the Title fonts + Text
 * fonts sections. Mirrors the styling of the per-label override toggle
 * in LabelsPanel so the chart-edit and theme-edit surfaces feel like
 * the same control. */
const StyleToggleBtn = ({
	on,
	label,
	className,
	ariaLabel,
	onClick,
}: {
	on: boolean
	label: string
	className: string
	ariaLabel: string
	onClick: () => void
}) => (
	<button
		type="button"
		onClick={onClick}
		aria-label={ariaLabel}
		aria-pressed={on}
		className={`h-7 w-7 rounded border text-sm ${className} ${
			on
				? "border-stone-700 bg-stone-200 text-stone-900 dark:border-stone-300 dark:bg-stone-700 dark:text-white"
				: "border-stone-300 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
		}`}
	>
		{label}
	</button>
)

export const StyleToggleRow = ({
	bold = false,
	italic,
	underline,
	onBold,
	onItalic,
	onUnderline,
}: {
	/** Omit `onBold` to drop the B button — for sections where weight is a
	 *  separate numeric select (data labels) rather than a bold flag. */
	bold?: boolean
	italic: boolean
	underline: boolean
	onBold?: (v: boolean) => void
	onItalic: (v: boolean) => void
	onUnderline: (v: boolean) => void
}) => {
	return (
		/* Label column + gap match the sibling input rows (THEME_LABEL_CLASS /
		   gap-2) so the buttons line up with the inputs; the tighter gap-1.5
		   between the buttons themselves lives on the inner group. */
		<div className="flex items-center gap-2 text-sm">
			<span className={`${THEME_LABEL_CLASS} shrink-0`}>
				Style
			</span>
			<div className="flex items-center gap-1.5">
			{onBold && (
				<StyleToggleBtn
					on={bold}
					label="B"
					className="font-bold"
					ariaLabel="Bold"
					onClick={() => onBold(!bold)}
				/>
			)}
			<StyleToggleBtn
				on={italic}
				label="I"
				className="italic"
				ariaLabel="Italic"
				onClick={() => onItalic(!italic)}
			/>
			<StyleToggleBtn
				on={underline}
				label="U"
				className="underline"
				ariaLabel="Underline"
				onClick={() => onUnderline(!underline)}
			/>
			</div>
		</div>
	)
}
