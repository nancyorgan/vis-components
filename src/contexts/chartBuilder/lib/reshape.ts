import { max } from "d3-array"
import { inferFieldType } from "./inferFieldType"
import type { DatasetView, Field } from "./types"

/** Wide→long reshape ("melt") of a dataset view. The stored dataset keeps
 * its original wide rows — applying a reshape saves the long table as a new
 * data VERSION (`materializeTransforms.ts`), and the config is recorded on
 * that version's `transform` so a fresh wide file can be reshaped the same
 * way. Older visuals still carry it live, per visual; see
 * `currentDatasetViewAtom`. There is deliberately no on/off boolean: the
 * reshape applies exactly when columns are combined (see `reshapeApplies`).
 *
 * A reshape has one or more column GROUPS. Each group melts its columns into
 * its own category + value pair; a second group pairs with the first by
 * POSITION — the i-th column of every group lands on the same output row
 * (`sales_2023, cost_2023, sales_2024, cost_2024` → year, sales, cost). A
 * group shorter than the longest gets blank cells on the rows past its last
 * column. The first group is the config's own `meltFields` / `variableName` /
 * `valueName` (the original single-group shape); the rest sit in
 * `extraGroups`, optional and additive, so nothing stored needs migrating. */
export type ReshapeGroup = {
	/** Columns combined into this group's variable/value pair. Membership
	 * only — the melt follows the dataset's column order, not check order. */
	meltFields: string[]
	/** Name of the new categorical column holding the melted columns' NAMES. */
	variableName: string
	/** Name of the new column holding the melted columns' cell VALUES. */
	valueName: string
}

export type ReshapeConfig = ReshapeGroup & {
	/** Columns kept as-is on every output row (NOT melted). */
	idFields: string[]
	/** Further column groups, paired with the first by position. */
	extraGroups?: ReshapeGroup[]
}

export const DEFAULT_RESHAPE_CONFIG: ReshapeConfig = {
	idFields: [],
	meltFields: [],
	variableName: "category",
	valueName: "value",
}

/** Every group of the config, the first one first. */
export const reshapeGroups = (config: ReshapeConfig): ReshapeGroup[] => [
	{
		meltFields: config.meltFields,
		variableName: config.variableName,
		valueName: config.valueName,
	},
	...(config.extraGroups ?? []),
]

/** A group's default names: "category" / "value" for the first group,
 * "category 2" / "value 2" for the second, and so on. */
export const defaultGroupVariableName = (index: number): string =>
	index === 0
		? DEFAULT_RESHAPE_CONFIG.variableName
		: `${DEFAULT_RESHAPE_CONFIG.variableName} ${index + 1}`
export const defaultGroupValueName = (index: number): string =>
	index === 0
		? DEFAULT_RESHAPE_CONFIG.valueName
		: `${DEFAULT_RESHAPE_CONFIG.valueName} ${index + 1}`

/** Blank name boxes fall back to the group's defaults rather than blocking
 * the reshape — clear-to-default, like the app's other auto-fallback inputs.
 * The panel shows the fallback as the placeholder. */
export const effectiveGroupVariableName = (
	group: ReshapeGroup,
	index: number
): string => group.variableName.trim() || defaultGroupVariableName(index)
export const effectiveGroupValueName = (
	group: ReshapeGroup,
	index: number
): string => group.valueName.trim() || defaultGroupValueName(index)

/** The names the melt mints — every group's pair, in group order. */
export const mintedNames = (config: ReshapeConfig): string[] =>
	reshapeGroups(config).flatMap((g, i) => [
		effectiveGroupVariableName(g, i),
		effectiveGroupValueName(g, i),
	])

/** Every column any group combines (membership, not presence). */
export const allMeltFields = (config: ReshapeConfig): string[] =>
	reshapeGroups(config).flatMap((g) => g.meltFields)

/** The ID columns actually present in the dataset, in dataset column order.
 * The config may hold stale names (version switch, field prune) — those are
 * ignored rather than treated as errors. */
const presentIdFields = (
	fields: Field[],
	config: ReshapeConfig
): Field[] => fields.filter((f) => config.idFields.includes(f.name))

/** One group as the melt sees it: its present columns in dataset order and
 * its effective names. `index` is the group's position in the config. */
export type PresentGroup = {
	index: number
	fields: Field[]
	variableName: string
	valueName: string
}

/** Every group's present melt columns, in dataset column order, by group.
 * A name checked as an ID column wins over a stale melt entry, and a column
 * listed by two groups goes to the earlier one (the panel never lets that
 * happen; a stale config might). */
