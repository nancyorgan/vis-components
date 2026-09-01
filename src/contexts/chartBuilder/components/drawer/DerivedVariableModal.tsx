import { useAtom, useAtomValue } from "jotai"
import { useAtomCallback } from "jotai/utils"
import { useCallback, useId, useMemo, useRef, useState } from "react"
import { Button } from "../../../../components/ui/Button"
import { Input } from "../../../../components/ui/Input"
import { ConfirmDialog, Modal } from "../../../../components/ui/Modal"
import { RadioGroup } from "../../../../components/ui/RadioGroup"
import { parseExpression } from "../../lib/derivedExpression"
import {
	applyDerivedVariablesToView,
	buildDerivedCompute,
	derivedMathTypeIssues,
	derivedVariableIssues,
	effectiveDerivedName,
	makeNonNumericLookup,
	nextDefaultDerivedName,
	type DerivedRule,
	type DerivedVariable,
	type DerivedVariableKind,
} from "../../lib/derivedVariables"
import type { DatasetView } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	datasetIndexAtom,
	derivedVariableEditorAtom,
} from "../../store/atoms"
import { preDerivedDatasetViewAtom } from "../../store/useCurrentDatasetView"
import { renameFieldAcrossEditorAtoms } from "../../store/useRenameField"

const newDerivedVariableId = () =>
	`dvr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const PREVIEW_ROWS = 5

const KIND_OPTIONS: ReadonlyArray<{
	value: DerivedVariableKind
	label: string
}> = [
	{ value: "math", label: "Math" },
	{ value: "concat", label: "Combine text" },
	{ value: "rules", label: "If / else" },
]

/** A `<select>` that inserts a `{Field}` token at the target input's cursor.
 * Always snaps back to the placeholder row, so it acts as a button menu. */
const InsertVariableSelect = ({
	fields,
	onInsert,
}: {
	fields: string[]
	onInsert: (fieldName: string) => void
}) => (
	<select
		value=""
		aria-label="Insert variable"
		onChange={(e) => {
			if (e.target.value) onInsert(e.target.value)
		}}
		className="rounded-sm border border-stone-300 bg-white px-1.5 py-1 text-xs text-stone-600 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
	>
		<option value="">Insert variable…</option>
		{fields.map((f) => (
			<option key={f} value={f}>
				{f}
			</option>
		))}
	</select>
)

/** The create/edit popup for derived variables (math / combine text /
 * if-else). Opened by the data tray's "+" column and the Fields panel's
 * pencil on a derived field; which variable it shows lives in the transient
 * `derivedVariableEditorAtom`. Save is disabled while the draft can't apply
 * (name collision, parse error, missing variable) — unlike the view seam,
 * which tolerates broken variables from stale data, the editor refuses to
 * mint them. */
export const DerivedVariableModal = () => {
	const [target, setTarget] = useAtom(derivedVariableEditorAtom)
	const config = useAtomValue(currentDerivedVariablesAtom)
	const preView = useAtomValue(preDerivedDatasetViewAtom)
	if (!target || !preView) return null
	const existing =
		target.mode === "edit"
			? config.variables.find((v) => v.id === target.id)
			: undefined
	// A stale edit target (variable deleted elsewhere) has nothing to show.
	if (target.mode === "edit" && !existing) return null
	return (
		<DerivedVariableEditor
			// Remount per target so a reopened modal starts from the stored
			// variable (or blank), never a stale draft.
			key={target.mode === "edit" ? target.id : "new"}
			existing={existing}
			preView={preView}
			onClose={() => setTarget(null)}
		/>
	)
}

const DerivedVariableEditor = ({
	existing,
	preView,
	onClose,
}: {
	existing: DerivedVariable | undefined
	preView: DatasetView
	onClose: () => void
}) => {
	const config = useAtomValue(currentDerivedVariablesAtom)
	const [name, setName] = useState(existing?.name ?? "")
	const [kind, setKind] = useState<DerivedVariableKind>(
		existing?.kind ?? "math"
	)
	const [formula, setFormula] = useState(existing?.math?.formula ?? "")
	const [template, setTemplate] = useState(existing?.concat?.template ?? "")
	const [rules, setRules] = useState<DerivedRule[]>(
		existing?.rules?.rules?.length
			? existing.rules.rules
			: [{ condition: "", output: "" }]
	)
	const [fallback, setFallback] = useState(existing?.rules?.fallback ?? "")
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const nameId = useId()
	const formulaRef = useRef<HTMLInputElement>(null)
	const templateRef = useRef<HTMLInputElement>(null)

	// This variable's position in the evaluation order — it may reference the
	// variables BEFORE it (and the upstream view columns), never itself or a
	// later one.
	const editIndex = existing
		? config.variables.findIndex((v) => v.id === existing.id)
		: config.variables.length

	/** The view this variable evaluates against: the pre-derived view plus
	 * every EARLIER derived variable. Full rows, not a sample — the Math
	 * numeric check has to see every cell before it lets a formula save; the
	 * preview slices this back down to its handful of rows. */
	const upstream = useMemo(
		() =>
			applyDerivedVariablesToView(preView, {
				variables: config.variables.slice(0, Math.max(editIndex, 0)),
			}) ?? preView,
		[preView, config, editIndex]
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

	// Fully-blank rule rows are editor scaffolding (one renders by default for
	// discoverability) — they never save.
	const meaningfulRules = useMemo(
		() =>
			rules.filter((r) => r.condition.trim() !== "" || r.output.trim() !== ""),
		[rules]
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
		const list = derivedVariableIssues(draft, editIndex, upstreamNames)
		// Math over a text column is an error here, not a blank row — the
		// view seam stays lenient, the editor refuses to mint it.
		list.push(...derivedMathTypeIssues(draft, upstreamNames, nonNumeric))
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
	}, [draft, editIndex, upstreamNames, nonNumeric, config, effectiveName])

	// Per-rule parse errors, keyed by row index (blank conditions excluded —
	// they never fire, and the blank scaffolding row shouldn't scold).
	const ruleErrors = useMemo(
		() =>
			rules.map((r) => {
				if (kind !== "rules" || r.condition.trim() === "") return null
				const parsed = parseExpression(r.condition)
				return parsed.ok ? null : parsed.error
			}),
		[rules, kind]
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
			for (const r of meaningfulRules) {
				const parsed = parseExpression(r.condition)
				if (parsed.ok)
					for (const f of parsed.fields)
						if (!fields.includes(f)) fields.push(f)
			}
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
		upstream,
	])

	const insertToken = (
		ref: React.RefObject<HTMLInputElement>,
		value: string,
		setValue: (next: string) => void,
		fieldName: string
	) => {
		const token = `{${fieldName}}`
		const el = ref.current
		const start = el?.selectionStart ?? value.length
		const end = el?.selectionEnd ?? start
		setValue(value.slice(0, start) + token + value.slice(end))
		window.requestAnimationFrame(() => {
			el?.focus()
			el?.setSelectionRange(start + token.length, start + token.length)
		})
	}

	const commit = useAtomCallback(
		useCallback(
			(get, set, saved: DerivedVariable, previousName: string | null) => {
				const cfg = get(currentDerivedVariablesAtom)
				const exists = cfg.variables.some((v) => v.id === saved.id)
				set(currentDerivedVariablesAtom, {
					variables: exists
						? cfg.variables.map((v) => (v.id === saved.id ? saved : v))
						: [...cfg.variables, saved],
				})
				// Renaming a derived variable rewrites this visual's references —
				// encodings, per-field maps, templates, and later variables'
				// expressions. Per-visual scope only: derived names can't be
				// referenced by sibling visuals or the dataset.
				if (previousName !== null && previousName !== saved.name) {
					const datasetId = get(currentDatasetIdAtom)
					const fields = datasetId
						? (get(datasetIndexAtom)[datasetId]?.fields ?? [])
						: []
					renameFieldAcrossEditorAtoms(
						get,
						set,
						fields,
						previousName,
						saved.name
					)
				}
			},
			[]
		)
	)

	const removeVariable = useAtomCallback(
		useCallback((get, set, id: string) => {
			const cfg = get(currentDerivedVariablesAtom)
			set(currentDerivedVariablesAtom, {
				variables: cfg.variables.filter((v) => v.id !== id),
			})
		}, [])
	)

	const onSave = () => {
		commit(
			{ ...draft, id: existing?.id ?? newDerivedVariableId() },
			existing?.name ?? null
		)
		onClose()
	}

	const saveDisabled = issues.length > 0 || anyRuleError

	return (
		<Modal
			open
			onClose={onClose}
			widthClass="max-w-lg"
			title={existing ? "Edit derived variable" : "New derived variable"}
			// Fixed height on purpose: the popup must not resize as you flip
			// Function or pile on rules — the fields region scrolls instead.
			panelClassName="flex h-[580px] max-h-[85vh] flex-col"
			bodyClassName="flex min-h-0 flex-1 flex-col"
		>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
				<div className="flex items-center gap-3 text-sm">
					<label
						htmlFor={nameId}
						className="w-16 flex-shrink-0 text-stone-600 dark:text-stone-400"
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
					orientation="horizontal"
					value={kind}
					options={KIND_OPTIONS}
					onChange={setKind}
				/>

				{kind === "math" && (
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<Input
								ref={formulaRef}
								value={formula}
								onChange={(e) => setFormula(e.target.value)}
								placeholder="{Sales} / {Count}"
								className="flex-1 font-mono"
							/>
							<InsertVariableSelect
								fields={insertableFields}
								onInsert={(f) => insertToken(formulaRef, formula, setFormula, f)}
							/>
						</div>
						<p className="text-xs text-stone-500 dark:text-stone-400">
							Reference variables in braces and combine with add (+), subtract (-), multiply (*), divide (/) and
							parentheses, e.g.{" "}
							<code className="font-mono">{"({A} - {B}) * 100"}</code>. Every
							variable you reference has to be a number — text values are an
							error, and blank cells come out blank.
						</p>
					</div>
				)}

				{kind === "concat" && (
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<Input
								ref={templateRef}
								value={template}
								onChange={(e) => setTemplate(e.target.value)}
								placeholder="Some text: {Region}"
								className="flex-1"
							/>
							<InsertVariableSelect
								fields={insertableFields}
								onInsert={(f) =>
									insertToken(templateRef, template, setTemplate, f)
								}
							/>
						</div>
						<p className="text-xs text-stone-500 dark:text-stone-400">
							Reference variables in braces, e.g.{" "}
							<code className="font-mono">{"{Region} / {Year}"}</code>. Text
							outside braces is kept as typed.
						</p>
					</div>
				)}

				{kind === "rules" && (
					<div className="flex flex-col gap-2">
						{rules.map((rule, i) => (
							<div
								// eslint-disable-next-line react/no-array-index-key -- rows are positional edit slots, like the color-rule editors
								key={i}
								className="flex flex-col gap-1"
							>
								<div className="flex items-center gap-2">
									<Input
										value={rule.condition}
										onChange={(e) =>
											setRules((prev) =>
												prev.map((r, j) =>
													j === i ? { ...r, condition: e.target.value } : r
												)
											)
										}
										placeholder={'{B} == 1 AND {C} > 3'}
										aria-label={`Rule ${i + 1} condition`}
										className="min-w-0 flex-1 font-mono"
									/>
									<span
										aria-hidden="true"
										className="flex-shrink-0 text-stone-400"
									>
										→
									</span>
									<Input
										value={rule.output}
										onChange={(e) =>
											setRules((prev) =>
												prev.map((r, j) =>
													j === i ? { ...r, output: e.target.value } : r
												)
											)
										}
										placeholder="value"
										aria-label={`Rule ${i + 1} output`}
										className="w-28 flex-shrink-0"
									/>
									<button
										type="button"
										aria-label={`Remove rule ${i + 1}`}
										onClick={() =>
											setRules((prev) => prev.filter((_, j) => j !== i))
										}
										className="flex-shrink-0 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
									>
										×
									</button>
								</div>
								{ruleErrors[i] && (
									<p className="text-xs text-amber-700 dark:text-amber-400">
										{ruleErrors[i]}
									</p>
								)}
							</div>
						))}
						<div className="flex items-center gap-2">
							<span className="text-sm text-stone-600 dark:text-stone-400">
								Otherwise
							</span>
							<span aria-hidden="true" className="text-stone-400">
								→
							</span>
							<Input
								value={fallback}
								onChange={(e) => setFallback(e.target.value)}
								placeholder=""
								aria-label="Otherwise output"
								className="w-28"
							/>
						</div>
						<button
							type="button"
							onClick={() =>
								setRules((prev) => [...prev, { condition: "", output: "" }])
							}
							className="self-start text-xs text-indigo-600 hover:underline dark:text-indigo-400"
						>
							+ Add rule
						</button>
						<p className="text-xs text-stone-500 dark:text-stone-400">
							Rules run top to bottom; the first match wins. Compare with{" "}
							<code className="font-mono">{"> < >= <= == !="}</code>, combine
							with AND / OR, and reference variables in braces, e.g.{" "}
							<code className="font-mono">{'{Region} == "West"'}</code> or{" "}
							<code className="font-mono">{"1 < {B} OR {B} < 2"}</code>.
						</p>
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
					<div className="overflow-x-auto rounded-md border border-stone-200 dark:border-stone-700">
						<table className="min-w-full text-left text-xs">
							<thead className="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
								<tr>
									{preview.referenced.map((f) => (
										<th key={f} className="px-2 py-1 font-medium">
											{f}
										</th>
									))}
									<th className="px-2 py-1 font-medium text-indigo-600 dark:text-indigo-400">
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
										<td className="px-2 py-1 font-medium text-stone-900 dark:text-white">
											{result}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
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
					<Button compact outline onClick={onClose}>
						Cancel
					</Button>
					<Button compact disabled={saveDisabled} onClick={onSave}>
						Save
					</Button>
				</div>
			</div>

			<ConfirmDialog
				open={confirmingDelete}
				title="Delete derived variable"
				message={
					<>
						Delete <strong>{existing?.name}</strong>? Anything mapped to it
						will show no data until you map something else.
					</>
				}
				confirmLabel="Delete"
				destructive
				onCancel={() => setConfirmingDelete(false)}
				onConfirm={() => {
					if (existing) removeVariable(existing.id)
					setConfirmingDelete(false)
					onClose()
				}}
			/>
		</Modal>
	)
}
