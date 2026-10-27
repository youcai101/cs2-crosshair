#!/usr/bin/env python3
"""Disassemble a VA range of a PE file.
python tools/re/disasm.py <dll> <start_rva> <end_rva> [outfile]
"""
import sys
import pefile
import capstone


def main():
    path, start, end = sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3], 16)
    out = sys.argv[4] if len(sys.argv) > 4 else None
    data = open(path, "rb").read()
    pe = pefile.PE(data=data, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    sec = None
    for s in pe.sections:
        if s.VirtualAddress <= start < s.VirtualAddress + max(s.Misc_VirtualSize, s.SizeOfRawData):
            sec = s
            break
    off = sec.PointerToRawData + (start - sec.VirtualAddress)
    blob = data[off:off + (end - start)]
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    lines = []
    for ins in md.disasm(blob, base + start):
        lines.append(f"0x{ins.address:x} {ins.bytes.hex():<20} {ins.mnemonic:<8} {ins.op_str}")
    text = "\n".join(lines)
    if out:
        open(out, "w", encoding="utf-8").write(text)
        print(f"wrote {len(lines)} insns -> {out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
