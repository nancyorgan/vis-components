import { datasetMetaFrom } from "../contexts/chartBuilder/lib/datasetMeta"
import { SYSTEM_LIGHT_THEME, themeOf } from "../contexts/chartBuilder/lib/systemThemes"
import type {
	Dataset,
	FieldType,
	Folder,
} from "../contexts/chartBuilder/lib/types"
import type { ComposeContext } from "../contexts/chartBuilder/lib/visualSpec/composeVisual"
import type { ChartSpec } from "../contexts/chartBuilder/lib/visualSpec/chartSpec"
import { buildDataset } from "./fixtures"

/** Small inline datasets and chart specs for the chart-spec suites. The six
 *  `TRENDS_*` charts are bar charts from a published trends report, kept at
 *  the shape of their source tables (percent cells as printed, category
 *  order as printed); the cafe table is a made-up toy. */

export const FOLDER: Folder = {
	id: "fl-trends",
	name: "Trends",
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
		rows: rows.map((r) =>
			Object.fromEntries(fields.map(([name], i) => [name, String(r[i])]))
		),
	})

const NAVY = "#0B2A5B"
const LAV = "#9C8CF2"
const PURPLE = "#4B2FE0"
const GRAY = "#CCCCCC"
const ORANGE = "#F28C28"
const INK = "#1F2937"

const subtitle = (page: number, source: string) =>
	`2026 Trends Report, p. ${page} · Source: ${source}`

const T1_ROWS: Array<[string, string, string]> = [
	["Age", "<18", "6.0%"],
	["Age", "18-64", "11.3%"],
	["Age", "≥65", "0.8%"],
	["Income", "Under $25,000", "11.7%"],
	["Income", "$25,000 to $49,999", "12.2%"],
	["Income", "$50,000 to $74,999", "11.0%"],
	["Income", "$75,000 to $99,999", "9.5%"],
	["Income", "$100,000 and over", "5.3%"],
	["Race", "Asian", "5.2%"],
	["Race", "White", "5.3%"],
	["Race", "Black", "8.9%"],
	["Race", "NHPI", "11.4%"],
	["Race", "Multiracial", "13.0%"],
	["Race", "Hispanic", "17.0%"],
	["Race", "AIAN", "18.9%"],
	["Race", "Other", "19.3%"],
]

const T2_ROWS: Array<[string, string, string]> = [
	["2019", "All Americans", "10.5%"],
	["2020", "All Americans", "8.8%"],
	["2021", "All Americans", "8.6%"],
	["2022", "All Americans", "8.3%"],
	["2023", "All Americans", "8.3%"],
	["2024", "All Americans", "10.0%"],
	["2019", "Uninsured Americans", "36.4%"],
	["2020", "Uninsured Americans", "30.0%"],
	["2021", "Uninsured Americans", "26.6%"],
	["2022", "Uninsured Americans", "28.5%"],
	["2023", "Uninsured Americans", "28.0%"],
	["2024", "Uninsured Americans", "30.8%"],
]

const IMPROPER = "Improper or phantom enrollments"
const OTHER = "Other enrollment (total minus improper)"
const T3_ROWS = (
	[
		[2020, 10.6, 0.1],
		[2021, 11.1, 0.4],
		[2022, 13.8, 2.2],
		[2023, 15.4, 2.6],
		[2024, 20.1, 4.8],
		[2025, 22.1, 5.6],
		[2026, 19.2, 2.6],
	] as const
).flatMap(([year, total, improper]) => [
	[String(year), IMPROPER, String(improper), String(total)],
	[String(year), OTHER, (Math.round((total - improper) * 10) / 10).toFixed(1), String(total)],
])

const T4_ROWS: Array<[string, string]> = [
	["≤0%", "0"],
	["0% to 5%", "2"],
	["5% to 10%", "12"],
	["10% to 15%", "35"],
	["15% to 20%", "8"],
	["20% to 25%", "10"],
	["25% to 30%", "8"],
	["30% to 35%", "1"],
	["≥35%", "1"],
]

const T5_ROWS = (
	[
		["Antidote", 1],
		["Aspirus", 1],
		["Independence Blue Cross", 1],
		["Colorado Access", 1],
		["CalOptima Health", 1],
		["BSWHealth Plan", -1],
		["Providence", -1],
		["Mending Health (Taro)", -2],
		["CareSource", -3],
		["PacificSource", -3],
		["Medica", -3],
		["Cigna", -11],
	] as const
).map(([insurer, change]) => [
	insurer,
	String(change),
	change > 0 ? "Entering states" : "Exiting states",
])

