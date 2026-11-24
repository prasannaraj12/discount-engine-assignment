# Opptra Smart Discount Engine

A customer-facing checkout pricing engine for the Opptra FDE Intern assignment. It applies brand, platform and cart-level offers, explains every price in plain language, and accepts input from **CSV**, **PDF** and **natural-language rules parsed by an LLM**, all feeding the same deterministic engine.

**Live demo:** _not deployed yet: add the Vercel URL here after deployment_

---

## The problem

A customer sees one final price at checkout. Behind it, brands (₹150 off Natura Casa) and platforms (15% off Amazon India) run overlapping campaigns. The system has to pick the best deal for each item, stack offers that are allowed to stack, apply cart-wide offers last, and tell the customer exactly what happened: one final price, one clear explanation, no surprises.

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
                         explanationEngine.js / ruleImpact.js (text + previews from results)
                                                           ▼
                                                  React components (display only)
```

```
api/parse-rule.js              Vercel serverless function (thin wrapper)
server/parseRule.js            request validation, rate limit, re-validation of LLM output
server/llm/                    provider (Anthropic), prompt, structured-output schema
src/adapters/                  csvAdapter, pdfAdapter, naturalLanguageAdapter
src/services/                  pdfExtractor (pdf.js), aiRuleParser (fetch client)
src/validation/                discountRuleSchema (Zod), cartItemSchema
src/engine/                    discountEngine, cartRuleEvaluator, pricing, explanationEngine, ruleImpact
src/components/                UI only
tests/                         Vitest suites
```

The engine imports no CSV, PDF or LLM library (enforced by `tests/architecture.test.js`). The original `discountEngine.js` was kept. Changes there are additive (structured `steps` / `competingOffers` for explanations), plus one fix: a flat discount can no longer push a price below zero. **Adding a third input mode** means writing one function that returns `CartItem[]` or `DiscountRule[]` and passes it through `validateCartRow` / `validateDiscountRule`. The architecture test includes a JSON-order adapter written exactly that way.

## Tech stack

React 18 + Vite 5 · Papa Parse · pdf.js (`pdfjs-dist`, lazy-loaded) · Zod · Anthropic SDK (server-side only) · Vitest · Vercel (static site + one serverless function)

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

That's all you need for CSV, PDF and pricing. To enable the AI rule parser, also create `.env` with your key (see below) before `npm run dev`. The dev server serves `/api/parse-rule` with the same handler production uses, so the key never reaches the browser.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | For AI rules | Server-side key for the rule parser. **Never** prefix it with `VITE_`. |
| `LLM_MODEL` | No | Overrides the model (default `claude-opus-5-5`). |

Copy `.env.example` to `.env` locally. On Vercel, set them under *Project → Settings → Environment Variables*. Without a key, everything else works and the rule builder shows *"The AI rule parser is not configured on this server"*. The app never falls back to fake or regex parsing.

## Deploy (Vercel)

1. Import the GitHub repo in Vercel (framework is auto-detected as Vite; `api/` becomes a serverless function).
2. Add `ANTHROPIC_API_KEY`.
3. Deploy, then put the URL at the top of this README.

## Using the sample inputs

- **Load sample data** (top right) loads `sample-data/rules.csv` + `sample-data/cart.csv` through the CSV adapter. Click **Calculate discounts**.
- Or upload them manually. `rules.csv` now includes the brief's `RULE-04` cart rule and `min_cart_value` column.
- **PDF tab:** upload
  - `sample-data/cart.pdf`: the brief's order (reproduces ₹5,339)
  - `sample-data/cart-malformed.pdf`: missing price/product/platform, unreadable and negative prices, a duplicate, a "Total" line
  - `sample-data/cart-near-threshold.pdf`: ₹3,817 cart, shows the "₹183 away" nudge
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
npm test              # 74 tests, Vitest
npm run eval:parser   # live LLM evaluation (needs ANTHROPIC_API_KEY, makes 20 API calls)
```

| Suite | Covers |
|---|---|
| `engine.sample` | Every value in the brief's expected-results table |
| `engine.edge` | Highest non-stackable wins, stackable alone/on top, no match, flat > price, ties, duplicate products, cart threshold met / not met / exactly equal / strict ">", empty cart, multiple cart rules, nudge, recalculation diff |
| `explanation` | Customer sentences generated from results (ITEM-01 comparison, stacking, no-offer, cart label, nudge) |
| `ruleImpact` | Impact preview and conflict notes (rule loses to / replaces an existing offer, cart threshold not met) |
| `ai` | Server handler: missing key, empty/oversized input, malformed model output, provider failures. Domain validation: 200%, negative, NaN, missing target, threshold on item rule. Adapter: clarification, hallucinated values, strict-vs-inclusive wording, duplicates. Fetch client: network error, non-JSON |
| `pdf` | Real pdf.js on the sample PDFs: brief cart → ₹5,339, every malformed row reported, not-a-PDF, scanned/empty, missing header, split headers, right-aligned prices |
| `architecture` | Engine imports no parsing/LLM libraries; a new adapter works without engine changes |

