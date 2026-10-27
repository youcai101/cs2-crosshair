#!/usr/bin/env python3
"""Find CS2 crosshair ConVar globals: given convar name string RVAs, locate the
registration stub and the global ConVar object it constructs.

python tools/re/find_convars.py <client.dll>
"""
import sys
import struct
import pefile
import capstone


def main():
    path = sys.argv[1]
    data = open(path, "rb").read()
    pe = pefile.PE(data=data, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    secs = [{"name": s.Name.rstrip(b"\0").decode(errors="replace"),
             "rva": s.VirtualAddress, "vsize": s.Misc_VirtualSize,
             "roff": s.PointerToRawData, "rsize": s.SizeOfRawData} for s in pe.sections]
    text = next(s for s in secs if s["name"] == ".text")

    def off2rva(off):
        for s in secs:
            if s["roff"] <= off < s["roff"] + s["rsize"]:
                return s["rva"] + (off - s["roff"])
        return None

    def rva2off(rva):
        for s in secs:
            if s["rva"] <= rva < s["rva"] + max(s["vsize"], s["rsize"]):
                return s["roff"] + (rva - s["rva"])
        return None

    # 1) all cl_crosshair* strings
    names = {}
    import re
    for m in re.finditer(rb"cl_crosshair[a-z0-9_]*\x00", data):
        rva = off2rva(m.start())
        if rva is None or not (0x1a00000 <= rva < 0x21be000):
            continue
        names.setdefault(m.group()[:-1].decode(), rva)

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    t0, t1 = text["roff"], text["roff"] + text["rsize"]
    trva = text["rva"]
    target2name = {base + rva: n for n, rva in names.items()}
    print(f"# {len(names)} crosshair strings")

    found = {}
    i = t0
    while i < t1 - 7:
        if data[i] == 0x48 and data[i + 1] == 0x8D and (data[i + 2] & 0xC7) == 0x05:
            disp = struct.unpack("<i", data[i + 3:i + 7])[0]
            nex = base + trva + (i - t0) + 7
            if (nex + disp) in target2name:
                name = target2name[nex + disp]
                # disassemble next 30 instructions to find lea rcx,[rip+...]
                code = data[i:i + 160]
                obj = None
                for ins in md.disasm(code, base + trva + (i - t0)):
                    if ins.mnemonic == "lea" and ins.op_str.startswith("rcx, [rip"):
                        obj = ins.operands[1].mem.disp + ins.address + ins.size
                        break
                if obj:
                    found[name] = (off2rva(i), obj - base)
                i += 7
                continue
        i += 1

    for name in sorted(found):
        rva_stub, obj_rva = found[name]
        print(f"{name:40s} stub=0x{rva_stub:08x} glob=0x{obj_rva:08x}")

    # 2) which .text sites reference the globals (drawing code candidates)
    print("\n# code xrefs to globals")
    for name in sorted(found):
        _, g = found[name]
        target = base + g
        hits = []
        j = t0
        while j < t1 - 7:
            if data[j] == 0x48 and data[j + 1] == 0x8D and (data[j + 2] & 0xC7) == 0x05:
                disp = struct.unpack("<i", data[j + 3:j + 7])[0]
                nex = base + trva + (j - t0) + 7
                if nex + disp == target:
                    hits.append(off2rva(j))
            if data[j] == 0x48 and data[j + 1] == 0x8B and (data[j + 2] & 0xC7) == 0x05:
                disp = struct.unpack("<i", data[j + 3:j + 7])[0]
                nex = base + trva + (j - t0) + 7
                if nex + disp == target:
                    hits.append(off2rva(j))
            j += 1
        if hits:
            print(f"{name:40s} glob=0x{g:08x} refs={[hex(h) for h in hits[:8]]}")


if __name__ == "__main__":
    main()
