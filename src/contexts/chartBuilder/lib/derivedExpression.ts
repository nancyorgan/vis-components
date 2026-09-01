/** The expression grammar behind derived variables (see derivedVariables.ts).
 * One grammar serves both faces: Math formulas ("{A} + {B} / {C}") evaluate
 * to a cell value, and If/else conditions ("{B} == 1 AND {C} > 3") evaluate
 * to a boolean. Field references use the same single-brace token form as the
 * data-label templates, so renames flow through the existing exact
 * `{Old}` → `{New}` replacement.
 *
 * Precedence (low → high): OR < AND < comparison < additive < multiplicative
 * < unary minus < parentheses. Comparisons are binary, never chained —
 * "1 < {B} < 2" is written "1 < {B} AND {B} < 2".
 *
 * This deliberately diverges from the data-label color rules' implicit-value
 * grammar (lib/textColorRules.ts): derived variables have no single implicit
 * value, so every comparison names its fields explicitly. The comparison
 * SEMANTICS mirror `firstMatchingRule`, though: ==/!= compare numerically
 * when both sides read as numbers and as strings otherwise, ordering
 * operators are numeric-only, and a blank cell never satisfies any
 * comparison. */

export type ComparisonOp = ">" | "<" | ">=" | "<=" | "==" | "!="
export type ArithmeticOp = "+" | "-" | "*" | "/"

export type Expr =
	| { kind: "num"; value: number }
	| { kind: "str"; value: string }
	| { kind: "field"; name: string }
	| { kind: "negate"; operand: Expr }
	| { kind: "arith"; op: ArithmeticOp; left: Expr; right: Expr }
	| { kind: "compare"; op: ComparisonOp; left: Expr; right: Expr }
	| { kind: "logic"; op: "and" | "or"; left: Expr; right: Expr }

export type ParseResult =
	| { ok: true; expr: Expr; fields: string[] }
	| { ok: false; error: string }

type Token =
	| { kind: "num"; value: number }
	| { kind: "str"; value: string }
	| { kind: "field"; name: string }
	| { kind: "punct"; op: ComparisonOp | ArithmeticOp | "(" | ")" }
	| { kind: "and" }
	| { kind: "or" }

const NUM_RE = /^(?:\d+(?:\.\d*)?|\.\d+)/
const WORD_RE = /^[a-zA-Z_]+/

const tokenize = (src: string): Token[] | { error: string } => {
	const tokens: Token[] = []
	let rest = src
	while (rest.length > 0) {
		const ch = rest[0]
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			rest = rest.slice(1)
			continue
		}
		if (ch === "{") {
			const end = rest.indexOf("}")
			if (end === -1) return { error: `Missing "}" after "{"` }
			const name = rest.slice(1, end)
			if (name.trim() === "") return { error: "Empty {} variable reference" }
			tokens.push({ kind: "field", name })
			rest = rest.slice(end + 1)
			continue
		}
		if (ch === '"' || ch === "'") {
			const end = rest.indexOf(ch, 1)
			if (end === -1) return { error: `Missing closing ${ch} quote` }
			tokens.push({ kind: "str", value: rest.slice(1, end) })
			rest = rest.slice(end + 1)
			continue
		}
		const two = rest.slice(0, 2)
		if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
			tokens.push({ kind: "punct", op: two })
			rest = rest.slice(2)
			continue
		}
		if (
			ch === ">" ||
			ch === "<" ||
			ch === "+" ||
			ch === "-" ||
			ch === "*" ||
			ch === "/" ||
			ch === "(" ||
			ch === ")"
		) {
			tokens.push({ kind: "punct", op: ch })
			rest = rest.slice(1)
			continue
		}
		if (ch === "=") return { error: `Use "==" to compare, not "="` }
		const num = NUM_RE.exec(rest)
		if (num) {
			tokens.push({ kind: "num", value: Number(num[0]) })
			rest = rest.slice(num[0].length)
			continue
		}
		const word = WORD_RE.exec(rest)
		if (word) {
			const upper = word[0].toUpperCase()
			if (upper === "AND") tokens.push({ kind: "and" })
			else if (upper === "OR") tokens.push({ kind: "or" })
			else
				return {
					error: `Unrecognized word "${word[0]}" — reference variables in braces, like {${word[0]}}`,
				}
			rest = rest.slice(word[0].length)
			continue
		}
		return { error: `Unrecognized character "${ch}"` }
	}
	return tokens
}

