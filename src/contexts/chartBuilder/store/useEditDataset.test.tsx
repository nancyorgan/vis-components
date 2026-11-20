import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ReactNode } from "react"
import { EMPTY_CHANNEL_CONFIGS } from "../lib/channelConfig"
import { SYSTEM_LIGHT_THEME } from "../lib/systemThemes"
import { labelsFromTheme } from "../lib/themeConfig"
import {
	emptyEncodings,
	type Dataset,
	type Field,
	type Visual,
} from "../lib/types"
import { buildDataset } from "../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"

import {
	currentDatasetIdAtom,
	dataFoldersAtom,
	currentDerivedVariablesAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
	visualsAtom,
} from "./atoms"
import { currentDatasetViewAtom } from "./useCurrentDatasetView"
import {
	editSaveMode,
	planOptionsFor,
	useSaveEditedData,
} from "./useEditDataset"

/** The Edit dialog's save, at the store level: what a fork copies, what an
 *  append keeps, and how renames ripple through the draft atoms, the derived
 *  variables and sibling visuals. The dialog's own smoke test covers the
 *  happy paths through the UI; this one pins the edges. */

beforeEach(() => {
	installInMemoryLocalStorage()
})
afterEach(() => {
	// nothing to restore: each test builds its own provider
})

const ID = "ds-edit-hook"

const FIELDS: Field[] = [
	{ name: "city", inferredType: "categorical" },
	{ name: "sales", inferredType: "quantitative" },
]

const ROWS_V1 = [
	{ city: "Lima", sales: "10" },
	{ city: "Quito", sales: "20" },
]
const ROWS_V2 = [
	{ city: "Lima", sales: "11" },
	{ city: "Quito", sales: "21" },
]

const twoVersions = (): Dataset =>
	buildDataset({
		id: ID,
		name: "sales",
		fields: FIELDS,
		versions: [
			{
				id: "v1",
				filename: "sales-jan.csv",
				rows: ROWS_V1,
				createdAt: 100,
				note: "January",
			},
			{ id: "v2", filename: "sales-feb.csv", rows: ROWS_V2, createdAt: 200 },
		],
	})

const visual = (id: string, over: Partial<Visual> = {}): Visual => ({
	id,
	name: id,
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: labelsFromTheme(SYSTEM_LIGHT_THEME),
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...over,
})

const setup = (dataset: Dataset | null, init?: (s: TestStore) => void) => {
	let store: TestStore | null = null
	const wrapper = ({ children }: { children: ReactNode }) => (
		<TestProvider
			initializeState={(s) => {
				store = s
				if (dataset) {
					s.set(loadedDatasetsAtom, { [dataset.id]: dataset })
					s.set(currentDatasetIdAtom, dataset.id)
				}
				s.set(previewVersionIdAtom, null)
				init?.(s)
			}}
		>
			{children}
		</TestProvider>
	)
	const { result } = renderHook(() => useSaveEditedData(), { wrapper })
	return { save: result.current, store: store! }
}

const forkedId = (store: TestStore) => {
	const id = store.get(currentDatasetIdAtom)
	if (!id || id === ID)
		throw new Error("expected the editor to move to a forked data set")
	return id
}

