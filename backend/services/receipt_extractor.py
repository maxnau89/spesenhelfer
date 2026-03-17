"""
Receipt PDF extractor — hybrid pdfplumber + GPT-4o vision fallback.

Path A (pdfplumber): For digitally-generated PDFs (Hetzner, DB, SaaS).
Path B (vision LLM): For scanned/photographed receipts with no text layer.
"""

import base64
import re
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

_GERMAN_DATE_RE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b")
_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_ENGLISH_DATE_RE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+(\d{1,2}),?\s+(\d{4})\b",
    re.IGNORECASE,
)
_MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

# Amount patterns — look near total keywords
_AMOUNT_LABEL_RE = re.compile(
    r"(?:total|gesamt|betrag|amount\s+due|rechnungsbetrag|summe|grand\s+total|zu\s+zahlen)"
    r"[^\d\-]*(-?\d[\d.,]+)",
    re.IGNORECASE,
)
_GENERIC_AMOUNT_RE = re.compile(r"(-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:EUR|€|USD|\$|GBP|£)", re.IGNORECASE)
_CORPORATE_RE = re.compile(r"\b(?:GmbH|AG|SE|KG|Ltd\.?|Inc\.?|LLC|AB|BV|SAS|Corp\.?|Co\.?)\b")


@dataclass
class ExtractedReceipt:
    extracted_date: date | None
    extracted_amount: float | None
    extracted_vendor: str | None
    extraction_confidence: float
    extraction_method: str  # "pdfplumber" or "vision_llm"
    raw_extracted_text: str


def _parse_date(text: str) -> date | None:
    m = _GERMAN_DATE_RE.search(text)
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = _ISO_DATE_RE.search(text)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = _ENGLISH_DATE_RE.search(text)
    if m:
        return date(int(m.group(3)), _MONTH_MAP[m.group(1).lower()], int(m.group(2)))
    return None


def _parse_amount(text: str) -> float | None:
    # Prefer labeled amounts (near "Total", "Gesamt" etc.)
    matches = _AMOUNT_LABEL_RE.findall(text)
    if not matches:
        matches = _GENERIC_AMOUNT_RE.findall(text)
    if not matches:
        return None
    raw = matches[-1]  # last = most likely grand total
    # Normalize: handle both 1.234,56 (German) and 1,234.56 (English)
    if "," in raw and "." in raw:
        if raw.index(",") < raw.index("."):
            # English: 1,234.56
            raw = raw.replace(",", "")
        else:
            # German: 1.234,56
            raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw and "." not in raw:
        raw = raw.replace(",", ".")
    try:
        return abs(float(raw))
    except ValueError:
        return None


def _parse_vendor(text: str, filename: str) -> str | None:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    # Look for a line with a corporate suffix
    for line in lines[:10]:
        if _CORPORATE_RE.search(line):
            return line[:80]
    # Fall back to first non-empty line
    if lines:
        return lines[0][:80]
    # Fall back to filename
    stem = Path(filename).stem
    return stem if stem else None


def _extract_pdfplumber(file_path: str, filename: str) -> ExtractedReceipt:
    import pdfplumber

    full_text = ""
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            full_text += (page.extract_text() or "") + "\n"

    raw = full_text[:3000]
    extracted_date = _parse_date(full_text)
    extracted_amount = _parse_amount(full_text)
    extracted_vendor = _parse_vendor(full_text, filename)

    confidence = sum([
        0.4 if extracted_amount is not None else 0.0,
        0.3 if extracted_date is not None else 0.0,
        0.3 if extracted_vendor is not None else 0.0,
    ])

    return ExtractedReceipt(
        extracted_date=extracted_date,
        extracted_amount=extracted_amount,
        extracted_vendor=extracted_vendor,
        extraction_confidence=confidence,
        extraction_method="pdfplumber",
        raw_extracted_text=raw,
    )


def _extract_vision_llm(file_path: str, filename: str, openai_api_key: str) -> ExtractedReceipt:
    """Render PDF to image and use GPT-4o vision to extract structured data."""
    from openai import OpenAI
    from pdf2image import convert_from_path

    client = OpenAI(api_key=openai_api_key)

    # Render first page only (sufficient for most receipts)
    with tempfile.TemporaryDirectory() as tmpdir:
        images = convert_from_path(file_path, first_page=1, last_page=1, output_folder=tmpdir, fmt="png")
        if not images:
            return ExtractedReceipt(None, None, None, 0.0, "vision_llm", "")

        import io
        buf = io.BytesIO()
        images[0].save(buf, format="PNG")
        img_b64 = base64.b64encode(buf.getvalue()).decode()

    prompt = (
        "Extract the following from this receipt or invoice image. "
        "Return ONLY valid JSON with these keys: "
        "date (ISO format YYYY-MM-DD or null), "
        "amount (number, grand total, or null), "
        "currency (3-letter code, default EUR), "
        "vendor (company name string or null). "
        "Example: {\"date\": \"2026-01-15\", \"amount\": 45.99, \"currency\": \"EUR\", \"vendor\": \"Hetzner GmbH\"}"
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            ],
        }],
        max_tokens=200,
    )

    import json
    raw_response = response.choices[0].message.content or ""
    extracted_date = None
    extracted_amount = None
    extracted_vendor = None

    try:
        data = json.loads(raw_response.strip().strip("```json").strip("```").strip())
        if data.get("date"):
            parts = data["date"].split("-")
            extracted_date = date(int(parts[0]), int(parts[1]), int(parts[2]))
        if data.get("amount") is not None:
            extracted_amount = float(data["amount"])
        extracted_vendor = data.get("vendor")
    except (json.JSONDecodeError, ValueError, KeyError, IndexError):
        pass

    confidence = sum([
        0.4 if extracted_amount is not None else 0.0,
        0.3 if extracted_date is not None else 0.0,
        0.3 if extracted_vendor is not None else 0.0,
    ])

    return ExtractedReceipt(
        extracted_date=extracted_date,
        extracted_amount=extracted_amount,
        extracted_vendor=extracted_vendor,
        extraction_confidence=confidence,
        extraction_method="vision_llm",
        raw_extracted_text=raw_response[:2000],
    )


def extract_receipt(file_path: str, filename: str, openai_api_key: str = "") -> ExtractedReceipt:
    """
    Hybrid extraction:
    1. Try pdfplumber (fast, free, works for digital PDFs)
    2. Fall back to GPT-4o vision if text layer is absent or confidence < 0.4
    """
    import pdfplumber

    # Quick check: does this PDF have a text layer?
    full_text = ""
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            full_text += page.extract_text() or ""
        text_length = len(full_text.strip())

    if text_length >= 50:
        result = _extract_pdfplumber(file_path, filename)
        if result.extraction_confidence >= 0.4:
            return result
        # Partial extraction — try vision if key available
        if openai_api_key:
            vision_result = _extract_vision_llm(file_path, filename, openai_api_key)
            if vision_result.extraction_confidence >= result.extraction_confidence:
                return vision_result
        return result
    elif openai_api_key:
        return _extract_vision_llm(file_path, filename, openai_api_key)
    else:
        # No text layer, no API key — return empty extraction
        return ExtractedReceipt(None, None, Path(filename).stem or None, 0.0, "pdfplumber", "")
