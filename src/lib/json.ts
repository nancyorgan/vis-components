/**
 * Typed JSON.stringify — returns `undefined` when given `undefined`, matching
 * the actual runtime behavior of `JSON.stringify` (which the built-in TS
 * types lie about). Vendored from `@th/lib/src/json.ts`.
 */
type JsonLike =
	| string
	| number
	| boolean
	| null
	| JsonLike[]
	| { [key: string]: JsonLike | undefined }

export function stringifyJsonDangerous(data: JsonLike): string
export function stringifyJsonDangerous(data: undefined): undefined
export function stringifyJsonDangerous(data?: JsonLike): string | undefined
export function stringifyJsonDangerous(data: JsonLike | undefined) {
	// eslint-disable-next-line @th/use-wrapped-json-functions -- this is the wrapper
	return JSON.stringify(data) as string | undefined
}
