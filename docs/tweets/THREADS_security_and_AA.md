# UltraRentz tweet threads — Security + Account Abstraction
*Format: "Tweet Format: Account Abstraction Series" (built on Tweet Standard v1.2). Every post counted with the brief's counter: all ≤ 260.*

---

# THREAD A — Web3 security: "The compiler only warned us"

## 1. Fact-check summary
**Verified**
- SBF stack frame = **4,096 bytes** per function → Solana docs, Constants Reference (`STACK_FRAME_SIZE`).
- Overruns are reported as a **warning, not an error**, "because some dependent crates may include functionality that violates the stack frame restrictions even if the program doesn't use that functionality" → Solana docs, Programs FAQ.
- Exceeding the frame can corrupt variables of the previous stack frame → OtterSec (Robert Chen), "Safe Solana Stack Smashing", Breakpoint 2024.
- **5,232 bytes / 1,136 over** → our own build log (`Settle` account loading: "Stack offset of 5232 exceeded max offset of 4096 by 1136 bytes"), 15 Nov 2026. After boxing: 0 stack warnings.
- **8 accounts**: today's `Settle` loads 8 data accounts (config, mint, tenancy, vault, tenant token, landlord token, agent token, treasury) → our code.
- **5 of 5 attacks rejected** → our `npm run security`, 24 Nov 2026.
- Devnet deploy, upgrade authority = admin wallet, no audit → true as of 26 Nov 2026.

**Corrected / careful wording**
- At the time of the stack bug, `settle` had 7 data accounts; the agent account was added later (still boxed, still 0 warnings). Post 3 describes the step as it is today ("loads 8 accounts"). If you'd rather be exact about the moment of the bug, change to "loads 7 accounts".

**Unconfirmed**
- None.

## 2. The thread

