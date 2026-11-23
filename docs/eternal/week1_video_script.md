# Eternal Week 1 — 1-minute video script

**Record with:** Loom (free, gives you a share link straight away). **Show:** webcam bubble throughout, screen showing the terminal demo, then Solana Explorer.

---

**[0:00–0:10] Intro — face**
> Hi, I'm Ben, founder of UltraRentz. We make rent deposits earn yield for tenants and come back automatically — held on Solana, not by the landlord.

**[0:10–0:30] Progress — terminal running `npm run demo`**
> This week we rebuilt the protocol natively in Rust with Anchor. Here's the full lifecycle running: a tenant locks a deposit into an escrow vault, it earns yield, the landlord claims damage with an evidence hash, three DAO jurors vote, and anyone can crank settlement. The landlord gets the lower median vote, the tenant gets refund plus yield, and our fee comes from yield only.

**[0:30–0:40] What we prioritised**
> We prioritised the core money flow — lock, release, dispute, settle — over the frontend, and a fair dispute rule: the burden of proof is on the landlord, so an absent tenant is never defaulted against.

**[0:40–0:52] Challenges**
> Two challenges. Our settle instruction exceeded Solana's 4KB stack limit — we fixed it by moving large accounts to the heap. And newer Rust crates broke the default Solana toolchain, so we pinned a newer platform-tools version.

**[0:52–1:00] Next — face**
> Next week: real yield through a Solana lending market, a keeper bot for automatic release, and preparing for our first real market — Ireland.

---

**If the devnet deploy isn't done:** say "running on a local validator" instead of "devnet" — keep it accurate.
