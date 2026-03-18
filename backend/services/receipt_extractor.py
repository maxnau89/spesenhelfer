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

# Total-keyword line detection (highest priority labels first)
_TOTAL_KEYWORD_RE = re.compile(
    r"^\s*(?:grand\s+total|amount\s+due|total\s+amount|rechnungsbetrag|gesamtbetrag"
    r"|gesamtsumme|zu\s+zahlen|total|gesamt|betrag|summe)",
    re.IGNORECASE,
)
# Any number that looks like a monetary value (with 2 decimal places).
# Permissive: allows any digit sequence + decimal so _normalize_amount handles format.
_NUMBER_RE = re.compile(r"-?\d[\d.,'\s]*[.,]\d{2}\b")
# All common currency codes/symbols
_CURRENCY_SYMBOLS = r"EUR|€|USD|\$|GBP|£|CHF|SEK|NOK|DKK|PLN|CZK|HUF|JPY|¥|CNY|CAD|AUD|SGD|MXN|BRL|INR|KRW|TRY|ZAR|AED|SAR|THB|HKD|NZD|IDR|MYR|PHP|ILS|CLP|TWD|PKR|SKK|kr\."
# Currency-tagged amounts (for generic fallback)
_CURRENCY_AMOUNT_RE = re.compile(
    rf"(-?\d{{1,3}}(?:[.,]\d{{3}})*[.,]\d{{2}})\s*(?:{_CURRENCY_SYMBOLS})",
    re.IGNORECASE,
)
# Currency symbol/code preceding the number (e.g. "$ 45.99", "CHF 1234.00", "CHF 1'234.00")
# Simple: grab any digits + decimal after a currency token
_CURRENCY_PREFIX_RE = re.compile(
    rf"(?:{_CURRENCY_SYMBOLS})\s*(-?\d[\d.,'\s]*[.,]\d{{2}})\b",
    re.IGNORECASE,
)
_CORPORATE_RE = re.compile(r"(?<!\d\s)(?<!\d)\b(?:GmbH|AG|SE|KG|Ltd\.?|B\.V\.|BV|Inc\.?|LLC|AB|SAS|Corp\.?|Co\.?)\b")

# Well-known vendor names derived from filename patterns
_KNOWN_VENDORS: dict[str, str] = {
    "hetzner": "Hetzner Online GmbH",
    "db ": "Deutsche Bahn AG",
    "bahn": "Deutsche Bahn AG",
    "digitalocean": "DigitalOcean LLC",
    "aws": "Amazon Web Services",
    "amazon": "Amazon",
    "google": "Google LLC",
    "microsoft": "Microsoft Corporation",
    "github": "GitHub Inc.",
    "openai": "OpenAI LLC",
    "stripe": "Stripe",
    "paypal": "PayPal",
    "linode": "Linode LLC",
    "ovh": "OVHcloud SAS",
    "uber": "Uber B.V.",
    "lyft": "Lyft Inc.",
    "bolt": "Bolt Technology OÜ",
}

# Brand names found in invoice text (searched in first ~500 chars)
_TEXT_BRAND_RE = re.compile(
    r"\b(Uber|Lyft|Bolt|Airbnb|Booking\.com|Expedia|Stripe|PayPal)\b",
    re.IGNORECASE,
)


@dataclass
class ExtractedReceipt:
    extracted_date: date | None
    extracted_amount: float | None
    extracted_currency: str | None
    extracted_vendor: str | None
    extraction_confidence: float
    extraction_method: str  # "pdfplumber" or "vision_llm"
    raw_extracted_text: str


# Map symbol/abbreviation → ISO code
_SYMBOL_TO_CODE: dict[str, str] = {
    "€": "EUR", "$": "USD", "£": "GBP", "¥": "JPY",
    # Scandinavian "kr" / "kr." — default to SEK (most common context);
    # DKK/NOK invoices are rarer and will usually also have "DKK"/"NOK" elsewhere
    "KR": "SEK", "KR.": "SEK", "SEK": "SEK", "NOK": "NOK", "DKK": "DKK",
}

_ISO_CODES = (
    "EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CNY|CAD|AUD|SGD|"
    "MXN|BRL|INR|KRW|TRY|ZAR|AED|SAR|THB|HKD|NZD|IDR|MYR|PHP|ILS|"
    "CLP|TWD|PKR|SKK"
)
_CURRENCY_TOKENS = rf"(?:{_ISO_CODES}|€|\$|£|¥|kr\.?)"

