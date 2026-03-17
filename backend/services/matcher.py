"""
Greedy best-first receipt ↔ transaction matcher.

Scoring:
  date_score:   days_diff 0→1.0, 1→0.8, 2→0.6, ≤5→0.3, else 0
  amount_score: diff ≤0.02→1.0, ≤0.50→0.7, ≤2.00→0.3, else 0
  combined = 0.4*date_score + 0.6*amount_score  (amount weighted higher)

Threshold: pairs with combined < 0.4 are discarded.
"""

from dataclasses import dataclass
from datetime import date


@dataclass
class ProposedMatch:
    transaction_id: str
    receipt_id: str
    confidence: float


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


def _amount_score(tx_amount: float, rx_amount: float | None) -> float:
    if rx_amount is None:
        return 0.0
    diff = abs(abs(tx_amount) - abs(rx_amount))
    if diff <= 0.02:
        return 1.0
    if diff <= 0.50:
        return 0.7
    if diff <= 2.00:
        return 0.3
    return 0.0


def match_receipts(
    transactions: list[dict],  # each: {id, booking_date, amount, needs_receipt}
    receipts: list[dict],      # each: {id, extracted_date, extracted_amount}
    threshold: float = 0.4,
) -> list[ProposedMatch]:
    """
    Returns a list of ProposedMatch (best greedy assignment).
    Only considers transactions with needs_receipt=True.
    """
    candidates: list[tuple[float, str, str]] = []

    for tx in transactions:
        if not tx.get("needs_receipt", True):
            continue
        for rx in receipts:
            ds = _date_score(tx["booking_date"], rx.get("extracted_date"))
            as_ = _amount_score(tx["amount"], rx.get("extracted_amount"))
            score = 0.4 * ds + 0.6 * as_
            if score >= threshold:
                candidates.append((score, tx["id"], rx["id"]))

    # Sort descending by score
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

    return matches
