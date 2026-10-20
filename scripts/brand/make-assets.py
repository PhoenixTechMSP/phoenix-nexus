#!/usr/bin/env python3
"""Genere les images de marque de l'interface a partir du logo source.

Usage : python3 scripts/brand/make-assets.py            (ecrit client/public/brand/*)
        python3 scripts/brand/make-assets.py --sheet F  (planche d'essai des epaisseurs, pour choisir)

Pourquoi un script plutot qu'un simple redimensionnement : le logo est un trait fin (~12 px sur
~760). Reduit a la taille d'un en-tete il devient un filet de 0,5 px presque invisible. On epaissit
donc le trait pour les petites tailles (dilatation en disque, trait cible en pixels de sortie) et on
produit deux couleurs : le rouge de marque sur fond clair, une variante plus claire sur fond sombre
(le rouge de marque n'atteint que 2,7:1 sur l'en-tete, sous le minimum de 3:1 des graphiques).
Pre-requis : pip install pillow scipy numpy
"""
import argparse, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, 'phoenix-logo-source.png')
OUT = os.path.join(HERE, '..', '..', 'client', 'public', 'brand')

BRAND_RED = (192, 0, 0)        # #C00000, fonds clairs
ON_DARK_RED = (229, 72, 77)    # #E5484D, fonds sombres (>= 4,4:1 sur #0f172a, #17171a, #1b1b1e)
SOURCE_STROKE = 12.0           # epaisseur mesuree du trait dans l'image source, en pixels


def load_square():
    """Alpha du logo, recadre sur le dessin, centre dans un carre avec une petite marge."""
    a = np.asarray(Image.open(SOURCE).convert('RGBA').getchannel('A'), dtype=np.float32) / 255.0
    ys, xs = np.where(a > 0.05)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = a.shape
    side = int(max(h, w) * 1.04)
    out = np.zeros((side, side), dtype=np.float32)
    oy, ox = (side - h) // 2, (side - w) // 2
    out[oy:oy + h, ox:ox + w] = a
    return out


def render(size, stroke_px, color, square=None):
    """Logo `size` x `size` px (RGBA), trait d'au moins `stroke_px` pixels de sortie (0 = naturel)."""
    a = load_square() if square is None else square
    scale = size / a.shape[0]
    wanted = stroke_px / scale                    # epaisseur necessaire dans l'image source
    r = max(0.0, (wanted - SOURCE_STROKE) / 2.0)  # rayon de dilatation
    if r > 0.5:
        n = int(np.ceil(r))
        yy, xx = np.ogrid[-n:n + 1, -n:n + 1]
        disk = (xx * xx + yy * yy) <= r * r
        a = ndimage.grey_dilation(a, footprint=disk)
    # On redimensionne l'alpha SEUL puis on applique la couleur : pas de liseré sombre sur les bords.
    alpha = Image.fromarray((a * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    img = Image.new('RGBA', (size, size), color + (255,))
    img.putalpha(alpha)
    return img


# nom de fichier -> (taille px, trait px, couleur). Tailles = 2x a 3x l'affichage CSS (ecrans HiDPI).
ASSETS = {
    'phoenix-mark-header.png': (96, 3.0, ON_DARK_RED),     # en-tete, affiche a ~32 px
    'phoenix-logo.png':        (256, 0, BRAND_RED),        # connexion (theme clair) + README
    'phoenix-logo-on-dark.png': (256, 0, ON_DARK_RED),     # connexion (theme sombre)
}
FAVICON = ('../favicon.png', (64, 4.0, ON_DARK_RED))       # onglet : lisible sur onglet clair ET sombre


def sheet(path):
    """Planche d'essai : plusieurs epaisseurs, sur les fonds reels, a taille reelle et agrandie x4."""
    sq = load_square()
    bgs = [('#0f172a', 'en-tete'), ('#17171a', 'en-tete sombre'), ('#ffffff', 'carte claire')]
    variants = [(80, 0), (80, 1.6), (80, 2.4), (80, 3.2), (32, 0), (32, 2.4), (32, 3.6), (32, 4.8)]
    W, H, pad = 2 * 130, 130, 10
    img = Image.new('RGB', (len(variants) * (W + pad) + pad, len(bgs) * (H + pad) + pad), '#888888')
    for j, (bg, _) in enumerate(bgs):
        for i, (size, stroke) in enumerate(variants):
            color = BRAND_RED if bg == '#ffffff' else ON_DARK_RED
            logo = render(size, stroke, color, sq)
            cell = Image.new('RGB', (W, H), bg)
            cell.paste(logo, (8, (H - size) // 2), logo)                                        # taille reelle
            big = logo.resize((96, 96), Image.NEAREST if size == 32 else Image.LANCZOS)
            cell.paste(big, (W - 104, (H - 96) // 2), big)                                      # agrandi
            img.paste(cell, (pad + i * (W + pad), pad + j * (H + pad)))
    img.save(path)
    print('planche :', path, '| colonnes =', variants)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', help='ecrit une planche d\'essai a ce chemin au lieu des assets')
    args = ap.parse_args()
    if args.sheet:
        sheet(args.sheet); sys.exit(0)
    os.makedirs(OUT, exist_ok=True)
    for name, (size, stroke, color) in ASSETS.items():
        p = os.path.join(OUT, name); render(size, stroke, color).save(p, optimize=True)
        print(f'{name:28} {size}px trait>={stroke} {os.path.getsize(p):>6} octets')
    name, (size, stroke, color) = FAVICON
    p = os.path.normpath(os.path.join(OUT, name)); render(size, stroke, color).save(p, optimize=True)
    print(f'{"favicon.png":28} {size}px trait>={stroke} {os.path.getsize(p):>6} octets')
