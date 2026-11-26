# UltraRentz — Tenant web app

React + Vite + Tailwind, styled to match the UltraRentz MVP. Talks directly to the Solana program (no backend).

## Run it locally (3 terminals)

**Terminal 1: local Solana with both programs**
```bash
cd ultrarentz-solana
solana-test-validator --reset \
  --bpf-program 13BK4Z9HZ2GWGzqHjPTDGW4Ayh9jN6iqPCkekCpfATzX target/deploy/ultrarentz.so \
  --bpf-program 73ZmGvzn29yTfZqwebHh8cXrcNS6TFRxXWVu5rKyYpWQ target/deploy/mock_lending.so
```

**Terminal 2: set up the protocol, then start the app**
```bash
cd ultrarentz-solana
solana config set --url localhost && solana airdrop 100
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json
npm install
npm run local -- setup          # prints the demo landlord address: copy it
cd app && npm install && VITE_RPC_URL=http://127.0.0.1:8899 npm run dev
```
Open **http://localhost:5173**. (Local runs need `VITE_RPC_URL=http://127.0.0.1:8899 npm run dev`; the default is now devnet.)

**Live (devnet):** https://ultrarentz.github.io/ultrarentz-solana/ (built automatically from `main` by `.github/workflows/pages.yml`).

**In the browser**
1. **Select Wallet → Burner Wallet** (a demo wallet stored in this browser only). Copy its address from the button.
2. **Terminal 3:** `npm run local -- fund <your wallet address>` (1 SOL + 5,000 test USDC).
3. Paste the demo landlord into **Landlord's wallet**, keep **Demo → 0.5 minutes**, then **Lock my deposit**.
4. Watch it move: *Locked → tenancy ends → landlord review countdown → Ready → Release my deposit now → receipt*.

**Act as the landlord / jurors (Terminal 3)**: copy the tenancy address from the browser console (`__tenancies`):
```bash
npm run local -- claim <tenancy> 250         # landlord claims 250 with evidence
npm run local -- vote  <tenancy> 50,100,250  # 3 jurors vote → landlord gets the lower median (100)
npm run local -- approve <tenancy>           # or: landlord approves full release
```

## Phantom
Phantom works too. Switch Phantom to a local network (Developer settings), then fund your Phantom address with `npm run local -- fund`.

## Devnet
Once deployed: `VITE_RPC_URL=https://api.devnet.solana.com npm run dev`.
