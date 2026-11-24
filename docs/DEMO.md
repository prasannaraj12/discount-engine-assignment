# Loom walkthrough (4–6 min)

Record on the **live deployment**, not localhost. Everything below is real behaviour; no step needs fake data.

**Live AI calls:** steps 4, 5 and 6 each send text to Groq, for **4 calls** in total (5 with the optional one in step 8). Editing fields, confirming, and everything else is local. Rehearse once if you like, but each rehearsal uses the same number of calls.

| # | Time | Do | Say |
|---|---|---|---|
| 1 | 0:00–0:30 | Open the live URL (https://discount-engine-assignment-sable.vercel.app/). Click **Load sample data**, then **Calculate discounts**. | "This is the brief's cart and rules. The engine gives ₹1,104, ₹629, ₹509, ₹2,499, ₹382, ₹809: ₹5,932 before the cart offer, ₹593 off, ₹5,339 final. That's exactly the expected table." |
| 2 | 0:30–1:00 | Open **Why this price?** on Cushion Cover, then on Ceramic Vase. Expand **Technical details** once. | "Two offers compete here. The customer sees the winner, the one it beat and by how much, and the exact maths: 15% of ₹1,299 is ₹194.85, rounded to ₹195 as in the brief. Ceramic Vase gets a meaningful no-offer message plus which offers don't cover it." |
| 3 | 1:00–1:20 | Point at **Order summary** and **Insights**. | "The cart offer is its own line. Insights are calculated from engine results, not generated: the item with no offer, which offer was outbid, and the cart offer's share of savings." |
| 4 | 1:20–2:20 | Click the chip *20% off for Natura Casa brand, stackable…* → **Interpret rule** *(1 call)*. Show the review panel. Change the value to 200, then back to 20. **Confirm rule**. | "Groq only turns text into a proposed rule, on the server, so the key never reaches the browser. The app validates it and shows its impact using the real engine: 2 products, ₹313 more savings, and the cart offer adjusts because it's computed on the lower total. 200% is blocked by validation, not by the model. Nothing changes until I confirm. Then the change summary shows exactly which prices moved." |
| 5 | 2:20–2:40 | Type *Give a discount for big orders* → **Interpret rule** *(1 call)*. | "Ambiguous input gets a question, not a guess, and nothing is added." |
| 6 | 2:40–3:30 | Type *-50 rupees off Natura Casa* → **Interpret rule** *(1 call)*. Point at the red message and the disabled Confirm. **Discard**. Then type *20% off Natura Casa this weekend only* → **Interpret rule** *(1 call)*. Point at the warning, then **Discard**. | "I ran a 25-case evaluation of the parser. It got 22 right, and found two real misses: it dropped the minus sign, and it dropped 'this weekend'. So I didn't trust the model more; I added plain-code checks. A negative amount in the text is now blocked, and a time limit the engine can't enforce gets a clear warning that the rule would be permanent. The LLM interprets; deterministic code validates and decides." |
| 7 | 3:30–4:20 | **PDF** tab → upload `cart-malformed.pdf`. Scroll the warnings. Click **Cancel**. Upload `cart-near-threshold.pdf` → **Replace cart**. | "Every bad row is reported with a reason: missing price, unreadable '2,4O9', negative price, a possible duplicate. The current cart isn't touched until I confirm, and Cancel keeps it. After replacing, the active rules re-apply and the nudge says ₹183 more unlocks 10% off." |
| 8 | 4:20–4:40 | Point at **Rule checks** under the rules table (optional: add *15% off on Amazon* *(1 call)* to show the "did you mean Amazon India?" note). | "Rule checks catch merchant mistakes: deep discounts, duplicates, rules that can never win, rules that match nothing." |
| 9 | 4:40–5:20 | Show the README architecture diagram and the evaluation table. | "CSV, PDF and plain English are adapters that produce the same validated rules and cart items. One deterministic engine prices everything; explanations, previews, insights and checks only read its output. 171 automated tests run offline and cover the brief's numbers, edge cases, AI failure modes, malformed PDFs, and the confirmation flows." |

**If step 6 goes differently:** the model isn't deterministic, so live it may ask a question or decline instead of repeating its evaluation mistakes. That's fine; say so: "This time the model caught it itself; the plain-code check is the safety net for when it doesn't." Don't claim it was blocked unless the screen shows it.

**Before recording:**
- In Vercel, set `LLM_PROVIDER=groq` and `GROQ_API_KEY` (no `VITE_` prefix), redeploy, and confirm one live parse works on the deployed URL.
- Download `sample-data/cart-malformed.pdf` and `sample-data/cart-near-threshold.pdf` from the repo.
- If Groq answers with "The AI service is busy (rate limit reached)", wait the few seconds it says and click **Interpret rule** again.