describe("an edit made from the library's Data tab", () => {
	const target = (dataset: Dataset, versionId: string) => {
		const version = dataset.versions.find((v) => v.id === versionId)!
		return {
			id: dataset.id,
			name: dataset.name,
			filename: version.filename,
			fields: dataset.fields,
			rows: version.rows,
			createdAt: dataset.createdAt,
			versionId,
			versionIndex: 1,
			totalVersions: dataset.versions.length,
			isLatest: versionId === dataset.latestVersionId,
			versionCreatedAt: version.createdAt,
		}
	}

	it("forks a copy that names its source, files it beside it, and leaves the editor alone", async () => {
		const other = buildDataset({
			id: "ds-in-editor",
			name: "other",
			fields: FIELDS,
			versions: [{ id: "o1", filename: "o.csv", rows: ROWS_V1, createdAt: 5 }],
		})
		const source = twoVersions()
		const { save, store } = setup(other, (s) => {
			s.set(loadedDatasetsAtom, { [other.id]: other, [source.id]: source })
			s.set(dataFoldersAtom, [
				{
					id: "fl-data",
					name: "Sales",
					parentId: null,
					createdAt: 1,
					kind: "data",
					datasetIds: [ID],
				},
			])
		})
		const result = await save(
			"city,sales\nLima,99\nQuito,20",
			"sales (edited)",
			target(source, "v1")
		)
		if (!result.ok) throw new Error(result.error)
		expect(result.mode).toBe("fork")
		// The editor still holds what it held.
		expect(store.get(currentDatasetIdAtom)).toBe(other.id)
		const copy = store.get(loadedDatasetsAtom)[result.datasetId]
		expect(copy.derivedFrom).toEqual({ datasetId: ID, versionId: "v1" })
		expect(copy.versions.at(-1)?.rows[0]).toEqual({ city: "Lima", sales: "99" })
		expect(store.get(dataFoldersAtom)[0].datasetIds).toEqual([
			ID,
			result.datasetId,
		])
	})
})

describe("save mode", () => {
	it("forks imported data and appends to a hand-edited copy", () => {
		expect(editSaveMode(twoVersions())).toBe("fork")
		expect(
			editSaveMode({
				versions: [
					{ id: "a", filename: "x", createdAt: 0 },
					{ id: "b", filename: "Edited data", createdAt: 1, editedFrom: "a" },
				],
			})
		).toBe("append")
		expect(planOptionsFor("fork")).toEqual({
			keepDropped: false,
			keepTypes: false,
		})
		expect(planOptionsFor("append")).toEqual({
			keepDropped: true,
			keepTypes: true,
		})
	})
})

describe("refusals", () => {
	it("needs a loaded data set, a name, and parseable text", async () => {
		const none = setup(null)
		expect(await none.save("city,sales\nLima,1", "x")).toEqual({
			ok: false,
			error: "No data set is loaded.",
		})
		const { save, store } = setup(twoVersions())
		expect(await save("city,sales\nLima,1", "   ")).toEqual({
			ok: false,
			error: "Enter a data set name.",
		})
		const bad = await save("city,sales\n", "x")
		expect(bad.ok).toBe(false)
		if (!bad.ok) expect(bad.error).toContain("at least one data row")
		// Nothing moved.
		expect(store.get(currentDatasetIdAtom)).toBe(ID)
		expect(Object.keys(store.get(loadedDatasetsAtom))).toEqual([ID])
	})
})

