# Builder Update #4 — Live on devnet, and letting agents can now act for landlords

*(Post after ~23:15 Fri 27 Nov.)*

**Shipped**
- **Live on Solana devnet.** Program `13BK4Z9HZ2GWGzqHjPTDGW4Ayh9jN6iqPCkekCpfATzX`, initialised on-chain with test USDC, the 60/20/5/15 yield split and a 3-juror DAO panel.
- **Open source:** github.com/UltraRentz/ultrarentz-solana is public, and the web app now deploys automatically from `main`.
- **Landlord/Agent screen.** Landlords see every deposit held for them, approve a release in one click, or raise an evidenced claim that independent jurors decide.
- **Letting agents can act for landlords (new on-chain feature).** Agents are our paying customer, so:
  1. UltraRentz approves agents in an on-chain **agent registry**, and can suspend one everywhere at once.
  2. The **landlord approves** "this agent can act for me", per tenancy, and can revoke it.
  3. The approved agent can then release deposits and raise claims, **without ever being able to move the money**.
- **Security:** 4 new attack tests, so **9/9 attacks are now rejected**. They include a tenant naming *their own wallet* as the agent to release their own deposit, an agent acting before the landlord approves them, and a suspended agent.
- Tested end to end in three browsers at once: tenant pays → landlord approves the agent → agent releases → tenant is paid.

**Why it matters**
Most landlords use letting agents, and agent-held deposits are where trust breaks down. With UltraRentz the agent does the work but never touches the money: *"handle every deposit in one click, without the liability of holding it."*

**Next: public pilot on Monday 30 Nov**
- Up to ~500 tenants, ~100 landlords and ~20 letting agents from our network.
- Before then: the agent upgrade on devnet, one-click test funds for non-crypto users, a dedicated RPC connection, and a feedback form.
