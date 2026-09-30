#!/usr/bin/env python3
"""Tekent de Notitieboekje-iconen, de favicon en het deelkaartje (OG-afbeelding).

Een klein geel reportersblokje met een spiraal bovenaan, getekend in code
(Pillow), op 4x groot en daarna verkleind voor zachte randen.
Draai: python3 tools/gen_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
SS = 4  # supersampling

INKT_BG = (36, 50, 77)          # achtergrond van het icoon (donker inktblauw)
GEEL = (255, 232, 110)          # blokje (iets feller dan in de app, voor een klein icoon)
GEEL_RAND = (226, 196, 70)
STAPEL = (238, 214, 96)
KARTON = (156, 132, 87)
LIJN = (92, 132, 178)
MARGE = (208, 72, 72)
DRAAD_LICHT = (240, 243, 246)
DRAAD_DONKER = (92, 97, 103)
GAT = (52, 42, 24)
BUREAU = (216, 210, 198)
TEKST = (29, 41, 64)
GEDEMPT = (92, 84, 60)


def font(size, bold=False):
    for p in (
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def blokje(w, h, lijnen=True, schaduw=True):
    """Geeft een RGBA-afbeelding van het blokje (breedte w, hoogte h, al supersampled)."""
    marge_boven = int(w * 0.09)      # ruimte voor de spiraal boven het papier
    stapel = max(2, int(w * 0.035))
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = 0, marge_boven, w - 1, h - 1 - stapel
    r = int(w * 0.035)
    # karton en stapel onderaan
    d.rounded_rectangle([x0, y0 + stapel, x1, y1 + stapel], r, fill=KARTON)
    d.rounded_rectangle([x0, y0 + stapel // 2, x1, y1 + stapel // 2], r, fill=STAPEL)
    # het bovenste blaadje
    d.rounded_rectangle([x0, y0, x1, y1], r, fill=GEEL, outline=GEEL_RAND, width=max(1, w // 110))
    if lijnen:
        kop = y0 + int((y1 - y0) * 0.22)
        dl = max(2, w // 120)
        d.line([(x0 + 2, kop), (x1 - 2, kop)], fill=MARGE, width=dl)
        d.line([(x0 + 2, kop + dl * 2), (x1 - 2, kop + dl * 2)], fill=MARGE, width=dl)
        stap = (y1 - kop) / 6.2
        y = kop + stap
        while y < y1 - stap * 0.5:
            d.line([(x0 + 2, int(y)), (x1 - 2, int(y))], fill=LIJN, width=max(1, w // 150))
            y += stap
        # een paar "geschreven" regels in inkt
        ink_w = max(2, w // 60)
        for i, frac in enumerate((0.62, 0.48, 0.7)):
            yy = int(kop + stap * (i + 1) - ink_w * 1.6)
            d.rounded_rectangle([x0 + int(w * 0.12), yy - ink_w, x0 + int(w * (0.12 + frac * 0.75)), yy + ink_w // 2], ink_w, fill=(40, 58, 96))
    # gaatjes en spiraal
    n = 7
    stap_x = (w - 2 * int(w * 0.1)) / (n - 1)
    gat_w = max(3, int(w * 0.055))
    for i in range(n):
        cx = int(w * 0.1 + i * stap_x)
        gy = y0 + int(w * 0.045)
        d.rounded_rectangle([cx - gat_w // 2, gy - gat_w // 2, cx + gat_w // 2, gy + gat_w // 2], gat_w // 2, fill=GAT)
        dw = max(2, int(w * 0.03))
        top = int(w * 0.018)
        kruin = (cx + int(gat_w * 0.35), top + dw // 2)
        # achterste draad: van de kruin naar achter het papier (donker)
        d.line([kruin, (cx + int(gat_w * 0.95), top + int(gat_w * 0.6)), (cx + int(gat_w * 0.9), y0)], fill=DRAAD_DONKER, width=dw, joint='curve')
        # voorste draad: uit het gaatje omhoog en over de rand (licht, met donkere rand)
        voor = [(cx, gy), (cx - int(gat_w * 0.3), top + int(gat_w * 0.7)), kruin]
        d.line(voor, fill=DRAAD_DONKER, width=dw + max(2, dw // 2), joint='curve')
        d.line(voor, fill=DRAAD_LICHT, width=dw, joint='curve')
        for x, y in (voor[0], kruin):
            rr = dw // 2
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=DRAAD_LICHT)
    if schaduw:
        sch = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(sch).rounded_rectangle([int(w * 0.03), y0 + int(w * 0.06), w - int(w * 0.03), h - 1], r, fill=(0, 0, 0, 110))
        sch = sch.filter(ImageFilter.GaussianBlur(w * 0.03))
        sch.alpha_composite(img)
        img = sch
    return img


def icoon(maat, vierkant=False, veilig=0.0, achtergrond=INKT_BG):
    S = maat * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if vierkant:
        d.rectangle([0, 0, S, S], fill=achtergrond)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], int(S * 0.22), fill=achtergrond)
    # blokje: portret, ~1:1.35, binnen de veilige zone
    beschikbaar = S * (1 - 2 * veilig)
    bh = int(beschikbaar * 0.80)
    bw = int(bh * 0.72)
    b = blokje(bw, bh)
    b = b.rotate(-5, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(b, ((S - b.width) // 2, (S - b.height) // 2 + int(S * 0.01)))
    return img.resize((maat, maat), Image.LANCZOS)


def og():
    W, H = 1200, 630
    S = SS // 2
    img = Image.new('RGBA', (W * S, H * S), BUREAU + (255,))
    # zachte lichtvlek op het bureau
    masker = Image.new('L', img.size, 0)
    ImageDraw.Draw(masker).ellipse([-200 * S, -300 * S, 900 * S, 900 * S], fill=255)
    masker = masker.filter(ImageFilter.GaussianBlur(120 * S))
    img.paste(Image.new('RGBA', img.size, (236, 231, 222, 255)), (0, 0), masker)
    b = blokje(300 * S, 440 * S)
    b = b.rotate(-4, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(b, (110 * S, (H * S - b.height) // 2 + 6 * S))
    img = img.resize((W, H), Image.LANCZOS).convert('RGB')
    d = ImageDraw.Draw(img)
    d.text((500, 210), 'Notitieboekje', font=font(78, bold=True), fill=TEKST)
    d.text((504, 318), 'A little yellow notebook.', font=font(38), fill=TEKST)
    d.text((504, 370), 'Everything stays on your device.', font=font(38), fill=GEDEMPT)
    d.text((504, 470), 'notitieboekje.vanali.workers.dev', font=font(28, bold=True), fill=(40, 70, 130))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    for maat in (192, 512):
        icoon(maat, veilig=0.08).save(os.path.join(OUT, f'icon-{maat}.png'), optimize=True)
        # maskable: tot in de hoeken gevuld, blokje binnen de veilige zone (middelste 80%)
        icoon(maat, vierkant=True, veilig=0.14).convert('RGB').save(os.path.join(OUT, f'icon-maskable-{maat}.png'), optimize=True)
    # apple-touch: vierkant zonder transparantie (iOS rondt zelf af)
    icoon(180, vierkant=True, veilig=0.1).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    icoon(64, veilig=0.0).save(os.path.join(OUT, 'favicon.png'), optimize=True)
    og().save(os.path.join(OUT, 'og.png'), optimize=True)
    for n in ('icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.png', 'og.png'):
        print(' ', n, os.path.getsize(os.path.join(OUT, n)), 'bytes')


if __name__ == '__main__':
    main()
