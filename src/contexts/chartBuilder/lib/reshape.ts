import { inferFieldType } from "./inferFieldType"
import type { DatasetView, Field } from "./types"

/** Wide→long reshape ("melt") applied to the current dataset VIEW at read
 * time. The stored dataset keeps its original wide rows — the reshape is
 * per-visual config (like MapConfig), so the raw upload is never rewritten,
 * a new version of the wide file flows through the same reshape, and
 * unchecking every Combine column restores the wide table instantly.
 * There is deliberately no on/off boolean: the reshape applies exactly when
 * columns are combined (see `reshapeApplies`), and whether the options MENU
 * is showing is separate transient UI state (`reshapePanelOpenAtom`). */
export type ReshapeConfig = {
	/** Columns kept as-is on every output row (NOT melted). */
	idFields: string[]
	/** Columns combined into the variable/value pair. Membership only — the
	 * melt follows the dataset's column order, not check order. */
	meltFields: string[]
	/** Name of the new categorical column holding the melted columns' NAMES. */
	variableName: string
	/** Name of the new column holding the melted columns' cell VALUES. */
	valueName: string
}

export const DEFAULT_RESHAPE_CONFIG: ReshapeConfig = {
	idFields: [],
	meltFields: [],
	variableName: "category",
	valueName: "value",
}

/** Blank name boxes fall back to the defaults ("category" / "value") rather
 * than blocking the reshape — clear-to-default, like the app's other
 * auto-fallback inputs. The panel shows the fallback as the placeholder. */
export const effectiveVariableName = (config: ReshapeConfig): string =>
	config.variableName.trim() || DEFAULT_RESHAPE_CONFIG.variableName
export const effectiveValueName = (config: ReshapeConfig): string =>
	config.valueName.trim() || DEFAULT_RESHAPE_CONFIG.valueName

/** The ID columns actually present in the dataset, in dataset column order.
 * The config may hold stale names (version switch, field prune) — those are
 * ignored rather than treated as errors. */
export const presentIdFields = (
	fields: Field[],
	config: ReshapeConfig
): Field[] => fields.filter((f) => config.idFields.includes(f.name))

/** The melt columns actually present in the dataset, in dataset column
 * order. A name checked as an ID column wins over a stale melt entry. */
export const presentMeltFields = (
	fields: Field[],
	config: ReshapeConfig
): Field[] =>
	fields.filter(
		(f) =>
			config.meltFields.includes(f.name) && !config.idFields.includes(f.name)
	)

/** Naming problems that stop the reshape from applying (shown as
 * panel warnings). Empty = the names are fine. Melt-column collisions are
 * impossible by construction (melted columns don't appear in the output),
 * so only ID columns and the pair itself can collide. */
export const reshapeIssues = (
	fields: Field[],
	config: ReshapeConfig
): string[] => {
	const issues: string[] = []
	const variableName = effectiveVariableName(config)
	const valueName = effectiveValueName(config)
	if (variableName === valueName)
		issues.push("The combined and value variables need different names.")
	const kept = new Set(presentIdFields(fields, config).map((f) => f.name))
	for (const name of new Set([variableName, valueName]))
		if (kept.has(name))
			issues.push(`"${name}" is already the name of an ID column.`)
	return issues
}

/** True when the config actually reshapes: at least one present melt column
 * and no naming issues. While false the wide view passes through untouched —
 * the panel can stay open in a half-configured state without blanking the
 * chart, and unchecking every Combine column is how the reshape turns off. */
export const reshapeApplies = (
	fields: Field[],
	config: ReshapeConfig
): boolean =>
	presentMeltFields(fields, config).length > 0 &&
	reshapeIssues(fields, config).length === 0

export type ReshapedData = {
	fields: Field[]
	rows: Array<Record<string, string>>
}

/** How many melted cells feed the value column's type inference. The
 * inference only reads the first 50 non-empty values anyway (see
 * inferFieldType), so a bounded slice keeps re-melts cheap on big datasets
 * without changing the result — melt order interleaves the melt columns
 * within each row, so every combined column is represented in the sample. */
const TYPE_SAMPLE_CELLS = 2000

/** Melt wide rows into long: each input row becomes one output row per melt
 * column, carrying the ID columns plus `{ [variableName]: columnName,
 * [valueName]: cellValue }`. Columns in neither list are dropped. Empty
 * cells melt to empty strings rather than being skipped, mirroring how the
 * wide table reads. Callers gate on `reshapeApplies` first. */
export const meltDataset = (
	fields: Field[],
	rows: Array<Record<string, string>>,
	config: ReshapeConfig
): ReshapedData => {
	const idFields = presentIdFields(fields, config)
	const meltFields = presentMeltFields(fields, config)
	const variableName = effectiveVariableName(config)
	const valueName = effectiveValueName(config)
	const outRows: Array<Record<string, string>> = []
	for (const row of rows) {
		const base: Record<string, string> = {}
		for (const f of idFields) base[f.name] = row[f.name] ?? ""
		for (const m of meltFields)
			outRows.push({
				...base,
				[variableName]: m.name,
				[valueName]: row[m.name] ?? "",
			})
	}
	const outFields: Field[] = [
		...idFields,
		{ name: variableName, inferredType: "categorical" },
		{
			name: valueName,
			inferredType: inferFieldType(
				outRows.slice(0, TYPE_SAMPLE_CELLS).map((r) => r[valueName] ?? "")
			),
		},
	]
	return { fields: outFields, rows: outRows }
}

/** Apply the reshape to a resolved DatasetView. Pass-through (same object)
 * when the reshape doesn't apply, so non-reshaped visuals keep the exact
 * pre-reshape identities. */
export const applyReshapeToView = (
	view: DatasetView | undefined,
	config: ReshapeConfig
): DatasetView | undefined => {
	if (!view || !reshapeApplies(view.fields, config)) return view
	const { fields, rows } = meltDataset(view.fields, view.rows, config)
	return { ...view, fields, rows }
}
