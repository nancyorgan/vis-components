// Writes src/contexts/chartBuilder/lib/visualSpec/settingDocs.json: the doc
// comment on each setting a chart-spec `settings` patch can name, keyed by
// its path (`channelConfigs.x.gridlines`). Run with `pnpm setting-docs`
// after changing a config type's comments; settingSearch.test.ts fails
// while the committed file is stale.
//
// Walks the `Visual` type from lib/types.ts with the TypeScript checker, so
// a doc lands on every path whose property declares it. Not resolved:
// entries of data-keyed maps (any key, no declaration), and properties
// typed through an index signature.

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const TYPES = join(root, "src/contexts/chartBuilder/lib/types.ts")
export const OUT = join(root, "src/contexts/chartBuilder/lib/visualSpec/settingDocs.json")

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

/** Path to doc comment for every documented setting under the slices. */
export const extractSettingDocs = () => {
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

	const docs = {}
	const objectParts = (type) => {
		const t = checker.getNonNullableType(type)
		const parts = t.isUnion() ? t.types : [t]
		return parts.filter(
			(p) =>
				p.flags & ts.TypeFlags.Object &&
				!checker.isArrayType(p) &&
				!checker.isTupleType(p) &&
				p.getCallSignatures().length === 0
		)
	}
	const walk = (type, path, depth) => {
		if (depth > MAX_DEPTH) return
		for (const part of objectParts(type)) {
			for (const prop of checker.getPropertiesOfType(part)) {
				const at = `${path}.${prop.name}`
				const doc = ts.displayPartsToString(prop.getDocumentationComment(checker))
				if (doc.trim() && !docs[at]) docs[at] = tidy(doc)
				const decl = prop.valueDeclaration ?? prop.declarations?.[0]
				if (decl) walk(checker.getTypeOfSymbolAtLocation(prop, decl), at, depth + 1)
			}
		}
	}
	for (const slice of SLICES) {
		const prop = visualType.getProperty(slice)
		if (!prop) throw new Error(`Visual has no "${slice}"`)
		walk(checker.getTypeOfSymbolAtLocation(prop, visual), slice, 1)
	}
	return Object.fromEntries(Object.entries(docs).sort(([a], [b]) => a.localeCompare(b)))
}

export const renderSettingDocs = (docs) => `${JSON.stringify(docs, null, "\t")}\n`

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const docs = extractSettingDocs()
	writeFileSync(OUT, renderSettingDocs(docs))
	console.log(`wrote ${Object.keys(docs).length} setting docs to ${OUT}`)
}
