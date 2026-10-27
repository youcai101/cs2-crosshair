#!/usr/bin/env python3
"""Locate a class vtable via MSVC RTTI given its mangled name.

python tools/re/rtti.py <dll> "<mangled-name>"     # 列出 vtable 及其方法
"""
import sys
import struct
import pefile


def main():
    path, mangled = sys.argv[1], sys.argv[2]
    data = open(path, "rb").read()
    pe = pefile.PE(data=data, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    secs = [{"n": s.Name.rstrip(b"\0").decode(errors="replace"),
             "rva": s.VirtualAddress, "vs": s.Misc_VirtualSize,
             "ro": s.PointerToRawData, "rs": s.SizeOfRawData} for s in pe.sections]

    def off2rva(off):
        for s in secs:
            if s["ro"] <= off < s["ro"] + s["rs"]:
                return s["rva"] + (off - s["ro"])
        return None

    def rva2off(rva):
        for s in secs:
            if s["rva"] <= rva < s["rva"] + max(s["vs"], s["rs"]):
                return s["ro"] + (rva - s["rva"])
        return None

    # 1) name string
    name_off = data.find(mangled.encode())
    if name_off < 0:
        print("name not found")
        return
    name_rva = off2rva(name_off)
    td_rva = name_rva - 0x10  # TypeDescriptor: vfptr, spare, pTypeName
    print(f"name rva=0x{name_rva:x}  TypeDescriptor rva=0x{td_rva:x}")

    # 2) CompleteObjectLocator: 4-byte RVA ref to TypeDescriptor
    needle = struct.pack("<I", td_rva)
    cols = []
    i = 0
    while True:
        i = data.find(needle, i)
        if i < 0:
            break
        # COL 结构: 0 sig, 4 offset, 8 cdOffset, 12 pTD(rva), 16 pCD(rva)
        start = i - 12
        if start >= 0:
            cols.append(start)
        i += 1
    print(f"COL candidates: {len(cols)}")
    for c in cols[:5]:
        col_rva = off2rva(c)
        print(f"  COL rva=0x{col_rva:x}")
        # 3) vtable: 8-byte pointer to COL VA
        cneedle = struct.pack("<Q", base + col_rva)
        j = 0
        while True:
            j = data.find(cneedle, j)
            if j < 0:
                break
            vt_rva = off2rva(j) + 8  # vtable[-1] = COL, so methods start +8
            print(f"    vtable rva=0x{vt_rva:x}")
            # 打印前 20 个方法
            voff = rva2off(vt_rva)
            for k in range(20):
                p = struct.unpack("<Q", data[voff + k * 8:voff + k * 8 + 8])[0]
                if base <= p < base + 0x3000000:
                    print(f"      [{k}] 0x{p - base:x}")
                else:
                    break
            j += 1


if __name__ == "__main__":
    main()
