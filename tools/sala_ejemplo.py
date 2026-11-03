"""Genera una sala de ejemplo texturizada que simula un escaneo por fotogrametría
(src/assets/salon-escaneado.glb). Solo se usa como demostración del gemelo digital."""
import io, json, math, random, struct, sys
from PIL import Image, ImageDraw, ImageFilter

random.seed(7)
W, D, H = 16.0, 11.0, 3.6

def jpg(img, q=82):
    b = io.BytesIO(); img.convert('RGB').save(b, 'JPEG', quality=q); return b.getvalue()

# ---------- Texturas ----------
def wall_tex(length, px_per_m=96):
    w, h = int(length * px_per_m), int(H * px_per_m)
    im = Image.new('RGB', (w, h), (214, 196, 160))
    d = ImageDraw.Draw(im)
    # papel pintado damasco
    for y in range(0, h, 48):
        for x in range(0, w, 40):
            ox = 20 if (y // 48) % 2 else 0
            cx, cy = x + ox, y + 24
            d.ellipse([cx - 9, cy - 14, cx + 9, cy + 14], outline=(196, 174, 134), width=2)
            d.line([cx, cy - 18, cx, cy + 18], fill=(201, 181, 141), width=1)
    wain = int(1.0 * px_per_m)
    d.rectangle([0, h - wain, w, h], fill=(74, 54, 38))  # zócalo de madera
    for x in range(10, w - 60, 110):
        d.rectangle([x, h - wain + 12, x + 96, h - 14], outline=(104, 78, 55), width=4)
    d.rectangle([0, h - wain - 8, w, h - wain], fill=(232, 220, 196))  # moldura media
    d.rectangle([0, 0, w, 22], fill=(240, 232, 214))  # cornisa
    d.rectangle([0, 22, w, 28], fill=(200, 180, 140))
    d.rectangle([0, h - 10, w, h], fill=(50, 36, 26))  # rodapié
    # ruido de captura
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    px = im.load()
    for _ in range(w * h // 30):
        x, y = random.randrange(w), random.randrange(h)
        r, g, b = px[x, y]; k = random.randint(-10, 10)
        px[x, y] = (max(0, min(255, r + k)), max(0, min(255, g + k)), max(0, min(255, b + k)))
    return im

def parquet():
    im = Image.new('RGB', (512, 512)); d = ImageDraw.Draw(im)
    for y in range(0, 512, 32):
        for x in range(-128, 512, 128):
            off = 64 if (y // 32) % 2 else 0
            c = random.choice([(150, 104, 62), (139, 95, 55), (162, 114, 70), (128, 86, 50)])
            d.rectangle([x + off, y, x + off + 126, y + 30], fill=c)
            for k in range(4):
                yy = y + random.randint(3, 27)
                d.line([x + off + 4, yy, x + off + 120, yy + random.randint(-2, 2)], fill=tuple(v - 12 for v in c))
    return im.filter(ImageFilter.GaussianBlur(0.5))

def ceiling():
    im = Image.new('RGB', (512, 512), (242, 238, 230)); d = ImageDraw.Draw(im)
    for i in range(0, 512, 128):
        d.rectangle([i + 6, 6, i + 122, 506], outline=(222, 214, 200), width=6)
    return im

def painting(kind, size=(384, 288)):
    w, h = size; im = Image.new('RGB', size); d = ImageDraw.Draw(im)
    if kind == 'paisaje':
        for y in range(h):
            t = y / h; d.line([0, y, w, y], fill=(int(120 + 120 * t), int(160 + 60 * t), int(210 - 40 * t)))
        d.ellipse([w * .68, h * .12, w * .82, h * .3], fill=(250, 220, 140))
        d.polygon([(0, h * .65), (w * .3, h * .42), (w * .55, h * .62), (w * .8, h * .45), (w, h * .6), (w, h), (0, h)], fill=(82, 112, 72))
        d.polygon([(0, h * .8), (w * .4, h * .7), (w, h * .82), (w, h), (0, h)], fill=(58, 86, 52))
    elif kind == 'abstracto':
        im.paste((236, 228, 210), [0, 0, w, h])
        for c, box in [((178, 52, 46), (30, 40, 200, 210)), ((32, 70, 120), (150, 90, 340, 250)), ((222, 170, 60), (90, 160, 220, 270))]:
            d.rectangle(box, fill=c)
        d.line([0, h * .55, w, h * .35], fill=(20, 20, 20), width=6)
    elif kind == 'marina':
        for y in range(h):
            t = y / h; d.line([0, y, w, y], fill=(int(200 - 90 * t), int(215 - 80 * t), int(230 - 40 * t)))
        d.rectangle([0, h * .55, w, h], fill=(40, 82, 120))
        d.polygon([(w * .4, h * .55), (w * .5, h * .18), (w * .5, h * .55)], fill=(245, 242, 235))
        d.polygon([(w * .52, h * .55), (w * .52, h * .25), (w * .62, h * .55)], fill=(230, 226, 218))
        d.rectangle([w * .36, h * .55, w * .66, h * .6], fill=(90, 60, 40))
    else:  # bodegón
        im.paste((52, 44, 38), [0, 0, w, h])
        d.ellipse([w * .25, h * .35, w * .5, h * .75], fill=(190, 60, 50))
        d.ellipse([w * .45, h * .45, w * .7, h * .8], fill=(220, 170, 60))
        d.rectangle([w * .6, h * .2, w * .72, h * .75], fill=(80, 120, 90))
        d.rectangle([0, h * .78, w, h], fill=(120, 90, 60))
    return im.filter(ImageFilter.GaussianBlur(0.8))

def solid(rgb):
    return Image.new('RGB', (8, 8), rgb)

# ---------- Geometría ----------
class Builder:
    def __init__(self):
        self.bin = bytearray(); self.views = []; self.acc = []; self.meshes = []; self.nodes = []
        self.mats = []; self.texs = []; self.imgs = []; self.img_index = {}
    def _view(self, data, target=None):
        while len(self.bin) % 4: self.bin += b'\0'
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target: v["target"] = target
        self.bin += data; self.views.append(v); return len(self.views) - 1
    def _acc(self, view, ctype, count, typ, mn=None, mx=None):
        a = {"bufferView": view, "componentType": ctype, "count": count, "type": typ}
        if mn is not None: a["min"], a["max"] = mn, mx
        self.acc.append(a); return len(self.acc) - 1
    def material(self, name, img=None, color=(1, 1, 1), rough=0.85, metal=0.0):
        m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": [*color, 1], "roughnessFactor": rough, "metallicFactor": metal}, "doubleSided": True}
        if img is not None:
            data = jpg(img); key = hash(data)
            if key not in self.img_index:
                v = self._view(data); self.imgs.append({"bufferView": v, "mimeType": "image/jpeg"})
                self.texs.append({"source": len(self.imgs) - 1, "sampler": 0}); self.img_index[key] = len(self.texs) - 1
            m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": self.img_index[key]}
        self.mats.append(m); return len(self.mats) - 1
    def mesh(self, name, verts, mat):
        """verts: lista de triángulos [(pos, normal, uv), ...] (3 por cara)."""
        pos = b''.join(struct.pack('<3f', *v[0]) for v in verts)
        nor = b''.join(struct.pack('<3f', *v[1]) for v in verts)
        uv = b''.join(struct.pack('<2f', *v[2]) for v in verts)
        n = len(verts)
        mn = [min(v[0][i] for v in verts) for i in range(3)]; mx = [max(v[0][i] for v in verts) for i in range(3)]
        p = self._acc(self._view(pos, 34962), 5126, n, "VEC3", mn, mx)
        no = self._acc(self._view(nor, 34962), 5126, n, "VEC3")
        u = self._acc(self._view(uv, 34962), 5126, n, "VEC2")
        self.meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": p, "NORMAL": no, "TEXCOORD_0": u}, "material": mat}]})
        self.nodes.append({"mesh": len(self.meshes) - 1, "name": name})
    def save(self, path):
        g = {"asset": {"version": "2.0", "generator": "MICE Design – sala de ejemplo"}, "scene": 0,
             "scenes": [{"nodes": list(range(len(self.nodes)))}], "nodes": self.nodes, "meshes": self.meshes,
             "materials": self.mats, "textures": self.texs, "images": self.imgs,
             "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
             "accessors": self.acc, "bufferViews": self.views}
        while len(self.bin) % 4: self.bin += b'\0'
        g["buffers"] = [{"byteLength": len(self.bin)}]
        j = json.dumps(g).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
        out = struct.pack('<III', 0x46546C67, 2, 28 + len(j) + len(self.bin)) + struct.pack('<II', len(j), 0x4E4F534A) + j + struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin)
        open(path, 'wb').write(out)

def quad(c, u, v, n, uv=(0, 0, 1, 1)):
    """Rectángulo con centro c, semiejes u y v, normal n."""
    P = lambda a, b: tuple(c[i] + a * u[i] + b * v[i] for i in range(3))
    u0, v0, u1, v1 = uv
    a, b, cc, d = (P(-1, -1), (u0, v1)), (P(1, -1), (u1, v1)), (P(1, 1), (u1, v0)), (P(-1, 1), (u0, v0))
    return [(a[0], n, a[1]), (b[0], n, b[1]), (cc[0], n, cc[1]), (a[0], n, a[1]), (cc[0], n, cc[1]), (d[0], n, d[1])]

def box(cx, cy, cz, sx, sy, sz, front_uv=None, bottom=True):
    hx, hy, hz = sx / 2, sy / 2, sz / 2; t = []
    faces = [((cx, cy, cz + hz), (hx, 0, 0), (0, hy, 0), (0, 0, 1)), ((cx, cy, cz - hz), (-hx, 0, 0), (0, hy, 0), (0, 0, -1)),
             ((cx + hx, cy, cz), (0, 0, -hz), (0, hy, 0), (1, 0, 0)), ((cx - hx, cy, cz), (0, 0, hz), (0, hy, 0), (-1, 0, 0)),
             ((cx, cy + hy, cz), (hx, 0, 0), (0, 0, -hz), (0, 1, 0)), ((cx, cy - hy, cz), (hx, 0, 0), (0, 0, hz), (0, -1, 0))]
    for i, f in enumerate(faces):
        if i == 5 and not bottom: continue
        t += quad(*f, uv=(0, 0, 1, 1))
    return t

def rot_y(tris, ang, pivot):
    c, s = math.cos(ang), math.sin(ang); px, pz = pivot; out = []
    for p, n, uv in tris:
        x, z = p[0] - px, p[2] - pz
        out.append(((px + x * c + z * s, p[1], pz - x * s + z * c), (n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c), uv))
    return out

def sphere(cx, cy, cz, r, seg=10):
    t = []
    for i in range(seg):
        for j in range(seg * 2):
            def P(a, b):
                th, ph = math.pi * a / seg, 2 * math.pi * b / (seg * 2)
                n = (math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph))
                return ((cx + r * n[0], cy + r * n[1], cz + r * n[2]), n, (b / (seg * 2), a / seg))
            a, b, c, d = P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)
            t += [a, b, c, a, c, d]
    return t

