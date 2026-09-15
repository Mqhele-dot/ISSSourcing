from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image as RLImage,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from PIL import Image as PILImage, ImageDraw, ImageFont

from manual_detailed_content import ROUTE_INDEX, SETUP_MODULES, STATUS_MATRIX, USER_MODULES
from manual_visual_content import (
    GLOBAL_BUTTONS,
    GLOBAL_SHORTCUTS,
    SETUP_SCREEN_GUIDE,
    USER_SCREEN_GUIDE,
)
from manual_function_catalog import ALL_FUNCTIONS, PURCHASE_ORDER_FUNCTIONS, INVENTORY_FUNCTIONS, TAB_FUNCTIONS


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "pdf"
OUT_DIR.mkdir(parents=True, exist_ok=True)
ANNOTATED_DIR = ROOT / "output" / "manual-assets" / "annotated"
ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)

TEAL = colors.HexColor("#14B8A6")
TEAL_DARK = colors.HexColor("#0F766E")
NAVY = colors.HexColor("#0F172A")
SLATE = colors.HexColor("#475569")
MUTED = colors.HexColor("#F1F5F9")
BORDER = colors.HexColor("#CBD5E1")
AMBER = colors.HexColor("#F59E0B")
RED = colors.HexColor("#DC2626")
WHITE = colors.white


def register_fonts() -> tuple[str, str]:
    candidates = [
        (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
        (Path("C:/Windows/Fonts/calibri.ttf"), Path("C:/Windows/Fonts/calibrib.ttf")),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("ManualRegular", str(regular)))
            pdfmetrics.registerFont(TTFont("ManualBold", str(bold)))
            return "ManualRegular", "ManualBold"
    return "Helvetica", "Helvetica-Bold"


FONT, FONT_BOLD = register_fonts()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="ManualTitle", fontName=FONT_BOLD, fontSize=30, leading=34, textColor=WHITE, alignment=TA_LEFT, spaceAfter=6))
styles.add(ParagraphStyle(name="ManualSubtitle", fontName=FONT, fontSize=13, leading=18, textColor=colors.HexColor("#CCFBF1"), spaceAfter=8))
styles.add(ParagraphStyle(name="H1x", fontName=FONT_BOLD, fontSize=22, leading=27, textColor=NAVY, spaceBefore=4, spaceAfter=10))
styles.add(ParagraphStyle(name="H2x", fontName=FONT_BOLD, fontSize=15, leading=19, textColor=TEAL_DARK, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="H3x", fontName=FONT_BOLD, fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=7, spaceAfter=4))
styles.add(ParagraphStyle(name="Bodyx", fontName=FONT, fontSize=9.5, leading=14, textColor=NAVY, spaceAfter=6))
styles.add(ParagraphStyle(name="Smallx", fontName=FONT, fontSize=8, leading=11, textColor=SLATE, spaceAfter=4))
styles.add(ParagraphStyle(name="Bulletx", fontName=FONT, fontSize=9.3, leading=13.5, textColor=NAVY, leftIndent=13, firstLineIndent=-8, bulletIndent=3, spaceAfter=3))
styles.add(ParagraphStyle(name="StepNum", fontName=FONT_BOLD, fontSize=10, leading=14, textColor=WHITE, alignment=TA_CENTER))
styles.add(ParagraphStyle(name="CalloutTitle", fontName=FONT_BOLD, fontSize=9.5, leading=13, textColor=NAVY, spaceAfter=3))
styles.add(ParagraphStyle(name="CalloutBody", fontName=FONT, fontSize=8.8, leading=13, textColor=NAVY))
styles.add(ParagraphStyle(name="Route", fontName=FONT, fontSize=8, leading=10, textColor=TEAL_DARK))
styles.add(ParagraphStyle(name="TableHead", fontName=FONT_BOLD, fontSize=8, leading=10, textColor=WHITE))
styles.add(ParagraphStyle(name="TableCell", fontName=FONT, fontSize=7.5, leading=10, textColor=NAVY))
styles.add(ParagraphStyle(name="FunctionCell", fontName=FONT, fontSize=6.8, leading=9, textColor=NAVY))
styles.add(ParagraphStyle(name="Toc", fontName=FONT, fontSize=9.5, leading=14, textColor=NAVY, leftIndent=8, spaceAfter=2))


def esc(text: object) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class ManualDoc(BaseDocTemplate):
    def __init__(self, filename: Path, title: str, edition: str):
        self.manual_title = title
        self.edition = edition
        super().__init__(
            str(filename),
            pagesize=A4,
            leftMargin=17 * mm,
            rightMargin=17 * mm,
            topMargin=19 * mm,
            bottomMargin=17 * mm,
            title=title,
            author="ISSSourcing",
            subject="Application documentation",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="main", frames=[frame], onPage=self._page))

    def _page(self, canvas, doc):
        if doc.page == 1:
            return
        canvas.saveState()
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.4)
        canvas.line(17 * mm, A4[1] - 13 * mm, A4[0] - 17 * mm, A4[1] - 13 * mm)
        canvas.setFont(FONT_BOLD, 7.5)
        canvas.setFillColor(TEAL_DARK)
        canvas.drawString(17 * mm, A4[1] - 10 * mm, "ISSSOURCING")
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(SLATE)
        canvas.drawRightString(A4[0] - 17 * mm, A4[1] - 10 * mm, self.manual_title)
        canvas.line(17 * mm, 12 * mm, A4[0] - 17 * mm, 12 * mm)
        canvas.drawString(17 * mm, 8 * mm, self.edition)
        canvas.drawRightString(A4[0] - 17 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()


def P(text: str, style: str = "Bodyx") -> Paragraph:
    return Paragraph(text, styles[style])


def heading(text: str, level: int = 1) -> Paragraph:
    return P(esc(text), {1: "H1x", 2: "H2x", 3: "H3x"}[level])


def bullets(items: Iterable[str]) -> list[Paragraph]:
    return [Paragraph(f"- {esc(item)}", styles["Bulletx"]) for item in items]


def numbered_steps(items: Sequence[str]) -> list:
    out: list = []
    for index, item in enumerate(items, 1):
        bubble = Table([[P(str(index), "StepNum")]], colWidths=[7 * mm], rowHeights=[7 * mm])
        bubble.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), TEAL),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOX", (0, 0), (-1, -1), 0, TEAL),
        ]))
        row = Table([[bubble, P(esc(item), "Bodyx")]], colWidths=[10 * mm, 154 * mm])
        row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        out.append(row)
    return out


def callout(title: str, body: str, tone: str = "info") -> Table:
    accent = {"info": TEAL, "warn": AMBER, "danger": RED}.get(tone, TEAL)
    data = [[P(esc(title), "CalloutTitle")], [P(esc(body), "CalloutBody")]]
    table = Table(data, colWidths=[166 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), MUTED),
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("LINEBEFORE", (0, 0), (0, -1), 4, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def data_table(headers: Sequence[str], rows: Sequence[Sequence[str]], widths: Sequence[float] | None = None) -> Table:
    data = [[P(esc(cell), "TableHead") for cell in headers]]
    data.extend([[P(esc(cell), "TableCell") for cell in row] for row in rows])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL_DARK),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F8FAFC")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def cover(title: str, subtitle: str, audience: str, edition: str) -> list:
    hero = Table([
        [P("ISSSOURCING", "ManualSubtitle")],
        [P(esc(title), "ManualTitle")],
        [P(esc(subtitle), "ManualSubtitle")],
        [Spacer(1, 16 * mm)],
        [P(f"<b>Audience</b><br/>{esc(audience)}", "ManualSubtitle")],
        [P(f"<b>Edition</b><br/>{esc(edition)}", "ManualSubtitle")],
    ], colWidths=[176 * mm], rowHeights=[None, None, None, None, None, None])
    hero.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 16 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16 * mm),
        ("TOPPADDING", (0, 0), (-1, 0), 16 * mm),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 18 * mm),
    ]))
    return [Spacer(1, 12 * mm), hero, Spacer(1, 10 * mm), callout("Document purpose", "A practical, role-aware guide to using the current application safely and consistently. Screens and actions depend on organization configuration, enabled capabilities, and your effective permissions."), PageBreak()]


