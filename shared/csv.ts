/** CSV helpers shared by the server's full export and the browser's Guava export. */

export function escapeCsvField(fieldValue: string): string {
  // Neutralize spreadsheet formula injection (=, +, -, @ at the start of a cell).
  const formulaSafeValue = /^[=+\-@\t\r]/.test(fieldValue) ? `'${fieldValue}` : fieldValue
  return /[",\n\r]/.test(formulaSafeValue) ? `"${formulaSafeValue.replace(/"/g, '""')}"` : formulaSafeValue
}

/** RFC 4180 lines, CRLF, with a UTF-8 BOM so spreadsheet apps read accents and emoji correctly. */
export function buildCsvText(headerRow: readonly string[], dataRows: readonly (readonly string[])[]): string {
  const csvLines = [headerRow, ...dataRows].map((row) => row.map(escapeCsvField).join(','))
  return '﻿' + csvLines.join('\r\n') + '\r\n'
}
