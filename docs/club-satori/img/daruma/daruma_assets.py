# Piezas del daruma del Club a partir de la imagen del dueño (foto del daruma real; 08-nov). Sin filtros ni retoques:
# solo recorte del fondo blanco (recortar.py), escala y composición sobre tinta.
#   python3 -I daruma_assets.py <daruma-original.jpg> <carpeta de salida>
# Salida: daruma.png (sin fondo) · logo.png (990×990, círculo tinta) · hero.png (1032×336, la cara sobre tinta)
#         marca.png (encabezado de club-web, sin fondo, 128 px de alto) · favicon-64.png · favicon-32.png
import os, subprocess, sys
from PIL import Image, ImageDraw
TINTA = (13, 13, 13, 255)
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
aqui = os.path.dirname(os.path.abspath(__file__))
tmp = os.path.join(out, '_recorte.png')
subprocess.run([sys.executable, '-I', os.path.join(aqui, 'recortar.py'), src, tmp], check=True)
d = Image.open(tmp)
caja = d.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
d = d.crop(caja); os.remove(tmp)
d.save(os.path.join(out, 'daruma.png'), optimize=True)
W, H = d.size
alta = Image.LANCZOS
def escala(img, alto): return img.resize((round(img.width * alto / img.height), alto), alta)
# logo: círculo tinta (Google muestra el logo en círculo); el daruma entero entra con margen
L = 990
logo = Image.new('RGBA', (L, L), (0, 0, 0, 0))
ImageDraw.Draw(logo).ellipse((0, 0, L - 1, L - 1), fill=TINTA)
dl = escala(d, round(L * 0.74))
logo.alpha_composite(dl, ((L - dl.width) // 2, (L - dl.height) // 2))
logo.save(os.path.join(out, 'logo.png'), optimize=True)
# hero: la franja de la cara (de las cejas a la barba), entera, centrada sobre tinta
oy = 74   # el recorte empieza en y=74 de la imagen original
cara = d.crop((0, 215 - oy, W, 765 - oy))
hw, hh = 1032, 336
ch = escala(cara, hh)
if ch.width > hw: ch = cara.resize((hw, round(cara.height * hw / cara.width)), alta)
hero = Image.new('RGBA', (hw, hh), TINTA)
hero.alpha_composite(ch, ((hw - ch.width) // 2, (hh - ch.height) // 2))
hero.convert('RGB').save(os.path.join(out, 'hero.png'), optimize=True)
# club-web: encabezado (sin fondo) y favicons (el daruma entero, cuadrado, sin fondo)
escala(d, 128).save(os.path.join(out, 'marca.png'), optimize=True)
lado = max(W, H)
cuadro = Image.new('RGBA', (lado, lado), (0, 0, 0, 0)); cuadro.alpha_composite(d, ((lado - W) // 2, (lado - H) // 2))
for n in (64, 32): cuadro.resize((n, n), alta).save(os.path.join(out, f'favicon-{n}.png'), optimize=True)
print('daruma', d.size, '· listo en', out)
