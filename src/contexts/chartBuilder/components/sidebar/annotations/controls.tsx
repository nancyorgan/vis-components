import { useId, useState, type ReactNode } from "react"
import { SectionChevron } from "../../../../../components/ui/Chevron"
import { DateInput } from "../../../../../components/ui/DateInput"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { Segmented } from "../../../../../components/ui/Segmented"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import {
	LABEL_COL,
	LabeledField,
} from "../../../../../components/ui/LabeledField"
import { cleanNumber, temporalCoordMs, type AxisInfo } from "./axisInfo"

/** Which annotation an editor card belongs to — drives the kind glyph in its
 *  header row. */
export type AnnotationKind = "rectangle" | "circle" | "line" | "text" | "image"

const KIND_LABEL: Record<AnnotationKind, string> = {
	rectangle: "Rectangle annotation",
	circle: "Circle annotation",
	line: "Line annotation",
	text: "Text annotation",
	image: "Image annotation",
}

/** Miniature of the annotation itself — a solid box / circle, a heavy
 *  diagonal stroke, a heavy "T", a framed landscape — so a collapsed list of
 *  cards is scannable by shape rather than by reading each name. Drawn on the same 14×14 grid as the
 *  sidebar's other glyphs (`AlignmentGlyph`), but the area shapes are FILLED
 *  and the stroked ones run heavier than that outline convention: at 13px an
 *  outline reads as a smudge next to the chevron, and these have to be
 *  identifiable at a glance. Everything is `currentColor`, so the caller's
 *  text color (the sidebar purple) drives all four. */
const AnnotationKindGlyph = ({ kind }: { kind: AnnotationKind }) => (
	<svg
		viewBox="0 0 14 14"
		width={13}
		height={13}
		role="img"
		aria-label={KIND_LABEL[kind]}
		fill="currentColor"
		stroke="currentColor"
		strokeWidth={2.4}
		strokeLinecap="round"
	>
		<title>{KIND_LABEL[kind]}</title>
		{kind === "rectangle" && (
			<rect x={1} y={3} width={12} height={8} rx={1.5} stroke="none" />
		)}
		{kind === "circle" && <circle cx={7} cy={7} r={5.5} stroke="none" />}
		{kind === "line" && <line x1={2} y1={11.5} x2={12} y2={2.5} />}
		{kind === "text" && (
			<>
				<line x1={2.5} y1={3} x2={11.5} y2={3} />
				<line x1={7} y1={3} x2={7} y2={11.5} />
			</>
		)}
		{kind === "image" && (
			<>
				{/* Picture frame with a mountain skyline and a sun. */}
				<rect x={1.5} y={2} width={11} height={10} rx={1} fill="none" strokeWidth={1.6} />
				<path d="M2.5 10.5 L5.5 7 L7.5 9 L9 7.5 L11.5 10.5 Z" stroke="none" />
				<circle cx={9.5} cy={5} r={1.2} stroke="none" />
			</>
		)}
	</svg>
)

/** Shared collapsible shell for one annotation's editor. The header row —
 *  expand/collapse chevron, kind glyph, name box, remove link — is always
 *  visible so a long list of annotations stays scannable; the body (position,
 *  style, layer controls) renders only while expanded. Collapse state lives in
 *  the parent so a freshly added annotation starts open while existing ones
 *  stay collapsed.
 *
 *  The name reads as plain text (not an input box): an open box in the first
 *  row of a fresh card was taken for the annotation's content, and users typed
 *  their label into it. Renaming is click-the-pencil or double-click-the-name,
 *  which opens an inline box (see `AnnotationNameEditor`). */
export const AnnotationCard = ({
	kind,
	name,
	fallbackName,
	onNameChange,
	onRemove,
	open,
	onToggle,
	children,
}: {
	/** Which annotation this card edits — shown as a glyph beside the name. */
	kind: AnnotationKind
	name: string
	/** Shown when the stored name is blank — annotations saved before names
	 *  were assigned at creation, or a rename the user emptied out. */
	fallbackName: string
	onNameChange: (name: string) => void
	onRemove: () => void
	open: boolean
	onToggle: () => void
	children: ReactNode
}) => (
	<div className="vc-option-panel">
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				aria-label={open ? "Collapse annotation" : "Expand annotation"}
				className="flex h-6 w-4 flex-shrink-0 items-center justify-center hover:text-stone-900 dark:hover:text-white vc-muted"
			>
				<SectionChevron open={open} />
			</button>
			{/* Same purple as the CollapsibleSubsection headers inside the card. */}
			<span className="text-vc-section-header flex flex-shrink-0 items-center">
				<AnnotationKindGlyph kind={kind} />
			</span>
			<AnnotationNameEditor
				name={name}
				fallbackName={fallbackName}
				onChange={onNameChange}
			/>
			<button
				type="button"
				onClick={onRemove}
				className="text-sm hover:text-stone-900 dark:hover:text-white vc-muted"
			>
				remove
			</button>
		</div>
		{open && children}
	</div>
)

