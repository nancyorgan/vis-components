// The setting catalog: for each setting a chart-spec `settings` patch can
// name, keyed by its path (`channelConfigs.x.gridlines`), its doc comment
// and its declared type. Read from the `Visual` type in lib/types.ts with
// the TypeScript checker, at build and test time, and served to the app as
// the `virtual:setting-catalog` module.
//
// Not resolved: entries of data-keyed maps (any key, no declaration), and
// properties typed through an index signature.

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const TYPES = join(root, "src/contexts/chartBuilder/lib/types.ts")

const SLICES = [
	"channelConfigs",
	"labelsConfig",
	"legendConfig",
	"tooltipConfig",
	"dataLabelsConfig",
	"captionConfig",
	"mapConfig",
]
const MAX_DEPTH = 6
const MAX_DOC = 400

const tidy = (doc) => {
	const flat = doc.replace(/\s+/g, " ").trim()
	if (flat.length <= MAX_DOC) return flat
	const cut = flat.slice(0, MAX_DOC)
	const end = cut.lastIndexOf(". ")
	return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

/** `{ docs, types }`: path to doc comment, and path to declared type as
 *  `{ kinds, values?, items? }`. `kinds` holds "string", "number",
 *  "boolean", "null", "list" or "object"; `values` the allowed strings
 *  when the type is a union of string literals; `items` a list's element
 *  type. A path whose type can't be described (any, unknown) has none. */
export const extractSettingCatalog = () => {
	const program = ts.createProgram([TYPES], {
		strict: true,
		skipLibCheck: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		jsx: ts.JsxEmit.ReactJSX,
	})
	const checker = program.getTypeChecker()
	const source = program.getSourceFile(TYPES)
	const visual = source.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === "Visual")
	if (!visual) throw new Error("no `Visual` type in lib/types.ts")
	const visualType = checker.getTypeAtLocation(visual.name)

	const isList = (t) => checker.isArrayType(t) || checker.isTupleType(t)
	const isPlainObject = (t) =>
		(t.flags & ts.TypeFlags.Object || t.flags & ts.TypeFlags.Intersection) && !isList(t) && t.getCallSignatures().length === 0
	const objectParts = (type) => {
		const t = checker.getNonNullableType(type)
		return (t.isUnion() ? t.types : [t]).filter(isPlainObject)
	}
	const describe = (type, depth = 0) => {
		const kinds = new Set()
		const values = []
		let items
		for (const p of type.isUnion() ? type.types : [type]) {
			const f = p.flags
			if (f & ts.TypeFlags.Undefined || f & ts.TypeFlags.Void) continue
			if (f & ts.TypeFlags.Null) kinds.add("null")
			else if (f & ts.TypeFlags.StringLiteral) values.push(p.value)
			else if (f & ts.TypeFlags.StringLike) kinds.add("string")
			else if (f & ts.TypeFlags.NumberLike) kinds.add("number")
			else if (f & ts.TypeFlags.BooleanLike) kinds.add("boolean")
			else if (isList(p)) {
				kinds.add("list")
				const element = checker.isArrayType(p) ? checker.getTypeArguments(p)[0] : undefined
				items = element && depth < 2 ? describe(element, depth + 1) : undefined
			} else if (isPlainObject(p)) kinds.add("object")
			else return undefined
		}
		if (values.length > 0 && !kinds.has("string")) kinds.add("string")
		else values.length = 0
		if (kinds.size === 0) return undefined
		const out = { kinds: [...kinds].sort() }
		if (values.length > 0) out.values = [...new Set(values)].sort()
		if (items) out.items = items
		return out
	}
	/** One path declared by several object types (a union of configs). */
	const merge = (a, b) => {
		if (!a || !b) return undefined
		const out = { kinds: [...new Set([...a.kinds, ...b.kinds])].sort() }
		const plainA = a.kinds.includes("string") && !a.values
		const plainB = b.kinds.includes("string") && !b.values
		if (!plainA && !plainB && (a.values || b.values)) out.values = [...new Set([...(a.values ?? []), ...(b.values ?? [])])].sort()
		if (a.items && b.items) out.items = merge(a.items, b.items)
		return out
	}

	const docs = {}
	const types = {}
	const walk = (type, path, depth) => {
		if (depth > MAX_DEPTH) return
		for (const part of objectParts(type)) {
			for (const prop of checker.getPropertiesOfType(part)) {
				const at = `${path}.${prop.name}`
				const doc = ts.displayPartsToString(prop.getDocumentationComment(checker))
				if (doc.trim() && !docs[at]) docs[at] = tidy(doc)
				const decl = prop.valueDeclaration ?? prop.declarations?.[0]
				if (!decl) continue
				const propType = checker.getTypeOfSymbolAtLocation(prop, decl)
				const described = describe(propType)
				types[at] = Object.hasOwn(types, at) ? merge(types[at], described) : described
				walk(propType, at, depth + 1)
				const list = checker.getNonNullableType(propType)
				if (checker.isArrayType(list)) walkItems(checker.getTypeArguments(list)[0], `${at}[]`, depth + 1)
			}
		}
	}
	/** A list's object elements, keyed `path[].field`, types only. */
	const walkItems = (type, path, depth) => {
		if (depth > MAX_DEPTH || !type) return
		for (const part of objectParts(type)) {
			for (const prop of checker.getPropertiesOfType(part)) {
				const decl = prop.valueDeclaration ?? prop.declarations?.[0]
				if (!decl) continue
				const at = `${path}.${prop.name}`
				const described = describe(checker.getTypeOfSymbolAtLocation(prop, decl))
				types[at] = Object.hasOwn(types, at) ? merge(types[at], described) : described
			}
		}
	}
	for (const slice of SLICES) {
		const prop = visualType.getProperty(slice)
		if (!prop) throw new Error(`Visual has no "${slice}"`)
		walk(checker.getTypeOfSymbolAtLocation(prop, visual), slice, 1)
	}
	const sorted = (o) =>
		Object.fromEntries(
			Object.entries(o)
				.filter(([, v]) => v !== undefined)
				.sort(([a], [b]) => a.localeCompare(b))
		)
	return { docs: sorted(docs), types: sorted(types) }
}

const ID = "virtual:setting-catalog"
const RESOLVED = `\0${ID}`

/** Vite plugin serving the catalog as `virtual:setting-catalog`. */
export const settingCatalog = () => ({
	name: "setting-catalog",
	resolveId: (id) => (id === ID ? RESOLVED : undefined),
	load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(extractSettingCatalog())}` : undefined),
})