def toc(entries: Sequence[tuple[str, str]]) -> list:
    out = [heading("Contents"), P("Use the section names below together with the application route shown in each chapter.", "Smallx")]
    for number, title in entries:
        out.append(P(f"<b>{esc(number)}</b> &nbsp; {esc(title)}", "Toc"))
    out.append(PageBreak())
    return out


def route_line(path: str) -> Paragraph:
    return P(f"Route: {esc(path)}", "Route")


def _callout_points(entry: dict) -> list[tuple[int, float, float]]:
    if entry.get("callouts"):
        return list(entry["callouts"])
    if entry["key"] == "mobile-approvals":
        return [(1, .50, .10), (2, .50, .35), (3, .50, .62), (4, .50, .88)]
    return [(1, .07, .23), (2, .40, .035), (3, .72, .035), (4, .30, .19), (5, .87, .20), (6, .56, .56), (7, .965, .95)]


def annotate_screenshot(entry: dict) -> tuple[Path, float]:
    source = ROOT / entry["image"]
    destination = ANNOTATED_DIR / f"{entry['key']}-annotated.png"
    with PILImage.open(source) as opened:
        image = opened.convert("RGB")
    draw = ImageDraw.Draw(image)
    radius = max(16, int(image.width * .014))
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", radius + 5)
    except OSError:
        font = ImageFont.load_default()
    for number, x_ratio, y_ratio in _callout_points(entry):
        x = int(image.width * x_ratio)
        y = int(image.height * y_ratio)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(37, 99, 235), outline=(255, 255, 255), width=3)
        label = str(number)
        box = draw.textbbox((0, 0), label, font=font)
        draw.text((x - (box[2] - box[0]) / 2, y - (box[3] - box[1]) / 2 - 1), label, fill=(255, 255, 255), font=font)
    image.save(destination, "PNG", optimize=True)
    return destination, image.width / image.height


def illustrated_screen(entry: dict, number: int) -> list:
    annotated, ratio = annotate_screenshot(entry)
    max_width = 166 * mm
    max_height = 104 * mm
    width = max_width
    height = width / ratio
    if height > max_height:
        height = max_height
        width = height * ratio

    default_callouts = [
        ("1", "Left navigation: open a permitted workspace; visibility does not grant API permission."),
        ("2", "Global search: search permitted records and use keyboard navigation."),
        ("3", "Header commands: Jump to, environment context, theme, notifications, and user menu."),
        ("4", "Page identity: confirm breadcrumb, title, explanation, and Preview or setup state before acting."),
        ("5", "Primary actions: the highest-priority valid actions for the current page and lifecycle state."),
        ("6", "Workspace body: filters, cards, table, form, tabs, evidence, and valid next actions."),
        ("7", "Help & Tutorials: opens route-specific guidance without changing operational data."),
    ]
    if entry.get("callouts"):
        if entry["key"] == "sign-in":
            default_callouts = [
                ("1", "Local test-account choices. These are server-enabled development controls, not production identities."),
                ("2", "Local instant-admin button. Use only in an authorized local test environment."),
                ("3", "Remember-me control. Session duration remains subject to server policy."),
                ("4", "Password-recovery entry point. Reset secrets and codes must remain private."),
                ("5", "Sign In submits the entered credentials and starts the authenticated session."),
            ]
        else:
            default_callouts = [(str(index), f"Highlighted control area {index}; see the exact button directory on the next page.") for index, _, _ in entry["callouts"]]
    if entry["key"] == "mobile-approvals":
        default_callouts = [
            ("1", "Mobile page identity and queue scope."),
            ("2", "Approval request cards and evidence summary."),
            ("3", "Decision actions appear only for an authorized request and valid state."),
            ("4", "Mobile navigation and refresh controls."),
        ]
    return [
        heading(f"I.{number} {entry['title']}"),
        route_line(entry["route"]),
        P(esc(entry["purpose"])),
        RLImage(str(annotated), width=width, height=height, hAlign="CENTER"),
        Spacer(1, 3 * mm),
        heading("Numbered screen areas", 2),
        data_table(["No.", "What it means"], default_callouts, [12 * mm, 154 * mm]),
        PageBreak(),
        heading(f"I.{number} {entry['title']} - buttons and worked example"),
        route_line(entry["route"]),
        P("Use only buttons that are enabled for the current record and state. Read-only navigation controls open information; lifecycle controls can create, lock, approve, post, dispatch, or otherwise change business evidence."),
        heading("Every task button shown or used in this workspace", 2),
        data_table(["Button or control", "What happens"], entry["buttons"], [52 * mm, 114 * mm]),
        Spacer(1, 3 * mm),
        callout("Worked example", entry["example"]),
        Spacer(1, 3 * mm),
        callout("Verify before leaving", "Confirm the success or error message, the resulting lifecycle state, the activity/audit evidence, and every downstream page or document named in the worked example. A changed screen alone is not proof that the server committed the action.", "warn"),
        PageBreak(),
    ]


def append_visual_guide(story: list, entries: Sequence[dict], title: str) -> None:
    story.extend([
        heading(title),
        P("These are live screenshots from the local application at the date of this edition. Numbered markers identify stable interface regions. Exact records, counts, statuses, permissions, feature flags, and Preview labels can differ by organization."),
        callout("How to read the screenshots", "First confirm route and page identity, then find the numbered screen area, read the exact button directory, and finish the worked example by verifying its downstream effect."),
        PageBreak(),
    ])
    for index, entry in enumerate(entries, 1):
        story.extend(illustrated_screen(entry, index))


def append_button_shortcut_reference(story: list) -> None:
    story.extend([
        heading("Complete common button and shortcut reference"),
        P("This section covers controls that recur across the application. Workspace-specific lifecycle buttons are documented beneath each screenshot and again in the detailed module action tables. A control may be hidden or disabled when permission, prerequisites, selected records, approval limit, or lifecycle state do not permit it."),
        heading("Common buttons and controls", 2),
        data_table(["Visible label", "Exact purpose and caution"], GLOBAL_BUTTONS, [52 * mm, 114 * mm]),
        Spacer(1, 5 * mm),
        heading("Keyboard shortcuts", 2),
        data_table(["Key", "Behavior"], GLOBAL_SHORTCUTS, [42 * mm, 124 * mm]),
        Spacer(1, 5 * mm),
        callout("Keyboard safety", "Keep visible focus on the intended control. Enter and Space can perform a state-changing action when an enabled submit or decision button is focused. Review the button label and current record before activation.", "warn"),
        PageBreak(),
    ])


def function_contract(entry: dict, number: str) -> list:
    """Render one complete operating contract with the matching live screen."""
    image_path = ROOT / entry["image"]
    out: list = [
        heading(f"{number} {entry['title']}"),
        route_line(entry["location"]),
        P(esc(entry["definition"])),
    ]
    if image_path.exists():
        with PILImage.open(image_path) as opened:
            ratio = opened.width / opened.height
        max_width, max_height = 166 * mm, 68 * mm
        width = max_width
        height = width / ratio
        if height > max_height:
            height = max_height
            width = height * ratio
        out.extend([
            RLImage(str(image_path), width=width, height=height, hAlign="CENTER"),
            P("Live application screenshot. Records and counts are examples from the local tenant; the control contract below is authoritative for use.", "Smallx"),
        ])
    rows = [
        ("What it works from", entry["uses"]),
        ("Required details / prerequisites", entry["required"]),
        ("Optional details", entry["optional"]),
        ("What the action writes", entry["result"]),
        ("What else it impacts", entry["impacts"]),
        ("Permission / authority", entry["permission"]),
        ("Evidence retained", entry["evidence"]),
        ("Why it can fail or be disabled", entry["failures"]),
    ]
    data = [[P("Operating question", "TableHead"), P("Detailed answer", "TableHead")]]
    data.extend([[P(esc(a), "FunctionCell"), P(esc(b), "FunctionCell")] for a, b in rows])
    table = Table(data, colWidths=[42 * mm, 124 * mm], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL_DARK),
        ("GRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F8FAFC")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    out.extend([Spacer(1, 2 * mm), table, PageBreak()])
    return out


