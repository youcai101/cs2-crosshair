#!/usr/bin/env python3
"""CS2 client.dll reverse helpers.

Usage:
  python cs2_scan.py strings <dll> [pattern]     列出字符串及其 RVA
  python cs2_scan.py ptrs    <dll> <rva>         找指向该 RVA 的 8 字节指针位置
  python cs2_scan.py code    <dll> <rva>         找 rip-relative 引用该地址的代码位置
  python cs2_scan.py around  <dll> <rva> [n]     反汇编该 RVA 附近 n 条指令
"""
import sys
import struct
import re

import pefile
import capstone


def load(path):
    data = open(path, "rb").read()
    pe = pefile.PE(data=data, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    secs = []
    for s in pe.sections:
        secs.append({
            "name": s.Name.rstrip(b"\x00").decode(errors="replace"),
            "rva": s.VirtualAddress,
            "vsize": s.Misc_VirtualSize,
            "roff": s.PointerToRawData,
            "rsize": s.SizeOfRawData,
        })
    return data, base, secs


def off2rva(secs, off):
    for s in secs:
        if s["roff"] <= off < s["roff"] + s["rsize"]:
            return s["rva"] + (off - s["roff"])
    return None


def rva2off(secs, rva):
    for s in secs:
        if s["rva"] <= rva < s["rva"] + max(s["vsize"], s["rsize"]):
            return s["roff"] + (rva - s["rva"])
    return None


def section_of(secs, off):
    for s in secs:
        if s["roff"] <= off < s["roff"] + s["rsize"]:
            return s
    return None


def cmd_strings(data, secs, pattern):
    rx = re.compile(pattern.encode())
    n = 0
    for m in rx.finditer(data):
        rva = off2rva(secs, m.start())
        if rva is None:
            continue
        s = data[m.start():m.start() + 64].split(b"\x00")[0].decode(errors="replace")
        print(f"rva=0x{rva:08x} off=0x{m.start():08x} {s}")
        n += 1
        if n >= 200:
            break


def cmd_ptrs(data, secs, base, rva):
    needle = struct.pack("<Q", base + rva)
    i = 0
    hits = []
    while True:
        i = data.find(needle, i)
        if i < 0:
            break
        hits.append(i)
        i += 1
    print(f"ptr hits: {len(hits)}")
    for h in hits[:60]:
        print(f"  off=0x{h:08x} rva=0x{off2rva(secs, h):08x} sec={section_of(secs,h)['name'] if section_of(secs,h) else '?'}")


def cmd_code(data, secs, base, target_rva):
    text = next((s for s in secs if s["name"] == ".text"), None)
    target = base + target_rva
    t0 = text["roff"]
    t1 = t0 + text["rsize"]
    trva = text["rva"]
    hits = []
    i = t0
    while i < t1 - 7:
        b = data[i:i + 7]
        if b[0] == 0x48 and b[1] == 0x8D and (b[2] & 0xC7) == 0x05:
            disp = struct.unpack("<i", b[3:7])[0]
            nex = base + trva + (i - t0) + 7
            if nex + disp == target:
                hits.append(i)
                i += 7
                continue
        if b[0] == 0xFF and b[1] == 0x15:
            disp = struct.unpack("<i", data[i + 2:i + 6])[0]
            nex = base + trva + (i - t0) + 6
            if nex + disp == target:
                hits.append(i)
                i += 6
                continue
        i += 1
    print(f"code hits: {len(hits)}")
    for h in hits[:40]:
        print(f"  off=0x{h:08x} rva=0x{off2rva(secs, h):08x}")


def cmd_around(data, secs, base, rva, n=40, back=64):
    off = rva2off(secs, rva)
    if off is None:
        print("rva not mapped")
        return
    start = max(0, off - back)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = False
    va = base + rva - back
    for ins in md.disasm(data[start:start + 400], va):
        print(f"0x{ins.address:x}: {ins.mnemonic:<8} {ins.op_str}")
        n -= 1
        if n <= 0:
            break


def main():
    cmd = sys.argv[1]
    path = sys.argv[2]
    data, base, secs = load(path)
    if cmd == "strings":
        cmd_strings(data, secs, sys.argv[3] if len(sys.argv) > 3 else "cl_crosshair")
    elif cmd == "ptrs":
        cmd_ptrs(data, secs, base, int(sys.argv[3], 16))
    elif cmd == "code":
        cmd_code(data, secs, base, int(sys.argv[3], 16))
    elif cmd == "around":
        n = int(sys.argv[4]) if len(sys.argv) > 4 else 40
        cmd_around(data, secs, base, int(sys.argv[3], 16), n)


if __name__ == "__main__":
    main()
