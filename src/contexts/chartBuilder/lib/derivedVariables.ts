import {
	cellReadsAsNumber,
	evaluateExpression,
	evaluateToCell,
	parseExpression,
} from "./derivedExpression"
import { inferFieldType } from "./inferFieldType"
import type { DatasetView, Field } from "./types"

/** Derived variables: new columns computed from existing ones, applied to the
 * current dataset VIEW at read time as the LAST stage of the view chain
 * (after reshape and the percent/dollar conversions, so Math formulas see
 * plain numeric strings and may reference reshape-minted columns). The
 * stored dataset is never rewritten — the definitions are per-visual config
 * (like ReshapeConfig), so a new version of the data flows through the same
 * definitions and the columns recompute for free.
 *
 * There is deliberately no on/off boolean: a variable applies exactly when
 * it is well-formed against the current view (see `derivedVariableIssues`),
 * and deleting it is the off switch. A variable that CAN'T apply — a name
 * collision, a formula referencing a missing column — is skipped with a
 * warning, never an error: real data always wins and the view never blanks. */
export type DerivedVariableKind = "math" | "concat" | "rules"

export type DerivedRule = {
	/** A boolean expression over {Field} tokens, e.g. `{B} == 1 AND {C} > 3`.
	 * Unparseable conditions never fire (the editor flags them inline). */
	condition: string
	/** Literal output text when the condition is the first to match. */
	output: string
}

export type DerivedVariable = {
	/** Stable id so the editor can target a variable for edit/delete. */
	id: string
	/** The view column name. The editor always saves a concrete name (its
	 * placeholder commits as text), but a blank survives defensively via
	 * `effectiveDerivedName`. */
	name: string
	kind: DerivedVariableKind
	// One payload per kind. Sparse — flipping kinds in the editor keeps each
	// kind's draft, so stray payloads for other kinds are expected and inert.
	/** Math: an arithmetic formula, e.g. `{A} + {B} / {C}`. */
	math?: { formula: string }
	/** Combine text: a {Field} template (the data-label template grammar) —
	 * tokens naming a present column become that row's cell, unknown tokens
	 * stay literal so typos are visible. */
	concat?: { template: string }
	/** If/else: rules checked top-to-bottom, first true condition wins;
	 * no match falls back to `fallback` ("Otherwise"). */
	rules?: { rules: DerivedRule[]; fallback: string }
}

export type DerivedVariablesConfig = { variables: DerivedVariable[] }

export const DEFAULT_DERIVED_VARIABLES_CONFIG: DerivedVariablesConfig = {
	variables: [],
}

/** Blank names fall back to a positional default rather than blocking. */
export const effectiveDerivedName = (
	variable: DerivedVariable,
	index: number
): string => variable.name.trim() || `Variable ${index + 1}`

/** The first "Variable N" not already taken — the editor's name placeholder
 * (and what a blank name box commits as). */
export const nextDefaultDerivedName = (taken: Iterable<string>): string => {
	const names = new Set(taken)
	for (let n = 1; ; n++) {
		const candidate = `Variable ${n}`
		if (!names.has(candidate)) return candidate
	}
}

/** Same token grammar as the data-label templates (lib/dataLabelsStyle.ts):
 * single braces, no nesting. Kept in sync by the shared rename path
 * (`renameLabelTokens` rewrites both). */
const TOKEN_RE = /\{([^{}]+)\}/g

/** Problems that stop a variable from applying against the given upstream
 * column names (the view's columns plus every EARLIER derived variable).
 * Empty = the variable applies. Shown as warnings in the editor; at the view
 * seam a non-empty list means "skip this variable", never an error. */
export const derivedVariableIssues = (
	variable: DerivedVariable,
	index: number,
	availableNames: ReadonlySet<string>
): string[] => {
	const issues: string[] = []
	const name = effectiveDerivedName(variable, index)
	if (availableNames.has(name))
		issues.push(`"${name}" is already the name of a variable in the data.`)
	if (variable.kind === "math") {
		const formula = variable.math?.formula ?? ""
		const parsed = parseExpression(formula)
		if (!parsed.ok) issues.push(parsed.error)
		else
			for (const field of parsed.fields)
				if (!availableNames.has(field))
					issues.push(`{${field}} isn't a variable in the data.`)
	} else if (variable.kind === "concat") {
		if ((variable.concat?.template ?? "").trim() === "")
			issues.push("The text template is empty.")
	} else {
		if ((variable.rules?.rules ?? []).length === 0)
			issues.push("Add at least one rule.")
	}
	return issues
}

/** The first cell in a column that holds something other than a number.
 * Blank cells don't count — a missing value is missing, not text. */
export type NonNumericCell = { rowNumber: number; value: string }

/** How much of an offending cell an error message quotes. */
const SAMPLE_LEN = 24

/** Scan one column for its first non-numeric cell (1-based row number), or
 * `null` when every non-blank cell reads as a number. */
export const firstNonNumericCell = (
	rows: ReadonlyArray<Record<string, string>>,
	field: string
): NonNumericCell | null => {
	for (let i = 0; i < rows.length; i++) {
		const cell = (rows[i]?.[field] ?? "").trim()
		if (cell === "" || cellReadsAsNumber(cell)) continue
		return { rowNumber: i + 1, value: cell }
	}
	return null
}

