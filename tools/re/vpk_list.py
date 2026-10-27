import struct

VPK = r"D:\software\steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir.vpk"
raw = open(VPK, "rb").read()

magic, version = struct.unpack_from("<II", raw, 0)
assert magic == 0x55AA1234
tree_size, data_size, md5_size, other_md5, sig_size = struct.unpack_from("<IIIII", raw, 8)
pos = 28

def cstr(p):
    e = raw.index(b"\x00", p)
    return raw[p:e].decode("utf-8", "replace"), e + 1

files = []
ext, pos = cstr(pos)
while ext:
    path, pos = cstr(pos)
    while path:
        name, pos = cstr(pos)
        while name:
            full = path + "/" + name + "." + ext
            crc, preload = struct.unpack_from("<IH", raw, pos); pos += 6
            if preload:
                pos += preload
            archive, entry_off, entry_len, term = struct.unpack_from("<HIIH", raw, pos); pos += 12
            assert term == 0xFFFF, (full, hex(term))
            files.append((full, archive, entry_off, entry_len))
            name, pos = cstr(pos)
        path, pos = cstr(pos)
    ext, pos = cstr(pos)

print("files:", len(files))
for f in files:
    if "crosshair" in f[0].lower():
        print(f)
