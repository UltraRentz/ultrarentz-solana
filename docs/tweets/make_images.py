"""Tweet images for the UltraRentz security + account abstraction threads (1200x675, brand palette)."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 675
BG, PANEL = "#0E1426", "#1A233E"
TEAL, AMBER, RED = "#2DD4BF", "#FBBF24", "#F87171"
TEXT, MUTED = "#F1F5F9", "#94A3B8"
FD = "/usr/share/fonts/truetype/dejavu/"
F = lambda s, b=False: ImageFont.truetype(FD + ("DejaVuSans-Bold.ttf" if b else "DejaVuSans.ttf"), s)
TAG = "[BRAND TAG: ask Ben]"
problems = []


def base():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((W - 40, H - 30), TAG, font=F(18), fill=MUTED, anchor="rs")
    return im, d


def text(d, xy, s, size, fill=TEXT, bold=False, maxw=None, anchor="la", spacing=8, name=""):
    """Draw text, wrapping to maxw; record an error if anything still overflows."""
    font = F(size, bold)
    lines = []
    for para in s.split("\n"):
        if maxw is None:
            lines.append(para)
            continue
        cur = ""
        for w in para.split(" "):
            t = (cur + " " + w).strip()
            if d.textlength(t, font=font) <= maxw:
                cur = t
            else:
                if cur:
                    lines.append(cur)
                cur = w
        lines.append(cur)
    x, y = xy
    for ln in lines:
        d.text((x, y), ln, font=font, fill=fill, anchor=anchor)
        wdt = d.textlength(ln, font=font)
        left = x - wdt / 2 if anchor[0] == "m" else (x - wdt if anchor[0] == "r" else x)
        if left < 20 or left + wdt > W - 20:
            problems.append(f"{name}: '{ln[:30]}' overflows")
        y += size + spacing
    return y


def panel(d, box, outline=None):
    d.rounded_rectangle(box, radius=22, fill=PANEL, outline=outline, width=3 if outline else 0)


# ---------------------------------------------------------------- SECURITY 1: hook
im, d = base()
text(d, (60, 50), "SOLANA SECURITY", 24, TEAL, True, name="s1")
text(d, (60, 95), "The compiler only warned us.", 54, TEXT, True, maxw=1080, name="s1")
# stack bar
x0, y0, bw, bh = 60, 300, 1080, 90
limit_frac = 4096 / 5232
d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=14, fill=PANEL)
d.rounded_rectangle((x0, y0, x0 + int(bw * limit_frac), y0 + bh), radius=14, fill=TEAL)
d.rectangle((x0 + int(bw * limit_frac), y0, x0 + bw, y0 + bh), fill=RED)
d.line((x0 + int(bw * limit_frac), y0 - 25, x0 + int(bw * limit_frac), y0 + bh + 25), fill=TEXT, width=4)
text(d, (x0 + 20, y0 + 26), "4,096-byte limit per function", 30, BG, True, name="s1")
text(d, (x0 + bw - 20, y0 + 26), "+1,136", 30, BG, True, anchor="ra", name="s1")
text(d, (60, 430), "Our deposit payout step used 5,232 bytes of stack.", 34, TEXT, maxw=1080, name="s1")
text(d, (60, 490), "The build still succeeded. We fixed it before devnet.", 30, MUTED, maxw=1080, name="s1")
im.save("sec_1_hook.png")

# ---------------------------------------------------------------- SECURITY 3: before/after
im, d = base()
text(d, (60, 45), "THE FIX: BOXING", 24, TEAL, True, name="s3")
text(d, (60, 85), "Move big accounts off the 4KB stack", 44, TEXT, True, maxw=1080, name="s3")
panel(d, (60, 190, 580, 600), RED)
panel(d, (620, 190, 1140, 600), TEAL)
text(d, (90, 215), "BEFORE", 26, RED, True, name="s3")
text(d, (90, 260), "8 accounts loaded onto the stack", 28, TEXT, maxw=460, name="s3")
text(d, (90, 370), "5,232 bytes", 60, RED, True, name="s3")
text(d, (90, 445), "1,136 over the limit: risk of overwriting values in use", 26, MUTED, maxw=460, name="s3")
text(d, (650, 215), "AFTER", 26, TEAL, True, name="s3")
text(d, (650, 260), "Large accounts wrapped in Box<…> → stored on the heap", 28, TEXT, maxw=460, name="s3")
text(d, (650, 370), "0 warnings", 60, TEAL, True, name="s3")
text(d, (650, 445), "Same program, same checks; only where it stores data changed", 26, MUTED, maxw=460, name="s3")
im.save("sec_3_fix.png")

# ---------------------------------------------------------------- SECURITY 7: summary card
im, d = base()
text(d, (60, 45), "SUMMARY", 24, TEAL, True, name="s7")
text(d, (60, 85), "Securing a rent-deposit program on Solana", 42, TEXT, True, maxw=1080, name="s7")
rows = [
    (TEAL, "1", "The 4KB stack limit only warns: treat it as a bug."),
    (TEAL, "2", "Box large accounts: 5,232 bytes → 0 warnings."),
    (TEAL, "3", "5 attacks on the lending path → all 5 rejected."),
    (AMBER, "!", "Limit: devnet pilot, upgradeable, not yet audited."),
]
y = 200
for col, n, s in rows:
    panel(d, (60, y, 1140, y + 90))
    d.ellipse((85, y + 20, 135, y + 70), fill=col)
    d.text((110, y + 45), n, font=F(28, True), fill=BG, anchor="mm")
    text(d, (160, y + 28), s, 30, TEXT, maxw=960, name="s7")
    y += 105
im.save("sec_7_summary.png")

# ---------------------------------------------------------------- AA 1: hook
im, d = base()
text(d, (60, 45), "ACCOUNT ABSTRACTION", 24, TEAL, True, name="a1")
text(d, (60, 85), "Who holds the key to a deposit?", 50, TEXT, True, maxw=1080, name="a1")
panel(d, (60, 210, 580, 590), RED)
panel(d, (620, 210, 1140, 590), TEAL)
text(d, (90, 240), "NORMAL ACCOUNT", 26, RED, True, name="a1")
d.rounded_rectangle((90, 300, 170, 340), radius=10, fill=RED)
d.text((130, 320), "KEY", font=F(22, True), fill=BG, anchor="mm")
text(d, (90, 370), "One private key controls it. Whoever holds the key can move the money.", 28, TEXT, maxw=460, name="a1")
text(d, (650, 240), "SOLANA PDA", 26, TEAL, True, name="a1")
d.rounded_rectangle((650, 300, 790, 340), radius=10, fill=TEAL)
d.text((720, 320), "NO KEY", font=F(22, True), fill=BG, anchor="mm")
text(d, (650, 370), "No private key exists. Only the program's rules can move the money.", 28, TEXT, maxw=460, name="a1")
im.save("aa_1_hook.png")

# ---------------------------------------------------------------- AA 3: comparison
im, d = base()
text(d, (60, 40), "THREE WAYS TO PUT RULES ON AN ACCOUNT", 24, TEAL, True, name="a3")
cols = [
    ("ERC-4337", "Ethereum", "Final · on mainnet since Mar 2023", "A smart account (a contract) holds funds; bundlers submit its actions"),
    ("EIP-7702", "Ethereum", "Live since 7 May 2025 (Pectra)", "A normal key-based account points to smart-account code"),
    ("PDA", "Solana", "Core Solana feature", "An address with no private key; only the program that created it can sign"),
]
x = 60
for title, chain, status, desc in cols:
    panel(d, (x, 100, x + 340, 600), TEAL if title == "PDA" else None)
    text(d, (x + 25, 125), chain.upper(), 22, MUTED, True, name="a3")
    text(d, (x + 25, 160), title, 46, TEXT, True, name="a3")
    d.rounded_rectangle((x + 25, 230, x + 315, 300), radius=12, fill=BG)
    text(d, (x + 40, 240), status, 21, AMBER if "Core" in status else TEAL, True, maxw=260, spacing=4, name="a3")
    text(d, (x + 25, 330), desc, 26, TEXT, maxw=290, name="a3")
    x += 370
text(d, (60, 618), "Statuses: ercs.ethereum.org, ethereum.org · Solana: solana.com/docs/core/pda", 18, MUTED, name="a3")
im.save("aa_3_compare.png")

# ---------------------------------------------------------------- AA 8: summary card
im, d = base()
text(d, (60, 45), "SUMMARY", 24, TEAL, True, name="a8")
text(d, (60, 85), "Rule-based accounts, two ways", 46, TEXT, True, maxw=1080, name="a8")
panel(d, (60, 180, 580, 470))
panel(d, (620, 180, 1140, 470), TEAL)
text(d, (90, 205), "ETHEREUM", 26, MUTED, True, name="a8")
text(d, (90, 255), "Smart accounts added on top of key-based accounts (ERC-4337, EIP-7702)", 30, TEXT, maxw=460, name="a8")
text(d, (650, 205), "SOLANA", 26, TEAL, True, name="a8")
text(d, (650, 255), "Program-owned addresses (PDAs) with no key at all", 30, TEXT, maxw=460, name="a8")
text(d, (60, 505), "UltraRentz: each deposit is controlled by a PDA. No landlord holds its key.", 30, TEXT, True, maxw=1080, name="a8")
im.save("aa_8_summary.png")

print("PROBLEMS:", problems or "none")
