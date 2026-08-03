import postCssColorMixFunction from "@csstools/postcss-color-mix-function"
import tailwind from "@tailwindcss/postcss"
import postcssNested from "postcss-nested"

export default {
	plugins: [
		// Resolve `:global` nesting in module CSS before Tailwind expands utilities.
		postcssNested(),
		// Tailwind v4 — generates the utility set and applies @theme tokens.
		tailwind(),
		// Polyfill `color-mix()` for browsers that don't support it natively.
		postCssColorMixFunction,
		// Vite handles minification (lightningcss/esbuild) on its own. cssnano
		// was previously in the chain but couldn't parse Tailwind v4's
		// `calc(infinity * 1px)` syntax — and minifying in dev is pointless.
	],
}
