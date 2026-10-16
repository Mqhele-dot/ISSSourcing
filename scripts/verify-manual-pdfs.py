"""Automated structural checks for the generated manuals."""

from pathlib import Path
import re

from pypdf import PdfReader


for pdf in (
    Path("output/pdf/ISSSourcing_User_Manual.pdf"),
    Path("output/pdf/ISSSourcing_Setup_and_Administration_Manual.pdf"),
):
    reader = PdfReader(str(pdf))
    texts = [(page.extract_text() or "") for page in reader.pages]
    blank = [index + 1 for index, text in enumerate(texts) if len(re.sub(r"\s+", "", text)) < 15]
    image_count = sum(len(getattr(page, "images", [])) for page in reader.pages)
    joined = " ".join(texts)
    mojibake = sum(joined.count(token) for token in ("â€”", "â€¦", "ï¿½"))
    print(
        pdf.name,
        f"pages={len(reader.pages)}",
        f"blank_pages={blank}",
        f"images={image_count}",
        f"operating_contracts={joined.count('Required details / prerequisites')}",
        f"live_screens={joined.count('Live application screenshot')}",
        f"mojibake={mojibake}",
    )