/** The annotation's name in the card header: plain text with a pencil beside
 *  it. Clicking the pencil or double-clicking the name swaps in an inline
 *  rename box (Enter / blur commit, Escape cancels). Committing an EMPTIED
 *  box stores "" so the display falls back to the kind's numbered default —
 *  the same clear-to-default convention as the Fields panel's rename. The
 *  raw bordered `<input>` is one of the deliberate inline-rename exceptions
 *  to the form-primitive rule (see CLAUDE.md). */
const AnnotationNameEditor = ({
	name,
	fallbackName,
	onChange,
}: {
	name: string
	fallbackName: string
	onChange: (name: string) => void
}) => {
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(name)
	const shown = name.trim() === "" ? fallbackName : name

	const startEditing = () => {
		setDraft(shown)
		setEditing(true)
	}
	const commit = () => {
		const trimmed = draft.trim()
		if (trimmed !== name.trim()) onChange(trimmed)
		setEditing(false)
	}
	const cancel = () => setEditing(false)

	if (editing) {
		return (
			<input
				type="text"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit()
					if (e.key === "Escape") cancel()
				}}
				aria-label={`New name for ${shown}`}
				// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the inline rename editor the user just opened
				autoFocus
				onFocus={(e) => e.target.select()}
				className="vc-focus-ring min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0 text-sm dark:bg-stone-900 vc-text"
			/>
		)
	}
	return (
		<span className="flex min-w-0 flex-1 items-center gap-1 text-sm vc-text">
			{/* Double-click is a shortcut; the pencil button is the keyboard-reachable control. */}
			<span
				className="min-w-0 truncate"
				title={`${shown} — double-click to rename`}
				onDoubleClick={startEditing}
			>
				{shown}
			</span>
			<button
				type="button"
				onClick={startEditing}
				aria-label={`Rename ${shown}`}
				title="Rename"
				className="-m-[7px] flex-shrink-0 p-[7px] hover:text-stone-900 dark:hover:text-white vc-muted"
			>
				<svg viewBox="0 0 16 16" width={11} height={11} aria-hidden>
					<path
						d="M11.7 1.6l2.7 2.7-9.2 9.2-3.4.7.7-3.4 9.2-9.2z"
						fill="currentColor"
					/>
				</svg>
			</button>
		</span>
	)
}

/** Picks the right input for an axis: a dropdown of unique categories
 *  for categorical/string-ordinal axes, a date box for temporal axes, a
 *  number input for everything else. The renderer treats string values
 *  as category labels and numeric values as scaled positions — epoch ms
 *  on a temporal axis, the unit the axis's Scale range bounds and custom
 *  breaks store too. */
export const AxisValueInput = ({
	label,
	value,
	axis,
	onChange,
	labelClassName,
}: {
	label: string
	value: number | string
	axis: AxisInfo
	onChange: (next: number | string) => void
	labelClassName?: string
}) => {
	const dateId = useId()
	// Categorical-or-string-ordinal: dropdown.
	if (axis.categories && axis.categories.length > 0) {
		const current = typeof value === "string" ? value : (axis.categories[0] ?? "")
		return (
			<SelectInput
				label={label}
				value={current}
				options={axis.categories.map((c) => ({ value: c, label: c }))}
				onChange={(v) => onChange(v)}
				labelClassName={labelClassName}
			/>
		)
	}
	// Temporal: a date box (typed YYYY-MM-DD or picked from the month / year
	// calendar), stored as epoch ms at local midnight — the clock the time
	// scale lays its ticks on. The raw number is nothing a person could type.
	// A blank commit (null) leaves the coordinate alone: a position has to
	// be somewhere.
	if (axis.type === "temporal") {
		const ms = temporalCoordMs(value)
		return (
			<LabeledField id={dateId} label={label} labelClassName={labelClassName}>
				<DateInput
					id={dateId}
					value={Number.isFinite(ms) ? ms : null}
					onChange={(next) => {
						if (next !== null) onChange(next)
					}}
					className="w-40"
				/>
			</LabeledField>
		)
	}
	// Numeric / numeric-ordinal: number input.
	const numericValue = typeof value === "number" ? value : Number(value)
	return (
		<NumberInput
			label={label}
			value={cleanNumber(Number.isFinite(numericValue) ? numericValue : 0)}
			step={1}
			onChange={(v) => onChange(v)}
			labelClassName={labelClassName}
		/>
	)
}

/** Behind-chart / in-front layer toggle — identical across all four
 *  annotation kinds. Each kind's Position subsection renders it last, under
 *  a hairline divider (`.vc-divider-group`): where the annotation sits in
 *  the stack is part of where it sits, and a bare row trailing the card's
 *  subsections read as an orphan. */
export const LayerRow = ({
	zOrder,
	onChange,
}: {
	zOrder: "behind" | "front"
	onChange: (zOrder: "behind" | "front") => void
}) => (
	<div className="flex items-center gap-2 text-sm">
		<span className={`shrink-0 ${LABEL_COL}`}>Layer</span>
		<Segmented
			ariaLabel="Layer order"
			value={zOrder}
			segments={LAYER_SEGMENTS}
			onChange={onChange}
		/>
	</div>
)

const LAYER_SEGMENTS = [
	{ key: "behind", label: "Behind chart" },
	{ key: "front", label: "In front" },
] as const
