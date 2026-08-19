import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginReact from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'
import th from './tooling/eslint/th-plugin.js'
import { restrictedGlobals } from './tooling/eslint/restricted-globals.js'

// Rule choices mirror engineering-frontend's eslint.config.mjs where they
// apply to a standalone Vite repo (no nx/import/unicorn/tanstack machinery),
// plus jsx-a11y, which this repo adds.
export default tseslint.config(
	{ ignores: ['dist', 'node_modules', 'test-results', 'playwright-report'] },
	{
		files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
		extends: [
			js.configs.recommended,
			...tseslint.configs.recommended,
			pluginReact.configs.flat.recommended,
			pluginReact.configs.flat['jsx-runtime'],
			jsxA11y.flatConfigs.recommended,
		],
		languageOptions: {
			globals: { ...globals.browser },
		},
		settings: {
			// explicit version: `detect` uses a context API removed in ESLint 10
			react: { version: '18.3' },
		},
		plugins: {
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
			'@th': th,
		},
		rules: {
			...reactHooks.configs.recommended.rules,

			'@th/use-wrapped-json-functions': 'error',
			'@th/no-storage-outside-try': 'error',

			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/no-unused-expressions': [
				'error',
				{ allowShortCircuit: true, allowTernary: true },
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					args: 'all',
					ignoreRestSiblings: true,
					varsIgnorePattern: '^_',
					argsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],

			'no-console': 'error',
			'no-restricted-globals': ['error', ...restrictedGlobals],
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'react',
							importNames: ['default'],
							message:
								'We no longer need the default React import. Use destructured imports instead, or no import at all.',
						},
					],
				},
			],

			'react/display-name': 'off',
			'react/no-array-index-key': 'error',
			'react/prop-types': 'off',

			'react-hooks/exhaustive-deps': 'error',
			'react-hooks/purity': 'warn',
			'react-hooks/refs': 'warn',
			'react-hooks/set-state-in-effect': 'warn',
			'react-hooks/static-components': 'warn',

			'react-refresh/only-export-components': [
				'warn',
				{ allowConstantExport: true },
			],
		},
	},
	{
		// Self-host server: plain Node, no React/browser globals. Logging to
		// stdout/stderr is the server's logging contract, so `no-console` stays
		// on but log.ts (the one sanctioned sink) carries a targeted disable.
		files: ['server/src/**/*.ts'],
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		languageOptions: {
			globals: { ...globals.node },
		},
		rules: {
			'no-console': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					args: 'all',
					ignoreRestSiblings: true,
					varsIgnorePattern: '^_',
					argsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
		},
	},
	{
		files: ['**/*.{test,spec}.{ts,tsx}', '**/*.smoke.test.tsx', 'src/test/**'],
		rules: {
			// non-null assertions are legit in tests
			'@typescript-eslint/no-non-null-assertion': 'off',
		},
	},
	{
		// Playwright specs run in node and log progress deliberately; browser
		// globals cover page.evaluate() callbacks.
		files: ['e2e/**/*.ts'],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
		},
		rules: {
			'no-console': 'off',
		},
	},
)
