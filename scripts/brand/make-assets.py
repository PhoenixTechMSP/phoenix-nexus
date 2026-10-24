#!/usr/bin/env python3
"""Genere les images de marque de l'interface a partir de la mascotte source (512 px, fond transparent).

Usage : python3 scripts/brand/make-assets.py      (ecrit client/public/brand/* et client/public/favicon.png)
Pre-requis : pip install pillow numpy

La mascotte est rouge et orange avec un coeur gris ardoise. Ce gris disparait sur un fond sombre :
la variante "on-dark" l'eclaircit. Les PNG sont reduits a 64 couleurs (avec transparence) pour rester
sous 30 Ko, limite verifiee par server/test/repo-guards.test.js.
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, 'phoenix-mascot-source.png')
PUBLIC = os.path.normpath(os.path.join(HERE, '..', '..', 'client', 'public'))
HUB_ON_DARK = (226, 232, 240)   # #E2E8F0 : remplace l'ardoise du coeur sur fond sombre


def square(img):
    """Recadre sur le dessin et le centre dans un carre avec une petite marge."""
    img = img.crop(img.getchannel('A').getbbox())
    side = int(max(img.size) * 1.06)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return out


def on_dark(img):
    """Eclaircit les pixels ardoise (coeur et rayons) pour qu'ils restent visibles sur fond sombre."""
    a = np.asarray(img).copy()
    slate = (a[..., :3].max(axis=2) < 110) & (a[..., 3] > 0)
    a[slate, :3] = HUB_ON_DARK
    return Image.fromarray(a, 'RGBA')


def save(img, size, path, colors=64):
    img = img.resize((size, size), Image.LANCZOS)
    img = img.quantize(colors, method=Image.FASTOCTREE, dither=Image.NONE).convert('RGBA')
    img.save(path, optimize=True)
    print(f'{os.path.relpath(path, PUBLIC):28} {size}px {os.path.getsize(path):>6} octets')


if __name__ == '__main__':
    sq = square(Image.open(SOURCE).convert('RGBA'))
    dark = on_dark(sq)
    out = os.path.join(PUBLIC, 'brand')
    os.makedirs(out, exist_ok=True)
    save(dark, 96, os.path.join(out, 'phoenix-mark-header.png'))         # en-tete (fond sombre), affiche a ~32 px
    save(sq, 256, os.path.join(out, 'phoenix-logo.png'))                 # connexion, chargement, README (theme clair)
    save(dark, 256, os.path.join(out, 'phoenix-logo-on-dark.png'))       # connexion, chargement (theme sombre)
    save(sq, 64, os.path.join(PUBLIC, 'favicon.png'))                    # onglet
