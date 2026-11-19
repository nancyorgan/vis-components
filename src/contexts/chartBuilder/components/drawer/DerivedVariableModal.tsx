import { useAtom, useAtomValue } from "jotai"
import { useId, useMemo, useRef, useState } from "react"
import { Button } from "../../../../components/ui/Button"
import { Input } from "../../../../components/ui/Input"
import { ConfirmDialog, Modal } from "../../../../components/ui/Modal"
import { RadioGroup } from "../../../../components/ui/RadioGroup"
import {
	parseExpression,
	type ComparisonOp,
} from "../../lib/derivedExpression"
import {
	COMPARISON_OPTIONS,
	comparisonText,
	joinComparison,
	levelLabel,
	levelSource,
	makeLevelLookup,
	splitComparison,
} from "../../lib/derivedRuleForm"
import { postMeltOnlyNames } from "../../lib/derivedReshapeStages"
import {
	applyDerivedVariablesToView,
	buildDerivedCompute,
	derivedMathTypeIssues,
	derivedVariableIssues,
	effectiveDerivedName,
	makeNonNumericLookup,
	nextDefaultDerivedName,
	referencedFields,
	type DerivedRule,
	type DerivedVariable,
	type DerivedVariableKind,
} from "../../lib/derivedVariables"
import type { DatasetView } from "../../lib/types"
import { effectiveType } from "../../lib/fieldType"
import { nameCollides } from "../../lib/nameUniqueness"
import {
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	currentFieldOverridesAtom,
	currentReshapeConfigAtom,
	datasetIndexAtom,
	derivedVariableEditorAtom,
} from "../../store/atoms"
import { saveModeFor, suggestedCopyName } from "../../store/commitDatasetVersion"
import {
	convertedWideDatasetViewAtom,
	derivedReshapeStagesAtom,
	materializedDerivedAtom,
	preDerivedDatasetViewAtom,
} from "../../store/useCurrentDatasetView"
import {
	useRemoveDerivedVariable,
	useSaveDerivedVariable,
	type DerivedTarget,
} from "../../store/useMaterializeVersion"
import { Select } from "../../../../components/ui/Select"
import type { InputProps } from "../../../../components/ui/Input"
import { IconButton } from "../../../../components/ui/IconButton"

