// Local copy of the two @th/eslint-plugin rules this codebase references, so
// disable directives and conventions stay aligned with engineering-frontend
// (source: tooling/eslint-plugin in that repo). If a rule changes there,
// mirror it here.

/** @type {(x: any) => boolean} */
const isIdentifier = (x) => typeof x.name === "string"

/** @type {(x: any, names: string[]) => boolean} */
const identifiedAsAnyOf = (x, names) => isIdentifier(x) && names.includes(x.name)

/** @type {(x: any, name: string) => boolean} */
const identifiedAs = (x, name) => identifiedAsAnyOf(x, [name])

/** @type {(node: any) => boolean} */
function inTry(node) {
	if (!node) return false
	return (
		(node.parent && node.parent.type === "TryStatement") || inTry(node.parent)
	)
}

/** @type {(node: any, name: string, i: number) => boolean | void} */
function isVariableDeclarationInScope(node, name, i) {
	if (node.body[i].type !== "VariableDeclaration") return false
	for (const declarator of node.body[i].declarations) {
		if (declarator.id && declarator.id.name === name) return true
	}
}

/** @type {(node: any, name: string, i: number) => boolean | void} */
function isImportDeclarationInScope(node, name, i) {
	if (node.body[i].type !== "ImportDeclaration") return false
	for (const specifier of node.body[i].specifiers) {
		if (specifier.local && specifier.local.name === name) return true
	}
}

/** @type {(node: any, name: string) => boolean} */
function definedInScope(node, name) {
	if (!node) return false
	if (node.body && Array.isArray(node.body)) {
		for (let i = 0; i < node.body.length; i++) {
			if (isVariableDeclarationInScope(node, name, i)) return true
			if (isImportDeclarationInScope(node, name, i)) return true
		}
	}
	if (node.parent) return definedInScope(node.parent, name)
	return false
}

export default {
	rules: {
		"use-wrapped-json-functions": {
			meta: {},
			create(context) {
				return {
					MemberExpression(node) {
						if (!isIdentifier(node.object)) return
						if (node.object.name !== "JSON") return

						// Using parse directly has no typing consequences
						if (isIdentifier(node.property) && node.property.name === "parse")
							return

						context.report({
							node,
							message:
								"Do not use `JSON.stringify` directly due to misleading types. Look to the json functions inside @th/lib instead.",
						})
					},
				}
			},
		},
		"no-storage-outside-try": {
			meta: {},
			create(context) {
				return {
					MemberExpression(node) {
						if (!node.object) return
						const isCalledFromWindow =
							identifiedAs(node.object, "window") &&
							identifiedAsAnyOf(node.property, [
								"localStorage",
								"sessionStorage",
							])
						const isCalledDirectly = identifiedAsAnyOf(node.object, [
							"localStorage",
							"sessionStorage",
						])
						const directName = isIdentifier(node.object) && node.object.name
						const wasDefinedInScope =
							isCalledDirectly &&
							typeof directName === "string" &&
							definedInScope(node, directName)
						if (
							(isCalledFromWindow || (isCalledDirectly && !wasDefinedInScope)) &&
							!inTry(node)
						) {
							context.report({
								node,
								message:
									"Do not use local or session storage outside of a try/catch. Spec says throwing an error is legitimate.",
							})
						}
					},
				}
			},
		},
	},
}
