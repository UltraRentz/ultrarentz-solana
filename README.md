# UltraRentz — Solana program

Yield-bearing rent deposits with automated release and DAO dispute resolution, written in Rust with Anchor 0.32.

## How it works

1. **Lock.** The tenant deposits USDC (a test mint on devnet) into a vault owned by a program PDA, one per tenancy.
2. **Earn.** The deposit earns yield while it is locked. On devnet this is simulated by topping up the vault. During the Eternal sprint a lending-market adapter replaces it.
3. **End.** A fixed-term tenancy has an `end_ts`. A rolling (periodic) tenancy starts with `end_ts = 0`, and either party later calls `serve_notice`.
4. **Release.** After the end date the landlord either:
   * calls `approve_release`, which gives an instant full refund, or
   * calls `raise_claim(amount, evidence_hash, uri)` inside the claim window.
   If the landlord does neither before the window closes, **anyone** can call `settle` and the tenant is refunded automatically.
5. **Dispute.** A claim goes to the DAO juror panel:
   * the tenant can `accept_claim` (no vote needed), or `submit_tenant_evidence` (optional)
   * each juror casts a vote with `cast_vote(award)` for any amount from 0 up to the claim
   * when voting closes, the landlord gets the **lower median** of the votes, provided quorum was reached
   * **if quorum is not reached, the tenant gets everything.** The burden of proof is on the landlord, and an absent tenant (for example an international student who has left the UK) is never defaulted against.
6. **Settle.** The landlord's award is paid first. Then comes the protocol fee, which is charged **on yield only** and never on principal. The tenant receives the remainder. The vault and tenancy accounts are closed and their rent is returned to the tenant.

## Instructions

| Instruction | Who | Notes |
|---|---|---|
| `initialize_config` | admin | mint, treasury, fee bps, claim window, voting period |
| `update_params` | admin | |
| `set_jurors` | dao_authority | up to 9 jurors + quorum |
| `create_tenancy` | tenant | `end_ts = 0` for rolling tenancy |
| `serve_notice` | tenant or landlord | sets end date on rolling tenancy |
| `approve_release` | landlord | instant full refund path |
| `raise_claim` | landlord | evidence hash required |
| `accept_claim` | tenant | |
| `submit_tenant_evidence` | tenant | optional |
| `cast_vote` | juror | parties can't vote on their own case |
| `settle` | anyone | permissionless crank |

PDAs: `config = ["config"]`, `tenancy = ["tenancy", tenant, landlord, tenancy_id_le]`; vault = ATA(mint, tenancy).

## Program ID

`13BK4Z9HZ2GWGzqHjPTDGW4Ayh9jN6iqPCkekCpfATzX`

## Deploy to devnet (fastest path, using the prebuilt program)

`target/deploy/ultrarentz.so`, `target/deploy/ultrarentz-keypair.json` and `target/idl/ultrarentz.json` ship in the release zip. **Never commit the keypair**, because `target/` is git-ignored.

```bash
solana config set --url devnet
solana balance                      # need ~6 devnet SOL (free: faucet.solana.com); ~2.6 SOL stays locked as program rent
solana program deploy target/deploy/ultrarentz.so \
  --program-id target/deploy/ultrarentz-keypair.json

npm install
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json

npm run demo -- all        # 4 scenarios: dispute, silent landlord + agent, one-click release, lending market
npm run keeper             # keeper bot: settles every due tenancy automatically (loops every 15s)
npm run keeper -- --once   # single pass, e.g. from cron
```

## Yield: Jupiter Lend Earn adapter

The vault can park the deposit in a Solana lending market while the tenancy runs:

1. Admin sets the approved lending program: `set_yield_program(program_id)`.
2. `deposit_to_yield` (anyone): vault → lending market. The tenancy PDA holds the share tokens.
3. At move-out, the keeper sends `withdraw_from_yield` + `settle` in **one transaction**: principal + interest come back, and the 60/20/5/15 split runs.

We call Jupiter with a raw CPI (its documented discriminators + account order), so there's no crate dependency to drift. The client resolves Jupiter's accounts with `@jup-ag/lend` (`scripts/yield.ts`). Our program pins the security-critical accounts (signer = tenancy PDA, money only moves vault ⇄ this tenancy's share account, mints match, program = the approved one).

**Testing.** `programs/mock_lending` is a TEST-ONLY stand-in with Jupiter's exact instruction names and account order, paying 3% on withdraw:

```bash
solana-test-validator --reset \
  --bpf-program 13BK4Z9HZ2GWGzqHjPTDGW4Ayh9jN6iqPCkekCpfATzX target/deploy/ultrarentz.so \
  --bpf-program 73ZmGvzn29yTfZqwebHh8cXrcNS6TFRxXWVu5rKyYpWQ target/deploy/mock_lending.so
npm run demo -- lending     # deposit → lending market → keeper withdraws + settles
npm run security            # 5 attack attempts, all must be rejected
```

Real Jupiter: the `@jup-ag/lend` SDK currently targets **mainnet** markets only, so the next step is testing against a mainnet fork (e.g. Surfpool) with `LENDING=jupiter`.

## Keeper bot

`scripts/keeper.ts` scans all tenancies and calls the permissionless `settle` instruction as soon as one is due:

| Status | Due when | Outcome |
|---|---|---|
| Active | claim window closed, no claim | full refund + yield to tenant |
| Resolved | landlord approved / tenant accepted | pay out immediately |
| Claimed | DAO voting closed | lower-median award, or the tenant wins if there's no quorum |

## Build from source

Recent crates need Rust ≥ 1.85, but the platform-tools bundled with Solana 2.3 ship Rust 1.84. Use platform-tools v1.52:

```bash
cargo build-sbf --tools-version v1.52 --manifest-path programs/ultrarentz/Cargo.toml
anchor idl build -o target/idl/ultrarentz.json
cargo test -p ultrarentz            # unit tests (settlement maths)
```

## Status

* ✅ SBF build: no stack warnings (large accounts are boxed)
* ✅ 7 unit tests pass for payout split and median voting
* ✅ Full lifecycle demo (`scripts/demo.ts`) passes on a local validator: lock → yield → claim → 3 votes → settle. Landlord 200, tenant 1,032.40, protocol fee 3.60, total 1,236.00
* ✅ Yield split 60/20/5/15 (tenant / landlord / agent / UltraRentz), configurable on-chain; optional letting agent per tenancy (no agent → agent's 5% goes to tenant). Principal is never split.
* ✅ Keeper bot + 3 demo scenarios pass on a local validator (dispute: landlord 200 / tenant 1,032.40 · silent landlord: tenant 1,232.40 · one-click release: tenant 1,200)
* ⏳ Devnet deploy, frontend wiring
* ✅ Lending-market yield adapter (Jupiter Lend Earn interface): deposit → earn → keeper withdraws + settles in one tx. Tested end-to-end against a Jupiter-compatible mock (1,200 → 1,236 at 3%: tenant 1,223.40 · landlord 7.20 · UltraRentz 5.40). 5/5 security checks reject attacks.
* ⏳ Test against real Jupiter on a mainnet fork; DAO hardening
