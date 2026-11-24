# UltraRentz Protocol Spec: one design, two implementations

| | Solidity (DepositLock, Uniswap v4 hook) | Rust (ultrarentz-solana, Anchor) |
|---|---|---|
| Yield source | Uniswap swap fees (+ Aave for idle funds, roadmap) | Solana lending market (Kamino / Jupiter Lend, roadmap; simulated now) |
| Everything else | **Must behave identically** — same roles, states, split, fees, rules | same |

Yield sources may differ by chain. **Roles, money flows and rules must not.**

## 1. Decisions to align (both codebases)

| Item | Solidity today | Rust today | Agreed target |
|---|---|---|---|
| Yield split (tenant/landlord/agent/UltraRentz) | 70/20/10 → planned 70/20/5/5 | 60/20/5/15 (config) | **60/20/5/15**, admin-configurable, must sum to 100%. No agent → agent share to tenant |
| Principal | never split | never split | same |
| Dispute decider | RTB ruling executed by arbiter | DAO jury (lower median) | **Arbiter executes RTB ruling (Ireland, binding). DAO jury = optional fast-track mediation only if both parties opt in.** RTB ruling always overrides |
| No-claim release | tenant self-releases after 10-day window | permissionless `settle` + keeper bot | Both: permissionless settle after window (keeper or tenant) |
| Burden of proof | — | no quorum → tenant wins | same in both |

## 2. Monetisation features → protocol changes

### 2.1 Agent registry (paying customer)
- `register_agent(agent)` / `deactivate_agent(agent)` — admin only. Agent PDA `["agent", wallet]`: `active`, `tenancy_count`.
- `create_tenancy(..., agent)` rejects an agent that is not registered and active.
- **Agent acts for landlord:** `raise_claim`, `approve_release` accept signer = landlord **or** the tenancy's agent.
- **`deposit_for`**: the agent pays the deposit in from its own token account on the tenant's behalf; the tenant is still the beneficiary and owner of the refund.

### 2.2 Per-tenancy fee (core revenue)
- `Config.tenancy_fee` (e.g. €25 equivalent).
- Charged in `create_tenancy` / `deposit_for` **from the agent's (or landlord's) token account to treasury, never from the deposit, never from the tenant** (Tenant Fees Act 2019 in England; same principle in Ireland).
- Event `TenancyFeePaid { agent, amount }` for invoicing.

### 2.3 Agent commission
- 5% of yield to the tenancy's agent at settle (built in Rust).

### 2.4 Payout address (international students)
- `Tenancy.payout_to: Pubkey` (default = tenant). `set_payout_address(new)` — tenant only, any time before settle.
- `settle` pays the tenant's share to `payout_to`'s token account.
- Cross-chain: Circle CCTP (supported on Solana and EVM) — separate instruction `bridge_payout` later; off-ramp to bank is off-chain partner.

### 2.5 Jurisdiction + England escalation
- `Tenancy.jurisdiction: Ireland | EnglandInsured`.
- England: `raise_claim` moves **the disputed amount** to `Config.scheme_account` (the approved scheme's account) and the undisputed balance settles automatically. No on-chain verdict in England.
- Ireland: dispute resolved by arbiter (RTB ruling) or opt-in DAO.

### 2.6 Arbiter (RTB ruling executor)
- `Config.arbiter`. `execute_ruling(tenancy, award, ruling_ref_hash)` — sets landlord award and status Resolved. Overrides an open DAO vote.

### 2.7 Deposit Passport (no lending)
- `passport(old_tenancy, new_landlord, new_end, new_agent?)` — tenant only, after old tenancy ended.
- Funds move old vault → new vault (one transfer; on Solana this is cheap). New tenancy records a **lien**: `lien_landlord`, `lien_amount = old principal`, `lien_until = old end + claim window`.
- Old landlord can still `raise_claim` against the lien until `lien_until`; award is paid from the new vault, the tenant tops up the shortfall for the new landlord.
- New landlord sees `free = principal − active lien` on-chain at all times.
- Ireland only. England: proposal for schemes.
- **Bridge lending** (front the liened amount for a fee) = regulated consumer credit → roadmap only.

### 2.8 Protection reserve (optional)
- If adopted, funded from the UltraRentz 15% share, not the tenant's. Off by default.

## 3. Build order (Rust), after the Week 2 video

| # | Feature | Effort | Why |
|---|---|---|---|
| 1 | Agent registry + act-for-landlord + `deposit_for` + per-tenancy fee | ~1 day | Makes the business model visible in code |
| 2 | Payout address | ~½ day | International-student story |
| 3 | Arbiter `execute_ruling` + DAO as opt-in | ~½ day | Aligns with Solidity + Irish law |
| 4 | Jurisdiction + `escalate_to_scheme` | ~½ day | Shows legal design for England |
| 5 | Deposit Passport with lien | 2–3 days | Most original feature |
| Later | Real yield adapter, CCTP bridge payout, bridge lending | — | Roadmap |

Mirror each change in the Solidity repo the same day, so the two stay in step.
