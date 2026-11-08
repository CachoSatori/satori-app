# Recorte del fondo blanco del daruma (sin tocar los colores del daruma): el fondo es el «casi blanco» conectado al borde
# (la cara blanca, rodeada de rojo, no se toca). En el contorno, alfa suave según cuánto blanco tiene el píxel.
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.float32)
w, h = im.size
minc = a.min(axis=2)
cand = minc >= 225
# el fondo: lo «casi blanco» conectado al borde (propagación por vecinos, sin librerías extra)
fondo = np.zeros_like(cand)
fondo[0, :] = cand[0, :]; fondo[-1, :] = cand[-1, :]; fondo[:, 0] = cand[:, 0]; fondo[:, -1] = cand[:, -1]
while True:
    g = fondo.copy()
    g[1:, :] |= fondo[:-1, :]; g[:-1, :] |= fondo[1:, :]; g[:, 1:] |= fondo[:, :-1]; g[:, :-1] |= fondo[:, 1:]
    g &= cand
    if (g == fondo).all(): break
    fondo = g

# franja del contorno: hasta 4 px desde el fondo
f_img = Image.fromarray((fondo * 255).astype(np.uint8), 'L')
cerca = np.asarray(f_img.filter(ImageFilter.MaxFilter(9))) > 0
banda = cerca & ~fondo
alfa = np.ones((h, w), np.float32)
alfa[fondo] = 0
# en la banda: mezcla con blanco → alfa por cuánto se aleja del blanco (el cuerpo rojo tiene mín. de canal ~40–70)
a_b = np.clip((255 - minc) / (255 - 60), 0, 1)
alfa[banda] = a_b[banda]
# desmezclar el blanco en la banda (para que el borde no quede con halo blanco sobre tinta)
rgb = a.copy()
m = banda & (alfa > 0.02)
rgb[m] = np.clip((a[m] - (1 - alfa[m, None]) * 255) / alfa[m, None], 0, 255)
out = np.dstack([rgb, alfa * 255]).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(dst, optimize=True)
ys, xs = np.where(alfa > 0)
print('caja del daruma:', xs.min(), ys.min(), xs.max(), ys.max(), '· fondo %.1f %%' % (fondo.mean() * 100))