# Regex to find a currency code/symbol adjacent to a number (within the same line)
_CURRENCY_DETECT_RE = re.compile(
    rf"(?:"
    rf"(?P<pre>{_CURRENCY_TOKENS})\s*-?\d"
    rf"|"
    rf"-?\d[\d.,'\s]*[.,]\d{{2}}\s*(?P<post>{_CURRENCY_TOKENS})"
    rf")",
    re.IGNORECASE,
)


def _detect_currency(text: str) -> str | None:
    """Find the most frequently mentioned currency in the text; return ISO code."""
    counts: dict[str, int] = {}
    for m in _CURRENCY_DETECT_RE.finditer(text):
        raw = (m.group("pre") or m.group("post") or "").upper()
        code = _SYMBOL_TO_CODE.get(raw, raw)
        counts[code] = counts.get(code, 0) + 1
    if not counts:
        return None
    # Most common currency wins; EUR loses tiebreaks (it appears in totals but
    # the original transaction currency is more interesting)
    dominant = max(counts, key=lambda c: (counts[c], c != "EUR"))
    return dominant


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


def _normalize_amount(raw: str) -> float | None:
    """Convert German/English/Swiss formatted number string to float."""
    raw = raw.strip()
    # Swiss apostrophe thousands separator: 1'234.50 → remove apostrophe
    raw = raw.replace("'", "").replace("\u2019", "").replace(" ", "")
    if "," in raw and "." in raw:
        if raw.index(",") < raw.index("."):
            raw = raw.replace(",", "")        # English: 1,234.56
        else:
            raw = raw.replace(".", "").replace(",", ".")  # German: 1.234,56
    elif "," in raw and "." not in raw:
        raw = raw.replace(",", ".")
    try:
        return abs(float(raw))
    except ValueError:
        return None


def _parse_amount(text: str) -> float | None:
    """
    Strategy:
    1. Scan line-by-line for total-keyword lines; take the LAST number on that line
       or the last number on the immediately following non-empty line.
       Among all candidates, pick the LARGEST (grand total > sub-totals).
    2. Fallback: among all currency-tagged amounts in the text, take the largest.
    3. Last resort: last 2-decimal number in text.
    """
    lines = text.splitlines()
    candidates: list[float] = []

    for i, line in enumerate(lines):
        if _TOTAL_KEYWORD_RE.match(line):
            # Grab numbers from this line and the next non-empty line
            search_lines = [line]
            for j in range(i + 1, min(i + 3, len(lines))):
                if lines[j].strip():
                    search_lines.append(lines[j])
                    break

            for sline in search_lines:
                nums = _NUMBER_RE.findall(sline)
                if nums:
                    # Take the LAST number (rightmost column = total in table layouts)
                    val = _normalize_amount(nums[-1])
                    if val is not None and val > 0:
                        candidates.append(val)

    if candidates:
        return max(candidates)  # grand total is always the largest labeled sum

    # Fallback: currency-tagged amounts (suffix and prefix), take largest
    currency_matches = _CURRENCY_AMOUNT_RE.findall(text) + _CURRENCY_PREFIX_RE.findall(text)
    if currency_matches:
        vals = [v for raw in currency_matches if (v := _normalize_amount(raw)) is not None and v > 0]
        if vals:
            return max(vals)

    # Last resort: last 2-decimal number anywhere
    all_nums = _NUMBER_RE.findall(text)
    if all_nums:
        return _normalize_amount(all_nums[-1])

    return None