B = Builder()
long_w, short_w = wall_tex(W), wall_tex(D)
m_long = B.material('pared_larga', long_w); m_short = B.material('pared_corta', short_w)
B.mesh('pared_norte', quad((0, H / 2, -D / 2), (W / 2, 0, 0), (0, H / 2, 0), (0, 0, 1)), m_long)
B.mesh('pared_sur', quad((0, H / 2, D / 2), (-W / 2, 0, 0), (0, H / 2, 0), (0, 0, -1)), m_long)
B.mesh('pared_oeste', quad((-W / 2, H / 2, 0), (0, 0, -D / 2), (0, H / 2, 0), (1, 0, 0)), m_short)
B.mesh('pared_este', quad((W / 2, H / 2, 0), (0, 0, D / 2), (0, H / 2, 0), (-1, 0, 0)), m_short)
B.mesh('suelo', quad((0, 0, 0), (W / 2, 0, 0), (0, 0, -D / 2), (0, 1, 0), uv=(0, 0, W / 2.5, D / 2.5)), B.material('parque', parquet(), rough=0.6))
B.mesh('techo', quad((0, H, 0), (W / 2, 0, 0), (0, 0, D / 2), (0, -1, 0), uv=(0, 0, 4, 3)), B.material('techo', ceiling()))

