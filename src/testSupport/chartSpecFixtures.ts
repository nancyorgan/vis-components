import { datasetMetaFrom } from "../contexts/chartBuilder/lib/datasetMeta"
import { SYSTEM_LIGHT_THEME, themeOf } from "../contexts/chartBuilder/lib/systemThemes"
import type { Dataset, FieldType, Folder } from "../contexts/chartBuilder/lib/types"
import type { ComposeContext } from "../contexts/chartBuilder/lib/visualSpec/composeVisual"
import { buildDataset } from "./fixtures"

/** Small inline datasets for the chart-spec suites. */

export const FOLDER: Folder = {
	id: "fl-reports",
	name: "Reports",
	parentId: null,
	createdAt: 0,
}

const table = (
	id: string,
	fields: Array<[string, FieldType]>,
	rows: Array<Array<string | number>>
): Dataset =>
	buildDataset({
		id,
		name: id,
		fields: fields.map(([name, inferredType]) => ({ name, inferredType })),
		rows: rows.map((r) => Object.fromEntries(fields.map(([name], i) => [name, String(r[i])]))),
	})

/** A made-up cafe's monthly sales: 3 months x 3 flavors. */
export const CAFE = table(
	"ds-cafe",
	[
		["month", "ordinal"],
		["flavor", "categorical"],
		["muffins", "quantitative"],
		["coffees", "quantitative"],
	],
	["2026-01", "2026-02", "2026-03"].flatMap((month, m) =>
		["Blueberry", "Bran", "Lemon"].map((flavor, f) => [month, flavor, 10 + m * 3 + f, 40 + m * 5 - f])
	)
)

/** Counts by day. */
export const DATES = table(
	"ds-dates",
	[
		["day", "temporal"],
		["n", "quantitative"],
	],
	[
		["2026-01-01", 1],
		["2026-01-02", 3],
		["2026-01-04", 2],
	]
)

export const THEME = SYSTEM_LIGHT_THEME

/** The context a caller hands `composeVisual`: the spec's dataset (when it
 *  exists) with the rows of its latest version. */
export const contextFor = (datasets: Dataset[], datasetId: unknown): ComposeContext => {
	const dataset = datasets.find((d) => d.id === datasetId)
	const version = dataset?.versions.find((v) => v.id === dataset.latestVersionId)
	return {
		dataset: dataset ? { meta: datasetMetaFrom(dataset), rows: version?.rows ?? [] } : null,
		folders: [FOLDER],
		theme: themeOf(THEME),
		themeId: THEME.id,
		now: 1_700_000_000_000,
		id: "vs-spec-test",
	}
}