def _parse_vendor(text: str, filename: str) -> str | None:
    # 1. Known vendor from filename (most reliable for Hetzner, DB, etc.)
    fname_lower = Path(filename).stem.lower().replace("_", " ").replace("-", " ")
    for key, name in _KNOWN_VENDORS.items():
        if key in fname_lower:
            return name

    # 2. Brand name found in the first 500 chars of text (e.g. Uber invoices)
    m = _TEXT_BRAND_RE.search(text[:500])
    if m:
        brand = m.group(1).lower()
        if brand in _KNOWN_VENDORS:
            return _KNOWN_VENDORS[brand]

    lines = [l.strip() for l in text.splitlines() if l.strip()]

    _SKIP_RE = re.compile(
        r"^(invoice|rechnung|faktura|bill|quittung|beleg|receipt|\d+|#)[\s#\d]*$",
        re.IGNORECASE,
    )
    # Personal name pattern: 2–4 words, each starting with an uppercase letter,
    # no digits, no corporate suffixes, no punctuation beyond spaces.
    # Used to skip recipient names that appear at the top of invoices.
    _PERSONAL_NAME_RE = re.compile(r"^[A-ZÄÖÜ][a-zäöüß]+(?: [A-ZÄÖÜ][a-zäöüß]+){1,3}$")

    def _is_personal_name(line: str) -> bool:
        # Quick pre-check: no digits, no corporate keywords, short enough
        if re.search(r"\d", line) or _CORPORATE_RE.search(line):
            return False
        return bool(_PERSONAL_NAME_RE.match(line.strip()))

    # 3. Corporate suffix in first 20 lines (skip meta lines and personal names)
    for line in lines[:20]:
        if _CORPORATE_RE.search(line) and not _SKIP_RE.match(line) and len(line) < 80:
            return line[:80]

    # 4. First non-empty line that isn't a header, a number, or a personal name
    for line in lines[:8]:
        if not _SKIP_RE.match(line) and not _is_personal_name(line) and len(line) > 3:
            return line[:80]

    # 5. Filename stem as last resort
    stem = Path(filename).stem
    return stem.replace("_", " ").replace("-", " ") if stem else None


def _extract_pdfplumber(file_path: str, filename: str) -> ExtractedReceipt:
    import pdfplumber

    pages_text: list[str] = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            # Handle rotated pages: pdfplumber can rotate before extraction
            rotation = page.rotation  # 0, 90, 180, 270
            if rotation:
                page = page.rotate(-rotation)
            pages_text.append(page.extract_text() or "")

    full_text = "\n".join(pages_text)
    raw = full_text[:4000]

    extracted_date = _parse_date(full_text)
    extracted_amount = _parse_amount(full_text)
    extracted_currency = _detect_currency(full_text)
    extracted_vendor = _parse_vendor(full_text, filename)

    confidence = sum([
        0.4 if extracted_amount is not None else 0.0,
        0.3 if extracted_date is not None else 0.0,
        0.3 if extracted_vendor is not None else 0.0,
    ])

    return ExtractedReceipt(
        extracted_date=extracted_date,
        extracted_amount=extracted_amount,
        extracted_currency=extracted_currency,
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
            return ExtractedReceipt(None, None, None, None, 0.0, "vision_llm", "")

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
        raw_currency = (data.get("currency") or "").upper().strip()
        extracted_currency = _SYMBOL_TO_CODE.get(raw_currency, raw_currency) or None
    except (json.JSONDecodeError, ValueError, KeyError, IndexError):
        extracted_currency = None

    confidence = sum([
        0.4 if extracted_amount is not None else 0.0,
        0.3 if extracted_date is not None else 0.0,
        0.3 if extracted_vendor is not None else 0.0,
    ])

    return ExtractedReceipt(
        extracted_date=extracted_date,
        extracted_amount=extracted_amount,
        extracted_currency=extracted_currency,
        extracted_vendor=extracted_vendor,
        extraction_confidence=confidence,
        extraction_method="vision_llm",
        raw_extracted_text=raw_response[:2000],
    )


def extract_receipt(file_path: str, filename: str, openai_api_key: str = "") -> ExtractedReceipt:
    """
    Hybrid extraction:
    1. GPT-4o vision (primary when API key available) — handles complex layouts like DB tickets
    2. pdfplumber fallback — fast regex extraction for simple digital invoices
    """
    if openai_api_key:
        vision_result = _extract_vision_llm(file_path, filename, openai_api_key)
        if vision_result.extraction_confidence >= 0.4:
            return vision_result

    # pdfplumber fallback (no API key, or vision returned low confidence)
    import pdfplumber
    full_text = ""
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            full_text += page.extract_text() or ""

    if len(full_text.strip()) >= 50:
        return _extract_pdfplumber(file_path, filename)

    return ExtractedReceipt(None, None, None, Path(filename).stem or None, 0.0, "pdfplumber", "")