## AI integration

```
User text → POST /api/parse-rule → Claude (structured JSON output, Zod schema)
          → server re-validates shape → client adapter: domain validation + cross-checks
          → confirmation (editable fields, warnings, impact preview from the engine)
          → user confirms → rule added → engine re-runs
```

**The LLM never calculates prices.** It only converts language into a proposed rule. Everything after that is deterministic code:

- **Structured output.** The model must return `{status, interpretation, clarification, missing_fields, rule}` (`server/llm/ruleOutputSchema.js`). The server validates it again before returning it.
- **Honest values.** The prompt tells the model to report numbers as stated ("200%" stays 200). The Zod domain schema then rejects it: *"200% is outside the supported range"*.
- **No invented values.** Missing amounts or vague conditions ("big orders") return `needs_clarification` with a question; unsupported requests (BOGO, date ranges, products) return `unsupported`. Nothing is added.
- **Deterministic cross-checks** (`naturalLanguageAdapter.crossCheck`) flag a value or threshold that doesn't appear in the user's text (possible hallucination), "more than" mapped to "at least" or vice versa, names the model normalized (e.g. "Amazon" → "Amazon India"), brands/platforms not present in the cart, stackability that contradicts the wording, and exact duplicates of active rules (blocked).
- **Confirmation.** Shows the original text, a deterministic description of the rule that will actually apply, the AI's own reading, editable fields (re-validated on every edit), and the impact on the current cart computed by the real engine, including conflict notes like *"Wall Shelf: the existing Amazon India offer saves ₹90, more than this rule's ₹50, so it stays applied."*
- **Safety.** API key only on the server; 500-character input limit; best-effort per-IP rate limit; merchant text is wrapped and treated as data in the prompt; 30 s client timeout; typed SDK errors mapped to clear messages. If the model declines, the API's server-side fallback retries on another model.
- **Provider.** `server/llm/anthropicProvider.js` implements `parseRule(text, context)`. Another provider only needs the same function wired into `createProvider()`.

### Parser evaluation

`evals/parser-cases.json` has 20 instructions: the brief's four examples, strict vs inclusive thresholds ("more than", "above", "at least", "and above"), flat and percentage, stackable and non-stackable, an unconditional cart rule, a short platform name, a decimal percentage, 200%, a negative amount, missing value, missing threshold, BOGO, a time-limited offer, and a prompt-injection attempt.

**Results: not run yet.** The evaluation needs an API key and spends real API credit, so it hasn't been run in this repo. Run `npm run eval:parser` and paste its summary (schema-valid rate and expected-outcome rate) here. LLM parsing is probabilistic; even a high score doesn't mean every input will parse correctly, which is why the confirmation step exists.

## PDF limitations

- Expects a text-based PDF with a header row containing **Product, Brand, Platform, Base Price** (any order). Columns are located from the header's x-positions; values are assigned to the nearest column on the left (15 pt tolerance for right-aligned numbers).
- Scanned/image PDFs have no text layer and are rejected with an explanation. **OCR is not implemented.**
- No quantity column: a repeated identical row is flagged as a possible duplicate and kept by default (a customer may buy two); the user can exclude duplicates.
- Lines starting with Total / Subtotal / Tax / GST / Shipping after the header are ignored and listed.
- Prices: `Rs.1,299`, `₹1,299.50`, `INR 899`, `1299`. Anything else is reported as unreadable, never guessed.
- Max 20 pages; password-protected PDFs are rejected.

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
| Results refresh | First calculation via the button; after that, adding/removing a rule or confirming a PDF cart recalculates automatically. Uploading a new CSV clears results until recalculated | Preserves the original flow while meeting "engine re-runs" for Tasks 2 and 3 |

## Known limitations

- Parser accuracy has not been measured yet (see above); results depend on the model.
- The rate limiter is in-memory per serverless instance, so it's best-effort, not a security control.
- One rule per instruction; no rule editing after confirmation (remove and re-add instead).
- No quantities, categories, date ranges or per-customer offers (the data model doesn't have them).
- State is in memory only, by design (no database per the brief).
- The "savings by offer type" split is informational; it doesn't say who funds a discount, since the data model doesn't define that.
