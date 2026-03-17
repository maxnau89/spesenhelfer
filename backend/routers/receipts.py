import os
import shutil
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.models import MonthlyReport, Receipt
from backend.schemas import ReceiptOut
from backend.services.receipt_extractor import extract_receipt
from backend.settings import settings

router = APIRouter(tags=["Receipts"])


@router.post("/api/v1/reports/{report_id}/receipts", response_model=list[ReceiptOut], status_code=201)
async def upload_receipts(
    report_id: str,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    report = await _get_report_or_404(report_id, db)
    upload_dir = os.path.join(settings.upload_dir, f"{report.year}-{report.month:02d}", "receipts")
    os.makedirs(upload_dir, exist_ok=True)

    created: list[Receipt] = []
    for file in files:
        filename = file.filename or "receipt.pdf"
        file_path = os.path.join(upload_dir, filename)
        # Handle filename collisions
        base, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(file_path):
            file_path = os.path.join(upload_dir, f"{base}_{counter}{ext}")
            counter += 1

        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        extracted = extract_receipt(file_path, filename, openai_api_key=settings.openai_api_key)

        receipt = Receipt(
            report_id=report_id,
            filename=filename,
            file_path=file_path,
            extracted_date=extracted.extracted_date,
            extracted_amount=extracted.extracted_amount,
            extracted_vendor=extracted.extracted_vendor,
            extraction_confidence=extracted.extraction_confidence,
            extraction_method=extracted.extraction_method,
            raw_extracted_text=extracted.raw_extracted_text,
        )
        db.add(receipt)
        created.append(receipt)

    await db.commit()
    for r in created:
        await db.refresh(r)

    result = await db.execute(
        select(Receipt).where(Receipt.report_id == report_id)
        .options(selectinload(Receipt.match))
        .order_by(Receipt.upload_at)
    )
    return result.scalars().all()


@router.get("/api/v1/reports/{report_id}/receipts", response_model=list[ReceiptOut])
async def list_receipts(report_id: str, db: AsyncSession = Depends(get_db)):
    await _get_report_or_404(report_id, db)
    result = await db.execute(
        select(Receipt).where(Receipt.report_id == report_id)
        .options(selectinload(Receipt.match))
        .order_by(Receipt.upload_at)
    )
    return result.scalars().all()


@router.delete("/api/v1/receipts/{receipt_id}", status_code=204)
async def delete_receipt(receipt_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    # Delete file from disk
    if os.path.exists(receipt.file_path):
        os.unlink(receipt.file_path)
    await db.delete(receipt)
    await db.commit()


async def _get_report_or_404(report_id: str, db: AsyncSession) -> MonthlyReport:
    result = await db.execute(select(MonthlyReport).where(MonthlyReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Report not found")
    return report