const T6_ROWS: Array<[string, string, string]> = [
	["U.S. (Black)", "44.8", "U.S. subgroup"],
	["U.S.", "17.9", "U.S."],
	["U.S. (White)", "14.2", "U.S. subgroup"],
	["Canada", "12.6", "Peer country"],
	["U.S. (Hispanic)", "12.1", "U.S. subgroup"],
	["Korea", "10.1", "Peer country"],
	["OECD average", "9.5", "OECD average"],
	["U.K.", "8.3", "Peer country"],
	["Switzerland", "7.7", "Peer country"],
	["Sweden", "5.2", "Peer country"],
	["Japan", "4.4", "Peer country"],
	["Germany", "4.4", "Peer country"],
	["Spain", "4.1", "Peer country"],
	["Netherlands", "3.6", "Peer country"],
	["Austria", "2.6", "Peer country"],
	["Finland", "2.3", "Peer country"],
]

export type TrendsFixture = {
	key: string
	dataset: Dataset
	spec: ChartSpec
	/** Bars the chart draws: one per row with a non-zero value. */
	bars: number
}

export const TRENDS: TrendsFixture[] = [
	{
		key: "T1",
		dataset: table(
			"ds-trends-t1",
			[
				["group", "categorical"],
				["category", "categorical"],
				["share", "quantitative"],
			],
			T1_ROWS
		),
		spec: {
			datasetId: "ds-trends-t1",
			folderId: FOLDER.id,
			name: "Uninsured by age, income and race, 2024",
			family: "bar",
			encodings: { y: "category", length: "share", hue: "group" },
			title: "Share of Americans Without Health Insurance, by Age, Income and Race, 2024",
			subtitle: subtitle(17, "American Community Survey 1-Year Estimates"),
			axes: { x: { title: "Percent of Americans (%)", max: 0.2 } },
			colors: { Age: "#1A8F5E", Income: "#5B3FE0", Race: "#1C6FD1" },
			order: { category: T1_ROWS.map((r) => r[1]) },
			dataLabels: { format: ".1%", position: "inside-end", color: "#FFFFFF" },
		},
		bars: T1_ROWS.length,
	},
	{
		key: "T2",
		dataset: table(
			"ds-trends-t2",
			[
				["year", "ordinal"],
				["status", "categorical"],
				["share", "quantitative"],
			],
			T2_ROWS
		),
		spec: {
			datasetId: "ds-trends-t2",
			folderId: FOLDER.id,
			name: "Delayed care due to cost, by insurance status",
			family: "bar",
			encodings: { x: "year", length: "share", hue: "status" },
			stack: "group",
			title:
				"Share of Adults Who Delayed or Did Not Get Care Due to Cost, by Insurance Status, 2004-2024",
			subtitle: subtitle(17, "Peterson-KFF Health System Tracker"),
			axes: { y: { title: "Percent of Americans (%)", max: 0.5 } },
			colors: { "All Americans": NAVY, "Uninsured Americans": LAV },
			dataLabels: { format: ".1%", position: "outside-end", color: PURPLE },
		},
		bars: T2_ROWS.length,
	},
	{
		key: "T3",
		dataset: table(
			"ds-trends-t3",
			[
				["year", "ordinal"],
				["segment", "categorical"],
				["enrollment_millions", "quantitative"],
				["printed_total_millions", "quantitative"],
			],
			T3_ROWS
		),
		spec: {
			datasetId: "ds-trends-t3",
			folderId: FOLDER.id,
			name: "Exchange enrollment and improper/phantom enrollments",
			family: "bar",
			encodings: { x: "year", length: "enrollment_millions", hue: "segment" },
			stack: "stack",
			title:
				"Total Enrollment and Improper/Phantom Enrollments in Exchange Plans, 2020-2026",
			subtitle: subtitle(
				90,
				"Department of Health and Human Services Assistant Secretary for Planning and Evaluation, ACA Exchange Enrollment, 2026"
			),
			axes: { y: { title: "Enrollment (in Millions)", max: 30 } },
			colors: { [IMPROPER]: LAV, [OTHER]: GRAY },
			dataLabels: { format: ".1f", position: "center", color: INK },
		},
		bars: T3_ROWS.length,
	},
	{
		key: "T4",
		dataset: table(
			"ds-trends-t4",
			[
				["range", "ordinal"],
				["insurers", "quantitative"],
			],
			T4_ROWS
		),
		spec: {
			datasetId: "ds-trends-t4",
			folderId: FOLDER.id,
			name: "Proposed 2027 marketplace premium increases",
			family: "bar",
			encodings: { y: "range", length: "insurers" },
			fill: PURPLE,
			title: "Proposed 2027 Marketplace Median Premium Increases, by Insurer",
			subtitle: subtitle(
				27,
				"KFF; Wakely Consulting Group; CMS Effectuated Enrollment Reports"
			),
			axes: {
				x: { title: "Number of Insurers", max: 40 },
				y: { title: "Premium Increase Range (%)" },
			},
			order: { range: T4_ROWS.map((r) => r[0]) },
			dataLabels: { position: "outside-end", color: PURPLE },
		},
		bars: T4_ROWS.filter((r) => r[1] !== "0").length,
	},
	{
		key: "T5",
		dataset: table(
			"ds-trends-t5",
			[
				["insurer", "categorical"],
				["change_in_states", "quantitative"],
				["direction", "categorical"],
			],
			T5_ROWS
		),
		spec: {
			datasetId: "ds-trends-t5",
			folderId: FOLDER.id,
			name: "Insurer participation changes for 2027",
			family: "bar",
			encodings: { y: "insurer", length: "change_in_states", hue: "direction" },
			title:
				"Changes in Marketplace Insurer Participation for 2027, by State, by Insurer",
			subtitle: subtitle(
				27,
				"KFF; Wakely Consulting Group; CMS Effectuated Enrollment Reports"
			),
			axes: { x: { title: "Number of States", min: -12, max: 2 } },
			colors: { "Entering states": LAV, "Exiting states": ORANGE },
			order: { insurer: T5_ROWS.map((r) => r[0]) },
			dataLabels: { position: "outside-end", color: INK },
		},
		bars: T5_ROWS.length,
	},
	{
		key: "T6",
		dataset: table(
			"ds-trends-t6",
			[
				["country", "categorical"],
				["deaths_per_100k", "quantitative"],
				["group", "categorical"],
			],
			T6_ROWS
		),
		spec: {
			datasetId: "ds-trends-t6",
			folderId: FOLDER.id,
			name: "Maternal mortality, select high-income countries, 2024",
			family: "bar",
			encodings: { y: "country", length: "deaths_per_100k", hue: "group" },
			title:
				"Maternal Mortality per 100,000 Live Births in Select High-Income Countries, 2024",
			subtitle: subtitle(
				33,
				"OECD; NCHS; CDC National Vital Statistics System; CDC WONDER"
			),
			axes: { x: { title: "Deaths per 100,000 Live Births", max: 50 } },
			colors: {
				"U.S. subgroup": "#D4CCF7",
				"U.S.": PURPLE,
				"Peer country": "#D6E6FA",
				"OECD average": NAVY,
			},
			order: { country: T6_ROWS.map((r) => r[0]) },
			dataLabels: { format: ".1f", position: "inside-end", color: INK },
		},
		bars: T6_ROWS.length,
	},
]

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
		["Blueberry", "Bran", "Lemon"].map((flavor, f) => [
			month,
			flavor,
			10 + m * 3 + f,
			40 + m * 5 - f,
		])
	)
)

