// Generates the sample cart PDFs in sample-data/ (run: npm run sample:pdfs).
// cart.pdf mirrors the assignment brief; cart-malformed.pdf exercises every
// warning path; cart-near-threshold.pdf demonstrates the cart-offer nudge.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const COLS = [50, 190, 310, 430] // x positions: Product, Brand, Platform, Base Price

async function makeCart(file, title, rows, footer = []) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let y = 780
  page.drawText(title, { x: 50, y, size: 12, font: bold })
  y -= 40
  ;['Product', 'Brand', 'Platform', 'Base Price'].forEach((h, i) => page.drawText(h, { x: COLS[i], y, size: 10, font: bold }))
  y -= 8
  page.drawLine({ start: { x: 50, y }, end: { x: 520, y }, thickness: 0.7, color: rgb(0.3, 0.3, 0.3) })
  y -= 18
  for (const row of rows) {
    row.forEach((cell, i) => cell && page.drawText(cell, { x: COLS[i], y, size: 10, font }))
    y -= 18
  }
  for (const line of footer) {
    y -= 6
    page.drawText(line, { x: 50, y, size: 10, font: bold })
    y -= 18
  }
  writeFileSync(new URL(`../sample-data/${file}`, import.meta.url), await doc.save())
  console.log('wrote sample-data/' + file)
}

const SAMPLE = [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
  ['Bed Sheet Set', 'Natura Casa', 'Flipkart', 'Rs.849'],
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.599'],
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'],
  ['Cutting Board', 'Nordic Basics', 'Amazon India', 'Rs.449'],
  ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'],
]

await makeCart('cart.pdf', 'Order #OP-9921  |  Date: 15 Jan 2025', SAMPLE)

await makeCart('cart-malformed.pdf', 'Order #OP-9934  |  Date: 18 Jan 2025', [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
  ['Bed Sheet Set', 'Natura Casa', 'Flipkart', ''], // missing price
  ['', 'LivSpace Pro', 'Amazon India', 'Rs.599'], // missing product
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,4O9'], // letter O instead of zero
  ['Cutting Board', 'Nordic Basics', 'Amazon India', 'Rs.-449'], // negative
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'], // duplicate of row 1
  ['Desk Organiser', 'Nordic Basics', '', 'Rs.899'], // missing platform
  ['Table Lamp', 'Nordic Basics', 'Flipkart', 'Rs.1,150'],
], ['Total                                                                                    Rs.6,595'])

await makeCart('cart-near-threshold.pdf', 'Order #OP-9940  |  Date: 20 Jan 2025', [
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'],
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.599'],
  ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'],
])