export const presentGroupFields = (
	fields: Field[],
	config: ReshapeConfig
): Field[][] => {
	const claimed = new Set(config.idFields)
	return reshapeGroups(config).map((g) => {
		const own = fields.filter(
			(f) => g.meltFields.includes(f.name) && !claimed.has(f.name)
		)
		for (const f of own) claimed.add(f.name)
		return own
	})
}

/** The groups that actually melt something — a group with no present
 * column mints nothing and is left out (an empty "+ Add another group"
 * row in the panel, or a stale entry). */
export const presentGroups = (
	fields: Field[],
	config: ReshapeConfig
): PresentGroup[] => {
	const own = presentGroupFields(fields, config)
	return reshapeGroups(config).flatMap((group, index) => {
		const present = own[index] ?? []
		return present.length === 0
			? []
			: [
					{
						index,
						fields: present,
						variableName: effectiveGroupVariableName(group, index),
						valueName: effectiveGroupValueName(group, index),
					},
				]
	})
}

/** The melt columns actually present in the dataset, across every group,
 * in dataset column order. */
export const presentMeltFields = (
	fields: Field[],
	config: ReshapeConfig
): Field[] => {
	const melted = new Set(
		presentGroupFields(fields, config).flatMap((own) => own.map((f) => f.name))
	)
	return fields.filter((f) => melted.has(f.name))
}

/** The effective name of the category column a melted column's NAME lands
 * in — the variable column of the group that combines it. Undefined when no
 * present group combines the column. */
export const meltVariableNameOf = (
	fields: Field[],
	config: ReshapeConfig,
	columnName: string
): string | undefined =>
	presentGroups(fields, config).find((g) =>
		g.fields.some((f) => f.name === columnName)
	)?.variableName

/** Naming problems that stop the reshape from applying (shown as
 * panel warnings). Empty = the names are fine. Only the groups that melt
 * something count — an empty group mints no columns. Melt-column collisions
 * are impossible by construction (melted columns don't appear in the
 * output), so only ID columns and the minted names can collide. */
export const reshapeIssues = (
	fields: Field[],
	config: ReshapeConfig
): string[] => {
	const issues: string[] = []
	const groups = presentGroups(fields, config)
	for (const g of groups)
		if (g.variableName === g.valueName)
			issues.push(
				g.index === 0
					? "The combined and value variables need different names."
					: `Group ${g.index + 1}'s combined and value variables need different names.`
			)
	const kept = new Set(presentIdFields(fields, config).map((f) => f.name))
	const seen = new Set<string>()
	for (const g of groups)
		for (const name of new Set([g.variableName, g.valueName])) {
			if (kept.has(name))
				issues.push(`"${name}" is already the name of an ID column.`)
			else if (seen.has(name)) issues.push(`"${name}" is used by two groups.`)
			seen.add(name)
		}
	return [...new Set(issues)]
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

/** How many melted cells feed a value column's type inference. The
 * inference only reads the first 50 non-empty values anyway (see
 * inferFieldType), so a bounded slice keeps re-melts cheap on big datasets
 * without changing the result — melt order interleaves the melt columns
 * within each row, so every combined column is represented in the sample. */
const TYPE_SAMPLE_CELLS = 2000

/** Melt wide rows into long: each input row becomes one output row per
 * position in the longest group, carrying the ID columns plus, for every
 * group, `{ [variableName]: columnName, [valueName]: cellValue }` of the
 * column at that position — blank for a group that has no column there.
 * Columns in no list are dropped. Empty cells melt to empty strings rather
 * than being skipped, mirroring how the wide table reads. Callers gate on
 * `reshapeApplies` first. */
export const meltDataset = (
	fields: Field[],
	rows: Array<Record<string, string>>,
	config: ReshapeConfig
): ReshapedData => {
	const idFields = presentIdFields(fields, config)
	const groups = presentGroups(fields, config)
	const depth = Math.max(0, max(groups, (g) => g.fields.length) ?? 0)
	const outRows: Array<Record<string, string>> = []
	for (const row of rows) {
		const base: Record<string, string> = {}
		for (const f of idFields) base[f.name] = row[f.name] ?? ""
		for (let k = 0; k < depth; k++) {
			const out = { ...base }
			for (const g of groups) {
				const column = g.fields[k]
				out[g.variableName] = column?.name ?? ""
				out[g.valueName] = column ? (row[column.name] ?? "") : ""
			}
			outRows.push(out)
		}
	}
	const sample = outRows.slice(0, TYPE_SAMPLE_CELLS)
	const outFields: Field[] = [
		...idFields,
		...groups.flatMap((g): Field[] => [
			{ name: g.variableName, inferredType: "categorical" },
			{
				name: g.valueName,
				inferredType: inferFieldType(sample.map((r) => r[g.valueName] ?? "")),
			},
		]),
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
