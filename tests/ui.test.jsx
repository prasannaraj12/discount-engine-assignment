// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import App from '../src/App.jsx'
import RuleBuilder from '../src/components/RuleBuilder.jsx'
import { requestRuleParse } from '../src/services/aiRuleParser.js'
import { extractTextItems } from '../src/services/pdfExtractor.js'

vi.mock('../src/services/aiRuleParser.js', () => ({ requestRuleParse: vi.fn() }))
vi.mock('../src/services/pdfExtractor.js', () => ({ loadBrowserPdfjs: vi.fn(async () => ({})), extractTextItems: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const cartItems = [{ itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 }]
const llmOk = {
  ok: true,
  result: {
    status: 'ok',
    interpretation: '20% off Natura Casa',
    clarification: null,
    missing_fields: [],
    rule: { scope: 'brand', applies_to: 'Natura Casa', type: 'percentage', value: 20, stackable: true, min_cart_value: null, threshold_inclusive: null },
  },
}

async function interpret(text) {
  fireEvent.change(screen.getByLabelText('Describe the discount rule'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Interpret rule' }))
}

describe('rule confirmation', () => {
  it('adds the rule only on Confirm, exactly once even if clicked twice', async () => {
    requestRuleParse.mockResolvedValue(llmOk)
    const onConfirm = vi.fn()
    render(<RuleBuilder rules={[]} cartItems={cartItems} onConfirm={onConfirm} />)
    await interpret('20% off for Natura Casa brand, stackable with other offers')
    const confirm = await screen.findByRole('button', { name: /Confirm rule/ })
    expect(onConfirm).not.toHaveBeenCalled() // parsing alone never adds a rule
    expect(screen.getByText('Products affected').nextSibling.textContent).toBe('1')
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ scope: 'brand', appliesTo: 'Natura Casa', value: 20, stackable: true, source: 'ai' })
  })

  it('Discard adds nothing and keeps the text for editing', async () => {
    requestRuleParse.mockResolvedValue(llmOk)
    const onConfirm = vi.fn()
    render(<RuleBuilder rules={[]} cartItems={cartItems} onConfirm={onConfirm} />)
    await interpret('20% off Natura Casa, stackable')
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Describe the discount rule').value).toBe('20% off Natura Casa, stackable')
  })

  it('an edit that makes the rule invalid disables Confirm', async () => {
    requestRuleParse.mockResolvedValue(llmOk)
    render(<RuleBuilder rules={[]} cartItems={cartItems} onConfirm={vi.fn()} />)
    await interpret('20% off Natura Casa, stackable')
    fireEvent.change(await screen.findByLabelText('Value (%)'), { target: { value: '150' } })
    expect(screen.getByText(/150% is outside the supported range/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Confirm rule/ }).disabled).toBe(true)
  })

  it('ambiguous input shows the clarification question and no Confirm button', async () => {
    requestRuleParse.mockResolvedValue({
      ok: true,
      result: { status: 'needs_clarification', interpretation: 'Large-order discount', clarification: 'What percentage, and from what cart value?', missing_fields: ['value', 'min_cart_value'], rule: null },
    })
    render(<RuleBuilder rules={[]} cartItems={cartItems} onConfirm={vi.fn()} />)
    await interpret('Give a discount for big orders')
    expect(await screen.findByText('What percentage, and from what cart value?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Confirm rule/ })).toBeNull()
  })

  it('API failures surface the server message', async () => {
    requestRuleParse.mockResolvedValue({ ok: false, code: 'provider_unreachable', message: 'Could not reach the AI service. Please try again.' })
    render(<RuleBuilder rules={[]} cartItems={cartItems} onConfirm={vi.fn()} />)
    await interpret('10% off Flipkart')
    expect(await screen.findByText('Could not reach the AI service. Please try again.')).toBeTruthy()
  })
})

describe('app workflow', () => {
  beforeEach(() => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Load sample data' }))
  })

  // The cart table is always the last table in the Cart card (a PDF preview table may sit above it).
  const cartRows = () => {
    const tables = within(screen.getByRole('region', { name: 'Cart' })).getAllByRole('table')
    return within(tables[tables.length - 1]).getAllByRole('row').length - 1
  }

  it('calculates the brief\'s sample cart', () => {
    fireEvent.click(screen.getByRole('button', { name: /Calculate discounts/ }))
    const summary = screen.getByRole('complementary', { name: 'Order summary' })
    expect(within(summary).getByText('₹5,339')).toBeTruthy()
    expect(within(summary).getByText('Cart offer: 10% off')).toBeTruthy()
  })

  async function uploadPdf() {
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    const input = document.querySelector('input[type=file][accept*=pdf]')
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4 x'], 'cart.pdf', { type: 'application/pdf' })] } })
  }

  it('keeps the current cart when the PDF cannot be read', async () => {
    extractTextItems.mockRejectedValue(new Error('This file could not be read as a PDF. It may be damaged or not a PDF.'))
    await uploadPdf()
    expect(await screen.findByText(/could not be read as a PDF/)).toBeTruthy()
    expect(screen.getByText('Your current cart (6 items) was kept.')).toBeTruthy()
    expect(cartRows()).toBe(6)
  })

  it('keeps the current cart when no PDF row is valid, and never auto-replaces', async () => {
    const t = (str, x, y) => ({ str, x, y, page: 1 })
    extractTextItems.mockResolvedValue([
      t('Product', 50, 700), t('Brand', 190, 700), t('Platform', 310, 700), t('Base Price', 430, 700),
      t('Lamp', 50, 680), t('Acme', 190, 680), t('Flipkart', 310, 680), t('Rs.abc', 430, 680),
    ])
    await uploadPdf()
    expect(await screen.findByText('Row 1 skipped — unreadable base price "Rs.abc"')).toBeTruthy()
    expect(screen.getByText('No valid products were found, so the current cart was kept.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Replace cart/ })).toBeNull()
    expect(cartRows()).toBe(6)
  })

  it('replaces the cart only after confirmation and re-prices it', async () => {
    const t = (str, x, y) => ({ str, x, y, page: 1 })
    extractTextItems.mockResolvedValue([
      t('Product', 50, 700), t('Brand', 190, 700), t('Platform', 310, 700), t('Base Price', 430, 700),
      t('Ceramic Vase', 50, 680), t('LivSpace Pro', 190, 680), t('Noon', 310, 680), t('Rs.2,499', 430, 680),
    ])
    await uploadPdf()
    const replace = await screen.findByRole('button', { name: /Replace cart with 1 item/ })
    expect(cartRows()).toBe(6) // preview does not touch the cart
    fireEvent.click(replace)
    await waitFor(() => expect(cartRows()).toBe(1))
    expect(screen.getByText(/You're just ₹1,501 away/)).toBeTruthy()
  })
})

describe('PDF preview decisions', () => {
  const t = (str, x, y) => ({ str, x, y, page: 1 })
  const header = [t('Product', 50, 700), t('Brand', 190, 700), t('Platform', 310, 700), t('Base Price', 430, 700)]
  const row = (y, product, price) => [t(product, 50, y), t('LivSpace Pro', 190, y), t('Noon', 310, y), t(price, 430, y)]
  const cartRows = () => {
    const tables = within(screen.getByRole('region', { name: 'Cart' })).getAllByRole('table')
    return within(tables[tables.length - 1]).getAllByRole('row').length - 1
  }

  beforeEach(() => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Load sample data' }))
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
  })

  const pickPdf = () =>
    fireEvent.change(document.querySelector('input[type=file][accept*=pdf]'), {
      target: { files: [new File(['%PDF-1.4 x'], 'cart.pdf', { type: 'application/pdf' })] },
    })

  it('Cancel closes the preview and keeps the current cart and prices', async () => {
    extractTextItems.mockResolvedValue([...header, ...row(680, 'Ceramic Vase', 'Rs.2,499')])
    pickPdf()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: /Replace cart/ })).toBeNull()
    expect(cartRows()).toBe(6)
    expect(within(screen.getByRole('region', { name: 'Cart' })).getByText(/sample-data\/cart\.csv/)).toBeTruthy()
  })

  it('a non-PDF dropped on the PDF area is rejected without reading it, and the cart is kept', async () => {
    const dropzone = screen.getByRole('button', { name: 'Upload Cart PDF' })
    fireEvent.drop(dropzone, { dataTransfer: { files: [new File(['a,b'], 'cart.csv', { type: 'text/csv' })] } })
    expect(await screen.findByText(/cart\.csv isn't a supported file\. Please upload a \.pdf file\./)).toBeTruthy()
    expect(screen.getByText('Your current cart (6 items) was kept.')).toBeTruthy()
    expect(extractTextItems).not.toHaveBeenCalled()
    expect(cartRows()).toBe(6)
  })

  it('an empty (0-byte) PDF is rejected before extraction', async () => {
    fireEvent.change(document.querySelector('input[type=file][accept*=pdf]'), { target: { files: [new File([], 'empty.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText('empty.pdf is empty.')).toBeTruthy()
    expect(extractTextItems).not.toHaveBeenCalled()
    expect(cartRows()).toBe(6)
  })

  it('the duplicate checkbox decides whether repeated rows are imported', async () => {
    extractTextItems.mockResolvedValue([...header, ...row(680, 'Ceramic Vase', 'Rs.2,499'), ...row(660, 'Ceramic Vase', 'Rs.2,499')])
    pickPdf()
    expect(await screen.findByText('Row 2 looks like a duplicate of row 1 — kept unless you exclude duplicates')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Replace cart with 2 items/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep possible duplicates/ }))
    fireEvent.click(screen.getByRole('button', { name: /Replace cart with 1 item$/ }))
    await waitFor(() => expect(cartRows()).toBe(1))
  })
})

describe('wording checks in the review screen', () => {
  const ruleOutput = (rule) => ({
    ok: true,
    result: { status: 'ok', interpretation: 'x', clarification: null, missing_fields: [], rule: { scope: 'brand', applies_to: 'Natura Casa', stackable: false, min_cart_value: null, threshold_inclusive: null, ...rule } },
  })

  it('a negative amount in the text disables Confirm', async () => {
    requestRuleParse.mockResolvedValue(ruleOutput({ type: 'flat', value: 50 }))
    const onConfirm = vi.fn()
    render(<RuleBuilder rules={[]} cartItems={cartItems} onConfirm={onConfirm} />)
    await interpret('-50 rupees off Natura Casa')
    expect(await screen.findByText(/contains a negative amount \("-50"\)/)).toBeTruthy()
    const confirm = screen.getByRole('button', { name: /Confirm rule/ })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a time limit shows a warning but the merchant can still confirm a permanent rule', async () => {
    requestRuleParse.mockResolvedValue(ruleOutput({ type: 'percentage', value: 20 }))
    const onConfirm = vi.fn()
    render(<RuleBuilder rules={[]} cartItems={cartItems} onConfirm={onConfirm} />)
    await interpret('20% off Natura Casa this weekend only')
    expect(await screen.findByText(/mentions a time limit \("weekend"\).*apply permanently/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Confirm rule/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