const newDerivedVariableId = () =>
	`dvr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const PREVIEW_ROWS = 5

/** The left box holding exactly one `{Variable}` token and nothing else. */
const LONE_TOKEN_RE = /^\{([^{}]+)\}$/

/** The "Formula…" entry at the end of a rule row's dropdowns — not a value
 * but a hand-over of the whole row to a formula box. A control character,
 * so no data value collides. */
const FORMULA_OPTION = "\u0000formula"

const KIND_OPTIONS: ReadonlyArray<{
	value: DerivedVariableKind
	label: string
}> = [
	{ value: "math", label: "Math" },
	{ value: "concat", label: "Combine text" },
	{ value: "rules", label: "If / else" },
]

/** One If/else row as the editor holds it. "compare" is the structured
 * form (left box, comparator, right box); "text" keeps an older free-text
 * condition that can't be shown as a single comparison (AND / OR), so
 * nothing stored is lost. Both compose back to `DerivedRule.condition`. */
type RuleDraft =
	| {
			form: "compare"
			left: string
			op: ComparisonOp
			right: string
			output: string
	  }
	| { form: "text"; condition: string; output: string }

const blankRule = (): RuleDraft => ({
	form: "compare",
	left: "",
	op: "==",
	right: "",
	output: "",
})

const draftFromRule = (rule: DerivedRule): RuleDraft => {
	const parts = splitComparison(rule.condition)
	return parts
		? { form: "compare", ...parts, output: rule.output }
		: { form: "text", condition: rule.condition, output: rule.output }
}

/** Compose a row back to its stored shape; `error` is the row's inline
 * message (blank scaffold rows never scold). */
const ruleFromDraft = (
	d: RuleDraft
): { rule: DerivedRule; error: string | null } => {
	if (d.form === "text") {
		const blank = d.condition.trim() === ""
		const parsed = blank ? null : parseExpression(d.condition)
		return {
			rule: { condition: d.condition, output: d.output },
			error: parsed && !parsed.ok ? parsed.error : null,
		}
	}
	const joined = joinComparison(d)
	if (!joined.ok) return { rule: { condition: "", output: d.output }, error: joined.error }
	// An output with no comparison would never fire — say so rather than
	// saving a dead rule.
	if (joined.condition === "" && d.output.trim() !== "")
		return {
			rule: { condition: "", output: d.output },
			error: "Both sides of the comparison need a value.",
		}
	return { rule: { condition: joined.condition, output: d.output }, error: null }
}

/** Where a variable button inserts: the box that last had focus. Keys name
 * the editor's text boxes; rule boxes are positional. */
type TokenKey = string
const ruleKey = (
	i: number,
	part: "left" | "right" | "output" | "condition"
): TokenKey => `rule-${i}-${part}`
const RULE_KEY_RE = /^rule-(\d+)-(left|right|output|condition)$/

/** An `Input` the variable buttons can target. */
const TokenInput = ({
	tokenKey,
	onActivate,
	...p
}: InputProps & { tokenKey: TokenKey; onActivate: (key: TokenKey) => void }) => (
	<Input data-token-key={tokenKey} onFocus={() => onActivate(tokenKey)} {...p} />
)

/** The create/edit popup for derived variables (math / combine text /
 * if-else). Opened by the data tray's "+" column and the Fields panel's ƒ
 * pill on a derived field; which variable it shows lives in the transient
 * `derivedVariableEditorAtom`. Saving computes the column and stores it as
 * a NEW DATA VERSION (`store/useMaterializeVersion.ts`) — the first change
 * to imported data forks a working copy (the popup takes the copy's name),
 * a change to a working copy appends a version. Editing a variable a
 * version made recomputes its column in place; editing one that still
 * lives in an older visual's config folds that config into the version.
 * Save is disabled while the draft can't apply (name collision, parse
 * error, missing variable) — unlike the view seam, which tolerates broken
 * variables from stale data, the editor refuses to mint them. */
export const DerivedVariableModal = () => {
	const [target, setTarget] = useAtom(derivedVariableEditorAtom)
	const config = useAtomValue(currentDerivedVariablesAtom)
	const materialized = useAtomValue(materializedDerivedAtom)
	const stages = useAtomValue(derivedReshapeStagesAtom)
	const reshape = useAtomValue(currentReshapeConfigAtom)
	const longView = useAtomValue(preDerivedDatasetViewAtom)
	const wideView = useAtomValue(convertedWideDatasetViewAtom)
	if (!target) return null
	// What an edit targets: an older visual's live definition by id, else
	// the definition a data version recorded for one of its columns.
	const legacyExisting =
		target.mode === "edit"
			? config.variables.find((v) => v.id === target.id)
			: undefined
	const storedExisting =
		target.mode === "edit" && !legacyExisting
			? [...materialized.values()].find((v) => v.id === target.id)
			: undefined
	// A stale edit target (variable deleted elsewhere) has nothing to show.
	if (target.mode === "edit" && !legacyExisting && !storedExisting) return null
	const editing: DerivedTarget | null = legacyExisting
		? { kind: "legacy", variable: legacyExisting }
		: storedExisting
			? { kind: "materialized", variable: storedExisting }
			: null
	const existing = legacyExisting
	// A live variable the reshape uses evaluates against the WIDE table
	// (that's where it runs); everything else — including every new variable
	// — against the table as shown, long once a reshape is on. A stored
	// column is recomputed over that table minus itself: a variable never
	// reads its own column.
	const before = existing !== undefined && stages.beforeIds.has(existing.id)
	const base = before ? wideView : longView
	const preView =
		base && storedExisting
			? { ...base, fields: base.fields.filter((f) => f.name !== storedExisting.name) }
			: base
	if (!preView) return null
	// Names a before-melt variable must not reach: the melt's own pair and
	// the variables that only exist after it.
	const lockedNames = before
		? new Set([
				...postMeltOnlyNames(new Set(preView.fields.map((f) => f.name)), reshape),
				...config.variables.flatMap((v, i) =>
					stages.beforeIds.has(v.id) ? [] : [effectiveDerivedName(v, i)]
				),
			])
		: new Set<string>()
	return (
		<DerivedVariableEditor
			// Remount per target so a reopened modal starts from the stored
			// variable (or blank), never a stale draft.
			key={target.mode === "edit" ? target.id : "new"}
			target={editing}
			preView={preView}
			stageIds={before ? stages.beforeIds : stages.afterIds}
			lockedNames={lockedNames}
			onClose={() => setTarget(null)}
		/>
	)
}

const DerivedVariableEditor = ({
	target,
	preView,
	stageIds,
	lockedNames,
	onClose,
}: {
	/** The variable being edited and where it lives; null for a new one. */
	target: DerivedTarget | null
	preView: DatasetView
	/** The variables that run in the same stage as this one (before or
	 * after the melt) — only those are visible upstream of it. */
	stageIds: ReadonlySet<string>
	/** Columns this variable may not reference (reshape-used variables can't
	 * reach the melt's columns); empty for an after-melt variable. */
	lockedNames: ReadonlySet<string>
	onClose: () => void
}) => {
	const config = useAtomValue(currentDerivedVariablesAtom)
	const existing = target?.variable
	const [name, setName] = useState(existing?.name ?? "")
	const [kind, setKind] = useState<DerivedVariableKind>(
		existing?.kind ?? "math"
	)
	const [formula, setFormula] = useState(existing?.math?.formula ?? "")
	const [template, setTemplate] = useState(existing?.concat?.template ?? "")
	const [rules, setRules] = useState<RuleDraft[]>(
		existing?.rules?.rules?.length
			? existing.rules.rules.map(draftFromRule)
			: [blankRule()]
	)
	const [fallback, setFallback] = useState(existing?.rules?.fallback ?? "")
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const nameId = useId()
	// The variable buttons insert into the box that last had focus; null
	// falls back to the current function's first box.
	const [activeKey, setActiveKey] = useState<TokenKey | null>(null)
	// The rule right box being typed in — it stays a text box until it loses
	// focus, so typing "East" on the way to "Eastern" doesn't snap it back
	// to the level list mid-word.
	const [typingKey, setTypingKey] = useState<TokenKey | null>(null)
	const fieldsRef = useRef<HTMLDivElement>(null)

	// This variable's position in the evaluation order — it may reference the
	// variables BEFORE it (and the upstream view columns), never itself or a
	// later one. A stored column, like a new variable, comes after every live
	// definition an older visual still carries.
	const editIndex =
		target?.kind === "legacy"
			? config.variables.findIndex((v) => v.id === target.variable.id)
			: config.variables.length

	/** The view this variable evaluates against: the pre-derived view plus
	 * every EARLIER derived variable of the same stage. Full rows, not a
	 * sample — the Math numeric check has to see every cell before it lets
	 * a formula save; the preview slices this back down to its handful of
	 * rows. */
	const upstream = useMemo(
		() =>
			applyDerivedVariablesToView(
				preView,
				{ variables: config.variables.slice(0, Math.max(editIndex, 0)) },
				stageIds
			) ?? preView,
		[preView, config, editIndex, stageIds]
	)
	// Scanned lazily, once per column (the formula changes on every
	// keystroke; a column's numeric-ness doesn't).
	const nonNumeric = useMemo(
		() => makeNonNumericLookup(upstream.rows),
		[upstream]
	)
	const upstreamNames = useMemo(
		() => new Set(upstream.fields.map((f) => f.name)),
		[upstream]
	)
	const insertableFields = useMemo(
		() => upstream.fields.map((f) => f.name),
		[upstream]
	)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	// Distinct levels of a categorical / ordinal column, in discovery order
	// (matching the legend and the Fields panel), for the right-side
	// dropdown. Scanned lazily, once per column; `null` means "no dropdown"
	// (numeric / date column, or too many levels).
	const levelsFor = useMemo(
		() =>
			makeLevelLookup(upstream.rows, (f) =>
				effectiveType(upstream, f, overrides)
			),
		[upstream, overrides]
	)
	/** The variable a left box names when it holds exactly one `{Token}` of a
	 * categorical / ordinal column — the case where ordering comparisons
	 * ("greater than Peter") make no sense and the right side can list the
	 * levels. A number / date variable, or any calculation, returns null:
	 * every comparator applies and the right side stays open. */
	const loneDiscreteField = (left: string): string | null => {
		const m = LONE_TOKEN_RE.exec(left.trim())
		if (!m || !upstreamNames.has(m[1])) return null
		const type = effectiveType(upstream, m[1], overrides)
		return type === "categorical" || type === "ordinal" ? m[1] : null
	}
	const comparatorsFor = (left: string) =>
		loneDiscreteField(left) === null
			? COMPARISON_OPTIONS
			: COMPARISON_OPTIONS.filter((o) => o.value === "==" || o.value === "!=")
	/** Levels to offer on a rule's right side: only when the left box is a
	 * lone categorical / ordinal variable, the right box isn't being typed
	 * in, and it is empty or already one of its levels (a variable or free
	 * text inserted there keeps the text box, so nothing typed is lost). */
	const rightSideLevels = (
		left: string,
		right: string,
		key: TokenKey
	): string[] | null => {
		const field = loneDiscreteField(left)
		const levels = field === null ? null : levelsFor(field)
		if (!levels || levels.length === 0 || typingKey === key) return null
		return right === "" || levels.some((l) => levelSource(l) === right)
			? levels
			: null
	}
	// Rows as the editor shows AND saves them: a comparator the left side no
	// longer allows (a stored "{Region} > 3", or a left box edited from a
	// number to a category) reads as "=". Derived, not written back, so
	// editing the left side again restores what was there.
	const shownRules = useMemo(
		() =>
			rules.map((r) =>
				r.form === "compare" &&
				!comparatorsFor(r.left).some((o) => o.value === r.op)
					? { ...r, op: "==" as const }
					: r
			),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- comparatorsFor reads only upstream / overrides / upstreamNames
		[rules, upstream, overrides, upstreamNames]
	)

	// The name a blank box commits as: the stored name when editing, else the
	// first free "Variable N". Shown as the placeholder, so what you see is
	// what saves.
	const defaultName = useMemo(
		() =>
			existing?.name ??
			nextDefaultDerivedName([
				...upstream.fields.map((f) => f.name),
				...config.variables.map((v, i) => effectiveDerivedName(v, i)),
			]),
		[existing, upstream, config]
	)
	const effectiveName = name.trim() || defaultName

	// Each row composed back to its stored shape, with its inline error.
	const compiledRules = useMemo(
		() => shownRules.map(ruleFromDraft),
		[shownRules]
	)
	// Fully-blank rule rows are editor scaffolding (one renders by default for
	// discoverability) — they never save.
	const meaningfulRules = useMemo(
		() =>
			compiledRules
				.map((c) => c.rule)
				.filter((r) => r.condition.trim() !== "" || r.output.trim() !== ""),
		[compiledRules]
	)

	const draft: DerivedVariable = useMemo(
		() => ({
			id: existing?.id ?? "draft",
			name: effectiveName,
			kind,
			// All three payloads ride along so flipping kinds keeps each draft.
			math: { formula },
			concat: { template },
			rules: { rules: meaningfulRules, fallback },
		}),
		[existing, effectiveName, kind, formula, template, meaningfulRules, fallback]
	)

	const issues = useMemo(() => {
		let list = derivedVariableIssues(draft, editIndex, upstreamNames)
		// Math over a text column is an error here, not a blank row — the
		// view seam stays lenient, the editor refuses to mint it.
		list = list.concat(derivedMathTypeIssues(draft, upstreamNames, nonNumeric))
		// A variable the reshape uses runs on the wide table, so it can't
		// reach the columns the melt creates — refuse rather than silently
		// dropping it out of the Reshape lists.
		for (const field of referencedFields(draft))
			if (lockedNames.has(field) && !upstreamNames.has(field))
				list.push(
					`Reshape uses this variable, so it can only use the original columns — {${field}} only exists after the reshape. Uncheck it in Reshape first.`
				)
		// The lib check only sees UPSTREAM names; also refuse the name of any
		// other derived variable (a later one would be silently shadowed).
		if (
			config.variables.some(
				(v, i) =>
					v.id !== draft.id &&
					i !== editIndex &&
					effectiveDerivedName(v, i) === effectiveName
			)
		)
			list.push(
				`"${effectiveName}" is already the name of another derived variable.`
			)
		return list
	}, [
		draft,
		editIndex,
		upstreamNames,
		nonNumeric,
		config,
		effectiveName,
		lockedNames,
	])

	// Per-rule errors, keyed by row index; only the If/else body can block.
	const ruleErrors = useMemo(
		() => compiledRules.map((c) => (kind === "rules" ? c.error : null)),
		[compiledRules, kind]
	)
	const anyRuleError = ruleErrors.some((e) => e !== null)

	const preview = useMemo(() => {
		if (issues.length > 0 || anyRuleError) return null
		const compute = buildDerivedCompute(draft, upstreamNames)
		if (!compute) return null
		// Show the variables the draft actually reads next to its result.
		const referenced = (() => {
			if (kind === "math") {
				const parsed = parseExpression(formula)
				return parsed.ok ? parsed.fields : []
			}
			if (kind === "concat")
				return [...template.matchAll(/\{([^{}]+)\}/g)]
					.map((m) => m[1])
					.filter((f, i, all) => upstreamNames.has(f) && all.indexOf(f) === i)
			const fields: string[] = []
			// Outputs and the fallback are {Field} templates too, so the columns
			// they read belong in the preview alongside the condition fields.
			const addTokens = (text: string) => {
				for (const m of text.matchAll(/\{([^{}]+)\}/g))
					if (upstreamNames.has(m[1]) && !fields.includes(m[1]))
						fields.push(m[1])
			}
			for (const r of meaningfulRules) {
				const parsed = parseExpression(r.condition)
				if (parsed.ok)
					for (const f of parsed.fields)
						if (!fields.includes(f)) fields.push(f)
				addTokens(r.output)
			}
			addTokens(fallback)
			return fields
		})().slice(0, 3)
		return {
			referenced,
			rows: upstream.rows
				.slice(0, PREVIEW_ROWS)
				.map((row) => ({ row, result: compute(row) })),
		}
	}, [
		issues,
		anyRuleError,
		draft,
		upstreamNames,
		kind,
		formula,
		template,
		meaningfulRules,
		fallback,
		upstream,
	])

	const updateRule = (i: number, patch: (r: RuleDraft) => RuleDraft) =>
		setRules((prev) => prev.map((r, j) => (j === i ? patch(r) : r)))

	/** Read / write a text box by its token key. */
	const valueOf = (key: TokenKey): string | null => {
		if (key === "formula") return formula
		if (key === "template") return template
		if (key === "fallback") return fallback
		const m = RULE_KEY_RE.exec(key)
		const rule = m ? rules[Number(m[1])] : undefined
		if (!m || !rule) return null
		const part = m[2]
		if (part === "output") return rule.output
		if (rule.form === "text") return part === "condition" ? rule.condition : null
		return part === "left" ? rule.left : part === "right" ? rule.right : null
	}
	const setValueOf = (key: TokenKey, next: string) => {
		if (key === "formula") setFormula(next)
		else if (key === "template") setTemplate(next)
		else if (key === "fallback") setFallback(next)
		else {
			const m = RULE_KEY_RE.exec(key)
			if (!m) return
			const part = m[2]
			updateRule(Number(m[1]), (r) =>
				part === "output"
					? { ...r, output: next }
					: r.form === "text"
						? part === "condition"
							? { ...r, condition: next }
							: r
						: part === "left"
							? { ...r, left: next }
							: part === "right"
								? { ...r, right: next }
								: r
			)
		}
	}
	// The right side of a rule may be a <select> of levels; a chip click on
	// it swaps in a text box holding the token (see `rightSideLevels`).
	const findInput = (key: TokenKey): HTMLInputElement | HTMLSelectElement | null =>
		fieldsRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(
			`[data-token-key="${key}"]`
		) ?? null
	const defaultKey = (): TokenKey => {
		if (kind === "math") return "formula"
		if (kind === "concat") return "template"
		const first = rules[0]
		if (!first) return "fallback"
		return ruleKey(0, first.form === "compare" ? "left" : "condition")
	}
	/** Put the caret at the end of a text box, once it has rendered. */
	const focusBox = (key: TokenKey) => {
		setActiveKey(key)
		window.requestAnimationFrame(() => {
			const el = findInput(key)
			if (!(el instanceof HTMLInputElement)) return
			el.focus()
			el.setSelectionRange(el.value.length, el.value.length)
		})
	}
	/** "Formula…" (from either of a row's menus) folds the three boxes into
	 * one condition box holding what they said, written the way a formula
	 * needs it (text quoted), with the caret at the end to carry on by hand
	 * — AND / OR, another comparison. The row unfolds again when it's left
	 * holding a single comparison. */
	const foldToFormula = (
		i: number,
		row: Extract<RuleDraft, { form: "compare" }>
	) => {
		updateRule(i, () => ({
			form: "text",
			condition: comparisonText(row),
			output: row.output,
		}))
		focusBox(ruleKey(i, "condition"))
	}

	/** Drop a `{Field}` token at the cursor of the active box (or the
	 * function's first box), then put the caret after it. */
	const insertVariable = (fieldName: string) => {
		const token = `{${fieldName}}`
		const key =
			activeKey !== null && valueOf(activeKey) !== null ? activeKey : defaultKey()
		const value = valueOf(key) ?? ""
		const el = findInput(key)
		// A text box takes the token at its caret; the level dropdown has no
		// caret and its chosen level is what the token REPLACES.
		const isInput = el instanceof HTMLInputElement
		const start = isInput ? (el.selectionStart ?? value.length) : el ? 0 : value.length
		const end = isInput ? (el.selectionEnd ?? start) : el ? value.length : start
		setValueOf(key, value.slice(0, start) + token + value.slice(end))
		setActiveKey(key)
		window.requestAnimationFrame(() => {
			const target = findInput(key)
			target?.focus()
			if (target instanceof HTMLInputElement)
				target.setSelectionRange(start + token.length, start + token.length)
		})
	}

	// Where the save lands: the first change to imported data forks a working
	// copy and needs a name for it; a working copy takes a new version.
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const meta = datasetId ? datasetIndex[datasetId] : undefined
	const mode = meta ? saveModeFor(meta) : "fork"
	const [datasetName, setDatasetName] = useState(() =>
		mode === "fork" ? suggestedCopyName(preView.name, "edited") : preView.name
	)
	const datasetNameId = useId()
	// Same-named data sets are allowed (the id is the identity); a collision
	// only warns. Appending keeps the data set, so its own name doesn't count.
	const collides = nameCollides(
		datasetName,
		Object.values(datasetIndex),
		mode === "append" ? (datasetId ?? undefined) : undefined
	)
	const [busy, setBusy] = useState(false)
	const [submitError, setSubmitError] = useState<string | null>(null)
	const saveDerived = useSaveDerivedVariable()
	const removeDerived = useRemoveDerivedVariable()

	const onSave = async () => {
		setBusy(true)
		setSubmitError(null)
		const result = await saveDerived(
			{ ...draft, id: existing?.id ?? newDerivedVariableId() },
			target,
			datasetName
		)
		setBusy(false)
		if (!result.ok) {
			setSubmitError(result.error)
			return
		}
		onClose()
	}

	const onDelete = async () => {
		if (!target) return
		setConfirmingDelete(false)
		setBusy(true)
		setSubmitError(null)
		const result = await removeDerived(target, datasetName)
		setBusy(false)
		if (!result.ok) {
			setSubmitError(result.error)
			return
		}
		onClose()
	}

	const saveDisabled =
		issues.length > 0 || anyRuleError || busy || datasetName.trim() === ""

	return (
		<Modal
			open
			onClose={onClose}
			// Wider than the default so an If/else row (two value boxes, the
			// comparator, the output) fits on one line; the same width for every
			// function so the popup never jumps as you flip.
			widthClass="max-w-2xl"
			title={existing ? "Edit derived variable" : "New derived variable"}
			// Fixed height on purpose: the popup must not resize as you flip
			// Function or pile on rules — the fields region scrolls instead.
			// 800px is sized so an If/else with three rules shows its whole
			// form AND the preview table without scrolling (measured: 638px of
			// fields + 142px of title, padding and footer = 780, plus slack);
			// a fourth rule is what first pushes the preview into the scroll.
			// The Modal's own max-h-full keeps it inside a shorter viewport.
			panelClassName="flex h-[800px] flex-col"
			bodyClassName="flex min-h-0 flex-1 flex-col"
		>
			<div
				ref={fieldsRef}
				className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1"
			>
				<div className="flex items-center gap-3 text-sm">
					<label
						htmlFor={nameId}
						className="w-16 flex-shrink-0 vc-muted"
					>
						Name
					</label>
					<Input
						id={nameId}
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={defaultName}
						className="flex-1"
					/>
				</div>

				<RadioGroup
					legend="Function"
					value={kind}
					options={KIND_OPTIONS}
					onChange={(next) => {
						setKind(next)
						setActiveKey(null)
					}}
				/>

				<div className="flex flex-col gap-1">
					<span className="text-sm vc-muted">Variables</span>
					<div
						role="group"
						aria-label="Insert variable"
						className="flex flex-wrap gap-1"
					>
						{insertableFields.map((f) => (
							<button
								key={f}
								type="button"
								// Keep focus (and the caret) in the box being edited.
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => insertVariable(f)}
								className="vc-toggle-off rounded-control border px-2 py-0.5 font-mono text-xs"
							>
								{f}
							</button>
						))}
					</div>
					<p className="vc-help">
						Click a variable to add it to the box you&apos;re typing in.
					</p>
				</div>

				{kind === "math" && (
					<div className="flex flex-col gap-2">
						<TokenInput
							tokenKey="formula"
							onActivate={setActiveKey}
							value={formula}
							onChange={(e) => setFormula(e.target.value)}
							placeholder="{Sales} / {Count}"
							aria-label="Formula"
							className="font-mono"
						/>
						<p className="vc-help">
							Compute variables with add (+), subtract (-), multiply (*),
							divide (/) and parentheses, e.g.{" "}
							<code className="font-mono">{"({A} - {B}) * 100"}</code>.
						</p>
					</div>
				)}

				{kind === "concat" && (
					<div className="flex flex-col gap-2">
						<TokenInput
							tokenKey="template"
							onActivate={setActiveKey}
							value={template}
							onChange={(e) => setTemplate(e.target.value)}
							placeholder="Some text: {Region}"
							aria-label="Template"
						/>
						<p className="vc-help">
							Mix variables with any text, e.g.{" "}
							<code className="font-mono">{"{Region} / {Year}"}</code>. Text
							outside the variables is kept as typed.
						</p>
					</div>
				)}

				{kind === "rules" && (
					<div className="flex flex-col gap-2">
						{shownRules.map((rule, i) => (
							<div
								// eslint-disable-next-line react/no-array-index-key -- rows are positional edit slots, like the color-rule editors
								key={i}
								className="flex flex-col gap-1"
							>
								<div className="flex items-center gap-2">
									{rule.form === "compare" ? (
										<>
											<TokenInput
												tokenKey={ruleKey(i, "left")}
												onActivate={setActiveKey}
												value={rule.left}
												onChange={(e) =>
													updateRule(i, (r) =>
														r.form === "compare"
															? { ...r, left: e.target.value }
															: r
													)
												}
												placeholder="{Sales}"
												aria-label={`Rule ${i + 1} left side`}
												className="min-w-0 flex-1 font-mono"
											/>
											<Select
												value={rule.op}
												aria-label={`Rule ${i + 1} comparison`}
												onChange={(e) => {
													if (e.target.value === FORMULA_OPTION) {
														foldToFormula(i, rule)
														return
													}
													const op = e.target.value as ComparisonOp
													updateRule(i, (r) =>
														r.form === "compare" ? { ...r, op } : r
													)
												}}
												// Fixed width: the closed box shows one sign, and sizing
												// to the widest entry would let "Formula…" stretch it.
												className="w-14 flex-shrink-0"
											>
												{comparatorsFor(rule.left).map((o) => (
													<option key={o.value} value={o.value} title={o.title}>
														{o.label}
													</option>
												))}
												<option value={FORMULA_OPTION}>Formula…</option>
											</Select>
											{(() => {
												const key = ruleKey(i, "right")
												const levels = rightSideLevels(rule.left, rule.right, key)
												const setRight = (next: string) =>
													updateRule(i, (r) =>
														r.form === "compare" ? { ...r, right: next } : r
													)
												return levels ? (
													<Select
														data-token-key={key}
														onFocus={() => setActiveKey(key)}
														value={rule.right}
														onChange={(e) =>
															e.target.value === FORMULA_OPTION
																? foldToFormula(i, rule)
																: setRight(e.target.value)
														}
														aria-label={`Rule ${i + 1} right side`}
														className="min-w-0 flex-1"
													>
														<option value="">Choose a value…</option>
														{levels.map((level) => (
															<option key={level} value={levelSource(level)}>
																{levelLabel(level)}
															</option>
														))}
														<option value={FORMULA_OPTION}>Formula…</option>
													</Select>
												) : (
													<TokenInput
														tokenKey={key}
														onActivate={(k) => {
															setActiveKey(k)
															setTypingKey(k)
														}}
														onBlur={() =>
															setTypingKey((t) => (t === key ? null : t))
														}
														value={rule.right}
														onChange={(e) => setRight(e.target.value)}
														placeholder="100"
														aria-label={`Rule ${i + 1} right side`}
														className="min-w-0 flex-1 font-mono"
													/>
												)
											})()}
										</>
									) : (
										<TokenInput
											tokenKey={ruleKey(i, "condition")}
											onActivate={setActiveKey}
											// Left holding a single comparison (or nothing), the row
											// unfolds into its three boxes — what reopening would show.
											onBlur={() =>
												updateRule(i, (r) =>
													r.form === "text"
														? draftFromRule({
																condition: r.condition,
																output: r.output,
															})
														: r
												)
											}
											value={rule.condition}
											onChange={(e) =>
												updateRule(i, (r) =>
													r.form === "text"
														? { ...r, condition: e.target.value }
														: r
												)
											}
											placeholder={"{B} == 1 AND {C} > 3"}
											aria-label={`Rule ${i + 1} condition`}
											className="min-w-0 flex-1 font-mono"
										/>
									)}
									<span
										aria-hidden="true"
										className="flex-shrink-0 vc-muted"
									>
										→
									</span>
									<TokenInput
										tokenKey={ruleKey(i, "output")}
										onActivate={setActiveKey}
										value={rule.output}
										onChange={(e) =>
											updateRule(i, (r) => ({ ...r, output: e.target.value }))
										}
										placeholder="value"
										aria-label={`Rule ${i + 1} output`}
										className="w-32 flex-shrink-0"
									/>
									<IconButton
										quiet
										aria-label={`Remove rule ${i + 1}`}
										onClick={() =>
											setRules((prev) => prev.filter((_, j) => j !== i))
										}
										className="w-4 flex-shrink-0"
									>
										×
									</IconButton>
								</div>
								{ruleErrors[i] && (
									<p className="text-xs text-amber-700 dark:text-amber-400">
										{ruleErrors[i]}
									</p>
								)}
							</div>
						))}
						<button
							type="button"
							onClick={() => setRules((prev) => [...prev, blankRule()])}
							className="self-end text-xs text-brand-500 hover:underline dark:text-indigo-400"
						>
							+ Add rule
						</button>
						<div className="flex items-center gap-2">
							<span className="flex-1 text-right text-sm vc-muted">
								Otherwise
							</span>
							<span aria-hidden="true" className="vc-muted">
								→
							</span>
							<TokenInput
								tokenKey="fallback"
								onActivate={setActiveKey}
								value={fallback}
								onChange={(e) => setFallback(e.target.value)}
								placeholder=""
								aria-label="Otherwise output"
								className="w-32 flex-shrink-0"
							/>
							<span aria-hidden="true" className="w-4 flex-shrink-0" />
						</div>
					</div>
				)}

				{issues.length > 0 && (
					<div className="flex flex-col gap-1">
						{issues.map((issue) => (
							<p
								key={issue}
								className="text-xs text-amber-700 dark:text-amber-400"
							>
								{issue}
							</p>
						))}
					</div>
				)}

				{preview && preview.rows.length > 0 && (
					/* flex-shrink-0: the overflow class drops this box's automatic
					 *  min-height to 0, so without it the fields column (a flex column)
					 *  squashes the table to a sliver to fit the fixed panel height — an
					 *  If/else form is tall enough to trigger that — instead of letting
					 *  the column scroll. */
					<div className="flex-shrink-0 overflow-x-auto rounded-md border border-stone-200 dark:border-stone-700">
						<table className="min-w-full text-left text-xs">
							<thead className="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
								<tr>
									{preview.referenced.map((f) => (
										<th key={f} className="px-2 py-1 font-medium">
											{f}
										</th>
									))}
									<th className="px-2 py-1 font-medium text-brand-500 dark:text-indigo-400">
										{effectiveName}
									</th>
								</tr>
							</thead>
							<tbody>
								{preview.rows.map(({ row, result }, i) => (
									<tr
										// eslint-disable-next-line react/no-array-index-key -- preview rows are a static sample
										key={i}
										className="odd:bg-white even:bg-stone-50 dark:odd:bg-stone-900 dark:even:bg-stone-900/50"
									>
										{preview.referenced.map((f) => (
											<td
												key={f}
												className="px-2 py-1 text-stone-600 dark:text-stone-300"
											>
												{row[f] ?? ""}
											</td>
										))}
										<td className="px-2 py-1 font-medium vc-heading">
											{result}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				{mode === "fork" ? (
					<div className="flex flex-col gap-1">
						<p className="text-sm vc-muted">
							Saving creates a new data set altogether.{" "}
							<span className="font-medium vc-text">
								&ldquo;{preView.name}&rdquo;
							</span>{" "}
							stays as it is, and this visualization moves to the copy with the
							new column.
						</p>
						<label htmlFor={datasetNameId} className="text-sm vc-muted">
							Data set name
						</label>
						<Input
							id={datasetNameId}
							value={datasetName}
							onChange={(e) => setDatasetName(e.target.value)}
						/>
						{collides && (
							<div className="vc-notice-warning">
								A data set named &ldquo;{datasetName.trim()}&rdquo; already
								exists. This will be saved as a separate data set with the same
								name.
							</div>
						)}
					</div>
				) : (
					<p className="text-sm vc-muted">
						Saving adds a new version of this data set with the{" "}
						{existing ? "recomputed" : "new"} column; the version list takes
						you back.
					</p>
				)}
				{submitError && (
					<p
						role="alert"
						className="vc-notice-error"
					>
						{submitError}
					</p>
				)}
			</div>

			<div className="mt-4 flex flex-shrink-0 items-center justify-between gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
				{existing ? (
					<Button compact danger onClick={() => setConfirmingDelete(true)}>
						Delete
					</Button>
				) : (
					<span />
				)}
				<div className="flex gap-2">
					<Button compact onClick={onClose}>
						Cancel
					</Button>
					<Button compact disabled={saveDisabled} onClick={() => void onSave()}>
						Save
					</Button>
				</div>
			</div>

			<ConfirmDialog
				open={confirmingDelete}
				title="Delete derived variable"
				message={
					<>
						Delete <strong>{existing?.name}</strong>?{" "}
						{target?.kind === "materialized"
							? "Its column leaves the data in a new version. "
							: ""}
						Anything mapped to it will show no data until you map something
						else.
					</>
				}
				confirmLabel="Delete"
				destructive
				onCancel={() => setConfirmingDelete(false)}
				onConfirm={() => void onDelete()}
			/>
		</Modal>
	)
}
