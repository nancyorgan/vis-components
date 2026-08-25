import type { ReactNode } from "react"
import { SectionChevron } from "../../../../../components/ui/Chevron"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { cleanNumber, type AxisInfo } from "./axisInfo"

/** Which annotation an editor card belongs to — drives the kind glyph in its
 *  header row. */
export type AnnotationKind = "rectangle" | "circle" | "line" | "text"

const KIND_LABEL: Record<AnnotationKind, string> = {
	rectangle: "Rectangle annotation",
	circle: "Circle annotation",
	line: "Line annotation",
	text: "Text annotation",
}

/** Miniature of the annotation itself — a solid box / circle, a heavy
 *  diagonal stroke, a heavy "T" — so a collapsed list of cards is scannable by
 *  shape rather than by reading each name. Drawn on the same 14×14 grid as the
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
	</svg>
)

/** Shared collapsible shell for one annotation's editor. The header row —
 *  expand/collapse chevron, kind glyph, name box, remove link — is always
 *  visible so a long list of annotations stays scannable; the body (position,
 *  style, layer controls) renders only while expanded. Collapse state lives in
 *  the parent so a freshly added annotation starts open while existing ones
 *  stay collapsed. */
export const AnnotationCard = ({
	kind,
	name,
	namePlaceholder,
	onNameChange,
	onRemove,
	open,
	onToggle,
	children,
}: {
	/** Which annotation this card edits — shown as a glyph beside the name. */
	kind: AnnotationKind
	name: string
	namePlaceholder?: string
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
				className="flex h-6 w-4 flex-shrink-0 items-center justify-center text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				<SectionChevron open={open} />
			</button>
			{/* Same purple as the CollapsibleSubsection headers inside the card. */}
			<span className="text-vc-section-header flex flex-shrink-0 items-center">
				<AnnotationKindGlyph kind={kind} />
			</span>
			<input
				type="text"
				value={name}
				placeholder={namePlaceholder}
				onChange={(e) => onNameChange(e.target.value)}
				className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500"
			/>
			<button
				type="button"
				onClick={onRemove}
				className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				remove
			</button>
		</div>
		{open && children}
	</div>
)

/** Picks the right input for an axis: a dropdown of unique categories
 *  for categorical/string-ordinal axes, a number input for everything
 *  else. The renderer treats string values as category labels and
 *  numeric values as scaled positions. */
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
	// Numeric / temporal / numeric-ordinal: number input.
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

/** Per-annotation facet targeting. "Apply to all facets" checked ⇒
 *  `facetKeys` is null = every panel (the default). Unchecking reveals a
 *  checkbox per facet so the user picks exactly which panels the annotation
 *  is drawn on. Only rendered when the chart is actually faceted. */
export const FacetScopeControl = ({
	facetKeys,
	facetOptions,
	onChange,
}: {
	facetKeys: string[] | null | undefined
	facetOptions: readonly string[]
	onChange: (next: string[] | null) => void
}) => {
	const applyAll = facetKeys == null
	return (
		/* px-2: this control renders as a bare sibling of the boxed subsections
		 * inside each editor's purple panel, so pad it to their content edge. */
		<div className="flex flex-col gap-1.5 px-2">
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={applyAll}
					onChange={(e) =>
						onChange(e.target.checked ? null : [...facetOptions])
					}
					className="h-3 w-3"
				/>
				<span className="text-stone-600 dark:text-stone-400">
					Apply to all facets
				</span>
			</label>
			{!applyAll && (
				<div className="flex flex-col gap-1 pl-5">
					{facetOptions.map((key) => (
						<label key={key} className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={facetKeys?.includes(key) ?? false}
								onChange={(e) => {
									const set = new Set(facetKeys ?? [])
									if (e.target.checked) set.add(key)
									else set.delete(key)
									// Keep stored keys in panel order for stable display.
									onChange(facetOptions.filter((k) => set.has(k)))
								}}
								className="h-3 w-3"
							/>
							<span
								className="min-w-0 truncate text-stone-700 dark:text-stone-300"
								title={key}
							>
								{key}
							</span>
						</label>
					))}
				</div>
			)}
		</div>
	)
}

/** Behind-chart / in-front layer toggle — identical across all three
 *  annotation kinds, so it lives here rather than being copy-pasted into
 *  each editor. */
export const LayerRow = ({
	zOrder,
	onChange,
}: {
	zOrder: "behind" | "front"
	onChange: (zOrder: "behind" | "front") => void
}) => (
	/* px-2 keeps this bare row's label/control column aligned with the
	 * rows inside the p-2 subsection cards above. */
	<div className="flex items-center gap-2 px-2 text-sm">
		<span className={LABEL_COL}>Layer</span>
		<div
			role="group"
			aria-label="Layer order"
			className="inline-flex overflow-hidden rounded border border-stone-300 dark:border-stone-700"
		>
			<button
				type="button"
				onClick={() => onChange("behind")}
				className={
					zOrder === "behind"
						? "bg-brand-500 px-2 py-1 text-sm text-white"
						: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
				}
				aria-pressed={zOrder === "behind"}
			>
				Behind chart
			</button>
			<button
				type="button"
				onClick={() => onChange("front")}
				className={
					zOrder === "front"
						? "bg-brand-500 px-2 py-1 text-sm text-white"
						: "bg-white px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
				}
				aria-pressed={zOrder === "front"}
			>
				In front
			</button>
		</div>
	</div>
)
