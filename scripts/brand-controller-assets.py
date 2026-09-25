"""Gera versões No Lost Media das fotografias de controles.

O script preserva os originais e substitui a marca dentro dos pixels da foto,
sem usar placas ou elementos HTML sobrepostos.
"""

from __future__ import annotations

from pathlib import Path
from random import Random

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps" / "launcher" / "public" / "controllers"
FONT_BOLD = Path("C:/Windows/Fonts/arialbd.ttf")
FONT_BOLD_ITALIC = Path("C:/Windows/Fonts/arialbi.ttf")
FONT_REGULAR = Path("C:/Windows/Fonts/arial.ttf")


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def fill_surface(image: Image.Image, box: tuple[int, int, int, int], blur: float = 4.0) -> None:
    """Reconstrói uma área usando as cores das quatro bordas e a textura local."""
    left, top, right, bottom = box
    pixels = image.load()
    region = image.crop((max(0, left - 12), max(0, top - 12), min(image.width, right + 12), min(image.height, bottom + 12)))
    stat = ImageStat.Stat(region.convert("RGB"))
    noise = max(0.7, min(4.0, sum(stat.stddev) / 16))
    rng = Random(sum(box))
    patch = Image.new("RGB", (right - left, bottom - top))
    target = patch.load()
    for y in range(bottom - top):
        fy = y / max(1, bottom - top - 1)
        for x in range(right - left):
            fx = x / max(1, right - left - 1)
            edge_left = pixels[max(0, left - 2), min(image.height - 1, top + y)][:3]
            edge_right = pixels[min(image.width - 1, right + 1), min(image.height - 1, top + y)][:3]
            edge_top = pixels[min(image.width - 1, left + x), max(0, top - 2)][:3]
            edge_bottom = pixels[min(image.width - 1, left + x), min(image.height - 1, bottom + 1)][:3]
            horizontal = tuple(edge_left[i] * (1 - fx) + edge_right[i] * fx for i in range(3))
            vertical = tuple(edge_top[i] * (1 - fy) + edge_bottom[i] * fy for i in range(3))
            weight = abs(fx - .5) / .5
            color = [horizontal[i] * (1 - weight * .35) + vertical[i] * (weight * .35) for i in range(3)]
            target[x, y] = tuple(max(0, min(255, round(value + rng.uniform(-noise, noise)))) for value in color)
    patch = patch.filter(ImageFilter.GaussianBlur(blur))
    image.paste(patch, (left, top))


def centered_text(
    image: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    font_path: Path,
    fill: tuple[int, int, int],
    max_size: int,
    stroke: tuple[int, int, int] | None = None,
    spacing: int = 0,
) -> None:
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = box
    size = max_size
    while size > 7:
        current = font(font_path, size)
        bounds = draw.textbbox((0, 0), text, font=current, stroke_width=1 if stroke else 0)
        if bounds[2] - bounds[0] <= right - left - 4 and bounds[3] - bounds[1] <= bottom - top - 2:
            break
        size -= 1
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    position = ((left + right - width) / 2 - bounds[0] + spacing, (top + bottom - height) / 2 - bounds[1])
    draw.text(position, text, font=current, fill=fill, stroke_width=1 if stroke else 0, stroke_fill=stroke)


def engraved_text(image: Image.Image, box: tuple[int, int, int, int], text: str, dark: tuple[int, int, int], light: tuple[int, int, int]) -> None:
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = box
    size = min(34, max(10, int((bottom - top) * .62)))
    current = font(FONT_BOLD, size)
    while draw.textbbox((0, 0), text, font=current)[2] > right - left - 4 and size > 7:
        size -= 1
        current = font(FONT_BOLD, size)
    bounds = draw.textbbox((0, 0), text, font=current)
    x = (left + right - (bounds[2] - bounds[0])) / 2
    y = (top + bottom - (bounds[3] - bounds[1])) / 2 - bounds[1]
    draw.text((x + 1, y + 1), text, font=current, fill=light)
    draw.text((x, y), text, font=current, fill=dark)