/** Describe a token for error messages. */
const describe = (t: Token | undefined): string => {
	if (!t) return "the end of the expression"
	switch (t.kind) {
		case "num":
			return `"${String(t.value)}"`
		case "str":
			return `"${t.value}"`
		case "field":
			return `{${t.name}}`
		case "punct":
			return `"${t.op}"`
		case "and":
			return `"AND"`
		case "or":
			return `"OR"`
	}
}

/** Parse an expression string. Failures return a human-readable error rather
 * than throwing — unparseable derived variables are skipped, never fatal. */
export const parseExpression = (src: string): ParseResult => {
	if (src.trim() === "") return { ok: false, error: "The expression is empty" }
	const tokens = tokenize(src)
	if (!Array.isArray(tokens)) return { ok: false, error: tokens.error }

	let pos = 0
	const peek = (): Token | undefined => tokens[pos]
	const isPunct = (op: string): boolean => {
		const t = peek()
		return t?.kind === "punct" && t.op === op
	}
	let failure: string | null = null
	const fail = (message: string): null => {
		if (failure === null) failure = message
		return null
	}

	const parsePrimary = (): Expr | null => {
		const t = peek()
		if (!t) return fail("Expected a value, got the end of the expression")
		if (t.kind === "num" || t.kind === "str" || t.kind === "field") {
			pos++
			return t.kind === "field"
				? { kind: "field", name: t.name }
				: t.kind === "num"
					? { kind: "num", value: t.value }
					: { kind: "str", value: t.value }
		}
		if (t.kind === "punct" && t.op === "(") {
			pos++
			const inner = parseOr()
			if (!inner) return null
			if (!isPunct(")")) return fail(`Expected ")" before ${describe(peek())}`)
			pos++
			return inner
		}
		return fail(`Expected a value before ${describe(t)}`)
	}

	const parseUnary = (): Expr | null => {
		if (isPunct("-")) {
			pos++
			const operand = parseUnary()
			return operand && { kind: "negate", operand }
		}
		return parsePrimary()
	}

	const parseMul = (): Expr | null => {
		let left = parseUnary()
		while (left && (isPunct("*") || isPunct("/"))) {
			const op = (peek() as { op: ArithmeticOp }).op
			pos++
			const right = parseUnary()
			left = right && { kind: "arith", op, left, right }
		}
		return left
	}

	const parseAdd = (): Expr | null => {
		let left = parseMul()
		while (left && (isPunct("+") || isPunct("-"))) {
			const op = (peek() as { op: ArithmeticOp }).op
			pos++
			const right = parseMul()
			left = right && { kind: "arith", op, left, right }
		}
		return left
	}

	const COMPARISONS: ReadonlySet<string> = new Set([
		">",
		"<",
		">=",
		"<=",
		"==",
		"!=",
	])
	const parseCompare = (): Expr | null => {
		const left = parseAdd()
		const t = peek()
		if (!left || t?.kind !== "punct" || !COMPARISONS.has(t.op)) return left
		pos++
		const right = parseAdd()
		return right && { kind: "compare", op: t.op as ComparisonOp, left, right }
	}

	const parseAnd = (): Expr | null => {
		let left = parseCompare()
		while (left && peek()?.kind === "and") {
			pos++
			const right = parseCompare()
			left = right && { kind: "logic", op: "and", left, right }
		}
		return left
	}

	const parseOr = (): Expr | null => {
		let left = parseAnd()
		while (left && peek()?.kind === "or") {
			pos++
			const right = parseAnd()
			left = right && { kind: "logic", op: "or", left, right }
		}
		return left
	}

	const expr = parseOr()
	if (!expr) return { ok: false, error: failure ?? "Could not parse the expression" }
	if (pos < tokens.length)
		return { ok: false, error: `Unexpected ${describe(peek())}` }

	const fields: string[] = []
	const collect = (e: Expr): void => {
		if (e.kind === "field") {
			if (!fields.includes(e.name)) fields.push(e.name)
		} else if (e.kind === "negate") collect(e.operand)
		else if (e.kind === "arith" || e.kind === "compare" || e.kind === "logic") {
			collect(e.left)
			collect(e.right)
		}
	}
	collect(expr)
	return { ok: true, expr, fields }
}

/** A runtime value: `null` is "blank" — a blank/missing cell, or arithmetic
 * that couldn't produce a number (non-numeric operand, division by zero).
 * Blank poisons arithmetic and fails every comparison. */
