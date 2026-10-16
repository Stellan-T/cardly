/**
 * Reads an uploaded file as plain text. DOCX (mammoth) and PDF (pdf.js) parsers
 * are loaded on demand so they don't weigh down the main bundle.
 */
import type { TermSepOption } from '../../lib/parseImport'

export const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.csv', '.tsv', '.docx', '.pdf']
export const ACCEPT_ATTR = [...ACCEPTED_EXTENSIONS, 'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values'].join(',')
export const MAX_FILE_BYTES = 20 * 1024 * 1024

export interface ReadResult {
  text: string
  /** Suggested title (file name without extension). */
  title: string
  /** Separator implied by the file type (csv → comma, tsv → tab). */
  termSep?: TermSepOption
}

export class ImportFileError extends Error {}

const extOf = (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase()
const titleOf = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()

export async function readImportFile(file: File): Promise<ReadResult> {
  const ext = extOf(file.name)
  const title = titleOf(file.name)
  if (file.size > MAX_FILE_BYTES) throw new ImportFileError('That file is larger than 20 MB. Please split it up.')
  switch (ext) {
    case '.txt':
    case '.md':
    case '.markdown':
      return { text: await file.text(), title }
    case '.csv':
      return { text: await file.text(), title, termSep: 'comma' }
    case '.tsv':
      return { text: await file.text(), title, termSep: 'tab' }
    case '.docx':
      return { text: await readDocx(file), title }
    case '.pdf':
      return { text: await readPdf(file), title }
    default:
      if (file.type.startsWith('text/')) return { text: await file.text(), title }
      throw new ImportFileError(`Unsupported file type “${ext || file.type}”. Use ${ACCEPTED_EXTENSIONS.join(', ')}.`)
  }
}

async function readDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  // mammoth separates paragraphs with a blank line; one line per paragraph keeps
  // multi-paragraph definitions attached to their term.
  return value.replace(/\n{2,}/g, '\n')
}

async function readPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const lines: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    let line = ''
    let lastY: number | null = null
    for (const item of content.items) {
      if (!('str' in item)) continue
      const y = item.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > 2 && line.trim()) {
        lines.push(line)
        line = ''
      }
      line += item.str
      lastY = y
      if (item.hasEOL) {
        lines.push(line)
        line = ''
        lastY = null
      }
    }
    if (line.trim()) lines.push(line)
  }
  const text = lines.join('\n').replace(/[ \t]+\n/g, '\n')
  if (text.replace(/\s/g, '').length < 20) {
    throw new ImportFileError(
      'No text found in this PDF. It looks like a scanned document (an image of text). Only PDFs with selectable text can be imported — try copying the text instead.',
    )
  }
  return text
}