def save(image: Image.Image, name: str) -> None:
    destination = ASSETS / name
    if destination.suffix.lower() == ".png":
        image.save(destination, optimize=True)
    else:
        image.save(destination, quality=94, subsampling=0, optimize=True)


def brand_gba() -> None:
    image = Image.open(ASSETS / "gba.png").convert("RGB")
    # Tela: remove GAME BOY e Nintendo preservando o gradiente azul original.
    fill_surface(image, (225, 145, 488, 258), blur=1.5)
    draw = ImageDraw.Draw(image)
    words = [("NO", (241, 73, 40)), ("LOST", (245, 190, 45)), ("MEDIA", (42, 185, 135))]
    current = font(FONT_BOLD_ITALIC, 31)
    widths = [draw.textbbox((0, 0), word, font=current)[2] for word, _ in words]
    gap = 5
    x = (image.width - (sum(widths) + gap * 2)) / 2
    for (word, color), width in zip(words, widths):
        draw.text((x, 164), word, font=current, fill=color, stroke_width=1, stroke_fill=(34, 83, 115))
        x += width + gap
    centered_text(image, (250, 211, 463, 244), "PRESERVATION", FONT_BOLD, (8, 15, 22), 18)
    # Marca em baixo relevo na carcaça superior.
    fill_surface(image, (300, 45, 414, 70), blur=2)
    engraved_text(image, (301, 47, 413, 68), "NO LOST MEDIA", (43, 42, 91), (127, 120, 195))
    # Wordmark inferior no mesmo espaço do logotipo original.
    fill_surface(image, (260, 313, 456, 345), blur=2)
    centered_text(image, (263, 315, 453, 343), "NO LOST MEDIA", FONT_BOLD_ITALIC, (238, 238, 245), 21, (39, 37, 70))
    save(image, "gba-nlm.png")


def brand_ps1() -> None:
    image = Image.open(ASSETS / "ps1.png").convert("RGB")
    fill_surface(image, (510, 454, 710, 514), blur=3)
    centered_text(image, (515, 457, 705, 511), "NO LOST MEDIA", FONT_BOLD, (104, 105, 116), 31)
    save(image, "ps1-nlm.png")


def brand_simple(source: str, destination: str, box: tuple[int, int, int, int], fill: tuple[int, int, int], max_size: int, style: str = "flat") -> None:
    image = Image.open(ASSETS / source).convert("RGB")
    fill_surface(image, box, blur=3)
    if style == "engraved":
        engraved_text(image, box, "NO LOST MEDIA", fill, tuple(min(255, value + 48) for value in fill))
    else:
        centered_text(image, box, "NO LOST MEDIA", FONT_BOLD_ITALIC, fill, max_size)
    save(image, destination)


def main() -> None:
    brand_gba()
    brand_ps1()
    brand_simple("n64.jpg", "n64-nlm.jpg", (650, 92, 875, 170), (94, 96, 101), 30, "engraved")
    brand_simple("nes.jpg", "nes-nlm.jpg", (800, 390, 1055, 490), (235, 54, 48), 38)
    brand_simple("snes.jpg", "snes-nlm.jpg", (470, 155, 820, 270), (145, 145, 145), 38)
    brand_simple("dreamcast.jpg", "dreamcast-nlm.jpg", (655, 88, 890, 225), (210, 71, 33), 34)
    brand_simple("ps2.jpg", "ps2-nlm.jpg", (610, 178, 865, 275), (145, 150, 158), 35)
    brand_simple("gamecube.jpg", "gamecube-nlm.jpg", (670, 65, 965, 185), (245, 245, 245), 37)
    brand_simple("wii.jpg", "wii-nlm.jpg", (780, 745, 980, 845), (170, 173, 178), 32)


if __name__ == "__main__":
    main()
