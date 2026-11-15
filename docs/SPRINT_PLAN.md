# UltraRentz on Solana — CTO sprint plan

**Founder/CEO:** Adegbenga (Ben) Ogungbeje · **CTO:** Claude
**Goal:** devnet deploy by the end of the Solana Bootcamp (Sun 15 Nov 2026), then a 4-week build through Colosseum Eternal.

## Markets (decided 10 Nov 2026)

* **England: test market.** Test tokens only. Statutory deposit protection (TDS/DPS/mydeposits) applies there, so no real money moves.
* **Ireland: first real market.** The RTB-run deposit protection scheme legislated in 2015 has never been commenced. Landlords or agents hold deposits themselves, and the RTB decides disputes, which must be referred within 90 days. UltraRentz fills that gap: neutral custody, yield, automatic release. Get Irish legal advice (custody/e-money and consumer-credit angles) before launch.

## Eternal submission notes

* Sprint deadline shown on the dashboard: 20 Mar 2027. A 1-minute progress video is due every week.
* The final submission needs: product name and description, team background, GitHub repo, pitch video (max 3 min), technical demo, and anything else the judges should know.

## Working agreement

* This Project is the source of truth. Claude does not carry memory between chats beyond what is written here and in the repo, so every decision goes into this doc or `docs/`.
* Each session ends with: what shipped, what is next, and any blockers.
* Scope rule (Pareto): ship the smallest thing that proves *lock → earn → release/dispute → settle* on-chain before adding anything else.

## Phase 1 — Bootcamp: 5 days to devnet

| Day | Date | Deliverable | Done when |
|---|---|---|---|
| 1 | Tue 10 Nov | Toolchain + `anchor build` + `anchor keys sync`; push program to `UltraRentz/ultrarentz-protocol` (`/solana` folder) | `.so` builds locally |
| 2 | Wed 11 Nov | TypeScript integration tests (LiteSVM or `anchor test`): auto-release, approve release, claim→accept, claim→vote, no-quorum→tenant wins, rolling notice, yield top-up split | all green |
| 3 | Thu 12 Nov | Devnet deploy + `scripts/bootstrap-devnet.ts`: test mint "tUSDC", config (10% fee on yield; **demo** windows of 10 min claim / 10 min vote), 3 juror wallets, quorum 2 | config account live on Solana Explorer |
| 4 | Fri 13 Nov | Frontend: reuse the existing Vite/React UI and swap Ethers for Solana wallet adapter (Phantom) and a Codama-generated client. Screens: Tenant (lock), Landlord (release/claim), Juror (vote), Settle | full flow clickable on devnet |
| 5 | Sat 14 – Sun 15 Nov | End-to-end demo, 2–3 min video, README, bootcamp submission | submitted |

**Cut list if behind:** drop tenant evidence UI, then rolling-notice UI. Never cut: lock, auto-release, claim, vote, settle.

## Phase 2 — Colosseum Eternal: 4 weeks

*Confirm the exact end date in the Colosseum dashboard and adjust.*

**Week 1 — real yield and automation**
* Yield adapter: deposit the vault into a Solana lending market by CPI. Shortlist Kamino Lend and Jupiter Lend, and pick based on SDK/CPI maturity. Most lending markets are mainnet-only, so test against cloned mainnet accounts (Surfpool/LiteSVM).
* Keeper bot for permissionless `settle` (a cron job calling the crank), so release really is automatic.
* Wed 18 Nov: Alliance.xyz application. Use the devnet demo as proof of progress.

**Week 2 — DAO hardening**
* Move `dao_authority` to a Squads multisig, then later to Realms governance.
* Commit-reveal voting, so jurors cannot copy each other.
* Random juror selection per case (VRF), plus a juror stake and reward.
* Evidence upload (IPFS or Arweave) with hashing in the browser.

**Week 3 — security + Deposit Passport**
* Fuzzing (Trident), invariant tests (vault fully drained on settle; tenant never gets less than principal minus award unless the market takes a loss), and an internal review against common Solana pitfalls.
* Deposit Passport (from ETHGlobal Mumbai): roll a deposit into a new tenancy without withdrawing it. Gate this on there being no open dispute.

**Week 4 — ship**
* Limited mainnet beta with a per-deposit cap, plus the UK student pilot running on test tokens.
* Pitch video, metrics, Eternal submission.

## Risks to manage

1. **UK regulation.** Deposits on assured shorthold tenancies in England and Wales must be protected in a government-approved scheme (TDS, DPS or mydeposits). A real-money UK launch therefore needs a scheme partnership, scheme approval, or a market or tenancy type outside that rule. Test tokens are fine for the pilot. Get legal advice before taking real deposits.
2. **Yield risk.** A lending-market loss reduces the vault. `compute_payout` already handles a shortfall without underflow, but the product promise to tenants must say principal is at risk, or yield must come from a lower-risk source.
3. **Juror capture.** A small, admin-set panel is fine for the pilot. Weeks 2–3 decentralise it.
4. **Time.** Ben's other commitments (care work, other hackathons) compete for hours. Protect a daily build block.
