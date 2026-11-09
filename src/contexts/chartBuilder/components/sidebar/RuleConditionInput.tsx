import { Textarea } from "../../../../components/ui/Input"

/** The condition box of a conditional rule (text-color, position and
 *  outline-color rules — lib/textColorRules.ts). Fills its row and wraps,
 *  growing a line at a time, so a long `{Variable} == value` rule stays
 *  readable in full rather than scrolling out of a narrow box. Enter is
 *  swallowed: a condition is one line, and a newline would split an
 *  operand like `== New York`. */
export const RuleConditionInput = ({
	value,
	onChange,
	placeholder,
	ariaLabel,
}: {
	value: string
	onChange: (condition: string) => void
	placeholder: string
	ariaLabel: string
}) => (
	<Textarea
		autoSize
		rows={1}
		value={value}
		onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
		onKeyDown={(e) => {
			if (e.key === "Enter") e.preventDefault()
		}}
		placeholder={placeholder}
		aria-label={ariaLabel}
		spellCheck={false}
		className="flex-1"
	/>
)

/** The grammar note shared by every rule list's help prose. */
export const RuleVariableHelp = () => (
	<>
		Start a rule with a variable in braces to test that variable instead,
		e.g. <code>{"{Region} == West"}</code>.
	</>
)

/** The combining note: several comparisons in one rule join with the words
 *  `AND` / `OR` (the same words as derived-variable conditions), never `&`
 *  or `|`. The example uses `{Variable}` comparisons where the target's
 *  marks carry rows and plain comparisons where they don't (tick labels). */
export const RuleCombineHelp = ({ variables = true }: { variables?: boolean }) => (
	<>
		Join conditions with the words <code>AND</code> / <code>OR</code> (not{" "}
		<code>&amp;</code> or <code>|</code>), e.g.{" "}
		<code>{variables ? "{Region} == West AND {Profit} < 0" : "> 5 AND < 10"}</code>
		; <code>AND</code> is applied before <code>OR</code>. Quote text that
		contains those words: <code>== &quot;Black and White&quot;</code>.
	</>
)
