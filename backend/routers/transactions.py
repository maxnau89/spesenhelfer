import os
import shutil
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth import CurrentUser
from backend.database import get_db
from backend.models import MonthlyReport, Transaction
from backend.schemas import TransactionOut, TransactionUpdate
from backend.services.pdf_parser import parse_cc_statement
from backend.settings import settings

router = APIRouter(tags=["Transactions"])


@router.post("/api/v1/reports/{report_id}/statement", response_model=list[TransactionOut], status_code=201)
async def upload_statement(report_id: str, file: UploadFile, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    report = await _get_report_or_404(report_id, user.email, db)
    existing = await db.execute(select(Transaction).where(Transaction.report_id == report_id))
    for tx in existing.scalars().all():
        await db.delete(tx)
    await db.commit()
    suffix = os.path.splitext(file.filename or "statement.pdf")[1] or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
    upload_dir = os.path.join(settings.upload_dir, f"{report.year}-{report.month:02d}")
    os.makedirs(upload_dir, exist_ok=True)
    shutil.copy(tmp_path, os.path.join(upload_dir, "statement.pdf"))
    try:
        parsed = parse_cc_statement(tmp_path)
    finally:
        os.unlink(tmp_path)
    if not parsed:
        raise HTTPException(422, "No transactions found in PDF — check format")
    created: list[Transaction] = []
    for p in parsed:
        tx = Transaction(report_id=report_id, booking_date=p.booking_date, value_date=p.value_date,
                         description=p.description, amount=p.amount, currency=p.currency,
                         needs_receipt=p.needs_receipt, raw_text=p.raw_text)
        db.add(tx); created.append(tx)
    await db.commit()
    for tx in created:
        await db.refresh(tx)
    result = await db.execute(select(Transaction).where(Transaction.report_id == report_id)
                              .options(selectinload(Transaction.match)).order_by(Transaction.booking_date))
    return result.scalars().all()


@router.get("/api/v1/reports/{report_id}/transactions", response_model=list[TransactionOut])
async def list_transactions(report_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await _get_report_or_404(report_id, user.email, db)
    result = await db.execute(select(Transaction).where(Transaction.report_id == report_id)
                              .options(selectinload(Transaction.match)).order_by(Transaction.booking_date))
    return result.scalars().all()


@router.patch("/api/v1/transactions/{tx_id}", response_model=TransactionOut)
async def update_transaction(tx_id: str, body: TransactionUpdate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Transaction).where(Transaction.id == tx_id).options(selectinload(Transaction.match)))
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(404, "Transaction not found")
    await _get_report_or_404(tx.report_id, user.email, db)
    if body.category is not None: tx.category = body.category
    if body.needs_receipt is not None: tx.needs_receipt = body.needs_receipt
    await db.commit(); await db.refresh(tx)
    return tx


async def _get_report_or_404(report_id: str, owner_email: str, db: AsyncSession) -> MonthlyReport:
    result = await db.execute(select(MonthlyReport).where(MonthlyReport.id == report_id, MonthlyReport.owner_email == owner_email))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Report not found")
    return report