export type ExprValue = number | string | boolean | null

/** Numeric reading of a value, `null` when it has none. Strings read as
 * numbers when the whole trimmed string parses (matching how cells are
 * parsed everywhere else); booleans deliberately have no numeric reading. */
const numReading = (v: ExprValue): number | null => {
	if (typeof v === "number") return Number.isFinite(v) ? v : null
	if (typeof v === "string") {
		const t = v.trim()
		if (t === "") return null
		const n = Number(t)
		return Number.isFinite(n) ? n : null
	}
	return null
}

/** Whether a raw cell reads as a number for arithmetic — the same reading a
 * `{Field}` operand gets in `evaluateExpression`. Blank cells are NOT
 * numbers; callers that treat "missing" differently from "not a number"
 * (the Math editor does) must filter blanks first. */
export const cellReadsAsNumber = (cell: string): boolean =>
	numReading(cell) !== null

/** String reading for ==/!= fallback. Booleans have none (a boolean never
 * string-matches a cell), so comparing one non-numerically is just false. */
const textReading = (v: ExprValue): string | null => {
	if (typeof v === "string") return v.trim()
	if (typeof v === "number") return String(v)
	return null
}

/** Evaluate against one row of the dataset view (cells are strings). Field
 * references resolve to the row's cell; a blank or missing cell is `null`. */
export const evaluateExpression = (
	expr: Expr,
	row: Record<string, string>
): ExprValue => {
	switch (expr.kind) {
		case "num":
			return expr.value
		case "str":
			return expr.value
		case "field": {
			const cell = row[expr.name]
			if (cell === undefined) return null
			const trimmed = cell.trim()
			return trimmed === "" ? null : trimmed
		}
		case "negate": {
			const n = numReading(evaluateExpression(expr.operand, row))
			return n === null ? null : -n
		}
		case "arith": {
			const left = numReading(evaluateExpression(expr.left, row))
			const right = numReading(evaluateExpression(expr.right, row))
			if (left === null || right === null) return null
			const result =
				expr.op === "+"
					? left + right
					: expr.op === "-"
						? left - right
						: expr.op === "*"
							? left * right
							: left / right
			return Number.isFinite(result) ? result : null
		}
		case "compare": {
			const left = evaluateExpression(expr.left, row)
			const right = evaluateExpression(expr.right, row)
			if (left === null || right === null) return false
			const leftNum = numReading(left)
			const rightNum = numReading(right)
			if (expr.op === "==" || expr.op === "!=") {
				const leftText = textReading(left)
				const rightText = textReading(right)
				const equal =
					leftNum !== null && rightNum !== null
						? leftNum === rightNum
						: leftText !== null && rightText !== null && leftText === rightText
				return expr.op === "==" ? equal : !equal
			}
			// Ordering comparisons are numeric-only.
			if (leftNum === null || rightNum === null) return false
			switch (expr.op) {
				case ">":
					return leftNum > rightNum
				case "<":
					return leftNum < rightNum
				case ">=":
					return leftNum >= rightNum
				case "<=":
					return leftNum <= rightNum
			}
			return false
		}
		case "logic": {
			// Only a literal boolean true counts — a bare {Field} or number is
			// not a condition, so it contributes false rather than truthiness.
			const left = evaluateExpression(expr.left, row) === true
			if (expr.op === "or" && left) return true
			if (expr.op === "and" && !left) return false
			return evaluateExpression(expr.right, row) === true
		}
	}
}

/** Serialize a numeric result as a cell string with float noise trimmed —
 * `0.1 + 0.2` should read "0.3", not "0.30000000000000004". Round-tripping
 * through 12 significant digits keeps every value users actually chart while
 * dropping IEEE dust. */
export const formatNumericCell = (n: number): string => {
	if (Number.isInteger(n)) return String(n)
	return String(Number(n.toPrecision(12)))
}

/** Evaluate an expression to a cell string for the Math kind: numbers are
 * noise-trimmed, blank/invalid rows become empty cells, and a boolean-valued
 * formula spells the result out. */
export const evaluateToCell = (
	expr: Expr,
	row: Record<string, string>
): string => {
	const v = evaluateExpression(expr, row)
	if (v === null) return ""
	if (typeof v === "number") return formatNumericCell(v)
	if (typeof v === "boolean") return v ? "true" : "false"
	return v
}
