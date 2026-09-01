import type {
	DataLabelsConfig,
	LabelPositionRule,
} from "../../../lib/channelConfig"

import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"

/** Conditional position rules under "Adjust position" — the positional
 *  sibling of the text-color rules. Each rule pairs a comparison condition
 *  (`< 0`, `>= 100`) with its own X/Y offsets; a label whose backing value
 *  matches uses the rule's offsets INSTEAD of the base Adjust-position
 *  values (first matching rule wins). The motivating case is a diverging
 *  bar chart labeled outside the bar ends: base Y nudges positive labels
 *  up, a `< 0` rule nudges negative labels down.
 *
 *  Renders just the "+ Add rule" link until a rule exists — the base X/Y
 *  inputs above are the primary controls; the rules are the exception
 *  path. Y inputs follow the sidebar-wide sign convention (positive = up;
 *  the flip happens at this input boundary). */
export const PositionRulesEditor = ({
	cfg,
	onChange,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
}) => {
	const rules = cfg.positionRules ?? []
	const update = (next: LabelPositionRule[]) =>
		onChange({ positionRules: next })
	const setRule = (i: number, patch: Partial<LabelPositionRule>) =>
		update(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
	const removeRule = (i: number) => update(rules.filter((_, idx) => idx !== i))
	// Seed a new rule from the current base offsets, so the fresh row starts
	// as a no-op the user then diverges from (same seeding the text-color
	// rules use with the base color).
	const addRule = () =>
		update([
			...rules,
			{ condition: "", xOffset: cfg.xOffset, yOffset: cfg.yOffset },
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
					<div className="flex items-center gap-2 text-sm">
						<span className={LABEL_COL}>Rule {i + 1}</span>
						<input
							type="text"
							value={rule.condition}
							onChange={(e) => setRule(i, { condition: e.target.value })}
							placeholder="< 0"
							aria-label={`Condition for position rule ${i + 1}`}
							className="w-24 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
						/>
						<button
							type="button"
							onClick={() => removeRule(i)}
							className="rounded px-1 text-stone-600 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
							aria-label={`Remove position rule ${i + 1}`}
						>
							×
						</button>
					</div>
					<NumberInput
						label="X"
						labelClassName={LABEL_COL}
						value={rule.xOffset}
						step={1}
						onChange={(xOffset) => setRule(i, { xOffset })}
						inputClassName="w-16"
						suffix="px"
					/>
					<NumberInput
						label="Y"
						labelClassName={LABEL_COL}
						value={-rule.yOffset}
						step={1}
						onChange={(n) => setRule(i, { yOffset: -n })}
						inputClassName="w-16"
						suffix="px"
					/>
				</div>
			))}
			<button
				type="button"
				onClick={addRule}
				className="self-start text-xs text-blue-600 hover:underline dark:text-blue-400"
			>
				+ Add rule
			</button>
			{rules.length > 0 && (
				<p className="vc-help">
					Labels whose value matches a rule use that rule&apos;s X/Y instead of
					the values above. First matching rule wins. Use <code>{">"}</code>,{" "}
					<code>{"<"}</code>, <code>{">="}</code>, <code>{"<="}</code>,{" "}
					<code>==</code>, or <code>!=</code> followed by a number.
				</p>
			)}
		</>
	)
}