def append_function_contract_reference(story: list, entries: Sequence[dict], title: str, prefix: str) -> None:
    story.extend([
        heading(title),
        P("This is the function-level operating guide. Each illustrated entry states its authoritative inputs, mandatory and optional details, write behavior, cross-workspace effects, permission gate, audit evidence, and failure conditions. It therefore defines the function rather than merely translating its button label."),
        callout("How to prove a function worked", "A toast or changed screen is not enough. Confirm the resulting record state, linked downstream records, stock or monetary effect where applicable, document version, and audit/approval evidence listed for the function."),
        PageBreak(),
    ])
    for index, entry in enumerate(entries, 1):
        story.extend(function_contract(entry, f"{prefix}.{index}"))


def section(title: str, path: str | None, purpose: str, steps: Sequence[str], controls: Sequence[str], downstream: str, caution: str | None = None) -> list:
    out: list = [heading(title)]
    if path:
        out.append(route_line(path))
    out.extend([P(esc(purpose)), heading("How to use it", 2), *numbered_steps(steps), heading("Key controls and evidence", 2), *bullets(controls), heading("Downstream impact", 2), P(esc(downstream))])
    if caution:
        out.append(callout("Control point", caution, "warn"))
    out.append(PageBreak())
    return out


def detailed_module(number: str, module: dict) -> list:
    out: list = [
        heading(f"{number}. {module['title']}"),
        route_line(module["route"]),
        P(f"<b>Primary audience:</b> {esc(module['audience'])}"),
        P(esc(module["purpose"])),
        heading("Prerequisites", 2),
        *bullets(module["prerequisites"]),
        heading("Field and information dictionary", 2),
        data_table(["Field or control", "Meaning and use"], module["fields"], [45 * mm, 121 * mm]),
        Spacer(1, 4 * mm),
        heading("Available actions", 2),
        data_table(["Action", "Detailed behavior"], module["actions"], [40 * mm, 126 * mm]),
        Spacer(1, 4 * mm),
        heading("Lifecycle and page states", 2),
        data_table(["State", "Meaning"], module["states"], [42 * mm, 124 * mm]),
        Spacer(1, 4 * mm),
        heading("Validation and control rules", 2),
        *bullets(module["validation"]),
        heading("Evidence to retain", 2),
        *bullets(module["evidence"]),
        heading("Troubleshooting", 2),
        data_table(["Problem", "Resolution"], module["troubleshooting"], [48 * mm, 118 * mm]),
        PageBreak(),
    ]
    return out


def append_comprehensive_reference(story: list, modules: Sequence[dict], title: str, prefix: str) -> None:
    story.extend([
        heading(title),
        P("This reference expands the operating guide into field-level behavior, prerequisites, available actions, lifecycle states, validation rules, retained evidence, and troubleshooting. Where a capability is disabled or labelled Preview, follow the state shown by the application and do not infer production readiness."),
        callout("How to use this reference", "Find the workspace by route, complete every prerequisite, follow the field dictionary, execute only an available lifecycle action, then verify the retained evidence and downstream result."),
        PageBreak(),
    ])
    for index, module in enumerate(modules, 1):
        story.extend(detailed_module(f"{prefix}.{index}", module))


USER_TOC = [
    ("1", "Getting started and navigation"),
    ("2", "Operations and exception management"),
    ("3", "Inventory and warehouse execution"),
    ("4", "Procurement and blanket purchasing"),
    ("5", "Finance and accounts payable"),
    ("6", "Analytics, reports, and exports"),
    ("7", "Documents, audit, and approvals"),
    ("8", "Mobile workflows"),
    ("9", "End-to-end operating playbooks"),
    ("10", "Troubleshooting and glossary"),
]


