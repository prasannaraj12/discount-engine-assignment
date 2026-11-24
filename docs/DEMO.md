# Loom walkthrough (3–5 min)

Record on the **live deployment**, not localhost. Everything below is real behaviour; no step needs fake data.

| # | Time | Do | Say |
|---|---|---|---|
| 1 | 0:00–0:30 | Open the live URL. Click **Load sample data**, then **Calculate discounts**. | "This is the brief's cart and rules. The engine gives ₹1,104, ₹629, ₹509, ₹2,499, ₹382, ₹809: ₹5,932 before the cart offer, ₹593 off, ₹5,339 final. That's exactly the expected table." |
| 2 | 0:30–1:00 | Open **Why this price?** on Cushion Cover, then on Ceramic Vase. Expand **Technical details** once. | "Two offers compete here. The customer sees the winner, the one it beat and by how much, and the exact maths: 15% of ₹1,299 is ₹194.85, rounded to ₹195 as in the brief. Ceramic Vase gets a meaningful no-offer message plus which offers don't cover it." |
| 3 | 1:00–1:20 | Point at **Order summary** and **Insights**. | "The cart offer is its own line. Insights are calculated from engine results, not generated: the item with no offer, which offer was outbid, and the cart offer's share of savings." |
| 4 | 1:20–2:20 | Click the chip *20% off for Natura Casa brand, stackable…* → **Interpret rule**. Show the review panel. Change the value to 200, then back to 20. **Confirm rule**. | "Claude only turns text into a proposed rule, on the server, so the key never reaches the browser. The app validates it and shows its impact using the real engine: 2 products, ₹313 more savings, and the cart offer adjusts because it's computed on the lower total. 200% is blocked by validation, not by the model. Nothing changes until I confirm. Then the change summary shows exactly which prices moved." |
| 5 | 2:20–2:45 | Type *Give a discount for big orders* → **Interpret rule**. | "Ambiguous input gets a question, not a guess, and nothing is added." |
| 6 | 2:45–3:30 | **PDF** tab → upload `cart-malformed.pdf`. Scroll the warnings. Click **Cancel**. Upload `cart-near-threshold.pdf` → **Replace cart**. | "Every bad row is reported with a reason: missing price, unreadable '2,4O9', negative price, a possible duplicate. The current cart isn't touched until I confirm. After replacing, the active rules re-apply and the nudge says ₹183 more unlocks 10% off." |
| 7 | 3:30–3:50 | Point at **Rule checks** under the rules table (optionally add *5% off on Amazon* to show the "did you mean Amazon India?" note). | "Rule checks catch merchant mistakes: deep discounts, duplicates, rules that can never win, rules that match nothing." |
| 8 | 3:50–4:30 | Show the README architecture diagram. | "CSV, PDF and plain English are adapters that produce the same validated rules and cart items. One deterministic engine prices everything; explanations, previews, insights and checks only read its output. 100 automated tests cover the brief's numbers, edge cases, AI failure modes, malformed PDFs, and the confirmation flows." |

**Before recording:** confirm `ANTHROPIC_API_KEY` is set in Vercel and one live parse works. Download `sample-data/cart-malformed.pdf` and `cart-near-threshold.pdf` from the repo.
