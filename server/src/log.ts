/** Single-line logging to stdout/stderr — the whole logging contract.
 *  Infrastructure owns collection and retention; the server never writes
 *  log files. */

/* eslint-disable no-console -- stdout/stderr ARE the log sink here */

const stamp = () => new Date().toISOString()

export const logInfo = (message: string): void => {
	console.log(`${stamp()} ${message}`)
}

export const logError = (message: string): void => {
	console.error(`${stamp()} ERROR ${message}`)
}
