import type { TextColorRule } from "../../lib/channelConfig"

import {
	ColorInput,
	LABEL_AND_HEX_SPAN,
} from "../../../../components/ui/ColorInput"
import { rowGroup } from "../../../../components/ui/rowGroup"
import {
	RuleCombineHelp,
	RuleConditionInput,
	RuleVariableHelp,
} from "./RuleConditionInput"
import { IconButton } from "../../../../components/ui/IconButton"

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
	divider = true,
	variableRules = true,
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
	/** `false` drops the hairline above the block — for a host that embeds
	 *  the rules INSIDE another editor's rows (the axis Tick labels font
	 *  editor, right under its Color row) rather than after them. */
	divider?: boolean
	/** `false` omits the `{Variable}` tip from the grammar note — for a
	 *  target whose values carry no rows (axis tick labels), where such a
	 *  rule could never fire — and gives the AND / OR example in plain
	 *  comparisons. */
	variableRules?: boolean
}) => {
	const ruleName = (i: number) =>
		ruleLabel ? `${ruleLabel} rule ${i + 1}` : `rule ${i + 1}`
	const setRule = (i: number, patch: Partial<TextColorRule>) =>
		update(stored.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
	const removeRule = (i: number) => update(stored.filter((_, idx) => idx !== i))
	const addRule = () => update([...stored, { condition: "", color: defaultColor }])
	return (
		// The line above the block stays even while the block is the add link
		// alone: it marks where the rules go. (The one place a divider sits
		// over a single row; the divider audit knows this block.)
		<div className={rowGroup(divider)}>
			{stored.map((rule, i) => (
				<div
					// Index key is stable here: rules are ordered, identity == position
					// eslint-disable-next-line react/no-array-index-key
					key={i}
					className="flex items-start gap-2 text-sm"
				>
					{/* The condition box stands in for the label column + hex box of
					 *  the color row above (every host puts its rules under a
					 *  LABEL_COL ColorInput row): it ends where that hex box ends,
					 *  so this rule's swatch, palette icon and × start on the
					 *  color row's swatch column. A long `{Variable} == value`
					 *  rule wraps onto more lines rather than widening the box. */}
					<RuleConditionInput
						value={rule.condition}
						onChange={(condition) => setRule(i, { condition })}
						placeholder="> 0"
						ariaLabel={`Condition for ${ruleName(i)}`}
						className={LABEL_AND_HEX_SPAN}
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
					<IconButton
						onClick={() => removeRule(i)}
						className="px-1"
						aria-label={`Remove ${ruleName(i)}`}
					>
						×
					</IconButton>
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
						<code>==</code> and <code>!=</code> for text, e.g. <code>== Melon</code>.
						{variableRules && (
							<>
								{" "}
								<RuleVariableHelp />
							</>
						)}{" "}
						<RuleCombineHelp variables={variableRules} />
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
