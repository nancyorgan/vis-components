import type { TextColorRule } from "../../lib/channelConfig"

import { ColorInput } from "../../../../components/ui/ColorInput"
import { RuleConditionInput, RuleVariableHelp } from "./RuleConditionInput"

/** The one conditional color-rule editor, shared by every color target that
 *  takes rules: the Color menu's Fill (`fillColorRules`), Outline
 *  (`shape.outlineColorRules`) and Line (`colorSlots.line.colorRules`)
 *  subsections, and the Data Labels text-color rules (layer-wide and per
 *  variable). Each row is a condition box plus a color; the first matching
 *  rule wins over the target's palette / scale / single color.
 *
 *  Sits under its own hairline below the target's primary controls, showing
 *  just the right-aligned "+ Add color rule" link until a rule exists — the
 *  swatches above are the primary control, the rules the exception path, and
 *  a standing subsection header gave them more room than that earns (the
 *  link names itself instead). The link stays under the rows, so adding
 *  keeps adding. Same shape as `PositionRulesEditor`, the positional
 *  sibling. */
export const ColorRulesEditor = ({
	rules: stored,
	onChange: update,
	defaultColor,
	palette,
	paletteKind,
	addLabel = "+ Add color rule",
	ruleLabel,
	help,
}: {
	rules: readonly TextColorRule[]
	onChange: (rules: TextColorRule[]) => void
	/** Seed color for a new rule — the color the rules fall back to. */
	defaultColor: string
	/** Colors the row's palette picker offers; omitted → the theme default
	 *  categorical palette (or the text palette with `paletteKind: "text"`). */
	palette?: readonly string[]
	paletteKind?: "categorical" | "text"
	/** The add link's text. */
	addLabel?: string
	/** Distinguishes the a11y labels when several rule lists share a panel
	 *  (one per data-label variable; Fill vs Outline vs Line). */
	ruleLabel?: string
	/** Extra help prose below the grammar note — typically what an implicit
	 *  rule compares against. */
	help?: React.ReactNode
}) => {
	const ruleName = (i: number) =>
		ruleLabel ? `${ruleLabel} rule ${i + 1}` : `rule ${i + 1}`
	const setRule = (i: number, patch: Partial<TextColorRule>) =>
		update(stored.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
	const removeRule = (i: number) => update(stored.filter((_, idx) => idx !== i))
	const addRule = () => update([...stored, { condition: "", color: defaultColor }])
	return (
		<div className="vc-divider-group">
			{stored.map((rule, i) => (
				<div
					// Index key is stable here: rules are ordered, identity == position
					// eslint-disable-next-line react/no-array-index-key
					key={i}
					className="flex items-start gap-2 text-sm"
				>
					{/* The condition box takes the row's full width (no label-column
					 *  spacer) so a `{Variable} == value` rule fits. */}
					<RuleConditionInput
						value={rule.condition}
						onChange={(condition) => setRule(i, { condition })}
						placeholder="> 0"
						ariaLabel={`Condition for ${ruleName(i)}`}
					/>
					<ColorInput
						label={`Color for ${ruleName(i)}`}
						labelClassName="sr-only"
						value={rule.color}
						onChange={(color) => setRule(i, { color })}
						showHexInput={false}
						palette={palette}
						paletteKind={paletteKind}
						pickerLabel={`Pick palette color for ${ruleName(i)}`}
					/>
					<button
						type="button"
						onClick={() => removeRule(i)}
						className="rounded px-1 hover:bg-stone-200 hover:text-stone-800 dark:hover:bg-stone-700 dark:hover:text-white vc-muted"
						aria-label={`Remove ${ruleName(i)}`}
					>
						×
					</button>
				</div>
			))}
			<button
				type="button"
				onClick={addRule}
				data-tip="color-rules"
				className="self-end text-xs text-blue-600 hover:underline dark:text-blue-400"
			>
				{addLabel}
			</button>
			{stored.length > 0 && (
				<>
					<p className="vc-help">
						First matching rule wins. Use <code>{">"}</code>, <code>{"<"}</code>,{" "}
						<code>{">="}</code>, and <code>{"<="}</code> for numbers;{" "}
						<code>==</code> and <code>!=</code> for text, e.g. <code>== Melon</code>.{" "}
						<RuleVariableHelp />
					</p>
					{help && <p className="vc-help">{help}</p>}
				</>
			)}
		</div>
	)
}

/** Help prose for a mark-color rule list: what an implicit rule compares
 *  against, which depends on whether the target has a variable mapped. */
export const markRuleHelp = (
	target: string,
	mappedField: string | null
): React.ReactNode =>
	mappedField ? (
		<>
			Compared against each mark&apos;s <strong>{mappedField}</strong> value;
			the {target} color above applies when no rule matches.
		</>
	) : (
		<>
			With no variable mapped, start each rule with a variable in braces,
			e.g. <code>{"{Profit} < 0"}</code>; the {target} color above applies
			when no rule matches.
		</>
	)