describe("fork", () => {
	it("copies the version SHOWN — note, filename and upload time included — and clears the preview pin", async () => {
		const { save, store } = setup(twoVersions(), (s) =>
			s.set(previewVersionIdAtom, "v1")
		)
		const result = await save("city,sales\nLima,10\nQuito,99", "sales (edited)")
		expect(result).toMatchObject({ ok: true, mode: "fork" })
		const forked = store.get(loadedDatasetsAtom)[forkedId(store)]!
		expect(forked.versions).toHaveLength(2)
		const [base, edited] = forked.versions
		expect(base).toMatchObject({
			filename: "sales-jan.csv",
			note: "January",
			createdAt: 100,
		})
		// Rows are reused by reference: nothing is re-stringified or copied.
		expect(base!.rows).toBe(ROWS_V1)
		expect(edited).toMatchObject({
			filename: "Edited data",
			editedFrom: base!.id,
		})
		expect(edited!.rows).toEqual([
			{ city: "Lima", sales: "10" },
			{ city: "Quito", sales: "99" },
		])
		expect(forked.latestVersionId).toBe(edited!.id)
		expect(forked.contentHash).toBeTruthy()
		expect(store.get(previewVersionIdAtom)).toBeNull()
		// The imported data set keeps both versions, untouched.
		expect(store.get(loadedDatasetsAtom)[ID]).toEqual(twoVersions())
	})

	it("keeps the derived variables and renames their {Field} tokens along with the header", async () => {
		const { save, store } = setup(twoVersions(), (s) => {
			s.set(currentEncodingsAtom, {
				...emptyEncodings(),
				y: { field: "sales" },
			})
			s.set(currentFieldOverridesAtom, { sales: "categorical" })
			s.set(currentDerivedVariablesAtom, {
				variables: [
					{
						id: "dv1",
						name: "double",
						kind: "math",
						math: { formula: "{sales} * 2" },
					},
				],
			})
		})
		const result = await save(
			"city,revenue\nLima,11\nQuito,21",
			"sales (edited)"
		)
		expect(result.ok).toBe(true)
		expect(store.get(currentEncodingsAtom).y.field).toBe("revenue")
		expect(store.get(currentFieldOverridesAtom)).toEqual({
			revenue: "categorical",
		})
		expect(
			store.get(currentDerivedVariablesAtom).variables[0]!.math!.formula
		).toBe("{revenue} * 2")
		// The view on the forked data set still computes the derived column.
		const view = store.get(currentDatasetViewAtom)!
		expect(view.fields.map((f) => f.name)).toEqual([
			"city",
			"revenue",
			"double",
		])
		expect(view.rows[0]!.double).toBe("22")
	})

	it("re-keys a copied version's keyAliases pin under the renamed field", async () => {
		const pinned: Dataset = buildDataset({
			id: ID,
			name: "sales",
			fields: [
				{ name: "city", inferredType: "categorical" },
				{
					name: "sales",
					inferredType: "quantitative",
					sourceNames: ["amount"],
				},
			],
			versions: [
				{
					id: "v1",
					filename: "sales.csv",
					// The upload carried BOTH names; the tiebreak bound the field to
					// the former-name column and pinned it.
					rows: [{ city: "Lima", amount: "10", sales: "x" }],
					createdAt: 0,
					keyAliases: { sales: "amount" },
				},
			],
		})
		const { save, store } = setup(pinned)
		const result = await save("city,revenue\nLima,12", "sales (edited)")
		expect(result.ok).toBe(true)
		const forked = store.get(loadedDatasetsAtom)[forkedId(store)]!
		expect(forked.versions[0]!.keyAliases).toEqual({ revenue: "amount" })
		expect(forked.fields[1]).toEqual({
			name: "revenue",
			inferredType: "quantitative",
			sourceNames: ["amount", "sales"],
		})
	})

	it("drops a removed column from the new data set's fields", async () => {
		const { save, store } = setup(twoVersions())
		const result = await save("city\nLima\nQuito", "cities")
		expect(result.ok).toBe(true)
		const forked = store.get(loadedDatasetsAtom)[forkedId(store)]!
		expect(forked.fields.map((f) => f.name)).toEqual(["city"])
		expect(forked.name).toBe("cities")
	})
})