def build_user_manual() -> Path:
    edition = "Edition 2.0 Exhaustive Illustrated - 15 September 2026"
    path = OUT_DIR / "ISSSourcing_User_Manual.pdf"
    story: list = []
    story += cover("Application User Manual", "Operations, inventory, procurement, finance, analytics, and controlled administration", "Business users, approvers, warehouse teams, buyers, finance teams, and administrators", edition)
    story += toc(USER_TOC)
    append_visual_guide(story, USER_SCREEN_GUIDE, "Illustrated application guide")
    append_button_shortcut_reference(story)
    append_function_contract_reference(story, PURCHASE_ORDER_FUNCTIONS, "Purchase Orders - complete function-by-function guide", "PO")
    append_function_contract_reference(story, INVENTORY_FUNCTIONS, "Inventory - create, transact, receive, adjust and return", "INV")
    append_function_contract_reference(story, TAB_FUNCTIONS, "Every internal tab - illustrated operating contracts", "TAB")

    story += [heading("1. Getting started and navigation"), P("ISSSourcing is a tenant-scoped supply-chain, inventory, procurement, finance, logistics, analytics, and governance application. The visible navigation is determined by the user's profile tabs; every server action is separately protected by effective permissions."), heading("Sign in", 2)]
    story += numbered_steps(["Open the application URL supplied by your administrator.", "Enter your username and password, then select Sign In.", "Confirm the header shows the correct organization context and user initials.", "If access is denied, ask an administrator to review Effective Access rather than merely making the tab visible."])
    story += [heading("Navigation conventions", 2)]
    story += bullets(["Use the left navigation for workspaces and the global search or Jump to control for direct access.", "Preview labels identify controlled-preview workspaces; open underlying records before making operational decisions.", "Status badges describe lifecycle state. Disabled actions usually indicate missing data, permission, approval, or an invalid state transition.", "Lists are paginated. Filters and totals are server-backed; changing page size does not change the underlying total.", "Use Get Educated and page tours for guided learning without changing operational records."])
    story += [callout("Permission model", "Seeing a tab does not grant permission to read or change its data. Profile visibility and API authorization are intentionally separate controls."), PageBreak()]

    story += section("2.1 Operations overview and Control Tower", "/operations and /operations/control-tower", "Use these pages to identify work that needs attention across inventory, procurement, logistics, fuel, AP, and exceptions.", ["Review ready, setup-required, degraded, and exception states.", "Select a KPI or attention card to open the authoritative queue.", "Resolve the underlying record in its owning workspace.", "Return and refresh to confirm the KPI changed."], ["KPI timestamp and current state", "Deep link to the source queue", "Loading, degraded, and retry states", "No write operations occur from a KPI read"], "The source queue updates first; dashboard totals update on the next refresh or invalidation.", "Do not treat dashboard counts as transaction evidence. Use the linked record, its documents, and activity history.")

    story += section("2.2 Logistics and shipments", "/operations/logistics", "Track tenant-owned inbound and outbound shipments with bounded filters, ETA risk, carrier, direction, source linkage, and delivery progress.", ["Filter by status, supplier, carrier, tracking, direction, or risk.", "Open the shipment detail and verify linked PO or inventory issue.", "Record permitted status changes and evidence.", "Resolve missing ETA, late delivery, or confirmation exceptions through the owning workflow."], ["Stable paginated list", "Carrier selected from governed supplier/carrier Master Data", "Shipment documents and delivery evidence", "Status and risk summaries"], "Shipment changes feed Control Tower, procurement confirmation/receiving, exceptions, and logistics analytics.", "Opening a list or detail page does not create an exception. Exceptions come from explicit reconciliation or operational changes.")

    story += section("2.3 Operational exceptions", "/operations/exceptions and /procurement/exceptions", "Use the exception queues to assign, investigate, comment on, and resolve current findings while retaining history.", ["Filter the list by severity, state, area, or type.", "Open one finding and review its incident summary, age, SLA, related records, and activity.", "Assign an owner or add a comment.", "Move the status only after the underlying cause is addressed."], ["Current versus retained history", "Area-scoped procurement queue", "Request and entity references", "Comments and lifecycle evidence"], "Resolved conditions update dashboards and source-module exception counts; history remains available for audit.", "Do not close an exception solely to improve a dashboard count.")

    story += section("2.4 Fuel operations", "/operations/fuel", "Manage configured stations, products, tanks, pumps, deliveries, pricing, reconciliation, and LP-gas compliance channels.", ["Complete station and product setup if the page reports setup required.", "Choose the correct station, tank, pump, or fuel product.", "Enter the authorized operational transaction.", "Review reconciliation and exception signals."], ["Setup-required is a valid state", "Fuel products come from governed Master Data", "Optional LP channels may be degraded independently", "Transactions remain organization scoped"], "Fuel movements and values feed inventory, operations analytics, exceptions, and accounting integration where enabled.", "A degraded optional LP channel must not be interpreted as failure of the canonical fuel workspace.")

    story += section("3.1 Inventory workspace", "/inventory", "Search and review inventory items, stock state, valuation, default warehouse, barcode or QR identity, and item-level details.", ["Search by SKU, name, or barcode.", "Open the item detail and distinguish master inventory from warehouse stock.", "Review movements, availability, replenishment, and item metadata.", "Use an authorized edit action to update item information; use Adjust only for controlled quantity corrections."], ["Every new item receives a barcode/QR identity", "Tenant-owned warehouse positions", "Unassigned stock is labelled separately", "All quantity mutations create stock-movement evidence"], "Item changes propagate to requisitions, POs, quotations, barcode workflows, analytics, and warehouse operations after their contexts refresh.", "Never select a display label as a warehouse identifier. A canonical warehouse must exist before warehouse adjustments are allowed.")

    story += section("3.2 Barcode scanner", "/inventory/barcodes", "Identify inventory items and execute controlled inbound or outbound scan flows.", ["Choose In for receiving/bringing stock in or Out for dispatching stock.", "Select the warehouse and scan or enter the barcode/QR code.", "Confirm the matched item and quantity.", "Submit the movement and review the resulting stock balance and movement record."], ["Item identity and warehouse are verified by the server", "Outbound checks current availability", "Inbound and outbound flows are explicit", "Commercial quotations can add catalog items by scan"], "Successful scans update canonical warehouse inventory, stock movements, item history, and dependent operational views.", "A scan identifies an item; it does not bypass approval, warehouse scope, or stock availability controls.")

    story += section("3.3 Warehouse operations, put-away, and cycle counts", "/inventory/warehouse-operations, /inventory/put-away, /inventory/cycle-counts", "Execute storage, allocation, put-away, count, and adjustment work against the canonical warehouse stock ledger.", ["Confirm the warehouse and any bin/location scope.", "Open the receipt, task, count program, or item that authorizes the work.", "Record accepted quantity, location, batch/serial evidence, or count result.", "Post and verify the resulting movement and exception state."], ["Item default, organization default, and count warehouse are labelled separately", "Posted receipts and counts are immutable evidence", "Corrections use reversals or compensating movements", "Mobile workflows use the active organization default warehouse"], "Receiving creates put-away work; posted counts update inventory and may create variance evidence; analytics reflect the canonical movement ledger.", "Do not edit a posted movement or receipt. Use the governed reversal or adjustment workflow.")

    story += section("3.4 Reorder requests", "/inventory/reorder", "Review demand-driven replenishment cues and convert valid demand into the controlled procurement flow.", ["Review low-stock or demand indicators and the recommended quantity.", "Confirm item, warehouse, supplier, and Master Data are current.", "Create or open the reorder request.", "Convert it to a requisition and complete the requisition approval flow."], ["Demand evidence remains linked", "Conversion creates a procurement record rather than a silent order", "Low-stock links use the canonical filter", "Server totals match rendered rows"], "Reorder conversion creates a requisition; approved demand can then become an RFQ, standard PO, or blanket agreement release.")

    story += section("4.1 Procurement overview", "/procurement/overview", "Monitor demand, approvals, sourcing, POs, supplier confirmation, receiving, AP matching, spend, and procurement exceptions from one bounded server snapshot.", ["Select the reporting period and available filters.", "Review each KPI and needs-attention table.", "Open the linked source queue.", "Complete the next valid action and return to confirm the impact."], ["Open requisitions and approvals", "RFQ, PO, confirmation, receipt, and exception counts", "Supplier spend and PO distribution", "Direct procurement exception links"], "Every overview card points to the owning workspace; no duplicate procurement record is created.")

    story += section("4.2 Purchase requisitions", "/procurement/requisitions", "Capture approved business demand with supplier, department, currency, FX, item/service lines, tax, UOM, cost centre, GL mapping, dates, and justification.", ["Select New Requisition.", "Choose the approved supplier, request currency, department, and required date.", "Add catalog, non-stock, or service lines and complete quantity, UOM, price, tax, cost centre, and GL mapping.", "Save the draft, review Master Data drift if shown, then submit for approval.", "After approval, convert to RFQ, standard PO, or an eligible blanket agreement release."], ["Create is disabled until mandatory references are valid", "Drafts can review and selectively refresh Master Data", "Submitted records are locked except permitted comments/attachments", "Approval and conversion activity are auditable"], "Approved requisitions create or transfer budget commitments and retain traceability through sourcing, PO, receipt, AP, and reporting.", "Submitted, approved, converted, cancelled, and closed records are snapshots. Do not expect later Master Data changes to rewrite them.")

    story += section("4.3 Sourcing and RFQs", "/procurement/sourcing", "Run competitive sourcing events, preview supplier emails, capture structured supplier responses, evaluate landed cost, and govern awards.", ["Create an event from approved demand or enter the authorized scope.", "Select eligible suppliers and preview the outbound RFQ email.", "Issue the event and monitor responses and deadline.", "Compare price, freight, lead time, MOQ, terms, compliance, risk, and reporting-currency totals.", "Record award justification and obtain independent approval before PO conversion."], ["Early closure requires an override reason", "Only submitted and unexpired quotes are award eligible", "Email preview does not send the message", "Award values remain linked to generated POs"], "Approved awards become PO commercial evidence and feed supplier performance and procurement analytics.")

    story += section("4.4 Supplier and commercial quotations", "/procurement/quotations and /procurement/commercial-quotations", "Supplier quotations record inbound supplier offers. Commercial quotations build branded offers for customers or one-off recipients using inventory, currencies, taxes, acceptance rules, and company identity.", ["Choose the correct quotation type.", "Select an onboarded supplier/customer where available or use the controlled non-onboarded recipient option.", "Add inventory items by selection or barcode scan, and add authorized non-stock/service lines.", "Review currency conversion, tax, validity, legal identity, addresses, and acceptance terms.", "Save, issue, accept, or reject through permitted lifecycle actions."], ["Company logo and address come from Company Setup", "Supplier/customer address is sourced from the canonical master when onboarded", "Accepted and rejected evidence is retained", "Changes use saved versions and audit events"], "Supplier quotations support sourcing and PO creation; commercial quotation acceptance can support downstream customer workflows where enabled.", "Do not overwrite accepted or rejected evidence. Use a new version or controlled correction.")

    story += section("4.5 Purchase orders and supplier confirmation", "/procurement/orders", "Create and manage commercial commitments using authoritative suppliers, items, contracts, payment terms, Incoterms, taxes, warehouses, carriers, currencies, and approval rules.", ["Create from an approved requisition, sourcing award, or approved blanket agreement release.", "Review pricing precedence, currency conversion, delivery, warehouse, tax, and terms.", "Submit for approval and send only when authorized.", "Monitor the append-only supplier confirmation state: Awaiting, Confirmed, Rejected, or Clarification Requested.", "Receive goods through the canonical receiving service."], ["Draft drift review is explicit", "Sent and approved POs are immutable snapshots", "Supplier responses do not overwrite commercial fields", "PDF and email documents use company and supplier identity"], "POs drive confirmations, shipments, receiving, inventory, AP matching, budget exposure, exceptions, and analytics.", "Use an amendment, cancellation, or linked correction; never edit a sent or received commitment in place.")

    story += section("4.6 Suppliers, contracts, and blanket agreements", "/procurement/suppliers and /procurement/contracts", "Maintain supplier identity, commercial defaults, compliance, carrier classification, contracts, framework agreements, price lines, releases, renewals, and activity.", ["Create or select the supplier and complete legal, address, contact, tax, and commercial details.", "For a carrier, enable the carrier category/capability instead of creating a second logistics-only identity.", "Create the agreement, add eligible catalog/non-stock/service lines and price breaks.", "Submit and independently approve the agreement.", "Create a release only from an eligible approved requisition; review value/quantity availability and approval evidence."], ["Agreement pricing precedes price lists, sourcing awards, and manual prices", "Approved versions are immutable", "Suspension, amendment, renewal, expiry, and closure are governed", "Release creation is transactional and idempotent"], "Supplier defaults populate new requisitions and POs; releases reserve agreement balances and create linked POs; performance and exceptions use the same supplier record.", "Inactive, expired, foreign-tenant, exhausted, or unapproved agreements cannot be used.")

    story += section("4.7 Receiving and returns", "/procurement/receiving", "Post canonical goods receipts, discrepancies, reversals, purchase returns, and supplier financial adjustments without creating a second inventory ledger.", ["Open a receivable PO and select the warehouse.", "Enter accepted and rejected quantities with reasons and traceability evidence.", "Post the receipt and verify its GRN, inventory movement, and PO progress.", "Use a reversal for an incorrect posted receipt.", "Create a governed purchase return from eligible accepted quantity and dispatch it after approval."], ["Historical supplier identity remains traceable", "PO remaining quantity is locked during posting", "Returns check current stock and batch/serial evidence", "Debit note or AP credit evidence remains linked"], "Receipts update inventory, PO progress, AP three-way match, supplier performance, exceptions, and analytics; returns create compensating stock and finance evidence.")

    story += section("5.1 General ledger and accounts receivable", "/finance/general-ledger and /finance/accounts-receivable", "Use enabled finance workspaces for chart of accounts, periods, journals, trial balance, customers, receivables, balances, and aging.", ["Confirm the capability is enabled for the organization.", "Choose the accounting period and dimensions.", "Review source references before posting or approving.", "Use reversals or credit notes for corrections."], ["Money uses fixed-precision decimal values", "Document and reporting currency snapshots are preserved", "Balanced entries and period controls apply", "Preview-labelled functions should not be treated as a complete statutory ledger"], "Finance records reconcile to AP, procurement, inventory, sales, projects, and analytics where their posting integration is enabled.", "Check the capability and preview labels before relying on a workspace for statutory reporting.")

    story += section("5.2 Accounts payable", "/finance/accounts-payable", "Process invoice intake, matching, approvals, exceptions, aging, payment batches, vouchers, and remittance advice.", ["Capture or import the supplier invoice and verify supplier, invoice number, dates, currency, and totals.", "Promote the capture and run three-way match against PO and receipt evidence.", "Resolve mismatches and submit for approval.", "Select eligible approved invoices across paginated pages and create a payment batch.", "Approve and release the batch under segregation-of-duties rules, then generate remittance evidence."], ["Invoices and batches use bounded v2 APIs", "Selections are revalidated atomically", "Creator self-approval/release is blocked unless a controlled override exists", "Voucher and remittance PDFs use company branding"], "AP status and totals feed finance analytics, procurement overview, supplier history, audit, notifications, and export reports.", "Payment-file export prepares approved instructions; it does not itself move funds.")

    story += section("5.3 Approval policies", "/finance/approval-policies", "Configure amount bands, approval levels, required system/custom roles, and specific approvers for governed entity types.", ["Choose the entity from the governed workflow catalog.", "Enter non-overlapping minimum and maximum amounts for the approval level.", "Select a valid active role and optional specific approver.", "Activate the policy and verify it in the visible policy chain."], ["System and custom roles use stable references", "Inactive roles cannot receive new assignments", "Overlapping active bands at the same level are conflicts", "Employee approval limits and policies share the workflow catalog"], "Policies determine valid approvers for requisitions, POs, contracts, releases, invoices, payment batches, adjustments, fuel changes, and other governed workflows.")

    story += section("6. Analytics, reports, and exports", "/analytics/overview, /analytics/reports, /analytics/saved-reports, /analytics/export-center", "Use charts, KPIs, bounded tables, saved definitions, and controlled export jobs to analyze operational and financial data.", ["Select the module, date range, and filters.", "Confirm the displayed currency, summary, and filtered total.", "Drill into source records where available.", "Preview the report before export.", "Choose only supported formats and monitor the export job in Export Center."], ["Preview and export use the same validated dataset query", "Filter fingerprints support reconciliation", "Failed retries create linked attempts without overwriting history", "Unsupported formats are hidden or rejected before queueing"], "Reports reflect source-module records and configured reporting-currency conversions; saved reports retain definitions, not frozen operational truth.", "Always record the reporting period and filters when sharing an export.")

    story += section("7.1 Documents and extraction", "/admin/documents and /admin/document-extractor", "Store document metadata and versions, verify file availability, reattach missing files, and preview extracted data before confirmed import.", ["Upload or locate the document and confirm its linked entity.", "Review active/archived metadata and available/missing file state separately.", "For extraction, choose Single File or Batch and upload an allowed format.", "Review extracted fields and column mappings.", "Confirm the import only after validation."], ["Single File accepts one file; Batch is capped at ten", "Allowed formats include PDF, XLSX, XLSM, CSV, JPEG, PNG, and TIFF within server limits", "Missing versions remain immutable history", "Replacement files create new versions"], "Documents attach to procurement, finance, logistics, audit, and other entity records without rewriting prior evidence.")

    story += section("7.2 Audit logs and workflow governance", "/admin/audit-logs and /admin/workflows", "Review who changed what, when, why, under which approval authority, and how governed workflows progressed.", ["Filter audit events by entity type, ID, actor, action, and date.", "Open the exact entity or workflow where available.", "Review approval level, decision, reason, before/after state, and request ID.", "Export the current filtered page when evidence must be shared."], ["Audit events are append-only and hash chained where supported", "Approval limits are managed in Employee Profiles", "Workflow catalog governs supported entity types", "Role permissions and visible tabs are displayed together but enforced separately"], "Audit evidence supports investigations, approval proof, document history, and diagnostics findings.", "Never delete or rewrite posted audit evidence to correct a business record.")

    story += section("8. Mobile workflows", "/operations/mobile-workflows and /m/*", "Use the mobile shell for focused frontline tasks such as counts, scanning, receiving, approvals, picking, and other enabled warehouse actions.", ["Open Mobile Workflows from a phone or the desktop launcher.", "Choose the assigned task and confirm the warehouse/site.", "Scan or enter the item, task, PO, or count identifier.", "Confirm quantities and evidence before posting.", "Review the success state and downstream record."], ["Mobile Home uses the standalone page heading", "Warehouse defaults remain organization scoped", "Explicit confirmation is required for sign-on-glass evidence", "Location evidence is collected only through a permitted user action"], "Mobile actions update the same canonical receiving, inventory, approval, and movement services as desktop.", "Do not use mobile actions as an offline substitute unless the page explicitly confirms supported offline behavior.")

    story += [heading("9. End-to-end operating playbooks")]
    playbooks = [
        ("Demand to payment", "Reorder or request -> Requisition -> Approval -> RFQ/award or agreement release -> PO -> Supplier confirmation -> Shipment -> Receipt -> AP match -> Invoice approval -> Payment batch -> Remittance."),
        ("Inventory issue to delivery", "Inventory issue draft -> readiness validation -> dispatch -> stock movement -> shipment link -> delivery note -> delivered or cancelled state."),
        ("Quotation to accepted offer", "Customer or one-off recipient -> inventory/non-stock/service lines -> currency and tax -> acceptance terms -> issue -> accept or reject -> immutable evidence and document."),
        ("Exception resolution", "Signal -> source record review -> owner assignment -> corrective action -> reconciliation -> resolved current finding -> retained history."),
        ("Master Data change", "Create/edit/deactivate -> dependency review -> context invalidation -> new forms receive current values -> draft drift review -> explicit refresh -> submitted records remain snapshots."),
    ]
    for title, flow in playbooks:
        story.append(KeepTogether([heading(title, 2), callout("Workflow", flow)]))
        story.append(Spacer(1, 3 * mm))
    story += [PageBreak(), heading("10. Troubleshooting and glossary"), heading("Common problems", 2)]
    story.append(data_table(["Symptom", "Likely cause", "Action"], [
        ["Button is disabled", "Missing mandatory data, permission, or invalid lifecycle state", "Read the readiness/blocker message; complete Master Data or ask an administrator to review Effective Access."],
        ["Data looks stale", "A draft or page context has not refreshed", "Use Refresh or Review Master Data changes; do not edit an approved snapshot."],
        ["Access denied", "API permission or tenant scope failed", "Confirm the selected organization and have an administrator inspect the role catalog and effective access."],
        ["Setup required", "A prerequisite master record is absent", "Follow the linked setup route and configure the missing warehouse, supplier, currency, product, policy, or provider."],
        ["Export failed", "Format preflight, worker, storage, or data error", "Open Export Center, review structured error/request ID, correct the issue, then create a linked retry."],
        ["Document unavailable", "Metadata exists but file storage is missing", "Retain history and attach a replacement as a new version."],
    ], [38*mm, 53*mm, 75*mm]))
    story += [heading("Glossary", 2)]
    story.append(data_table(["Term", "Meaning"], [
        ["Effective access", "The actual server-enforced permissions plus the user's visible navigation context."],
        ["Master Data", "Governed organization-owned reference data used by transactions and defaults."],
        ["Snapshot", "Values preserved on a submitted or completed document even after reference data changes."],
        ["Drift", "A difference between a draft's stored defaults and current Master Data."],
        ["GRN", "Goods receipt note and its accepted/rejected receipt evidence."],
        ["BPA", "Blanket purchase agreement used for controlled requisition-backed release orders."],
        ["Three-way match", "Comparison of PO, receipt, and supplier invoice evidence."],
        ["Tenant", "The organization boundary applied before data reads, counts, mutations, and downloads."],
        ["Idempotent", "Safe retry behavior that does not create a duplicate transaction."],
        ["Controlled preview", "A clearly labelled function that should not be treated as a complete live production workflow."],
    ], [35*mm, 131*mm]))
    story += [Spacer(1, 6 * mm), callout("Need more help?", "Open Get Educated for route-specific lessons and guided tours. For system health, use Admin > System Diagnostics and provide the request ID when escalating an error.")]

    story += [PageBreak()]
    append_comprehensive_reference(story, USER_MODULES, "Part II - Comprehensive workspace reference", "R")
    story += [
        heading("Appendix A - Cross-module lifecycle matrix"),
        P("Use this matrix as a quick control reference. Exact available actions remain subject to the entity, feature flag, permissions, organization policy, amount, and current state."),
        data_table(["Entity", "State", "Operational meaning"], STATUS_MATRIX, [35 * mm, 55 * mm, 76 * mm]),
        PageBreak(),
        heading("Appendix B - Canonical route index"),
        P("Routes are listed for direct navigation and support conversations. Detail pages add a stable record identifier to the listed base route."),
        data_table(["Workspace", "Route"], ROUTE_INDEX, [70 * mm, 96 * mm]),
        PageBreak(),
        heading("Appendix C - Required evidence before an action is complete"),
        data_table(["Action class", "Minimum evidence"], [
            ["Master Data change", "Actor, organization, before/after, revision, dependency review, approval where configured, invalidation result."],
            ["Approval", "Entity, amount/currency, level, policy, role/user authority, limit, SoD result, decision, reason, timestamp."],
            ["Stock mutation", "Item, warehouse/bin, quantity, direction, source/reason, availability, movement ID, actor/time."],
            ["Document issue", "Entity/version, both-party identity/address as applicable, totals/currency/tax, validity, file checksum/size, actor/time."],
            ["Receipt/return", "PO/GRN/line, accepted/rejected/returned quantity, warehouse, discrepancy reason, traceability, movement, reversal/financial link."],
            ["Payment release", "Invoice eligibility, batch items/count/total, approval chain, separate releaser, payment-file/remittance evidence."],
            ["Exception resolution", "Finding code/entity, root cause, owner, corrective action, reconciliation result, resolved/superseded state."],
            ["Export", "Dataset, normalized filters, fingerprint, total/summary, format, job ID/status, filename or error/request ID."],
        ], [43 * mm, 123 * mm]),
    ]

    ManualDoc(path, "Application User Manual", edition).build(story)
    return path