/** Specialists per primary care physician by country: the lollipop chart
 *  in the 10-14 walkthrough. One row per country, ascending. */
export const RATIOS = table(
	"ds-ratios",
	[
		["Country", "categorical"],
		["Ratio", "quantitative"],
	],
	[
		["Colombia", 0.520969],
		["Ireland", 0.839772],
		["Portugal", 0.928591],
		["Chile", 1.030715],
		["Canada", 1.139471],
		["France", 1.352448],
		["Mexico", 1.775568],
		["Norway", 2.018978],
		["Switzerland", 2.396358],
		["OECD Average", 2.674538875],
		["Denmark", 2.912904],
		["Spain", 3.021148],
		["United Kingdom", 3.075031],
		["Slovenia", 3.831418],
		["Iceland", 4.071661],
		["Italy", 4.349717],
		["United States", 7.77605],
		["Greece", 11.40251],
	]
)

export const THEME = SYSTEM_LIGHT_THEME

/** The context a caller hands `composeVisual`: the spec's dataset (when it
 *  exists) with the rows of the version the spec names, or its latest. */
export const contextFor = (
	datasets: Dataset[],
	datasetId: unknown,
	versionId?: unknown
): ComposeContext => {
	const dataset = datasets.find((d) => d.id === datasetId)
	const version = dataset?.versions.find((v) =>
		versionId === undefined ? v.id === dataset.latestVersionId : v.id === versionId
	)
	return {
		dataset: dataset
			? { meta: datasetMetaFrom(dataset), rows: version?.rows ?? [] }
			: null,
		folders: [FOLDER],
		theme: themeOf(THEME),
		themeId: THEME.id,
		now: 1_700_000_000_000,
		id: "vs-spec-test",
	}
}

export const ALL_DATASETS: Dataset[] = [...TRENDS.map((t) => t.dataset), CAFE, RATIOS]
