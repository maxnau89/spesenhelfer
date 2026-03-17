"""
CC statement PDF parser (pdfplumber-based).

Handles German bank credit card statements (DKB, Commerzbank, ING, etc.).
German number format: 1.234,56  → 1234.56
German date format:   31.01.2026 → date(2026, 1, 31)
"""

import re
from dataclasses import dataclass
from datetime import date


@dataclass
class ParsedTransaction:
    booking_date: date
    value_date: date | None
    description: str
    amount: float
    currency: str = "EUR"
    raw_text: str = ""


# Lines containing these words are balance/total rows — skip them
_SKIP_KEYWORDS = re.compile(r"saldo|gesamt|summe|übertrag|kontostand|limit|verfügbar", re.IGNORECASE)

# German date: dd.mm.yyyy
_DATE_RE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b")

# German decimal number (positive or negative): -1.234,56 or 1.234,56
_AMOUNT_RE = re.compile(r"(-?\d{1,3}(?:\.\d{3})*,\d{2})")


def _parse_german_date(day: str, month: str, year: str) -> date:
    return date(int(year), int(month), int(day))


def _parse_german_amount(s: str) -> float:
    """Convert '1.234,56' → 1234.56 or '-45,00' → -45.0"""
    s = s.replace(".", "").replace(",", ".")
    return float(s)


def _parse_line(line: str) -> ParsedTransaction | None:
    """Try to extract a transaction from a single text line."""
    if _SKIP_KEYWORDS.search(line):
        return None

    dates = _DATE_RE.findall(line)
    amounts = _AMOUNT_RE.findall(line)

    if not dates or not amounts:
        return None

    booking_date = _parse_german_date(*dates[0])
    value_date = _parse_german_date(*dates[1]) if len(dates) > 1 else None

    # Amount is the LAST match (most likely to be the final amount)
    amount = _parse_german_amount(amounts[-1])

    # Description: strip dates and amounts from the line
    desc = line
    for d in dates:
        desc = desc.replace(f"{d[0]}.{d[1]}.{d[2]}", "", 1)
    for a in amounts:
        desc = desc.replace(a, "", 1)
    description = " ".join(desc.split()).strip(" -+")

    if not description:
        return None

    return ParsedTransaction(
        booking_date=booking_date,
        value_date=value_date,
        description=description,
        amount=amount,
        raw_text=line.strip(),
    )


def parse_cc_statement(file_path: str) -> list[ParsedTransaction]:
    """
    Parse a German CC statement PDF.
    Tries pdfplumber table extraction first, falls back to line-by-line text.
    """
    import pdfplumber

    transactions: list[ParsedTransaction] = []

    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            # Attempt 1: structured table extraction
            tables = page.extract_tables()
            if tables:
                for table in tables:
                    for row in table:
                        if not row:
                            continue
                        line = " ".join(str(cell) for cell in row if cell)
                        tx = _parse_line(line)
                        if tx:
                            transactions.append(tx)
            else:
                # Attempt 2: line-by-line text
                text = page.extract_text() or ""
                for line in text.splitlines():
                    tx = _parse_line(line)
                    if tx:
                        transactions.append(tx)

    # Deduplicate by (booking_date, amount, description)
    seen: set[tuple] = set()
    unique: list[ParsedTransaction] = []
    for tx in transactions:
        key = (tx.booking_date, tx.amount, tx.description[:30])
        if key not in seen:
            seen.add(key)
            unique.append(tx)

    return sorted(unique, key=lambda t: t.booking_date)
