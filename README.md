# Opptra Smart Discount Engine

A customer-facing checkout pricing engine for the Opptra FDE Intern assignment. It applies brand, platform and cart-level offers, explains every price in plain language, and accepts input from **CSV**, **PDF** and **natural-language rules parsed by an LLM**, all feeding the same deterministic engine.

**Live demo:** https://discount-engine-assignment-sable.vercel.app/ (deployed on Vercel from `main`; the AI rule parser uses Groq `openai/gpt-oss-120b`)

**Video walkthrough:** https://www.loom.com/share/51e28da727f74f4d83854c299c0a2a80 (about 4 minutes)

---

## The problem

A customer sees one final price at checkout. Behind it, brands (₹150 off Natura Casa) and platforms (15% off Amazon India) run overlapping campaigns. The system has to pick the best deal for each item, stack offers that are allowed to stack, apply cart-wide offers last, and tell the customer exactly what happened: one final price, one clear explanation, no surprises.

## Why this is more than a discount calculator

- **One deterministic source of truth.** Every rupee shown comes from `calculateCart()`. The LLM never calculates a price, picks a winning offer, or touches a total. It only proposes a rule, which the app validates before anyone confirms it.
- **AI where language needs understanding, code where it doesn't.** Turning "10% off above ₹5,000" into a rule needs a language model. Spotting a duplicate promotion or the item with no offer doesn't, so those checks are plain, testable code.
- **Transparent pricing.** Every product answers *what happened, why, how much did I save, and what can I do next*: the winning offer, the offer it beat and by how much, offers that don't cover it, the exact maths, and how far the cart is from the next cart offer.
- **Mistakes are caught before they reach customers.** Rules are validated twice, previewed against the live cart with conflict notes, confirmed explicitly, and audited afterwards (deep discounts, duplicates, rules that can never win, heavy stacking, typos like "Amazon" vs "Amazon India").
- **Bad input fails loudly and safely.** Malformed CSV and PDF rows are reported row by row, never guessed. A failed import never touches the current cart.

## Features

