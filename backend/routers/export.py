import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth import CurrentUser
from backend.database import get_db
from backend.models import Match, MonthlyReport, Transaction
from backend.services.pdf_assembler import assemble_pdf
from backend.settings import settings

router = APIRouter(tags=["Export"])


@router.get("/api/v1/reports/{report_id}/export/pdf")
async def export_pdf(report_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    report = await _get_report_or_404(report_id, user.email, db)

    # Find statement PDF
    upload_dir = os.path.join(settings.upload_dir, f"{report.year}-{report.month:02d}")
    statement_path = os.path.join(upload_dir, "statement.pdf")
    if not os.path.exists(statement_path):
        raise HTTPException(422, "No CC statement uploaded for this report")

    # Get confirmed matches ordered by transaction booking_date
    tx_result = await db.execute(
        select(Transaction)
        .where(Transaction.report_id == report_id)
        .options(selectinload(Transaction.match).selectinload(Match.receipt))
        .order_by(Transaction.booking_date)
    )
    transactions = tx_result.scalars().all()

    receipt_paths: list[str] = []
    for tx in transactions:
        if tx.match and tx.match.receipt_id and tx.match.receipt:
            rp = tx.match.receipt.file_path
            if os.path.exists(rp) and rp not in receipt_paths:
                receipt_paths.append(rp)

    # Assemble
    output_path = os.path.join(upload_dir, f"export_{report.year}-{report.month:02d}.pdf")
    assemble_pdf(statement_path, receipt_paths, output_path)

    MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni",
                 "Juli","August","September","Oktober","November","Dezember"]
    month_name = MONTHS_DE[report.month - 1]
    filename = f"KKA {user.display_name} {month_name} {report.year}.pdf"
    return FileResponse(output_path, media_type="application/pdf", filename=filename)


@router.get("/api/v1/reports/{report_id}/export/status")
async def export_status(report_id: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    report = await _get_report_or_404(report_id, user.email, db)

    tx_result = await db.execute(
        select(Transaction)
        .where(Transaction.report_id == report_id)
        .options(selectinload(Transaction.match))
    )
    transactions = tx_result.scalars().all()

    missing = sum(
        1 for t in transactions
        if t.needs_receipt and (not t.match or (t.match.match_type not in ("acknowledged_missing", "no_receipt_needed") and not t.match.confirmed))
    )

    upload_dir = os.path.join(settings.upload_dir, f"{report.year}-{report.month:02d}")
    has_statement = os.path.exists(os.path.join(upload_dir, "statement.pdf"))

    return {
        "ready": missing == 0 and has_statement,
        "can_export": has_statement,   # always exportable if statement exists
        "has_statement": has_statement,
        "missing_receipts": missing,
    }


async def _get_report_or_404(report_id: str, owner_email: str, db: AsyncSession) -> MonthlyReport:
    result = await db.execute(select(MonthlyReport).where(MonthlyReport.id == report_id, MonthlyReport.owner_email == owner_email))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Report not found")
    return report
