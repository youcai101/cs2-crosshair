import struct, sys, os

BASE = r"D:\software\steam\steamapps\common\Counter-Strike Global Offensive\game\csgo"
DIRVPK = os.path.join(BASE, "pak01_dir.vpk")
OUT = r"D:\Documents\cscrosshair\.preview\vpk"

raw = open(DIRVPK, "rb").read()
magic, version = struct.unpack_from("<II", raw, 0)
tree_size, data_size, md5_size, other_md5, sig_size = struct.unpack_from("<IIIII", raw, 8)
pos = 28

def cstr(p):
    e = raw.index(b"\x00", p)
    return raw[p:e].decode("utf-8", "replace"), e + 1

files = {}
ext, pos = cstr(pos)
while ext:
    path, pos = cstr(pos)
    while path:
        name, pos = cstr(pos)
        while name:
            full = path + "/" + name + "." + ext
            crc, preload = struct.unpack_from("<IH", raw, pos); pos += 6
            pre = raw[pos:pos + preload]; pos += preload
            archive, entry_off, entry_len, term = struct.unpack_from("<HIIH", raw, pos); pos += 12
            files[full] = (archive, entry_off, entry_len, pre)
            name, pos = cstr(pos)
        path, pos = cstr(pos)
    ext, pos = cstr(pos)

def read_entry(full):
    archive, off, ln, pre = files[full]
    if archive == 0x7FFF:
        body = raw[off:off + ln]
    else:
        vpk = os.path.join(BASE, "pak01_%03d.vpk" % archive)
        with open(vpk, "rb") as f:
            f.seek(off)
            body = f.read(ln)
    return pre + body

if __name__ == "__main__":
    targets = sys.argv[1:]
    os.makedirs(OUT, exist_ok=True)
    for t in targets:
        if t not in files:
            print("MISSING", t)
            continue
        data = read_entry(t)
        dst = os.path.join(OUT, t.replace("/", "_"))
        open(dst, "wb").write(data)
        print(len(data), dst, data[:120])
