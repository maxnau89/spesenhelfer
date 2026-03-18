"""
Generates Eigenbeleg PDFs using reportlab.

Layout matches the corporate template (Eigenbeleg_Naumow_000x.docx):
  Eigenbeleg (title)
  Betrag (Euro, Cent):  →  33,40 GBP = 37,48 EUR
  Laufende Belegnummer:  →  0001
  Empfänger:             →  vendor name + address
  Verwendungszweck:      →  (filled by user)
  Grund für Eigenbeleg:  →  reason
  Ort, Datum:            →  Stuttgart, 22.03.2023
  Unterschrift:          →  (blank line)
"""

from dataclasses import dataclass
from datetime import date
from io import BytesIO


EIGENBELEG_GRUENDE = [
    "Tap-to-Pay mit Kreditkarte, belegloses Zahlen, kein Online-Auszug generierbar",
    "Verlust des Zahlungsbelegs",
    "Beleg wurde nicht ausgestellt (Automat / Self-Checkout)",
    "Technischer Fehler beim Erstellen des Belegs",
    "Buchung über Drittanbieter, kein separater Beleg erhältlich",
]


@dataclass
class EigenbelegData:
    belegnummer: str
    betrag_original: float
    currency: str
    betrag_eur: float
    eur_rate: float | None
    empfaenger: str
    verwendungszweck: str
    grund: str
    ort: str
    ausgabedatum: date
    erstelldatum: date
    name: str


def _fmt(value: float) -> str:
    """Format a float as German decimal string: 1234.56 → '1.234,56'"""
    formatted = f"{value:,.2f}"          # e.g. "1,234.56"
    return formatted.replace(",", "X").replace(".", ",").replace("X", ".")


def generate_eigenbeleg_pdf(data: EigenbelegData) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_CENTER
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2.5 * cm,
        rightMargin=2.5 * cm,
        topMargin=3.0 * cm,
        bottomMargin=2.5 * cm,
    )

    W = A4[0] - 5.0 * cm  # usable width

    def ps(name, **kw) -> ParagraphStyle:
        base = getSampleStyleSheet()["Normal"]
        s = ParagraphStyle(name, parent=base)
        for k, v in kw.items():
            setattr(s, k, v)
        return s

    title_s   = ps("title",   fontName="Helvetica-Bold", fontSize=24, leading=28, spaceAfter=2)
    label_s   = ps("label",   fontName="Helvetica-Bold", fontSize=10, leading=14, spaceAfter=1)
    value_s   = ps("value",   fontName="Helvetica",      fontSize=10, leading=14, spaceAfter=0)
    footer_s  = ps("footer",  fontName="Helvetica",      fontSize=8,  leading=11,
                   textColor=colors.HexColor("#888888"), alignment=TA_CENTER)

    story = []

    # ── Title ─────────────────────────────────────────────────────────────────
    story.append(Paragraph("Eigenbeleg", title_s))
    story.append(HRFlowable(width="100%", thickness=1.5,
                             color=colors.black, spaceBefore=4, spaceAfter=14))

    # ── Betrag ────────────────────────────────────────────────────────────────
    story.append(Paragraph("Betrag (Euro, Cent):", label_s))
    if data.currency == "EUR":
        betrag_line = f"{_fmt(data.betrag_eur)} EUR"
    else:
        betrag_line = f"{_fmt(data.betrag_original)} {data.currency} = {_fmt(data.betrag_eur)} EUR"
    story.append(Paragraph(betrag_line, value_s))
    story.append(Spacer(1, 10))

    # ── Laufende Belegnummer ──────────────────────────────────────────────────
    story.append(Paragraph("Laufende Belegnummer:", label_s))
    story.append(Paragraph(data.belegnummer, value_s))
    story.append(Spacer(1, 10))

    # ── Empfänger ─────────────────────────────────────────────────────────────
    story.append(Paragraph("Empfänger:", label_s))
    # Render each line of the address separately
    for line in data.empfaenger.splitlines():
        if line.strip():
            story.append(Paragraph(line.strip(), value_s))
    story.append(Spacer(1, 10))

    # ── Verwendungszweck ──────────────────────────────────────────────────────
    story.append(Paragraph("Verwendungszweck:", label_s))
    for line in data.verwendungszweck.splitlines():
        if line.strip():
            story.append(Paragraph(line.strip(), value_s))
    if not data.verwendungszweck.strip():
        story.append(Paragraph("–", value_s))
    story.append(Spacer(1, 10))

    # ── Grund für Eigenbeleg ──────────────────────────────────────────────────
    story.append(Paragraph("Grund für Eigenbeleg:", label_s))
    for line in data.grund.splitlines():
        if line.strip():
            story.append(Paragraph(line.strip(), value_s))
    story.append(Spacer(1, 10))

    # ── Ort, Datum ────────────────────────────────────────────────────────────
    story.append(Paragraph("Ort, Datum:", label_s))
    story.append(Paragraph(
        f"{data.ort}, {data.ausgabedatum.strftime('%d.%m.%Y')}", value_s
    ))
    story.append(Spacer(1, 28))

    # ── Unterschrift ──────────────────────────────────────────────────────────
    story.append(Paragraph("Unterschrift:", label_s))
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="60%", thickness=0.5,
                             color=colors.HexColor("#555555"), spaceAfter=4))
    story.append(Paragraph(data.name, ps("signame", fontName="Helvetica", fontSize=9,
                                          textColor=colors.HexColor("#555555"))))

    story.append(Spacer(1, 1.5 * cm))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5,
                             color=colors.HexColor("#cccccc"), spaceAfter=6))
    story.append(Paragraph(
        "Dieser Eigenbeleg ersetzt einen nicht erhältlichen Originalbeleg "
        "gemäß den geltenden steuerlichen Anforderungen.",
        footer_s,
    ))

    doc.build(story)
    return buf.getvalue()
