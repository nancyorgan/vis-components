import type { LabelPositionRule } from "../../../lib/channelConfig"

import {
	LABEL_COL,
	LABEL_COL_NESTED,
} from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import {
	RuleCombineHelp,
	RuleConditionInput,
	RuleVariableHelp,
} from "../RuleConditionInput"

/** Conditional position rules under "Adjust position" — the positional
 *  sibling of the text-color rules. Each rule pairs a comparison condition
 *  (`< 0`, `>= 100`) with its own X/Y offsets; a label whose backing value
 *  matches uses the rule's offsets INSTEAD of the base Adjust-position
 *  values (first matching rule wins). The motivating case is a diverging
 *  bar chart labeled outside the bar ends: base Y nudges positive labels
 *  up, a `< 0` rule nudges negative labels down.
 *
 *  Shared by the arranged label's layer-wide rules (`positionRules`) and
 *  each own label's — a standalone variable's or a combination's
 *  (`fieldPositionRules[key]`) — which differ only in which value they
 *  compare against and which base offsets they replace. With the variables
 *  separate, every label has its own list inside its own subsection, so
 *  there are as many "+ Add rule" links as there are labels.
 *
 *  Renders just the "+ Add rule" link until a rule exists — the base X/Y
 *  inputs above are the primary controls; the rules are the exception
 *  path. Y inputs follow the sidebar-wide sign convention (positive = up;
 *  the flip happens at this input boundary). */
export const PositionRulesEditor = ({
	rules,
	onChange: update,
	baseXOffset,
	baseYOffset,
	ruleLabel,
	help,
	nested = false,
}: {
	rules: LabelPositionRule[]
	onChange: (rules: LabelPositionRule[]) => void
	/** Seeds a new rule, so the fresh row starts as a no-op the user then
	 *  diverges from — the offsets the rules replace (the label's own when
	 *  it has them, else the layer's). */
	baseXOffset: number
	baseYOffset: number
	/** Distinguishes the a11y labels when several rule lists share a panel
	 *  (one per label). */
	ruleLabel?: string
	/** Extra help prose below the grammar note — which value these rules
	 *  compare against. */
	help?: React.ReactNode
	/** Indent each rule's X / Y under its "Rule N" line — the layout the
	 *  split First / Last label X / Y pairs above use — so the columns line
	 *  up with them. */
	nested?: boolean
}) => {
	const ruleName = (i: number) =>
		ruleLabel ? `${ruleLabel} position rule ${i + 1}` : `position rule ${i + 1}`
	const setRule = (i: number, patch: Partial<LabelPositionRule>) =>
		update(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
	const removeRule = (i: number) => update(rules.filter((_, idx) => idx !== i))
	const addRule = () =>
		update([
			...rules,
			{ condition: "", xOffset: baseXOffset, yOffset: baseYOffset },
		])
	return (
		<>
			{rules.map((rule, i) => (
				<div
					// Index key is stable here: rules are ordered, identity == position
					// eslint-disable-next-line react/no-array-index-key
					key={i}
					className="flex flex-col gap-2"
				>
					{/* Same stacked layout — and w-24 label column — as the base
					 *  X/Y adjusters above: condition line, then X, then Y. */}
					<div className="flex items-start gap-2 text-sm">
						<span className={`${LABEL_COL} pt-1`}>Rule {i + 1}</span>
						<RuleConditionInput
							value={rule.condition}
							onChange={(condition) => setRule(i, { condition })}
							placeholder="< 0"
							ariaLabel={`Condition for ${ruleName(i)}`}
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
					<div
						className={
							nested ? "ml-6 flex flex-col gap-2 text-sm" : "flex flex-col gap-2"
						}
					>
						<NumberInput
							label="X"
							labelClassName={nested ? LABEL_COL_NESTED : LABEL_COL}
							value={rule.xOffset}
							step={1}
							onChange={(xOffset) => setRule(i, { xOffset })}
							inputClassName="w-16"
							suffix="px"
						/>
						<NumberInput
							label="Y"
							labelClassName={nested ? LABEL_COL_NESTED : LABEL_COL}
							value={-rule.yOffset}
							step={1}
							onChange={(n) => setRule(i, { yOffset: -n })}
							inputClassName="w-16"
							suffix="px"
						/>
					</div>
				</div>
			))}
			<button
				type="button"
				onClick={addRule}
				className="self-end text-xs text-blue-600 hover:underline dark:text-blue-400"
			>
				+ Add rule
			</button>
			{rules.length > 0 && (
				<>
					<p className="vc-help">
						Labels whose value matches a rule use that rule&apos;s X/Y instead
						of the values above. First matching rule wins. Use{" "}
						<code>{">"}</code>, <code>{"<"}</code>, <code>{">="}</code>,{" "}
						<code>{"<="}</code>, <code>==</code>, or <code>!=</code> followed
						by a number. <RuleVariableHelp /> <RuleCombineHelp />
					</p>
					{help && <p className="vc-help">{help}</p>}
				</>
			)}
		</>
	)
}
