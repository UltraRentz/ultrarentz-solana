# Eternal — Week 1 progress video + Builder Update #2

## 1-minute video script (~150 words)

**Show:** your face/webcam for the first 10 seconds, then the terminal running `npm run demo` (sped up through the 45-second waits), then a Solana Explorer tab.

> **[0:00 — face]** Hi, I'm Ben, founder of UltraRentz. We make rent deposits earn yield for tenants and come back automatically, held on Solana, not by the landlord.
>
> **[0:10 — terminal]** This week we rebuilt the protocol natively in Rust with Anchor. Here's the full lifecycle running on devnet. A tenant locks a twelve-hundred-dollar test deposit into an escrow vault. It earns yield. The tenancy ends and the landlord claims three hundred for damage, with an evidence hash on-chain.
>
> **[0:30]** Three DAO jurors vote: one-fifty, two hundred, three hundred. The landlord gets the lower median, two hundred. That leans towards the tenant, because the burden of proof is on the landlord.
>
> **[0:42 — Explorer]** Anyone can then crank settlement. The tenant gets their refund plus yield, and our fee comes from yield only, never the deposit.
>
> **[0:52 — face]** Next week: real yield through a Solana lending market, and our first real market, Ireland, which has never had a deposit protection scheme.

## Builder Update #2 (paste after the devnet deploy)

**Week 1: full deposit lifecycle live on Solana devnet**

**Shipped**
- The UltraRentz Anchor program is deployed to devnet: `13BK4Z9HZ2GWGzqHjPTDGW4Ayh9jN6iqPCkekCpfATzX` [paste Explorer link]
- An end-to-end demo script runs the whole lifecycle on-chain: deposit lock → yield → landlord claim with evidence hash → 3 DAO juror votes → permissionless settlement. Example run: the landlord was awarded 200 (lower median of 150/200/300), the tenant received 1,032.40 (refund + yield − fee), and the protocol earned 3.60 (10% of yield only). Every token was accounted for.
- We caught and fixed a stack-size issue before deploy. Two instructions exceeded Solana's 4 KB stack frame, so we moved the large accounts to the heap (boxed).
- Pinned the build to platform-tools v1.52 so it is reproducible.

**Market**
- England is our test market and runs on test tokens. Ireland is our first real market, because its statutory deposit protection scheme was never commenced.

**Next week**
- Real yield via a Solana lending market adapter.
- A keeper bot, so auto-release needs no human.
- A Phantom-connected frontend for tenants, landlords and jurors.
