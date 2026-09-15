"""Create sampled contact sheets from rendered manual pages for visual QA."""

from pathlib import Path
from PIL import Image, ImageDraw


def build(source: Path, output: Path, sample_count: int = 30) -> None:
    pages = sorted(source.glob("page-*.png"))
    indexes = sorted({round(i * (len(pages) - 1) / (sample_count - 1)) for i in range(sample_count)})
    selected = [pages[i] for i in indexes]
    cell_w, cell_h = 260, 370
    sheet = Image.new("RGB", (cell_w * 5, cell_h * 6), "#d9e2ec")
    draw = ImageDraw.Draw(sheet)
    for slot, path in enumerate(selected):
        with Image.open(path) as opened:
            page = opened.convert("RGB")
        page.thumbnail((cell_w - 12, cell_h - 24))
        x = (slot % 5) * cell_w + (cell_w - page.width) // 2
        y = (slot // 5) * cell_h + 18
        sheet.paste(page, (x, y))
        draw.text((slot % 5 * cell_w + 6, slot // 5 * cell_h + 3), path.stem, fill="#0f172a")
    sheet.save(output)


build(Path("output/manual-review-v2/user"), Path("output/manual-review-v2/user-contact-sheet.png"))
build(Path("output/manual-review-v2/setup"), Path("output/manual-review-v2/setup-contact-sheet.png"))