**1/** 🖼️ `sec_1_hook.png` (198)

Solana's compiler only warns you when a program overflows its 4KB stack. It doesn't stop the build.

Ours overflowed. Our program holds tenants' rent deposits.

What happened, and how we fixed it 🧵

**2/** (243)

Every Solana program (code that runs on the blockchain) gets 4,096 bytes of stack per function: scratch memory for temporary values.

Go past it and the program can overwrite values it was still using. In a deposit app, those values are money.

**3/** 🖼️ `sec_3_fix.png` (247)

Our "settle" step (it pays out a deposit) loads 8 accounts at once.

Our build log showed its stack use reaching 5,232 bytes: 1,136 over the limit.

The fix was "boxing": moving the big accounts to the heap (a larger memory area). Now: 0 warnings.

**4/** (258)

Next we attacked the part that lends deposits out for interest. 5 attempts:

✗ swap in an attacker's account
✗ use an unapproved lending program
✗ deposit twice
✗ withdraw early to cost the tenant interest
✗ pay out while funds are lent

All 5 rejected.

**5/** (236)

My take as a builder, not an official Solana rule: treat every stack warning as a bug.

Solana's docs say it's only a warning because some libraries trip it in code you never call. That makes it easy to scroll past the one that matters.

**6/** (256)

The honest limit: this is a devnet pilot (a test network with no real money).

Our admin key can still upgrade the program, no one has audited it yet, and the lending test used a stand-in for the real lending market.

Real deposits wait until that changes.

**7/** 🖼️ `sec_7_summary.png` (260)

3 takeaways:
1. Solana's 4KB stack limit only warns
2. Box large accounts
3. Write the attack before an attacker does

We're building UltraRentz in public: rent deposits that come back automatically.

Which warning taught you the hard way?

[SIGN-OFF: ask Ben]

## 3. Images + alt text
- `sec_1_hook.png`: Alt: "Bar chart. Solana gives each function a 4,096-byte stack. Our deposit payout step used 5,232 bytes, 1,136 over the limit, and the build still succeeded."
- `sec_3_fix.png`: Alt: "Before and after. Before: 8 accounts loaded onto the stack, 5,232 bytes. After: large accounts wrapped in Box and stored on the heap, 0 warnings."
- `sec_7_summary.png`: Alt: "Summary card: the 4KB stack limit only warns, so treat it as a bug; boxing took 5,232 bytes to 0 warnings; 5 attacks rejected; limit: devnet pilot, upgradeable, not yet audited."

## 4. Replies (sources)
- Under **2/**: Solana stack frame size (4,096 bytes): https://solana.com/docs/core/constants-reference · Why it's a warning, not an error: https://solana.com/docs/programs/faq
- Under **2/**: How overruns corrupt memory, OtterSec at Breakpoint 2024: https://solanacompass.com/learn/breakpoint-24/breakpoint-2024-product-keynote-safe-solana-stack-smashing-by-ottersec-robert-chen
- Under **4/**: The 5 attack tests (open source): https://github.com/UltraRentz/ultrarentz-solana/blob/main/scripts/security-checks.ts
- Under **7/**: Code: https://github.com/UltraRentz/ultrarentz-solana · Program on devnet: https://explorer.solana.com/address/13BK4Z9HZ2GWGzqHjPTDGW4Ayh9jN6iqPCkekCpfATzX?cluster=devnet

---

# THREAD B — Account abstraction: "Who holds the key to a deposit?"

## 1. Fact-check summary
**Verified**
- **ERC-4337: status Final**; on Ethereum mainnet since **1 March 2023** (announced at WalletCon) → ercs.ethereum.org/ERCS/erc-4337; Etherspot "ERC-4337 reaches Final" (10 Jun 2026); ZeroDev "ERC-4337: Final, Not Finished" (12 Aug 2026).
- **EIP-7702: Live**, activated in the **Pectra upgrade on 7 May 2025** → ethereum.org/roadmap/account-abstraction; eips.ethereum.org/EIPS/eip-7702.
- **PDA:** "no private key exists — only the deriving program can sign via invoke_signed" → solana.com/docs/core/pda.
- **1.28 billion** cumulative ERC-4337 UserOperations across Ethereum and L2s, BundleBear data reported **16 Sept 2026** → reported by Analytics Insight citing BundleBear.

**Flags (R15)**
- The old page eips.ethereum.org/EIPS/eip-4337 still shows "Draft"; the standard moved to the ERC repository, where it is **Final**. Post 3 uses Final.
- 1.28B is a secondary report of BundleBear data. Please confirm on BundleBear's dashboard before posting, or drop the number from post 7.

**Ben's inferences (labelled in post 5)**
- "Each UltraRentz deposit is a small rule-bound account" is Ben's comparison, not an official Solana or Ethereum statement.

## 2. The thread

**1/** 🖼️ `aa_1_hook.png` (221)

Ethereum spent years building account abstraction: accounts whose rules are set by code, not by one private key.

Solana has an address type with no private key at all.

We use it to hold rent deposits. What that means 🧵

**2/** (219)

On Ethereum, a normal account (an EOA, "externally owned account") is controlled by one private key. Lose or leak the key and the account is gone.

Account abstraction (AA) lets code decide who can move funds, and when.

**3/** 🖼️ `aa_3_compare.png` (251)

Ethereum has two live routes to AA:

• ERC-4337 (status: Final; on mainnet since March 2023): smart accounts plus "bundlers" that submit them
• EIP-7702 (status: Live since the Pectra upgrade, 7 May 2025): a normal account points to smart-account code

**4/** (211)

Solana's version: a PDA (program derived address) is an address with no private key. Nobody can sign for it except the program that created it.

So a PDA works like a vault whose only key is the program's rules.

**5/** (234)

My take as a builder, not an official comparison:

Each UltraRentz deposit is a small rule-bound account. Only 3 things release it: no claim in time, the landlord approves, or independent jurors decide.

No landlord holds a key to it.

**6/** (243)

The honest limit: a PDA isn't full account abstraction. Our tenants still need a normal wallet and a little SOL (Solana's currency) for fees.

And while we pilot on devnet, our admin key can upgrade the program, so the rules aren't locked yet.

**7/** (221)

Why it matters: a deposit is someone else's money. "Trust the landlord" becomes "check the rules".

Ethereum users already rely on rule-based accounts: ERC-4337 passed 1.28B user operations by Sept 2026 (BundleBear data).

**8/** 🖼️ `aa_8_summary.png` (244)

Ethereum: smart accounts added on top of key-based accounts.
Solana: program-owned addresses with no key.

UltraRentz uses the Solana model so rent deposits come back automatically.

Which would you trust with your deposit?

[SIGN-OFF: ask Ben]

## 3. Images + alt text
- `aa_1_hook.png`: Alt: "Two panels. A normal account has one private key, and whoever holds it can move the money. A Solana PDA has no private key; only the program's rules can move the money."
- `aa_3_compare.png`: Alt: "Three ways to put rules on an account: ERC-4337 (Final, on mainnet since March 2023), EIP-7702 (live since 7 May 2025) and the Solana PDA (an address with no private key that only its program can sign for)."
- `aa_8_summary.png`: Alt: "Summary card. Ethereum adds smart accounts on top of key-based accounts; Solana has program-owned addresses with no key. In UltraRentz, each deposit is controlled by a PDA and no landlord holds its key."

## 4. Replies (sources)
- Under **3/**: ERC-4337 (Final): https://ercs.ethereum.org/ERCS/erc-4337 · EIP-7702: https://eips.ethereum.org/EIPS/eip-7702 · Overview: https://ethereum.org/roadmap/account-abstraction
- Under **4/**: Solana PDAs: https://solana.com/docs/core/pda
- Under **7/**: BundleBear ERC-4337 data: https://www.bundlebear.com (as reported by Analytics Insight, Sept 2026)
- Under **8/**: Code: https://github.com/UltraRentz/ultrarentz-solana

---

## 5. Open questions for Ben
1. **Sign-off** for this series (`[SIGN-OFF: ask Ben]`).
2. **Brand tag** for the images (`[BRAND TAG: ask Ben]`): "UltraRentz"? I'll re-render once you confirm.
3. **Tags:** I haven't tagged anyone. Verified-handle candidates to check: @solana, @colosseum, and OtterSec for thread A, reply 2. Confirm before adding.
4. Thread A, post 3: keep "8 accounts" (today's code) or say "7 accounts" (at the moment of the bug)?
5. Confirm the 1.28B figure on BundleBear, or drop it.

## 6. Posting slots
- **Thread A (security):** Fri 27 Nov, ≈18:00 UK, posted live.
- **Thread B (AA):** Sat 28 Nov, ≈18:00 UK. Never two threads on the same evening.
