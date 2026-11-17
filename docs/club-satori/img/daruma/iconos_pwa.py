# Íconos de la app instalada (PWA) a partir del daruma del dueño. Reutiliza recortar.py (solo recorte del fondo blanco).
#   python3 -I iconos_pwa.py <daruma-original.jpg> <carpeta de salida>
# Salida: icon-192.png, icon-512.png (purpose any: cuadro redondeado tinta con margen, el resto transparente)
#         icon-maskable-512.png (purpose maskable: tinta a sangre, daruma dentro de la zona segura: círculo del 80 %)
#         apple-touch-icon.png (180×180, tinta a sangre: iOS redondea las esquinas)
#         favicon-32.png, favicon-64.png (daruma entero sin fondo, como club-web)
import os, subprocess, sys
from PIL import Image, ImageDraw
TINTA = (10, 10, 10, 255)          # #0a0a0a = theme_color/background_color del manifest
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
aqui = os.path.dirname(os.path.abspath(__file__))
tmp = os.path.join(out, '_recorte.png')
subprocess.run([sys.executable, '-I', os.path.join(aqui, 'recortar.py'), src, tmp], check=True)
d = Image.open(tmp); os.remove(tmp)
d = d.crop(d.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
AA = Image.LANCZOS
def daruma_en(lado, alto_rel, fondo, radio_rel=0.0, margen_rel=0.0):
    S = 4 * lado                                  # se dibuja a 4× y se baja: bordes suaves
    lienzo = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    m = round(S * margen_rel)
    if fondo:
        ImageDraw.Draw(lienzo).rounded_rectangle((m, m, S - 1 - m, S - 1 - m), radius=round(S * radio_rel), fill=TINTA)
    alto = round(S * alto_rel)
    dd = d.resize((round(d.width * alto / d.height), alto), AA)
    lienzo.alpha_composite(dd, ((S - dd.width) // 2, (S - dd.height) // 2))
    return lienzo.resize((lado, lado), AA)
# any: cuadro tinta con esquinas redondeadas (forma de ícono de macOS/Windows), 6 % de margen, daruma al 66 %
for n in (192, 512):
    daruma_en(n, 0.66, True, radio_rel=0.20, margen_rel=0.06).save(os.path.join(out, f'icon-{n}.png'), optimize=True)
# maskable: a sangre; el daruma al 74 % de alto queda dentro del círculo seguro del 80 % (radio máx. ≈ 0,37 de 0,40)
daruma_en(512, 0.74, True).save(os.path.join(out, 'icon-maskable-512.png'), optimize=True)
daruma_en(180, 0.70, True).convert('RGB').save(os.path.join(out, 'apple-touch-icon.png'), optimize=True)
lado = max(d.size); c = Image.new('RGBA', (lado, lado), (0, 0, 0, 0)); c.alpha_composite(d, ((lado - d.width) // 2, (lado - d.height) // 2))
for n in (64, 32): c.resize((n, n), AA).save(os.path.join(out, f'favicon-{n}.png'), optimize=True)
print('daruma', d.size, 'listo en', out)