gold = B.material('marco_dorado', solid((176, 141, 87)), rough=0.4, metal=0.6)
arts = [('paisaje', (-4, 1.75, -D / 2), 0, 2.2, 1.6), ('abstracto', (4, 1.75, -D / 2), 0, 1.8, 1.35),
        ('marina', (-W / 2, 1.7, -2), math.pi / 2, 1.6, 1.2), ('bodegon', (W / 2, 1.7, 2.5), -math.pi / 2, 1.4, 1.05)]
for name, (x, y, z), ang, w, h in arts:
    mat = B.material('cuadro_' + name, painting(name))
    frame = box(0, 0, 0.03, w, h, 0.06); canvas = quad((0, 0, 0.061), (w / 2 - 0.08, 0, 0), (0, h / 2 - 0.08, 0), (0, 0, 1))
    off = lambda tris: [((p[0], p[1] + y, p[2]), n, uv) for p, n, uv in tris]
    fr = rot_y(off(frame), ang, (0, 0)); cv = rot_y(off(canvas), ang, (0, 0))
    sh = lambda tris: [((p[0] + x, p[1], p[2] + z), n, uv) for p, n, uv in tris]
    B.mesh('marco_' + name, sh(fr), gold); B.mesh('lienzo_' + name, sh(cv), mat)

