/** Dummy data sets shared by the browser sweeps (`e2e/sweep/*.sweep.ts`) and
 *  the panel matrix test (`markParts.matrix.smoke.test.tsx`).
 *
 *  Deterministic (a seeded generator, no Math.random) so a sweep result is
 *  comparable from run to run. One data set per chart family's shape:
 *  category × series × value, a monthly trend, two-numeric scatter rows, a
 *  category × category matrix, a two-level hierarchy, flows, and the map
 *  CSVs already in `e2e/fixtures/`. Several values are deliberately long so
 *  the layout sweep has labels that need room. */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type SweepFieldType = "quantitative" | "categorical" | "ordinal" | "temporal"

export type SweepDataset = {
	id: string
	name: string
	fields: Array<{ name: string; inferredType: SweepFieldType }>
	rows: Array<Record<string, string>>
}

/** mulberry32 — small seeded PRNG. */
const prng = (seed: number) => {
	let s = seed | 0
	return (): number => {
		s = (s + 0x6d2b79f5) | 0
		let t = Math.imul(s ^ (s >>> 15), 1 | s)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const PRODUCTS = [
	"Notebook",
	"Pen",
	"Desk lamp",
	"Ergonomic office chair",
	"Standing desk converter",
	"Mug",
] as const
const REGIONS = ["North", "South", "West"] as const
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const
const TIER: Record<string, string> = {
	Notebook: "Core",
	Pen: "Core",
	"Desk lamp": "Premium",
	"Ergonomic office chair": "Premium",
	"Standing desk converter": "Premium",
	Mug: "Core",
}

/** Product × Region × Quarter — bars, pies, combos, radar. */
const sales = (): SweepDataset => {
	const rnd = prng(11)
	const rows: Array<Record<string, string>> = []
	for (const [pi, product] of PRODUCTS.entries())
		for (const [ri, region] of REGIONS.entries())
			for (const [qi, quarter] of QUARTERS.entries()) {
				const base = 40 + pi * 18 + ri * 9 + qi * 6
				rows.push({
					Product: product,
					Region: region,
					Quarter: quarter,
					Tier: TIER[product] ?? "Core",
					Sales: String(Math.round(base + rnd() * 40)),
					Profit: String(Math.round(base * 0.3 + rnd() * 20 - 8)),
					Units: String(Math.round(5 + rnd() * 30)),
				})
			}
	return {
		id: "ds-sweep-sales",
		name: "sweep-sales",
		fields: [
			{ name: "Product", inferredType: "categorical" },
			{ name: "Region", inferredType: "categorical" },
			{ name: "Quarter", inferredType: "categorical" },
			{ name: "Tier", inferredType: "categorical" },
			{ name: "Sales", inferredType: "quantitative" },
			{ name: "Profit", inferredType: "quantitative" },
			{ name: "Units", inferredType: "quantitative" },
		],
		rows,
	}
}

/** Month × Region, one row per point — lines and areas. */
const trend = (): SweepDataset => {
	const rnd = prng(23)
	const rows: Array<Record<string, string>> = []
	for (const [ri, region] of REGIONS.entries())
		for (let month = 1; month <= 12; month++) {
			const wave = Math.sin((month + ri * 2) / 2) * 14
			rows.push({
				Month: String(month),
				Date: `2025-${String(month).padStart(2, "0")}-01`,
				Region: region,
				Half: month <= 6 ? "First half" : "Second half",
				Sales: String(Math.round(60 + ri * 22 + wave + rnd() * 10)),
				Profit: String(Math.round(18 + ri * 6 + wave / 3 + rnd() * 6)),
				Units: String(Math.round(8 + rnd() * 20)),
			})
		}
	return {
		id: "ds-sweep-trend",
		name: "sweep-trend",
		fields: [
			{ name: "Month", inferredType: "quantitative" },
			{ name: "Date", inferredType: "temporal" },
			{ name: "Region", inferredType: "categorical" },
			{ name: "Half", inferredType: "categorical" },
			{ name: "Sales", inferredType: "quantitative" },
			{ name: "Profit", inferredType: "quantitative" },
			{ name: "Units", inferredType: "quantitative" },
		],
		rows,
	}
}

/** Individual observations — scatter, hexbin, regression, violin, box,
 *  density, histogram. */
const people = (): SweepDataset => {
	const rnd = prng(37)
	const groups = ["A", "B", "C"] as const
	const sexes = ["F", "M"] as const
	const cities = ["Lisbon", "Oslo", "Kyoto", "Quito"] as const
	const rows: Array<Record<string, string>> = []
	for (let i = 0; i < 150; i++) {
		const gi = i % 3
		const height = 150 + gi * 8 + rnd() * 30
		const weight = height * 0.45 - 20 + rnd() * 18
		rows.push({
			Height: height.toFixed(1),
			Weight: weight.toFixed(1),
			Age: String(Math.round(18 + rnd() * 50)),
			Score: String(Math.round(rnd() * 100)),
			Group: groups[gi] ?? "A",
			Sex: sexes[i % 2] ?? "F",
			City: cities[Math.floor(rnd() * cities.length)] ?? "Lisbon",
		})
	}
	return {
		id: "ds-sweep-people",
		name: "sweep-people",
		fields: [
			{ name: "Height", inferredType: "quantitative" },
			{ name: "Weight", inferredType: "quantitative" },
			{ name: "Age", inferredType: "quantitative" },
			{ name: "Score", inferredType: "quantitative" },
			{ name: "Group", inferredType: "categorical" },
			{ name: "Sex", inferredType: "categorical" },
			{ name: "City", inferredType: "categorical" },
		],
		rows,
	}
}

/** Day × Slot — heatmaps. */
const matrix = (): SweepDataset => {
	const rnd = prng(41)
	const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
	const slots = ["Morning", "Midday", "Afternoon", "Evening"] as const
	const rows: Array<Record<string, string>> = []
	for (const day of days)
		for (const [si, slot] of slots.entries()) {
			const visits = Math.round(10 + si * 12 + rnd() * 40)
			rows.push({
				Day: day,
				Slot: slot,
				Visits: String(visits),
				Share: (rnd() * 0.9 + 0.05).toFixed(2),
				Level: visits > 50 ? "High" : visits > 30 ? "Medium" : "Low",
			})
		}
	return {
		id: "ds-sweep-matrix",
		name: "sweep-matrix",
		fields: [
			{ name: "Day", inferredType: "categorical" },
			{ name: "Slot", inferredType: "categorical" },
			{ name: "Visits", inferredType: "quantitative" },
			{ name: "Share", inferredType: "quantitative" },
			{ name: "Level", inferredType: "categorical" },
		],
		rows,
	}
}

/** Group → item, sized — packed circles, treemap, sunburst. */
const tree = (): SweepDataset => {
	const rnd = prng(53)
	const groups: Record<string, readonly string[]> = {
		Fruit: ["Apple", "Pear", "Plum", "Fig"],
		Vegetable: ["Leek", "Kale", "Beet"],
		Grain: ["Oats", "Rye", "Spelt", "Barley", "Millet"],
	}
	const rows: Array<Record<string, string>> = []
	for (const [group, items] of Object.entries(groups))
		for (const item of items)
			rows.push({
				Group: group,
				Item: item,
				Kind: rnd() > 0.5 ? "Organic" : "Conventional",
				Size: String(Math.round(10 + rnd() * 90)),
			})
	return {
		id: "ds-sweep-tree",
		name: "sweep-tree",
		fields: [
			{ name: "Group", inferredType: "categorical" },
			{ name: "Item", inferredType: "categorical" },
			{ name: "Kind", inferredType: "categorical" },
			{ name: "Size", inferredType: "quantitative" },
		],
		rows,
	}
}

/** Source → target, disjoint stages — sankey. */
const flows = (): SweepDataset => {
	const rnd = prng(61)
	const sources = ["Coal", "Gas", "Solar", "Wind"] as const
	const targets = ["Homes", "Industry", "Transport"] as const
	const rows: Array<Record<string, string>> = []
	for (const source of sources)
		for (const target of targets)
			rows.push({
				Source: source,
				Target: target,
				Amount: String(Math.round(5 + rnd() * 60)),
			})
	return {
		id: "ds-sweep-flows",
		name: "sweep-flows",
		fields: [
			{ name: "Source", inferredType: "categorical" },
			{ name: "Target", inferredType: "categorical" },
			{ name: "Amount", inferredType: "quantitative" },
		],
		rows,
	}
}

/** From → to among the same places — chord. */
const trade = (): SweepDataset => {
	const rnd = prng(67)
	const places = ["Asia", "Europe", "Africa", "Americas", "Oceania"] as const
	const rows: Array<Record<string, string>> = []
	for (const from of places)
		for (const to of places) {
			if (from === to) continue
			rows.push({ From: from, To: to, Volume: String(Math.round(5 + rnd() * 80)) })
		}
	return {
		id: "ds-sweep-trade",
		name: "sweep-trade",
		fields: [
			{ name: "From", inferredType: "categorical" },
			{ name: "To", inferredType: "categorical" },
			{ name: "Volume", inferredType: "quantitative" },
		],
		rows,
	}
}

const FIXTURES_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../e2e/fixtures"
)

/** A map CSV from `e2e/fixtures/` as a data set. Plain comma-separated with
 *  a header row and no quoting (true of every file there). */
const fromCsv = (
	id: string,
	file: string,
	types: Record<string, SweepFieldType>
): SweepDataset => {
	const [header = "", ...lines] = readFileSync(path.join(FIXTURES_DIR, file), "utf-8")
		.trim()
		.split(/\r?\n/)
	const names = header.split(",")
	return {
		id,
		name: id.replace(/^ds-/, ""),
		fields: names.map((name) => ({ name, inferredType: types[name] ?? "categorical" })),
		rows: lines.map((line) => {
			const cells = line.split(",")
			return Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ""]))
		}),
	}
}

