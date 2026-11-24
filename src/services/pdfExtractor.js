/**
 * pdfExtractor.js — reads positioned text out of a PDF with pdf.js.
 * The only module that knows about pdf.js. Output feeds pdfAdapter.js.
 */

/** Browser: lazy-load pdf.js (keeps it out of the main bundle) with its worker. */
export async function loadBrowserPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

const MAX_PAGES = 20

/**
 * @param {object} pdfjs  the pdf.js module (browser or node legacy build)
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<{str: string, x: number, y: number, page: number}[]>}
 */
export async function extractTextItems(pdfjs, data) {
  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0 }).promise
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('This PDF is password-protected. Please upload an unlocked copy.')
    throw new Error('This file could not be read as a PDF. It may be damaged or not a PDF.')
  }
  if (doc.numPages > MAX_PAGES) throw new Error(`This PDF has ${doc.numPages} pages; carts are limited to ${MAX_PAGES} pages.`)

  const items = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    for (const it of content.items) {
      if (typeof it.str !== 'string') continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], page: p })
    }
  }
  await doc.destroy()
  return items
}