# espejo y consola junto a la pared sur
mirror = B.material('espejo', solid((205, 216, 222)), rough=0.08, metal=0.9)
B.mesh('marco_espejo', box(3.5, 1.7, D / 2 - 0.03, 1.1, 1.5, 0.06), gold)
B.mesh('espejo', quad((3.5, 1.7, D / 2 - 0.065), (-0.48, 0, 0), (0, 0.68, 0), (0, 0, -1)), mirror)
wood = B.material('madera', solid((92, 62, 40)), rough=0.5)
B.mesh('consola', box(3.5, 0.82, D / 2 - 0.25, 1.4, 0.06, 0.4) + box(2.9, 0.4, D / 2 - 0.25, 0.06, 0.8, 0.36) + box(4.1, 0.4, D / 2 - 0.25, 0.06, 0.8, 0.36), wood)
B.mesh('jarron', sphere(3.5, 1.0, D / 2 - 0.25, 0.14), B.material('porcelana', solid((40, 70, 120)), rough=0.2))
# apliques
brass = B.material('laton', solid((200, 160, 90)), rough=0.3, metal=0.8)
glow = B.material('pantalla_aplique', solid((255, 236, 200)))
for x in (-7, -1, 1, 7):
    B.mesh(f'aplique_{x}', box(x, 2.3, -D / 2 + 0.06, 0.08, 0.25, 0.12), brass)
    B.mesh(f'tulipa_{x}', sphere(x, 2.5, -D / 2 + 0.16, 0.1), glow)
# lámparas de araña
crystal = B.material('cristal', solid((236, 238, 240)), rough=0.1, metal=0.3)
for x in (-4, 4):
    B.mesh(f'arania_varilla_{x}', box(x, H - 0.3, 0, 0.03, 0.6, 0.03), brass)
    t = []
    for k in range(8):
        a = 2 * math.pi * k / 8
        t += sphere(x + 0.45 * math.cos(a), H - 0.7, 0.45 * math.sin(a), 0.07, 6)
    t += sphere(x, H - 0.75, 0, 0.18, 8)
    B.mesh(f'arania_{x}', t, crystal)
# puertas pintadas como relieve
door = B.material('puerta', solid((88, 58, 38)), rough=0.5)
B.mesh('puerta_doble', box(0, 1.15, D / 2 - 0.02, 1.8, 2.3, 0.04), door)
B.mesh('puerta_lateral', box(W / 2 - 0.02, 1.1, -3, 0.04, 2.2, 1.2), door)
# mobiliario que había el día del escaneo (se puede quitar con «Vaciar la sala»)
fabric = B.material('tapiceria', solid((120, 40, 48)), rough=0.95)
B.mesh('sofa_1', box(-1.5, 0.22, 1.2, 2.0, 0.44, 0.85, bottom=False) + box(-1.5, 0.6, 1.55, 2.0, 0.5, 0.18, bottom=False), fabric)
B.mesh('sofa_2', box(1.8, 0.22, -0.8, 2.0, 0.44, 0.85, bottom=False) + box(1.8, 0.6, -1.15, 2.0, 0.5, 0.18, bottom=False), fabric)
B.mesh('mesa_centro', box(0.2, 0.42, 0.2, 1.2, 0.05, 0.7, bottom=False) + box(0.2, 0.2, 0.2, 0.9, 0.4, 0.4, bottom=False), wood)
B.mesh('alfombra', quad((0.2, 0.012, 0.2), (2.4, 0, 0), (0, 0, -1.8), (0, 1, 0)), B.material('alfombra', solid((140, 118, 90)), rough=1))
B.save(sys.argv[1])