const states = (): SweepDataset =>
	fromCsv("ds-sweep-states", "states-rate.csv", { state: "categorical", rate: "quantitative" })

const cities = (): SweepDataset =>
	fromCsv("ds-sweep-cities", "cities-lonlat.csv", {
		city: "categorical",
		lon: "quantitative",
		lat: "quantitative",
		pop: "quantitative",
	})

export const SWEEP_DATASETS = {
	sales: sales(),
	trend: trend(),
	people: people(),
	matrix: matrix(),
	tree: tree(),
	flows: flows(),
	trade: trade(),
	states: states(),
	cities: cities(),
} as const satisfies Record<string, SweepDataset>

export type SweepDatasetKey = keyof typeof SWEEP_DATASETS

/** Every value of every text column, longest first. */
export const datasetLevels = (dataset: SweepDataset): string[] => {
	const levels = new Set<string>()
	for (const field of dataset.fields) {
		if (field.inferredType === "quantitative") continue
		for (const row of dataset.rows) {
			const value = row[field.name]
			if (value) levels.add(value)
		}
	}
	return [...levels].sort((a, b) => b.length - a.length)
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Replace a data value inside a control's label with "‹level›", so a
 *  per-category control ("Color for North") reads the same on every data
 *  set and a run of them can be collapsed into one line. */
export const levelNormalizer = (dataset: SweepDataset): ((label: string) => string) => {
	const levels = datasetLevels(dataset)
	if (levels.length === 0) return (label) => label
	const pattern = new RegExp(`\\b(${levels.map(escapeRegExp).join("|")})\\b`, "g")
	return (label) => label.replace(pattern, "‹level›")
}
