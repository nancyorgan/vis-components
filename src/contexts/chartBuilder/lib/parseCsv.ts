import { parse as papaParse } from "papaparse"

export type ParsedCsv = {
	fieldNames: string[]
	rows: Array<Record<string, string>>
}

export const parseCsvFile = async (file: File): Promise<ParsedCsv> => {
	const text = await file.text()
	return parseCsvText(text)
}

export const parseCsvText = (text: string): ParsedCsv => {
	const result = papaParse<Record<string, string>>(text, {
		header: true,
		skipEmptyLines: true,
		dynamicTyping: false,
	})
	if (result.errors.length > 0) {
		const firstFatal = result.errors.find((e) => e.type !== "Quotes")
		if (firstFatal) {
			throw new Error(
				`CSV parse error at row ${firstFatal.row}: ${firstFatal.message}`
			)
		}
	}
	const fieldNames = result.meta.fields ?? []
	return { fieldNames, rows: result.data }
}