SETUP_TOC = [
    ("1", "Setup sequence and responsibilities"),
    ("2", "Local installation and first run"),
    ("3", "Company identity and document branding"),
    ("4", "Master Data foundation"),
    ("5", "Warehouses, inventory, suppliers, and carriers"),
    ("6", "Currencies, tax, finance, and budgets"),
    ("7", "Roles, profiles, approval limits, and workflows"),
    ("8", "Documents, integrations, and runtime capabilities"),
    ("9", "Diagnostics, security, and operational readiness"),
    ("10", "Go-live and change-control checklists"),
]


def build_setup_manual() -> Path:
    edition = "Edition 2.0 Exhaustive Illustrated - 15 September 2026"
    path = OUT_DIR / "ISSSourcing_Setup_and_Administration_Manual.pdf"
    story: list = []
    story += cover("Setup and Administration Manual", "Organization onboarding, Master Data, access, approvals, documents, diagnostics, and go-live controls", "System administrators, implementation leads, finance controllers, procurement owners, and IT support", edition)
    story += toc(SETUP_TOC)
    append_visual_guide(story, SETUP_SCREEN_GUIDE, "Illustrated setup and administration guide")
    append_button_shortcut_reference(story)
    setup_function_entries = [
        entry for entry in ALL_FUNCTIONS
        if any(token in entry["location"] for token in (
            "Admin", "Settings", "Master Data", "Suppliers", "Contracts", "Purchase Order", "Receiving", "Finance"
        ))
    ]
    append_function_contract_reference(story, setup_function_entries, "Illustrated configuration and cross-workspace function contracts", "CFG")

    story += [heading("1. Setup sequence and responsibilities"), P("Configure the application in dependency order. This prevents duplicate identities, invalid references, missing approval targets, incorrect currencies, and unusable transaction forms."), heading("Recommended implementation order", 2)]
    story += numbered_steps(["Confirm runtime and database health.", "Create the organization and company document identity.", "Load currencies and effective FX rates, tax codes, UOMs, departments, cost centres, warehouses, and other Master Data.", "Create suppliers and classify carrier suppliers where appropriate.", "Configure operational and finance settings.", "Create roles, assign employee profiles, navigation visibility, warehouse scope, and approval limits.", "Configure approval policies and workflow governance.", "Validate documents, notifications, integrations, reports, and cross-workspace propagation.", "Complete go-live review and retain evidence."])
    story += [heading("Responsibility model", 2), data_table(["Owner", "Primary responsibility"], [
        ["Executive sponsor", "Legal entity, policy authority, reporting requirements, and go-live approval."],
        ["System administrator", "Organization setup, access, runtime capabilities, diagnostics, and controlled configuration."],
        ["Master Data steward", "Reference quality, codes, defaults, dependencies, active state, and change review."],
        ["Procurement owner", "Suppliers, sourcing, contracts, BPA rules, confirmation, and receiving controls."],
        ["Finance controller", "Reporting currency, tax, GL mappings, budgets, AP, approval limits, and period controls."],
        ["Warehouse owner", "Warehouses, bins, default warehouse, item positions, counting, and stock-control roles."],
    ], [42*mm, 124*mm]), PageBreak()]

    story += [heading("2. Local installation and first run"), P("These instructions are for the current Windows development installation. Production deployment must use managed secrets, migration-first database changes, backups, TLS, and the production runbook."), heading("Windows quick start", 2)]
    story += numbered_steps(["Install Node.js 22.12 or later and PostgreSQL.", "Open PowerShell and change location with: Set-Location -LiteralPath \"C:\\Users\\USER-PC\\OneDrive\\Documents\\GITHUB REPO\\ISSSourcing\"", "Confirm PostgreSQL is Running with: Get-Service postgresql-x64-18", "Install exact dependencies with: npm.cmd ci", "Check the environment with: npm.cmd run local:doctor", "Start the app with: npm.cmd run local:up", "Open http://127.0.0.1:5000 and complete first-run onboarding."])
    story += [callout("PowerShell note", "The Command Prompt syntax cd /d does not work in PowerShell. Use Set-Location -LiteralPath. If PostgreSQL already reports Running, do not run Start-Service from a non-administrator terminal.", "warn"), heading("Required production controls", 2)]
    story += bullets(["Use a real DATABASE_URL and strong SESSION_SECRET.", "Apply checked-in migrations before production startup.", "Use tenant-scoped database backups and tested restore procedures.", "Keep demo walkthrough and developer tools disabled unless explicitly authorized.", "Verify /api/ready and System Diagnostics before onboarding users."])
    story += [PageBreak()]

    story += section("3. Company identity and document branding", "/admin/company-setup", "Create the legal and visual identity used on newly generated reports, vouchers, remittances, delivery notes, agreement summaries, POs, and quotations.", ["Enter trading/display name and registered legal name.", "Add registration number, VAT/tax number, principal address, company email, phone, and website.", "Upload a PNG, JPEG, WebP, or SVG logo no larger than 5 MB, or use an approved external URL.", "Set country, locale, and timezone.", "Review the document preview and optional legal/footer text.", "Save the profile and generate a sample document for verification."], ["Reporting currency is read-only here and is controlled in Settings after Master Data setup", "Historical generated documents retain their stored identity snapshot", "The logo must be uploaded before saving its returned URL", "Supplier/customer addresses remain sourced from their canonical records"], "All newly generated documents consume the saved company identity; changing it does not rewrite historical files.", "Complete the physical address and legal identifiers before external document use.")

    story += [heading("4. Master Data foundation"), route_line("/admin/master-data"), P("Master Data is organization-owned and authoritative. Transaction forms use context APIs rather than static client lists."), heading("Load in dependency order", 2)]
    story.append(data_table(["Order", "Domain", "Purpose and checks"], [
        ["1", "Currencies", "Create active ISO definitions. Do not use a legacy current-rate field."],
        ["2", "FX rates", "Add effective dated, organization-scoped rates. Confirm base/reporting direction."],
        ["3", "UOMs", "Create stable codes and names used by items, requisitions, POs, receipts, and agreements."],
        ["4", "Tax codes", "Define active tax behavior and rate; coordinate with finance policy."],
        ["5", "Departments", "Create ownership structures and default currency where applicable."],
        ["6", "Cost centres and GL mapping", "Support coding, budgets, approvals, and financial posting."],
        ["7", "Payment terms and Incoterms", "Create commercial defaults, then assign them to suppliers or contracts."],
        ["8", "Warehouses", "Create active tenant-owned locations and designate one organization default."],
        ["9", "Carriers", "Use governed carrier-capable suppliers and any retained carrier reference mapping."],
        ["10", "Approval policies", "Configure only after roles, approvers, and workflow entities exist."],
    ], [13*mm, 42*mm, 111*mm]))
    story += [heading("Governance rules", 2)]
    story += bullets(["Codes are unique within the organization, not globally.", "Inactive records cannot be used for new assignments or documents.", "Dependency counts and Used by links must be reviewed before deactivation or deletion.", "New documents receive current active values; drafts require explicit drift review and refresh.", "Submitted, approved, sent, received, paid, cancelled, closed, and completed records remain immutable snapshots.", "Context invalidation should make saved Master Data available to already-open new forms after refresh/refetch."])
    story += [callout("Safe change pattern", "Review dependencies -> make the Master Data change -> confirm context invalidation -> open a new transaction -> review draft drift -> verify an approved historical document remains unchanged."), PageBreak()]

    story += section("5.1 Warehouses and inventory prerequisites", "/admin/master-data/warehouses and /inventory/warehouse-operations", "Configure locations before enabling warehouse adjustments, receiving, counting, picking, or dispatch.", ["Create each warehouse with its real business name and organization ownership.", "Set one active organization-default warehouse transactionally.", "Configure bins or locations where required.", "Assign item-default warehouses separately from the organization default.", "Grant users only the permitted warehouse/bin scope.", "Test an inbound and outbound movement against a disposable item."], ["No invented Main Warehouse fallback is used", "Item default, organization default, and count warehouse are separate concepts", "Cross-tenant and inactive warehouse references are rejected", "Outbound availability is validated under lock"], "Warehouses become available in inventory, requisitions/POs, receiving, logistics, mobile counts, issues, returns, and analytics.")

    story += section("5.2 Suppliers and carrier classification", "/procurement/suppliers", "Maintain one canonical counterparty identity. A carrier is a supplier category/capability, not an unrelated duplicate supplier record.", ["Create the supplier with legal name, physical/postal address, contacts, tax identifiers, and onboarding status.", "Configure currency, payment terms, Incoterms, lead time, warehouse/delivery defaults, and compliance.", "Enable the carrier category/capability for logistics providers.", "Add contracts, price lists, documents, risk, and communication evidence.", "Approve or activate the supplier under the configured workflow."], ["Only active tenant-owned suppliers are selectable", "Carrier selection uses the same authoritative supplier identity", "Defaults affect new documents and explicit draft refreshes", "Supplier deletion/deactivation is dependency guarded"], "Supplier records populate requisitions, RFQs, POs, agreements, shipments, receipts, AP, quotations, analytics, and notifications.")

    story += [heading("6. Currencies, tax, finance, and budgets"), heading("Reporting currency", 2)]
    story += numbered_steps(["Create and activate the ISO currency in Master Data.", "Add the effective FX rate records required for transaction dates.", "Open Admin > Settings and select the active tenant-owned reporting currency.", "Save and verify settings consumers refresh.", "Create a new requisition and PO in a foreign currency and confirm the reporting value uses the effective rate.", "Confirm submitted historical records retain their stored rate and reporting snapshot."])
    story += [heading("Tax and coding", 2)]
    story += bullets(["Create tax codes and rates according to the organization's jurisdiction and accounting policy.", "Map items/services and transaction lines to valid UOM, tax, cost centre, and GL account values.", "Configure budgets by available accounting dimensions before enforcing commitment control.", "Approved requisitions reserve commitments; PO conversion transfers them without double counting; receipts/invoices update exposure or actuals.", "Choose warning plus elevated approval or hard block according to organization policy."])
    story += [callout("Financial control", "Use fixed-precision monetary values. Never configure financial posting or statutory reporting from a preview-labelled workspace without validating the enabled accounting capability and reconciliation evidence.", "warn"), PageBreak()]

    story += [heading("7. Roles, profiles, approval limits, and workflows"), heading("Role catalog and effective access", 2)]
    story += numbered_steps(["Open User Roles and load the authoritative permission catalog.", "Create or select an active system/custom role and grant only required resource actions.", "Configure navigation tabs from the canonical navigation catalog.", "Open Employee Profiles, assign the role, location/warehouse scope, and visible tabs.", "Set approval limits for supported governed workflows.", "Review Effective Access to compare API permissions and visible tabs."])
    story += [heading("Approval and workflow setup", 2)]
    story += numbered_steps(["Open Workflow Governance and review the governed-workflow catalog.", "Enable only workflows supported by the organization and configured prerequisites.", "Open Approval Policies and choose the governed entity.", "Create sequential amount bands and approval levels using active roles or specific approvers.", "Configure escalation, segregation-of-duties, and high-control requirements.", "Test submission, independent approval, denial, reason capture, and audit evidence with disposable data."])
    story += [heading("Required controls", 2)]
    story += bullets(["Inactive roles cannot be assigned.", "Referenced roles cannot be deleted until users and policies are reassigned.", "Unknown/legacy paths may be displayed for removal but cannot be newly assigned.", "Profile tab visibility never substitutes for API permission.", "Requester/approver, creator/high-value approver, invoice creator/approver, and payment creator/releaser duties should be separated.", "Approval limits and policies use the same workflow catalog."])
    story += [PageBreak()]

    story += section("8.1 Documents and extraction setup", "/admin/documents and /admin/document-extractor", "Configure storage, supported formats, entity links, extraction providers, and safe replacement behavior.", ["Verify document storage is writable and backed up.", "Generate a branded sample PDF and confirm its size/checksum metadata.", "Run reconciliation to detect missing blobs without deleting metadata.", "Configure extraction limits and allowed formats.", "Test preview, mapping, validation, and explicit import confirmation."], ["Missing documents return an unavailable state and remain in immutable history", "Replacement creates a new version", "Demo metadata is created only after a real file is written", "Single-file and batch limits match the server"], "Documents and extraction feed procurement, AP, logistics, audit, and diagnostics.")

    story += section("8.2 Integrations, recognition, demo, and developer tools", "/admin/integrations and /admin/image-recognition", "Enable external systems only with explicit runtime capabilities and configured providers.", ["Review runtime capabilities and feature flags.", "Configure the provider and credentials through approved secret management.", "Test read/write scope with disposable records.", "Confirm recognition reports operational, simulation, or unavailable correctly.", "Keep demo walkthrough and developer tools disabled in normal production."], ["Simulation is permitted only when server demo mode is enabled", "No recognition provider means setup required, not sample success", "Developer routes require administrator access and capability enablement", "Walkthrough preparation is tenant-scoped and must not reset unrelated data"], "Integrations may affect data freshness, documents, notifications, recognition, and diagnostics depending on their configured scope.")

    story += [heading("9. Diagnostics, security, and operational readiness"), route_line("/admin/system-diagnostics"), heading("Routine checks", 2)]
    story += numbered_steps(["Open System Diagnostics and separate Current, Expected configuration, and History.", "Run current probes and note request IDs.", "Open each finding's exact problem tab.", "Apply only safe, reversible remediation or follow the documented manual action.", "Rerun the probe and confirm the current finding clears while history remains."])
    story += [heading("Security checklist", 2)]
    story += bullets(["Use strong session secrets, TLS, secure cookies, and least-privilege roles.", "Apply tenant and permission scope before filtering, counting, exporting, or downloading.", "Validate every route, identifier, file, warehouse, supplier, role, and target path server-side.", "Protect backups and test restoration; do not rely on migration success alone.", "Keep audit evidence immutable and retain request IDs for incident review.", "Use disposable databases or guaranteed cleanup for mutation/browser suites.", "Never automatically purge production fixtures or operational data."])
    story += [heading("Backup and maintenance", 2), callout("Fixture cleanup", "Run dry-run first. Purge requires a verified backup, tenant scope, exact confirmation token, dependency expansion, and one transaction with rollback. Current local records are never automatically deleted.", "danger"), PageBreak()]

    story += [heading("10. Go-live and change-control checklists"), heading("Go-live checklist", 2)]
    story.append(data_table(["Area", "Acceptance evidence"], [
        ["Runtime", "Ready endpoint healthy; production environment and migrations validated."],
        ["Company", "Legal identity, address, contact details, logo, currency, locale, and sample documents approved."],
        ["Master Data", "Active currencies/FX, UOMs, tax, departments, cost centres, warehouses, terms, and carriers verified."],
        ["Access", "Roles, users, visible tabs, effective permissions, warehouse scopes, and inactive-role guards tested."],
        ["Approvals", "Every governed workflow has valid amount bands, approvers, limits, SoD, and escalation behavior."],
        ["Procurement", "Requisition -> RFQ/award or BPA release -> PO -> confirmation -> receipt flow verified."],
        ["Inventory/logistics", "Inbound, outbound, count, dispatch, shipment, exception, and document propagation verified."],
        ["Finance", "AP match, approval, batch, voucher/remittance, tax, FX, budgets, and reconciliation checked."],
        ["Analytics", "Filtered totals, currency, preview/export parity, and source drilldowns reconciled."],
        ["Recovery", "Backup, restore, document storage, export retry, and diagnostic escalation rehearsed."],
    ], [36*mm, 130*mm]))
    story += [heading("Change-control checklist", 2)]
    story += numbered_steps(["Identify the affected organization, module, entities, and downstream consumers.", "Review dependencies and historical snapshot rules.", "Confirm required permission and approval authority.", "Apply the smallest governed change.", "Invalidate and refresh relevant contexts.", "Verify the source record and every expected downstream page/document/report.", "Record reason, request ID, approval evidence, and rollback plan."])
    story += [Spacer(1, 5 * mm), callout("Administration principle", "Configuration is complete only when the source setting, a new downstream transaction, its generated document, its analytics output, and its audit evidence all agree.")]

    story += [PageBreak()]
    append_comprehensive_reference(story, SETUP_MODULES, "Part II - Detailed implementation and administration reference", "S")
    story += [
        heading("Appendix A - Configuration-to-consumer verification matrix"),
        data_table(["Configuration", "Consumers that must be checked"], [
            ["Company identity/logo", "POs, quotations, agreement summaries, vouchers, remittances, delivery notes, reports."],
            ["Reporting currency/FX", "Requisitions, sourcing comparison, POs, invoices, AP batches, analytics, reports."],
            ["Supplier defaults", "New requisitions, POs, contracts, shipments, receiving, AP and supplier documents."],
            ["Warehouse/default", "Item detail, adjustments, receiving, put-away, counts, barcode In/Out, dispatch, returns, mobile."],
            ["Tax/UOM/cost centre/GL", "Requisition lines, PO lines, quotation lines, agreement lines, invoices, budgets/posting."],
            ["Role/permissions/tabs", "Employee profile, header/navigation, every protected list/detail/action, diagnostics."],
            ["Approval policy/limit", "Requisition, PO, contract, release, receipt reversal, adjustment, invoice, batch, return and enabled workflows."],
            ["Document storage", "Uploads, generated PDFs, downloads, reconciliation, reattachment, diagnostics."],
            ["Runtime capability", "Demo walkthrough, developer tools, recognition, preview/disabled UI and direct routes."],
        ], [50 * mm, 116 * mm]),
        PageBreak(),
        heading("Appendix B - Administration sign-off record"),
        P("Complete this record outside the application or reproduce it in the organization's controlled implementation workbook/change system."),
        data_table(["Sign-off item", "Owner", "Evidence reference", "Date", "Result"], [
            ["Runtime and database", "", "", "", ""], ["Company/legal identity", "", "", "", ""], ["Master Data", "", "", "", ""],
            ["Warehouses/inventory", "", "", "", ""], ["Suppliers/carriers/contracts", "", "", "", ""], ["Currencies/tax/budgets", "", "", "", ""],
            ["Roles/scopes", "", "", "", ""], ["Approvals/workflows", "", "", "", ""], ["Documents/integrations", "", "", "", ""],
            ["Analytics/reports", "", "", "", ""], ["Security/diagnostics", "", "", "", ""], ["Backup/rollback", "", "", "", ""], ["Business go-live", "", "", "", ""],
        ], [51 * mm, 28 * mm, 49 * mm, 18 * mm, 20 * mm]),
    ]

    ManualDoc(path, "Setup and Administration Manual", edition).build(story)
    return path


if __name__ == "__main__":
    generated = [build_user_manual(), build_setup_manual()]
    for item in generated:
        print(item)