describe("append", () => {
	const handEdited = (): Dataset =>
		buildDataset({
			id: ID,
			name: "sales (edited)",
			fields: FIELDS,
			versions: [
				{ id: "v1", filename: "sales.csv", rows: ROWS_V1, createdAt: 0 },
				{
					id: "v2",
					filename: "Edited data",
					rows: ROWS_V2,
					createdAt: 1,
					editedFrom: "v1",
				},
			],
		})

	it("adds a version, keeps a dropped column as a field, and renames the data set", async () => {
		const { save, store } = setup(handEdited())
		// `sales` dropped outright, Lima's city cell edited.
		const result = await save("city\nLima!\nQuito", "sales (fixed)")
		expect(result).toEqual({ ok: true, mode: "append", datasetId: ID })
		const ds = store.get(loadedDatasetsAtom)[ID]!
		expect(ds.name).toBe("sales (fixed)")
		expect(ds.versions).toHaveLength(3)
		expect(ds.versions[2]).toMatchObject({
			filename: "Edited data",
			editedFrom: "v2",
		})
		expect(ds.latestVersionId).toBe(ds.versions[2]!.id)
		// The field list is shared by every version, so the dropped column
		// stays and reads empty on the new version.
		expect(ds.fields.map((f) => f.name)).toEqual(["city", "sales"])
		const view = store.get(currentDatasetViewAtom)!
		expect(view.rows[0]).toEqual({ city: "Lima!" })
		expect(store.get(currentDatasetIdAtom)).toBe(ID)
	})

	it("reads a column swapped for another as a rename (the in-place header bias)", async () => {
		const { save, store } = setup(handEdited())
		expect(
			(await save("city,note\nLima,a\nQuito,b", "sales (edited)")).ok
		).toBe(true)
		const ds = store.get(loadedDatasetsAtom)[ID]!
		expect(ds.fields.map((f) => f.name)).toEqual(["city", "note"])
		expect(ds.fields[1]!.sourceNames).toEqual(["sales"])
	})

	it("pins a quantitative field's type even when the edit puts text in it", async () => {
		const { save, store } = setup(handEdited())
		expect(
			(await save("city,sales\nLima,n/a\nQuito,21", "sales (edited)")).ok
		).toBe(true)
		expect(store.get(loadedDatasetsAtom)[ID]!.fields[1]!.inferredType).toBe(
			"quantitative"
		)
	})

	it("renames the header on sibling visuals bound to the data set, not on others", async () => {
		const { save, store } = setup(handEdited(), (s) =>
			s.set(visualsAtom, [
				visual("sibling", {
					datasetId: ID,
					encodings: { ...emptyEncodings(), x: { field: "sales" } },
				}),
				visual("other", {
					datasetId: "ds-other",
					encodings: { ...emptyEncodings(), x: { field: "sales" } },
				}),
			])
		)
		expect(
			(await save("city,revenue\nLima,11\nQuito,21", "sales (edited)")).ok
		).toBe(true)
		const [sibling, other] = store.get(visualsAtom)
		expect(sibling!.encodings.x.field).toBe("revenue")
		expect(other!.encodings.x.field).toBe("sales")
		expect(store.get(loadedDatasetsAtom)[ID]!.fields[1]).toEqual({
			name: "revenue",
			inferredType: "quantitative",
			sourceNames: ["sales"],
		})
	})
})

describe("filters", () => {
	const noQuito = [
		{ field: "city", filter: { kind: "values" as const, excluded: ["Quito"] } },
	]
	const SHOWN = "city,sales\nLima,11\nQuito,21"

	it("saves filters alone as one filtered version of a forked copy", async () => {
		const { save, store } = setup(twoVersions())
		const result = await save(SHOWN, "sales (edited)", undefined, {
			filters: noQuito,
			edited: false,
		})
		expect(result).toMatchObject({ ok: true })
		const forked = store.get(loadedDatasetsAtom)[forkedId(store)]!
		expect(forked.versions).toHaveLength(2)
		const [base, filtered] = forked.versions
		expect(base!.rows).toEqual(ROWS_V2)
		expect(filtered).toMatchObject({
			filename: "Filtered data",
			editedFrom: base!.id,
			transform: { filter: noQuito },
			rows: [{ city: "Lima", sales: "11" }],
		})
		expect(forked.latestVersionId).toBe(filtered!.id)
		expect(store.get(currentDatasetViewAtom)?.rows).toHaveLength(1)
	})

	it("saves hand edits over every row, then the filters as a version on top", async () => {
		const { save, store } = setup(twoVersions())
		const result = await save(
			"city,sales\nLima,99\nQuito,21",
			"sales (edited)",
			undefined,
			{ filters: noQuito, edited: true }
		)
		expect(result).toMatchObject({ ok: true })
		const forked = store.get(loadedDatasetsAtom)[forkedId(store)]!
		expect(forked.versions).toHaveLength(3)
		const [base, edited, filtered] = forked.versions
		expect(edited).toMatchObject({
			filename: "Edited data",
			editedFrom: base!.id,
			rows: [
				{ city: "Lima", sales: "99" },
				{ city: "Quito", sales: "21" },
			],
		})
		expect(edited!.transform).toBeUndefined()
		expect(filtered).toMatchObject({
			filename: "Filtered data",
			editedFrom: edited!.id,
			rows: [{ city: "Lima", sales: "99" }],
		})
		expect(forked.latestVersionId).toBe(filtered!.id)
	})

	it("refuses a save with neither edits nor filters", async () => {
		const { save } = setup(twoVersions())
		expect(await save(SHOWN, "x", undefined, { edited: false })).toEqual({
			ok: false,
			error: "Nothing has changed.",
		})
	})
})
