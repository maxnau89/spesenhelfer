import hashlib
import io
import os
import shutil
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth import CurrentUser
from backend.database import get_db
from backend.models import MonthlyReport, Receipt
from backend.schemas import ReceiptOut
from backend.services.receipt_extractor import extract_receipt
from backend.settings import settings

router = APIRouter(tags=["Receipts"])


@router.post("/api/v1/reports/{report_id}/receipts", response_model=list[ReceiptOut], status_code=201)
async def upload_receipts(
    report_id: str,
    user: CurrentUser,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    report = await _get_report_or_404(report_id, user.email, db)
    upload_dir = os.path.join(settings.upload_dir, f"{report.year}-{report.month:02d}", "receipts")
    os.makedirs(upload_dir, exist_ok=True)

    # Load existing receipts for this report to enable deduplication
    existing_result = await db.execute(select(Receipt).where(Receipt.report_id == report_id))
    existing_receipts = existing_result.scalars().all()
    existing_filenames = {r.filename for r in existing_receipts}
    existing_hashes = {r.content_hash for r in existing_receipts if r.content_hash}

    created: list[Receipt] = []
    skipped = 0
    for file in files:
        filename = file.filename or "receipt.pdf"

        # Read file bytes once for hashing and writing
        file_bytes = await file.read()
        content_hash = hashlib.md5(file_bytes).hexdigest()

        # Skip exact duplicate (same content hash already in this report)
        if content_hash in existing_hashes:
            skipped += 1
            continue
        # Skip same filename (likely same file re-uploaded)
        if filename in existing_filenames:
            skipped += 1
            continue

        file_path = os.path.join(upload_dir, filename)
        base, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(file_path):
            file_path = os.path.join(upload_dir, f"{base}_{counter}{ext}")
            counter += 1

        with open(file_path, "wb") as f:
            f.write(file_bytes)

        extracted = extract_receipt(file_path, filename, openai_api_key=settings.openai_api_key)

        receipt = Receipt(
            report_id=report_id,
            filename=filename,
            file_path=file_path,
            content_hash=content_hash,
            extracted_date=extracted.extracted_date,
            extracted_amount=extracted.extracted_amount,
            extracted_currency=extracted.extracted_currency,
            extracted_vendor=extracted.extracted_vendor,
            extraction_confidence=extracted.extraction_confidence,
            extraction_method=extracted.extraction_method,
            raw_extracted_text=extracted.raw_extracted_text,
        )
        db.add(receipt)
        created.append(receipt)
        existing_hashes.add(content_hash)
        existing_filenames.add(filename)

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
async def list_receipts(report_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await _get_report_or_404(report_id, user.email, db)
    result = await db.execute(
        select(Receipt).where(Receipt.report_id == report_id)
        .options(selectinload(Receipt.match))
        .order_by(Receipt.upload_at)
    )
    return result.scalars().all()


@router.get("/api/v1/receipts/{receipt_id}/thumbnail")
async def get_receipt_thumbnail(receipt_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Render page 1 of a receipt PDF as PNG (150 dpi)."""
    receipt = await _get_receipt_or_404(receipt_id, db)
    if not os.path.exists(receipt.file_path):
        raise HTTPException(404, "File not found on disk")
    try:
        import pdfplumber
        from pdf2image import convert_from_path

        # Detect page rotation from PDF metadata so we can correct it
        rotation = 0
        try:
            with pdfplumber.open(receipt.file_path) as pdf:
                if pdf.pages:
                    rotation = pdf.pages[0].rotation or 0
        except Exception:
            pass

        images = convert_from_path(receipt.file_path, first_page=1, last_page=1, dpi=150)
        img = images[0]

        # Correct rotation: PDF rotation means the page was stored rotated,
        # so we rotate the rendered image back by the same angle.
        if rotation:
            img = img.rotate(rotation, expand=True)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return Response(content=buf.read(), media_type="image/png",
                        headers={"Cache-Control": "max-age=3600"})
    except Exception as e:
        raise HTTPException(500, f"Thumbnail generation failed: {e}")


@router.delete("/api/v1/receipts/{receipt_id}", status_code=204)
async def delete_receipt(receipt_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    # Delete file from disk
    if os.path.exists(receipt.file_path):
        os.unlink(receipt.file_path)
    await db.delete(receipt)
    await db.commit()


async def _get_receipt_or_404(receipt_id: str, db: AsyncSession) -> Receipt:
    result = await db.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    return receipt


async def _get_report_or_404(report_id: str, owner_email: str, db: AsyncSession) -> MonthlyReport:
    result = await db.execute(select(MonthlyReport).where(MonthlyReport.id == report_id, MonthlyReport.owner_email == owner_email))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Report not found")
    return report