| Area | What it does |
|---|---|
| **Discount engine** | Best non-stackable offer per item (by rupee saving, scope doesn't matter), stackable offers on top, "No offers available" fallback |
| **Cart-level offers** (Task 1) | Evaluated after item discounts against the sum of final item prices; shown as a separate "Cart offer: 10% off: ₹593 saved" row; hidden if the threshold isn't met |
| **Natural-language rules** (Task 2) | Plain English → LLM → schema validation → editable confirmation with an impact preview → engine re-runs |
| **PDF cart upload** (Task 3) | Client-side extraction with pdf.js, row-by-row preview with warnings, cart replaced only after confirmation, re-priced with the active rules |
| **Price explanations** | "You saved ₹195 with the Amazon India offer, which is ₹45 more than the Natura Casa offer (₹150)." Competing offers, step-by-step maths, and rule IDs behind a *Technical details* toggle |
| **Threshold nudge** | "You're just ₹183 away from unlocking 10% off your entire cart." with a progress bar |
| **Change summary** | After adding or removing a rule: previous vs updated total, extra savings, and only the products whose price actually changed |
| **Order summary** | Original total, product offers, cart offer, final payable, savings split by platform / brand / cart offers |
| **Cart insights** | Overall saving, biggest saving, items with no offer, offers that were outbid, the cart offer's share, and the next threshold, all read from engine results. Suggestions only; never changes the cart. |
| **Rule checks** | Deterministic audit of the active rules: ≥50% or 100% discounts, duplicates (stackable duplicates double-discount), same-target rules that can never win, rules matching nothing in the cart (with "did you mean…?"), rules outbid on every item, items ≥50% off after stacking |
| **Safe uploads** | Type and size limits (CSV 1 MB, PDF 5 MB, 20 pages), checked for drag & drop too; a rejected file keeps the current data |

## Architecture

```
            ┌────────────── input adapters (src/adapters) ───────────────┐
 rules.csv ─┤ csvAdapter            ──┐                                    │
 cart.csv  ─┤                          │  normalized                       │
 cart.pdf  ─┤ pdfExtractor → pdfAdapter├─ DiscountRule[]  ─┐               │
 "20% off…"─┤ /api/parse-rule (LLM) →  │  CartItem[]       │               │
            │ naturalLanguageAdapter ──┘                   │               │
            └──────── all validated by src/validation ─────┼───────────────┘
                                                           ▼
                         src/engine/pricing.js  calculateCart(items, rules)
                           ├─ discountEngine.js      item-level (original logic)
                           └─ cartRuleEvaluator.js   cart-level, threshold nudge
                                                           │
             explanationEngine · ruleImpact · cartInsights · promotionAudit
                   (text, previews, insights and checks read from results)
                                                           ▼
                                                  React components (display only)
```

```
api/parse-rule.js              Vercel serverless function (thin wrapper)
server/parseRule.js            request validation, rate limit, re-validation of LLM output
server/llm/                    providers (Groq, Anthropic), shared prompt, output schema, JSON-Schema checker
src/adapters/                  csvAdapter, pdfAdapter, naturalLanguageAdapter
src/services/                  pdfExtractor (pdf.js), aiRuleParser (fetch client)
src/validation/                discountRuleSchema (Zod), cartItemSchema
src/engine/                    discountEngine, cartRuleEvaluator, pricing, explanationEngine,
                               ruleImpact, cartInsights, promotionAudit, ruleIdentity
src/components/                UI only
tests/                         Vitest suites
```

The engine imports no CSV, PDF, LLM or validation library (enforced by `tests/architecture.test.js`). The original `discountEngine.js` was kept. Changes there are additive (structured `steps` / `competingOffers` for explanations), plus one fix: a flat discount can no longer push a price below zero. **Adding a third input mode** means writing one function that returns `CartItem[]` or `DiscountRule[]` and passes it through `validateCartRow` / `validateDiscountRule`. The architecture test includes a JSON-order adapter written exactly that way.

## Tech stack

React 18 + Vite 8 · Papa Parse · pdf.js (`pdfjs-dist`, lazy-loaded) · Zod 4 · LLM via Groq (OpenAI-compatible API, built-in fetch) or the Anthropic SDK, server-side only · Vitest 5 + React Testing Library · Vercel (static site + one serverless function). Requires Node 20.19+.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

That's all you need for CSV, PDF and pricing. To enable the AI rule parser, also create `.env` with your key (see below) before `npm run dev`. The dev server serves `/api/parse-rule` with the same handler production uses, so the key never reaches the browser.

## Environment variables

All are server-side only. **Never** prefix them with `VITE_`, which would put them in the browser bundle.

| Variable | Required | Purpose |
|---|---|---|
| `LLM_PROVIDER` | To use Groq | `groq` or `anthropic`. If unset, `anthropic` is used (the original default). The app never switches provider on its own because another key exists, and never falls back to a different provider when the selected one fails. |
| `GROQ_API_KEY` | When `LLM_PROVIDER=groq` | Groq API key. An Anthropic key is not needed in this mode. |
| `GROQ_MODEL` | No | Default `openai/gpt-oss-120b`. |
| `ANTHROPIC_API_KEY` | When `LLM_PROVIDER=anthropic` | Anthropic API key. |
| `ANTHROPIC_MODEL` | No | Default `claude-opus-5-5`. `LLM_MODEL` is still accepted as a legacy alias for this. |

**Using Groq locally:**

```
# D:\assignment\.env   (git-ignored; never commit it)
LLM_PROVIDER=groq
GROQ_API_KEY=<your key from console.groq.com/keys>
# GROQ_MODEL=openai/gpt-oss-120b
```

Then `npm run dev`. `npm run parse:once` shows the provider, model and whether the key is set, without calling the API; `npm run parse:once -- --yes` makes exactly one live call and prints the validated result.

**Groq output modes.** For `openai/gpt-oss-120b` and `openai/gpt-oss-20b`, Groq's strict structured outputs (`response_format: json_schema, strict: true`) constrain the reply to the schema. Any other `GROQ_MODEL` uses JSON mode (`json_object`) with the schema in the prompt, which guarantees valid JSON but not the schema. In both modes the server's Zod check decides, and a mismatch is shown as an error, never repaired or guessed.

Copy `.env.example` to `.env` locally. On Vercel, set them under *Project → Settings → Environment Variables*. Without a key, everything else works and the rule builder shows *"The AI rule parser is not configured on this server"*. The app never falls back to fake or regex parsing.

## Deploy (Vercel)

1. Import the GitHub repo in Vercel (framework is auto-detected as Vite; `api/` becomes a serverless function).
2. Add `LLM_PROVIDER` and the matching key (`GROQ_API_KEY`, or `ANTHROPIC_API_KEY`), plus an optional model variable.
3. Deploy. The live deployment is at https://discount-engine-assignment-sable.vercel.app/.

## Using the sample inputs

- **Load sample data** (top right) loads `sample-data/rules.csv` + `sample-data/cart.csv` through the CSV adapter. Click **Calculate discounts**.
- Or upload them manually. `rules.csv` now includes the brief's `RULE-04` cart rule and `min_cart_value` column.
- **PDF tab:** upload
  - `sample-data/cart.pdf`: the brief's order (reproduces ₹5,339)
  - `sample-data/cart-malformed.pdf`: missing price/product/platform, unreadable and negative prices, a duplicate, a "Total" line
  - `sample-data/cart-near-threshold.pdf`: ₹3,817 cart, shows the "₹183 away" nudge
  - `sample-data/cart-empty.pdf`: a valid PDF with one blank page (no text layer), shown as "may be a scanned image; OCR is not supported"
  - Regenerate with `npm run sample:pdfs`.
- **AI rules:** click an example chip (the brief's four examples) or type your own.

### Expected results (verified by `tests/engine.sample.test.js` and in the browser)

| Item | Base | Applied | Final |
|---|---|---|---|
| ITEM-01 Cushion Cover | ₹1,299 | RULE-01 15% (₹195 beats RULE-02's ₹150) | **₹1,104** |
| ITEM-02 Bed Sheet Set | ₹849 | RULE-02 −₹150, then RULE-03 10% stacked | **₹629** |
| ITEM-03 Wall Shelf | ₹599 | RULE-01 | **₹509** |
| ITEM-04 Ceramic Vase | ₹2,499 | No offers available | **₹2,499** |
| ITEM-05 Cutting Board | ₹449 | RULE-01 | **₹382** |
| ITEM-06 Desk Organiser | ₹899 | RULE-03 | **₹809** |
| Cart before offer | | | ₹5,932 |
| RULE-04 cart offer | | 10% (₹5,932 ≥ ₹4,000) | −₹593 |
| **Final cart total** | | | **₹5,339** |

## Testing

```bash
npm test                       # 171 tests, Vitest, fully offline
npm run eval:parser -- --dry   # list the evaluation cases (no API calls)
npm run eval:parser            # live LLM evaluation (selected provider's key, 25 API calls)
npm run parse:once -- --yes    # exactly one live parse (selected provider's key)
```

| Suite | Covers |
|---|---|
| `engine.sample` | Every value in the brief's expected-results table |
| `engine.edge` | Highest non-stackable wins, stackable alone/on top, no match, flat > price, ties, duplicate products, cart threshold met / not met / exactly equal / strict ">", empty cart, multiple cart rules, nudge, recalculation diff |
| `explanation` | Customer sentences generated from results (ITEM-01 comparison, stacking, no-offer, cart label, nudge) |
| `ruleImpact` | Impact preview and conflict notes (rule loses to / replaces an existing offer, cart threshold not met) |
| `ai` | Server handler: missing key, empty/oversized input, malformed model output, provider failures. Domain validation: 200%, negative, NaN, missing target, threshold on item rule. Adapter: clarification, hallucinated values, strict-vs-inclusive wording, duplicates. Fetch client: network error, non-JSON |
| `pdf` | Real pdf.js on the sample PDFs: brief cart → ₹5,339, every malformed row reported, not-a-PDF, blank-page PDF (`cart-empty.pdf`) reported as scanned/unsupported. Also: no header, header with no rows, split header words, right-aligned prices, a header repeated on page 2, password-protected PDFs, more than 20 pages (rejected before reading any page) |
| `architecture` | Engine imports no parsing/LLM/validation libraries; a new adapter works without engine changes |
| `intelligence` | Rule checks and cart insights on real engine output; "offers that don't apply" explanations; rounding at exactly ₹0.50; ₹10-lakh prices; paise; zero/negative/non-numeric prices; invalid CSV rows with row numbers; upload type/size limits |
| `groq` | The JSON Schema sent to Groq passes a checker built from Groq's documented strict-mode rules (and the checker catches violations). Request shape: strict mode for gpt-oss, JSON mode otherwise. One POST with no retries. Malformed JSON, empty or cut-off replies, refusals, 401/403/404/400 (schema mismatch and other)/413/422/429 (with retry-after)/498/5xx, network failure and timeout. Zod still rejects bad output, 200% is still blocked, ambiguity stays a clarification. A failure never becomes another provider's answer or a made-up rule. Explicit provider selection and independent model settings |
| `wordingChecks` | Replays the exact Groq output for the two evaluation misses: "this weekend only" now gets the time-limit warning, and "-50 rupees off" is now blocked. 10 time-limit and 6 negative-amount phrasings detected; ranges like "10-20%" ignored; neither check fires on any other evaluation instruction; the negative block holds even after the fields are edited |
| `ui` (jsdom) | Rule added only on Confirm and only once on double-click; Discard adds nothing; an invalid edit disables Confirm; clarification shows no Confirm; API errors shown; a negative amount disables Confirm; a time limit warns but still allows Confirm; sample cart → ₹5,339. PDF: cart kept when the file can't be read, has no valid rows, is 0 bytes, or is a non-PDF dropped on the PDF area; Cancel keeps the cart; the duplicate checkbox controls what's imported; cart replaced only after confirmation |

All tests run offline. Groq HTTP responses are mocked in `groq.test.js` (global `fetch` is replaced so an accidental real call fails the test). The AI service and pdf.js are mocked in `ui.test.jsx` at the module boundary. `pdf.test.js` runs the real pdf.js on the sample PDFs.

## AI integration

```
User text → POST /api/parse-rule → selected provider: Groq or Claude (structured JSON output from one Zod schema)
          → server re-validates shape → client adapter: domain validation + cross-checks
          → confirmation (editable fields, warnings, impact preview from the engine)
          → user confirms → rule added → engine re-runs
```

**The LLM never calculates prices.** It only converts language into a proposed rule. Everything after that is deterministic code:

- **Structured output.** The model must return `{status, interpretation, clarification, missing_fields, rule}` (`server/llm/ruleOutputSchema.js`). The server validates it again before returning it.
- **Honest values.** The prompt tells the model to report numbers as stated ("200%" stays 200). The Zod domain schema then rejects it: *"200% is outside the supported range"*.
- **No invented values.** Missing amounts or vague conditions ("big orders") return `needs_clarification` with a question; unsupported requests (BOGO, date ranges, products) return `unsupported`. Nothing is added.
- **Deterministic cross-checks** (`naturalLanguageAdapter.crossCheck`) flag a value or threshold that doesn't appear in the user's text (possible hallucination), "more than" mapped to "at least" or vice versa, names the model normalized (e.g. "Amazon" → "Amazon India"), brands/platforms not present in the cart, stackability that contradicts the wording, time limits the engine can't enforce (the rule would be permanent), negative amounts in the text (blocked), and exact duplicates of active rules (blocked).
- **Confirmation.** Shows the original text, a deterministic description of the rule that will actually apply, the AI's own reading, editable fields (re-validated on every edit), and the impact on the current cart computed by the real engine, including conflict notes like *"Wall Shelf: the existing Amazon India offer saves ₹90, more than this rule's ₹50, so it stays applied."*
- **Safety.** API key only on the server; 500-character input limit; best-effort per-IP rate limit; merchant text is wrapped and treated as data in the prompt; 25 s server / 30 s client timeouts; provider errors mapped to clear messages that never include keys or raw provider responses. Groq makes exactly one HTTP request per parse with no automatic retries. With Anthropic, if the model declines, the API's server-side fallback retries on another Claude model.
- **Providers.** `server/llm/groqProvider.js` and `server/llm/anthropicProvider.js` both implement `parseRule(text, context)` and share the prompt and output schema. `createProvider()` picks one from `LLM_PROVIDER`. Adding a provider means one module and one branch there; the engine, validation and UI don't change.

### Parser evaluation

`evals/parser-cases.json` has **25 instructions**: 16 that should become rules, 4 that should trigger a clarification, 3 unsupported requests, and 2 invalid ones. They include the brief's four examples, strict vs inclusive thresholds ("more than", "above", "at least", "and above"), flat and percentage, stackable and non-stackable, an unconditional cart rule, short platform names ("Amazon" → "Amazon India"), a decimal percentage, 200%, a negative amount, a missing value or threshold, BOGO, a time-limited offer, a product-specific offer, and a prompt-injection attempt.

**Method.** Each case runs through the real pipeline: server handler, then the selected LLM provider, then server re-validation, then the client adapter and domain schema. A case passes only if the final outcome matches: the right rule with every expected field, a clarification, an `unsupported` reply, or a rejected invalid rule. The script reports:

| Metric | Meaning |
|---|---|
| Parsed (schema-valid) | Model returned structured output that passed server validation |
| Correct interpretation | Rule cases where every expected field matched |
| Clarification asked | Vague cases where it asked instead of guessing |
| Invalid rule rejected | Out-of-range cases that never became a rule |
| Unsupported detected | BOGO / time-limited / product-specific requests declined |

Calls run one at a time, 3 s apart by default (`--delay=ms` to change), to reduce provider rate-limit errors. Full per-case results, including the raw model JSON, validation errors and any provider error, are written to `evals/results/latest.json`. Provider failures (`error:<code>`) are reported separately from rules the app rejected (`invalid`).

**Results: Groq `openai/gpt-oss-120b`, 24 Nov 2026.** One full run of 25 calls, 3 s apart. Six of those got HTTP 429 rate-limit responses (retry-after 1–6 s, consistent with Groq's tokens-per-minute limit), so those 6 were re-run once, 10 s apart (`--only=…`, saved in `evals/results/subset.json`). Every case was answered exactly once across the two runs; 31 calls in total.

| | Result |
|---|---|
| Schema-valid answers | 25 / 25 |
| **Expected outcome** | **22 / 25 (88%)** |
| Correct interpretation (rules) | 15 / 16 |
| Clarification asked when the amount or condition was missing | 4 / 4 |
| Invalid rule rejected | 1 / 2 (200% ✓; negative amount ✗, see below) |
| Unsupported request declined | 2 / 3 (BOGO ✓, product-specific ✓; time-limited ✗, see below) |
| Prompt-injection attempt | Ignored; parsed the real rule (10% off Noon) |
| Median latency | ~1 s |

**The three misses**, all reproducible from the saved model output:

| Input | Model returned | Caught in the app? |
|---|---|---|
| *"15% off on Amazon"* | platform **"Amazon"**, not "Amazon India" (the similar *"Give 15% off on Amazon products."* was mapped correctly) | **Warned.** With a cart loaded, the review screen warns no product is sold on platform "Amazon", and the rule checks suggest *Did you mean "Amazon India"?* |
| *"20% off Natura Casa this weekend only"* | a **permanent** 20% Natura Casa rule; the time limit was dropped instead of being reported as unsupported | **Warned** (since this evaluation): *"Your text mentions a time limit ("weekend"), but this engine has no dates or schedules. If you confirm, the rule will apply permanently…"* |
| *"-50 rupees off Natura Casa"* | a valid **₹50 off** rule; the minus sign was dropped, so the range check never saw a negative | **Blocked** (since this evaluation): *"Your text contains a negative amount ("-50")…"*, and Confirm is disabled. |

**What changed because of this evaluation.** The last two misses were initially silent; the review screen relied on the merchant reading carefully. Two deterministic wording checks now close those gaps without depending on the model, in the same style as the existing strict-vs-inclusive check:

- **Time-limit wording** (today, weekend, until/till, "for 3 days", festival names, weekdays, dates, times) shows a warning that the rule would apply permanently. It's a warning rather than a block, because the merchant may still want a permanent rule.
- **Negative amounts** ("-50", "Rs.-50", "minus 30") block confirmation.

Neither check fires on any of the other 23 evaluation instructions (enforced by `tests/wordingChecks.test.js`), and both are tested by replaying the exact model output Groq returned. Re-scoring the 25 saved answers offline with the new checks, the app now rejects the negative case, so **23 / 25 app-level outcomes match**. The model's own accuracy is unchanged at 22 / 25; the improvement is in the deterministic layer, not the LLM. This wasn't re-measured with new API calls. These are small, focused samples, so the numbers are indicative, not a guarantee.

## PDF limitations

- Expects a text-based PDF with a header row containing **Product, Brand, Platform, Base Price** (any order). Columns are located from the header's x-positions; values are assigned to the nearest column on the left (15 pt tolerance for right-aligned numbers).
- Scanned/image PDFs have no text layer and are rejected with an explanation. **OCR is not implemented.**
- No quantity column: a repeated identical row is flagged as a possible duplicate and kept by default (a customer may buy two); the user can exclude duplicates.
- Lines starting with Total / Subtotal / Tax / GST / Shipping after the header are ignored and listed.
- Prices: `Rs.1,299`, `₹1,299.50`, `INR 899`, `1299`. Anything else is reported as unreadable, never guessed.
- Max 5 MB and 20 pages; password-protected PDFs are rejected.

## Error handling, edge cases and security

| Concern | Handling |
|---|---|
| API key | Only read by the serverless function / dev middleware. Never `VITE_`-prefixed, never in the bundle. `.env` is git-ignored; `.env.example` has no value. |
| LLM output | Structured output, then server re-validation, then the domain schema. Refusals, truncation, timeouts (25 s server / 30 s client), rate limits, auth and network errors each map to a clear message. No fake fallback. |
| Prompt injection | Merchant text is wrapped in tags and treated as data; any rule it produces still goes through validation, preview and confirmation. |
| Abuse of the AI endpoint | 500-character input cap, best-effort 20 req/min per IP. |
| Uploads | Extension and size checked before reading (drag & drop included). pdf.js runs without `eval` (`isEvalSupported: false`). |
| CSV / formula injection | Not applicable: the app never exports CSV. Values are rendered as React text, never as HTML. |
| Failed imports | The current cart and rules are kept, and the message says so. |
| Dependencies | `npm audit`: 0 vulnerabilities (Zod 4, Vite 8, Vitest 5). |

## Engineering decisions & trade-offs

| Situation | Decision | Reason |
|---|---|---|
| Competing non-stackable offers | Highest rupee saving on the base price wins; exact ties keep the rule listed first | The brief: "scope does not matter, only the saving does". A stable tie-break keeps results reproducible. |
| Stackable rules | Applied after the winner, in rule order, on the reduced price; apply alone if no non-stackable rule matches | Brief rules; ITEM-02 = (849 − 150) × 0.9 |
| Currency rounding | Each discount amount is rounded to the nearest rupee when applied; prices keep paise | Matches the brief ("Rs.195 saving", ₹593 cart discount). Savings always add up exactly to base − final. The exact figure (₹194.85) is shown in Technical details. |
| Flat discount larger than price | Capped at the price (final ≥ ₹0) | The original engine could produce negative prices |
| Cart thresholds | Checked against the sum of **final** item prices; CSV `min_cart_value` means "at least" (≥) | Brief wording. NL rules can be strict ("more than ₹5,000" → `>`), and the UI shows and lets you change which. |
| Multiple cart rules | Same selection logic as items: best qualifying non-stackable + stackable on top | One mental model for both levels |
| Ambiguous AI instructions | Ask a specific question; add nothing | Inventing a value or threshold would silently change prices |
| Invalid LLM output | Rejected at the server (shape) and client (domain); user sees why and can edit | The model is a parser, not a source of truth |
| Strict vs inclusive wording | Model extracts it; deterministic check warns on contradictions; user chooses explicitly | "Above ₹5,000" and "at least ₹5,000" differ exactly at ₹5,000 |
| Confirmation step | Kept, with editable fields and an engine-computed impact preview | Pricing changes affect real customers; the preview makes the decision informed, not a rubber stamp |
| Malformed PDF rows | Shown in the preview with the reason; excluded; cart replaced only on confirm; if no valid rows, the cart is kept | "Row 3 skipped: missing product name" beats silent data loss or guesses |
| Scanned PDFs | Rejected with an explanation; OCR not implemented | OCR on prices is error-prone and would need a server; out of scope for 2–3 h |
| PDF parsing location | Client-side (pdf.js, lazy-loaded) | No server needed; the file never leaves the browser |
| API key security | Serverless function; key in env vars; never `VITE_`-prefixed | Client bundles are public |
| Cart insights and rule checks | Deterministic code over engine results, not an LLM | The engine already knows every fact involved. An LLM would add cost, latency and the risk of a confidently wrong number in a money UI. |
| UI tests | React Testing Library + jsdom, with AI and pdf.js mocked at the module boundary | Confirmation, cancellation and "cart kept on failed import" are UI behaviour; the engine and real pdf.js are tested separately |
| Results refresh | First calculation via the button; after that, adding/removing a rule or confirming a PDF cart recalculates automatically. Uploading a new CSV clears results until recalculated | Preserves the original flow while meeting "engine re-runs" for Tasks 2 and 3 |

## Known limitations

- Parser accuracy has not been measured yet (see above); results depend on the model.
- The rate limiter is in-memory per serverless instance, so it's best-effort, not a security control.
- Product- or category-specific offers aren't supported (the brief's data model has brand, platform and cart scopes only); the AI parser replies "unsupported" for them.
- Rule checks use fixed thresholds (≥50% is "unusually deep"); a real deployment would make these configurable per merchant.
- One rule per instruction; no rule editing after confirmation (remove and re-add instead).
- No quantities, categories, date ranges or per-customer offers (the data model doesn't have them).
- State is in memory only, by design (no database per the brief).
- The "savings by offer type" split is informational; it doesn't say who funds a discount, since the data model doesn't define that.
