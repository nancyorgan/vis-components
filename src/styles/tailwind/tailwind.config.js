/** @type {import('tailwindcss').Config} */
module.exports = {
	theme: {
		extend: {
			/**
			 * Can't override typography in the CSS file, so we must do it here:
			 * https://github.com/tailwindlabs/tailwindcss-typography?tab=readme-ov-file#adding-custom-color-themes
			 */
			typography: () => ({
				dark: {
					css: {
						"--tw-prose-body": "var(--color-stone-300)",
						"--tw-prose-headings": "var(--color-stone-300)",
						"--tw-prose-bold": "var(--color-stone-300)",
						"--tw-prose-code": "var(--color-stone-300)",
					},
				},
			}),
		},
	},
}
