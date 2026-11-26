import sys
posts = open(sys.argv[1]).read().split("\n=====\n")
def xlen(s):
    n = 0
    for ch in s:
        o = ord(ch)
        if o > 0xFFFF or 0x2190 <= o <= 0x21FF or 0x2600 <= o <= 0x27BF or o == 0xFE0F:
            n += 2
        else:
            n += 1
    return n
for i, p in enumerate(posts, 1):
    p = p.strip("\n")
    print(i, xlen(p), "OK" if xlen(p) <= 260 else "TOO LONG")
