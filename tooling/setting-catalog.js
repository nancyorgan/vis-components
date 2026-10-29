// The setting catalog: every setting a chart-spec `settings` patch can
// name, keyed by its path (`channelConfigs.x.gridlines`), with its doc
// comment and its declared type. Read from the `Visual` type in
// lib/types.ts with the TypeScript checker, at build and test time, and
// served to the app as the `virtual:setting-catalog` module.
//
// The slices are the keys of `Visual` minus NOT_SETTINGS, so a slice
// Nancy adds is settable on the next build. Paths are always dot form:
// an entry of a map keyed by data (a level, a panel, a field) is a `*`
// segment (`channelConfigs.hue.colors.*`), and a list's elements are a
// `[]` segment (`annotationsConfig.texts[].text`). Each type is walked to
// its full depth; a type that contains itself is walked once.

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const TYPES = join(root, "src/contexts/chartBuilder/lib/types.ts")

/** The keys of `Visual` a settings patch never writes, with why: who the
 *  chart is, what it draws from, and what a save stamps, plus what the
 *  spec sets through keys of its own. */
export const NOT_SETTINGS = {
	id: "the chart's identity",
	name: "the spec's `name`",
	folderId: "the spec's `folderId`",
	datasetId: "the spec's `datasetId`; a chart keeps its dataset",
	createdAtVersionId: "stamped when the chart is first saved",
	thumbnail: "the library's preview, captured by the editor",
	thumbnailAt: "when the preview was captured",
	createdAt: "stamped by a save",
	updatedAt: "stamped by a save",
	updatedBy: "stamped by a save",
	deletedAt: "the trash",
	themeId: "the spec's `themeId`",
	encodings: "the spec's `encodings`",
	fieldTypeOverrides: "the spec's `fieldTypes`",
	reshapeConfig: "changes the fields every other setting names",
	derivedVariablesConfig: "changes the fields every other setting names",
}

const MAX_DOC = 400

const tidy = (doc) => {
	const flat = doc.replace(/\s+/g, " ").trim()
	if (flat.length <= MAX_DOC) return flat
	const cut = flat.slice(0, MAX_DOC)
	const end = cut.lastIndexOf(". ")
	return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

/** `{ slices, docs, types, required, shapes }`: the settings slices; path
 *  to doc comment; path to declared type as `{ kinds, values?, items? }`,
 *  where `kinds` holds "string", "number", "boolean", "null", "list" or
 *  "object", `values` the allowed strings when the type is a union of
 *  string literals, and `items` a list's element type (a path whose type
 *  can't be described, any or unknown, has none); a list's path to the
 *  fields each of its elements must have; and an object's path to the
 *  shapes it may take, each as `{ must, tags }`: the members it must have,
 *  and the members fixed to one string that tell a union's shapes apart
 *  (`{kind: "categorical"}`). A path with a shape that needs nothing has
 *  no entry. */
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
	const keys = checker.getPropertiesOfType(visualType).map((p) => p.name)
	for (const key of Object.keys(NOT_SETTINGS)) {
		if (!keys.includes(key)) throw new Error(`NOT_SETTINGS names "${key}", which Visual doesn't have`)
	}
	const slices = keys.filter((k) => !Object.hasOwn(NOT_SETTINGS, k)).sort()

	const isList = (t) => checker.isArrayType(t) || checker.isTupleType(t)
	const isPlainObject = (t) =>
		(t.flags & ts.TypeFlags.Object || t.flags & ts.TypeFlags.Intersection) && !isList(t) && t.getCallSignatures().length === 0
	const partsOf = (type) => {
		const t = checker.getNonNullableType(type)
		return t.isUnion() ? t.types : [t]
	}
	const elementOf = (t) => (checker.isArrayType(t) ? checker.getTypeArguments(t)[0] : undefined)
	/** `open` holds the list types already being described on this path,
	 *  so a list that contains itself stops instead of recursing forever. */
	const describe = (type, open = new Set()) => {
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
				const element = elementOf(p)
				items = element && !open.has(p) ? describe(element, new Set(open).add(p)) : undefined
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
	const required = {}
	const shapes = {}
	/** Paths with a shape that needs nothing, so any object will do. */
	const loose = new Set()
	const shapeOf = (o) => {
		const props = checker.getPropertiesOfType(o)
		const must = props.filter((p) => !(p.flags & ts.SymbolFlags.Optional)).map((p) => p.name)
		const tags = {}
		for (const p of props) {
			const t = checker.getTypeOfSymbol(p)
			if (!(p.flags & ts.SymbolFlags.Optional) && t.flags & ts.TypeFlags.StringLiteral) tags[p.name] = t.value
		}
		return { must, tags }
	}
	const recordShape = (path, o) => {
		if (loose.has(path)) return
		const shape = shapeOf(o)
		if (shape.must.length === 0) {
			loose.add(path)
			delete shapes[path]
			return
		}
		const known = shapes[path] ?? []
		if (!known.some((k) => JSON.stringify(k) === JSON.stringify(shape))) shapes[path] = [...known, shape]
	}
	const record = (at, type, doc) => {
		if (doc && doc.trim() && !docs[at]) docs[at] = tidy(doc)
		const described = describe(type)
		types[at] = Object.hasOwn(types, at) ? merge(types[at], described) : described
	}
	/** Everything below `path`, whose value is `type`: an object's
	 *  properties, a map's `*` entry, a list's `[]` elements. `within` holds
	 *  the object types already open on this path, so a type that contains
	 *  itself stops instead of recursing forever. */
	const walk = (type, path, within) => {
		for (const part of partsOf(type)) {
			const element = elementOf(part)
			if (element) {
				const at = `${path}[]`
				const objects = partsOf(element).filter(isPlainObject)
				for (const o of objects) {
					const must = checker.getPropertiesOfType(o).filter((p) => !(p.flags & ts.SymbolFlags.Optional)).map((p) => p.name)
					required[path] = Object.hasOwn(required, path) ? required[path].filter((n) => must.includes(n)) : must
				}
				walk(element, at, within)
				continue
			}
			if (!isPlainObject(part)) continue
			recordShape(path, part)
			if (within.has(part)) continue
			const inner = new Set(within).add(part)
			for (const prop of checker.getPropertiesOfType(part)) {
				const at = `${path}.${prop.name}`
				const propType = checker.getTypeOfSymbol(prop)
				record(at, propType, ts.displayPartsToString(prop.getDocumentationComment(checker)))
				walk(propType, at, inner)
			}
			const entry = part.getStringIndexType()
			if (entry) {
				const at = `${path}.*`
				record(at, entry)
				walk(entry, at, inner)
			}
		}
	}
	for (const slice of slices) {
		const prop = visualType.getProperty(slice)
		const type = checker.getTypeOfSymbolAtLocation(prop, visual)
		record(slice, type, ts.displayPartsToString(prop.getDocumentationComment(checker)))
		walk(type, slice, new Set())
	}
	const sorted = (o) =>
		Object.fromEntries(
			Object.entries(o)
				.filter(([, v]) => v !== undefined)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		)
	return { slices, docs: sorted(docs), types: sorted(types), required: sorted(required), shapes: sorted(shapes) }
}

const ID = "virtual:setting-catalog"
const RESOLVED = `\0${ID}`

/** Vite plugin serving the catalog as `virtual:setting-catalog`. */
export const settingCatalog = () => ({
	name: "setting-catalog",
	resolveId: (id) => (id === ID ? RESOLVED : undefined),
	load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(extractSettingCatalog())}` : undefined),
})
