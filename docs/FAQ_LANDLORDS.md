# UltraRentz — FAQ for Landlords and Letting Agents

*Plain-English answers. Items marked **(planned)** are not built yet; everything else works in our current software.*

---

## How it works

### 1. How does the deposit come back automatically?
The deposit is held in a locked digital account that follows fixed rules — no person moves the money by hand. When the tenancy ends, a review period starts (the "claim window"). If you raise no claim before it closes, the money is paid back to the tenant automatically. If you're happy at check-out, you can tap "approve" and it's paid straight away.

### 2. What if I don't want the deposit to come back automatically?
Raise a claim before the claim window closes. That stops the automatic refund for the amount you're claiming until it's decided. What you can't do is hold the money indefinitely without a reason — that protection is the point of the system, and it's what tenants are signing up for.

### 3. What if there is damage and I can't prove it?
The rule is the same as in today's deposit schemes: whoever wants to keep part of the deposit has to show why. Without evidence, a claim is unlikely to succeed. The practical answer is a good check-in inventory: dated photos and a signed condition report at move-in. **(planned)** Uploading the check-in inventory into UltraRentz at move-in, so the evidence is ready if you ever need it.

### 4. How long is the claim window?
It's a setting, not fixed in the code. Our demo uses 45 seconds so we can show it live. For real tenancies we plan around **14 days** after the tenancy ends, set to fit local law in each country.

### 5. If the landlord can't sit on the deposit, who does?
No person. The money sits in a locked account run by software on a public blockchain, which pays out only when its rules are met: no claim, your approval, or a dispute decision. UltraRentz cannot spend it either.
*Being transparent:* during the pilot, UltraRentz can still update the software and choose the dispute panel. **(planned)** Handing those controls to a group of keyholders (a "multisig"), so no single person, including us, controls them.

### 6. What does "keeper settles the lower-median award" mean?
- **Award:** how much of a claim the landlord gets.
- **Lower median:** each juror on the dispute panel says an amount; we take the middle one. With 3 jurors voting €0, €100 and €200, the award is €100. With an even number of votes, we take the lower of the two middle ones, so ties lean towards the tenant. One extreme juror can't swing the result.
- **Keeper:** an automated service that checks every tenancy and triggers the payout the moment it's due. Nobody has to remember to press a button.

### 6a. Is the keeper an AI? Could it go rogue?
No, it's not AI. It's a short, fixed program that checks each tenancy against the rules and, when a payout is due, triggers it. It makes no judgements.
It can't go rogue because it has no power over the money. The amounts and the recipients are calculated by the locked account's own rules, so the keeper can only say "pay out now" when the rules already allow it. It can't change who gets paid or how much. If the keeper ever stopped, anyone, including the tenant, could trigger the same payout.

### 7. What scenarios have been tested?
All three run end-to-end on Solana (currently on a test network on our own machine):
1. **Dispute:** landlord claims €300, three jurors vote €150 / €200 / €300, landlord receives €200 plus their share of the interest, tenant receives the rest.
2. **Silent landlord, agent-managed:** no claim is made, so the tenant is refunded automatically with their share of the interest; the landlord and the agent receive their shares of the interest.
3. **One-click release:** landlord approves at check-out and the tenant is paid immediately.

### 8. How do you handle tenants on benefits?
Many tenants on benefits have their deposit paid by a council, a charity or a deposit-guarantee scheme. **(planned)** "Pay on behalf of": a third party (council, charity or agent) pays the deposit in, and the rules record who gets the refund. Schemes that give a written guarantee instead of cash aren't supported yet; we'd want to work with local authorities on that.

---

## Interest ("yield")

### 9. How did you decide the interest rate?
We don't set the rate; the market does. The deposit is lent out through an established lending market on the blockchain (these are not bank-regulated), and borrowers pay interest. Our demo uses an example of about 3% a year (€36 on €1,200). What we did decide is **how the interest is shared**:

| Who | Share of interest |
|---|---|
| Tenant | 60% |
| Landlord | 20% |
| Letting agent | 5% (if no agent, this goes to the tenant) |
| UltraRentz | 15% |

The deposit itself is never shared out. It goes back to the tenant in full, minus any proven damage.

### 10. Will the interest rate change in the future?
Yes. It moves with demand for borrowing, sometimes daily, so we can't promise a fixed rate.

### 11. If the tenant stays year after year, does the interest increase?
The *rate* doesn't go up because they stay longer, but the *amount* earned keeps building for as long as the deposit is held. A deposit held for three years earns roughly three times what it earns in one year.

### 12. How does inflation affect it?
The deposit is held in a digital euro or dollar, so it keeps its face value but doesn't rise with prices, just as it wouldn't in a bank. The interest partly offsets inflation, and interest rates tend to be higher when inflation is high. It isn't a protection against inflation.

### 13. What if my bank offers a better rate?
If earning interest is all you care about, keeping the deposit in your own savings account may earn *you* more, since you'd keep 100% rather than 20%. Where the law allows that, it's a fair choice. What UltraRentz offers is everything else: no deposit admin, automatic returns, a clear dispute process, and tenants who trust the arrangement. The interest is a bonus, not the main reason to use it.

### 15. How would it work with a real lending market?
The locked account deposits the money into a well-established lending service on Solana (we're assessing Kamino and Jupiter Lend). It receives a receipt that grows in value as borrowers pay interest. When the tenancy ends, it cashes the receipt in, returns the deposit and shares out the interest. **(planned)** This is our next build step; today the interest in our demo is simulated.
*Risk:* any lending service carries some risk of technical failure. Our software already handles a shortfall safely, but we will be clear with tenants about that risk before taking real money.

### 16. Will the interest go up or down?
Either. It depends on how much people want to borrow. We publish the current rate; we don't promise one.

### 17. Do I get a higher rate if I onboard more deposits?
No. The rate is the same for every euro. More deposits simply means more interest in total, because your 20% applies to each one. For agents, volume pricing (for example, a lower per-tenancy fee for larger portfolios) is a business decision we'd discuss directly; it's not built into the system.

---

## Markets

### 14. After England and Ireland, which countries are you considering?
**Ireland** is our first real market, because landlords there hold deposits themselves and the national protection scheme legislated for in 2015 was never started. **England** is a test market only, because deposits there must go into a government-approved scheme.

Next, we're looking for countries where:
- landlords or agents hold deposits directly, with no mandatory state scheme, and
- there are large numbers of international students who struggle to recover deposits after leaving.

We'll research specific countries against those two tests before naming any. Rules on deposits vary widely between countries, and even between regions within one country.