/** A memoizing per-column wrapper around `firstNonNumericCell`. The editor
 * re-validates on every keystroke, but a column's numeric-ness only changes
 * with the data — so the scan runs once per column per view. */
export const makeNonNumericLookup = (
	rows: ReadonlyArray<Record<string, string>>
): ((field: string) => NonNumericCell | null) => {
	const cache = new Map<string, NonNumericCell | null>()
	return (field) => {
		if (!cache.has(field)) cache.set(field, firstNonNumericCell(rows, field))
		return cache.get(field) ?? null
	}
}

/** Math-only data check: arithmetic over a column holding text is an ERROR,
 * not a blank row — the editor refuses to save such a formula (see
 * `DerivedVariableModal`). Kept separate from `derivedVariableIssues`
 * because it needs the rows, not just the column names, and because the view
 * seam deliberately does NOT enforce it: a saved variable whose data later
 * grows a stray text cell keeps computing, blanking only that row, rather
 * than dropping the whole column out from under the chart.
 *
 * Only fields the formula actually references are checked, and only those
 * that exist upstream (a missing column is already its own issue). */
export const derivedMathTypeIssues = (
	variable: DerivedVariable,
	availableNames: ReadonlySet<string>,
	lookup: (field: string) => NonNumericCell | null
): string[] => {
	if (variable.kind !== "math") return []
	const parsed = parseExpression(variable.math?.formula ?? "")
	if (!parsed.ok) return []
	const issues: string[] = []
	for (const field of parsed.fields) {
		if (!availableNames.has(field)) continue
		const found = lookup(field)
		if (!found) continue
		const sample =
			found.value.length > SAMPLE_LEN
				? `${found.value.slice(0, SAMPLE_LEN)}…`
				: found.value
		issues.push(
			`{${field}} isn't a number in every row — row ${found.rowNumber} is "${sample}". Math needs numeric variables.`
		)
	}
	return issues
}

/** Build the per-row evaluator for one variable, or `null` when the payload
 * can't produce one. `knownNames` snapshots the columns visible to THIS
 * variable (upstream view columns + earlier derived variables) — the concat
 * kind needs it to keep unknown tokens literal. Exported so the editor can
 * run live previews of an unsaved draft. */
export const buildDerivedCompute = (
	variable: DerivedVariable,
	knownNames: ReadonlySet<string>
): ((row: Record<string, string>) => string) | null => {
	if (variable.kind === "math") {
		const parsed = parseExpression(variable.math?.formula ?? "")
		if (!parsed.ok) return null
		return (row) => evaluateToCell(parsed.expr, row)
	}
	if (variable.kind === "concat") {
		const template = variable.concat?.template ?? ""
		if (template.trim() === "") return null
		const known = new Set(knownNames)
		return (row) =>
			template.replace(TOKEN_RE, (token, field: string) =>
				known.has(field) ? (row[field] ?? "") : token
			)
	}
	const rules = variable.rules?.rules ?? []
	if (rules.length === 0) return null
	const fallback = variable.rules?.fallback ?? ""
	// Precompile once; unparseable conditions never fire (matching the
	// data-label color rules' leniency) — the editor flags them inline.
	const compiled = rules.flatMap((rule) => {
		const parsed = parseExpression(rule.condition)
		return parsed.ok ? [{ expr: parsed.expr, output: rule.output }] : []
	})
	return (row) => {
		for (const rule of compiled)
			if (evaluateExpression(rule.expr, row) === true) return rule.output
		return fallback
	}
}

/** How many computed cells feed a derived column's type inference — the
 * inference only reads the first 50 non-empty values anyway (see
 * inferFieldType), so a bounded slice keeps big datasets cheap. */
const TYPE_SAMPLE_CELLS = 2000

/** Apply the derived variables to a resolved DatasetView. Pass-through (same
 * object) when nothing applies, so visuals without derived variables keep
 * the exact upstream identities. Variables evaluate in list order, each
 * seeing the columns of the ones before it — chaining works, and a forward
 * reference is just a missing column (that variable is skipped). */
export const applyDerivedVariablesToView = (
	view: DatasetView | undefined,
	config: DerivedVariablesConfig
): DatasetView | undefined => {
	if (!view || config.variables.length === 0) return view

	const available = new Set(view.fields.map((f) => f.name))
	const applied: Array<{
		name: string
		compute: (row: Record<string, string>) => string
	}> = []
	config.variables.forEach((variable, index) => {
		if (derivedVariableIssues(variable, index, available).length > 0) return
		const compute = buildDerivedCompute(variable, available)
		if (!compute) return
		applied.push({ name: effectiveDerivedName(variable, index), compute })
		available.add(effectiveDerivedName(variable, index))
	})
	if (applied.length === 0) return view

	const rows = view.rows.map((row) => {
		const out: Record<string, string> = { ...row }
		for (const a of applied) out[a.name] = a.compute(out)
		return out
	})
	const fields: Field[] = [
		...view.fields,
		...applied.map(
			(a): Field => ({
				name: a.name,
				inferredType: inferFieldType(
					rows.slice(0, TYPE_SAMPLE_CELLS).map((r) => r[a.name] ?? "")
				),
				derived: true,
			})
		),
	]
	return { ...view, fields, rows }
}
