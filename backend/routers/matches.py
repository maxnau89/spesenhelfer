import json

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth import CurrentUser
from backend.database import get_db
from backend.models import Match, MonthlyReport, Receipt, Transaction
from backend.schemas import MatchCreate, MatchOut, MatchUpdate
from backend.services.matcher import match_receipts

router = APIRouter(tags=["Matches"])


@router.post("/api/v1/reports/{report_id}/match", response_model=list[MatchOut])
async def run_auto_match(report_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Run auto-matching algorithm. Deletes previous auto matches, keeps manual/acknowledged ones."""
    await _get_report_or_404(report_id, user.email, db)

    # Load transactions and receipts
    tx_result = await db.execute(
        select(Transaction).where(Transaction.report_id == report_id).options(selectinload(Transaction.match))
    )
    transactions = tx_result.scalars().all()

    rx_result = await db.execute(
        select(Receipt).where(Receipt.report_id == report_id)
    )
    receipts = rx_result.scalars().all()

    # Delete only previous auto matches
    for tx in transactions:
        if tx.match and tx.match.match_type == "auto":
            await db.delete(tx.match)
    await db.commit()

    # Reload after deletion
    tx_result = await db.execute(
        select(Transaction).where(Transaction.report_id == report_id).options(selectinload(Transaction.match))
    )
    transactions = tx_result.scalars().all()

    # Build dicts for matcher (exclude already-matched transactions)
    tx_dicts = [
        {"id": t.id, "booking_date": t.booking_date, "amount": t.amount, "needs_receipt": t.needs_receipt}
        for t in transactions if not t.match
    ]
    # Only unmatched receipts (including extra split receipts already assigned)
    matched_rx_ids: set[str] = set()
    for t in transactions:
        if t.match and t.match.receipt_id:
            matched_rx_ids.add(t.match.receipt_id)
        if t.match and t.match.extra_receipt_ids:
            try:
                matched_rx_ids.update(json.loads(t.match.extra_receipt_ids))
            except Exception:
                pass
    rx_dicts = [
        {"id": r.id, "extracted_date": r.extracted_date,
         "extracted_amount": r.extracted_amount, "extracted_currency": r.extracted_currency}
        for r in receipts if r.id not in matched_rx_ids
    ]

    proposed = match_receipts(tx_dicts, rx_dicts)

    created: list[Match] = []
    for pm in proposed:
        extra = json.dumps([pm.extra_receipt_id]) if pm.extra_receipt_id else "[]"
        m = Match(
            transaction_id=pm.transaction_id,
            receipt_id=pm.receipt_id,
            extra_receipt_ids=extra,
            match_type="auto",
            confidence=pm.confidence,
            confirmed=False,
        )
        db.add(m)
        created.append(m)

    await db.commit()
    for m in created:
        await db.refresh(m)

    result = await db.execute(select(Match).where(Match.transaction_id.in_([m.transaction_id for m in created])))
    return result.scalars().all()


@router.get("/api/v1/reports/{report_id}/matches", response_model=list[MatchOut])
async def list_matches(report_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await _get_report_or_404(report_id, user.email, db)
    tx_result = await db.execute(select(Transaction.id).where(Transaction.report_id == report_id))
    tx_ids = [row[0] for row in tx_result.all()]
    result = await db.execute(select(Match).where(Match.transaction_id.in_(tx_ids)))
    return result.scalars().all()


@router.post("/api/v1/matches", response_model=MatchOut, status_code=201)
async def create_match(body: MatchCreate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    # Remove existing match for this transaction
    existing = await db.execute(select(Match).where(Match.transaction_id == body.transaction_id))
    old = existing.scalar_one_or_none()
    if old:
        await db.delete(old)
        await db.commit()

    m = Match(
        transaction_id=body.transaction_id,
        receipt_id=body.receipt_id,
        match_type=body.match_type,
        confidence=1.0,
        confirmed=True,
        notes=body.notes,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


@router.patch("/api/v1/matches/{match_id}", response_model=MatchOut)
async def update_match(match_id: str, body: MatchUpdate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Match).where(Match.id == match_id))
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(404, "Match not found")
    if body.receipt_id is not None:
        match.receipt_id = body.receipt_id
    if body.match_type is not None:
        match.match_type = body.match_type
    if body.confirmed is not None:
        match.confirmed = body.confirmed
    if body.notes is not None:
        match.notes = body.notes
    await db.commit()
    await db.refresh(match)
    return match


@router.delete("/api/v1/matches/{match_id}", status_code=204)
async def delete_match(match_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Match).where(Match.id == match_id))
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(404, "Match not found")
    await db.delete(match)
    await db.commit()


@router.post("/api/v1/matches/{match_id}/acknowledge", response_model=MatchOut)
async def acknowledge_match(match_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Mark as 'acknowledged missing' — no receipt will be provided."""
    result = await db.execute(select(Match).where(Match.id == match_id))
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(404, "Match not found")
    match.match_type = "acknowledged_missing"
    match.confirmed = True
    await db.commit()
    await db.refresh(match)
    return match


@router.post("/api/v1/transactions/{tx_id}/no-receipt", response_model=MatchOut, status_code=201)
async def mark_no_receipt_needed(tx_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Mark a transaction as not needing a receipt (e.g. bank fees, internal transfers)."""
    # Remove existing match
    existing = await db.execute(select(Match).where(Match.transaction_id == tx_id))
    old = existing.scalar_one_or_none()
    if old:
        await db.delete(old)
        await db.commit()

    # Update transaction
    tx_result = await db.execute(select(Transaction).where(Transaction.id == tx_id))
    tx = tx_result.scalar_one_or_none()
    if not tx:
        raise HTTPException(404, "Transaction not found")
    tx.needs_receipt = False

    m = Match(
        transaction_id=tx_id,
        match_type="no_receipt_needed",
        confidence=1.0,
        confirmed=True,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


@router.post("/api/v1/matches/{match_id}/split-receipt", response_model=MatchOut)
async def set_split_receipt(match_id: str, receipt_id: str = Body(..., embed=True), db: AsyncSession = Depends(get_db)):
    """Link a second receipt to an existing match (DB Hin+Rückfahrt split-ticket)."""
    result = await db.execute(select(Match).where(Match.id == match_id))
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(404, "Match not found")
    match.extra_receipt_ids = json.dumps([receipt_id])
    await db.commit()
    await db.refresh(match)
    return match


@router.delete("/api/v1/matches/{match_id}/split-receipt", response_model=MatchOut)
async def clear_split_receipt(match_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Remove the split second receipt from a match."""
    result = await db.execute(select(Match).where(Match.id == match_id))
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(404, "Match not found")
    match.extra_receipt_ids = "[]"
    await db.commit()
    await db.refresh(match)
    return match


async def _get_report_or_404(report_id: str, owner_email: str, db: AsyncSession) -> MonthlyReport:
    result = await db.execute(select(MonthlyReport).where(MonthlyReport.id == report_id, MonthlyReport.owner_email == owner_email))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Report not found")
    return report
