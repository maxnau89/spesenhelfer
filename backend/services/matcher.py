"""
Greedy best-first receipt ↔ transaction matcher.

Pass 1 — single receipt:
  date_score:   days_diff 0→1.0, 1→0.8, 2→0.6, ≤5→0.3, else 0
  amount_score: diff ≤0.02→1.0, ≤0.50→0.7, ≤2.00→0.3, else 0
  combined = 0.4*date_score + 0.6*amount_score  (amount weighted higher)
  Threshold: pairs with combined < 0.4 are discarded.

Pass 2 — split receipts (e.g. DB Hin+Rückfahrt):
  For unmatched transactions, try all pairs of unmatched receipts whose
  sum ≈ tx.amount (within 0.10 €). Best date score of the pair is used.
  Result: ProposedMatch with extra_receipt_id set.
"""

from dataclasses import dataclass, field
from datetime import date

# Approximate EUR conversion rates for receipt amount normalisation.
# Transactions are always in EUR (CC statement); receipts may be in any currency.
_EUR_RATES: dict[str, float] = {
    "EUR": 1.0, "USD": 0.92, "GBP": 1.19, "CHF": 1.03,
    "SEK": 0.087, "NOK": 0.085, "DKK": 0.134,
    "PLN": 0.23, "CZK": 0.040, "HUF": 0.0026,
    "JPY": 0.0062, "CNY": 0.127, "CAD": 0.68, "AUD": 0.60,
    "SGD": 0.68, "MXN": 0.054, "BRL": 0.18, "INR": 0.011,
    "KRW": 0.00067, "TRY": 0.028, "ZAR": 0.049,
    "AED": 0.25, "SAR": 0.25, "THB": 0.026, "HKD": 0.118,
    "NZD": 0.55, "TWD": 0.028, "SKK": 0.0332,
}


def _to_eur(amount: float, currency: str | None) -> float:
    """Convert a receipt amount to approximate EUR for matching purposes."""
    if not currency or currency.upper() == "EUR":
        return amount
    rate = _EUR_RATES.get(currency.upper())
    if rate is None:
        return amount  # unknown currency — compare as-is, let score absorb the error
    return amount * rate


@dataclass
class ProposedMatch:
    transaction_id: str
    receipt_id: str
    confidence: float
    extra_receipt_id: str | None = field(default=None)  # second receipt for split matches


def _date_score(tx_date: date, rx_date: date | None) -> float:
    if rx_date is None:
        return 0.0
    diff = abs((tx_date - rx_date).days)
    if diff == 0:
        return 1.0
    if diff == 1:
        return 0.8
    if diff == 2:
        return 0.6
    if diff <= 5:
        return 0.3
    return 0.0


def _amount_score(tx_amount: float, rx_amount: float | None, rx_currency: str | None = None) -> float:
    if rx_amount is None:
        return 0.0
    tx_abs = abs(tx_amount)
    rx_abs = abs(_to_eur(rx_amount, rx_currency))
    diff = abs(tx_abs - rx_abs)
    if diff <= 0.02:
        return 1.0
    if diff <= 0.50:
        return 0.7
    if diff <= 2.00:
        return 0.3
    # VAT slack: receipt may show net amount, CC charges gross
    # German VAT rates: 7% (DB Fernverkehr, books) and 19% (most services)
    if tx_abs > 0:
        ratio = diff / tx_abs
        if ratio <= 0.08:   # ≈7% Mwst gap
            return 0.55
        if ratio <= 0.21:   # ≈19% Mwst gap
            return 0.45
    return 0.0


def match_receipts(
    transactions: list[dict],  # each: {id, booking_date, amount, needs_receipt}
    receipts: list[dict],      # each: {id, extracted_date, extracted_amount}
    threshold: float = 0.4,
) -> list[ProposedMatch]:
    """
    Returns a list of ProposedMatch (best greedy assignment).
    Only considers transactions with needs_receipt=True.
    Pass 1: single receipt match.
    Pass 2: split receipt match for remaining transactions (two receipts summing to tx amount).
    """
    # ── Pass 1: single receipt ──────────────────────────────────────────────────
    candidates: list[tuple[float, str, str]] = []

    for tx in transactions:
        if not tx.get("needs_receipt", True):
            continue
        for rx in receipts:
            ds = _date_score(tx["booking_date"], rx.get("extracted_date"))
            as_ = _amount_score(tx["amount"], rx.get("extracted_amount"), rx.get("extracted_currency"))
            score = 0.4 * ds + 0.6 * as_
            if score >= threshold:
                candidates.append((score, tx["id"], rx["id"]))

    candidates.sort(key=lambda c: c[0], reverse=True)

    assigned_tx: set[str] = set()
    assigned_rx: set[str] = set()
    matches: list[ProposedMatch] = []

    for score, tx_id, rx_id in candidates:
        if tx_id in assigned_tx or rx_id in assigned_rx:
            continue
        matches.append(ProposedMatch(transaction_id=tx_id, receipt_id=rx_id, confidence=score))
        assigned_tx.add(tx_id)
        assigned_rx.add(rx_id)

    # ── Pass 2: split receipt pairs ─────────────────────────────────────────────
    unmatched_tx = [t for t in transactions if t.get("needs_receipt", True) and t["id"] not in assigned_tx]
    unmatched_rx = [r for r in receipts if r["id"] not in assigned_rx]

    if unmatched_tx and len(unmatched_rx) >= 2:
        split_candidates: list[tuple[float, str, str, str]] = []  # score, tx_id, rx1_id, rx2_id

        for tx in unmatched_tx:
            tx_abs = abs(tx["amount"])
            for i, rx1 in enumerate(unmatched_rx):
                a1 = rx1.get("extracted_amount")
                if a1 is None:
                    continue
                a1_eur = _to_eur(a1, rx1.get("extracted_currency"))
                for rx2 in unmatched_rx[i + 1:]:
                    a2 = rx2.get("extracted_amount")
                    if a2 is None:
                        continue
                    a2_eur = _to_eur(a2, rx2.get("extracted_currency"))
                    total = abs(a1_eur) + abs(a2_eur)
                    if abs(total - tx_abs) > 0.10:
                        continue
                    # Amount matches — score using date proximity
                    ds = max(
                        _date_score(tx["booking_date"], rx1.get("extracted_date")),
                        _date_score(tx["booking_date"], rx2.get("extracted_date")),
                    )
                    score = 0.3 * ds + 0.7  # amount match is near-perfect, downweight vs pass-1
                    split_candidates.append((score, tx["id"], rx1["id"], rx2["id"]))

        split_candidates.sort(key=lambda c: c[0], reverse=True)

        for score, tx_id, rx1_id, rx2_id in split_candidates:
            if tx_id in assigned_tx or rx1_id in assigned_rx or rx2_id in assigned_rx:
                continue
            matches.append(ProposedMatch(
                transaction_id=tx_id,
                receipt_id=rx1_id,
                confidence=score,
                extra_receipt_id=rx2_id,
            ))
            assigned_tx.add(tx_id)
            assigned_rx.add(rx1_id)
            assigned_rx.add(rx2_id)

    return matches
