from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.models import Match, MonthlyReport, Receipt, Transaction
from backend.schemas import ReportCreate, ReportDashboard, ReportOut, ReportStats, TodoItem, TodoList

router = APIRouter(prefix="/api/v1/reports", tags=["Reports"])


@router.get("", response_model=list[ReportOut])
async def list_reports(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MonthlyReport).order_by(MonthlyReport.year.desc(), MonthlyReport.month.desc()))
    return result.scalars().all()


@router.post("", response_model=ReportOut, status_code=201)
async def create_report(body: ReportCreate, db: AsyncSession = Depends(get_db)):
    # Check duplicate
    existing = await db.execute(
        select(MonthlyReport).where(MonthlyReport.year == body.year, MonthlyReport.month == body.month)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"Report for {body.year}-{body.month:02d} already exists")
    report = MonthlyReport(year=body.year, month=body.month, notes=body.notes)
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report


@router.get("/{report_id}", response_model=ReportDashboard)
async def get_report(report_id: str, db: AsyncSession = Depends(get_db)):
    report = await _get_report_or_404(report_id, db)

    tx_result = await db.execute(
        select(Transaction).where(Transaction.report_id == report_id).options(selectinload(Transaction.match))
    )
    transactions = tx_result.scalars().all()

    rx_result = await db.execute(
        select(Receipt).where(Receipt.report_id == report_id).options(selectinload(Receipt.match))
    )
    receipts = rx_result.scalars().all()

    total_spend = sum(abs(t.amount) for t in transactions if t.amount < 0)
    matched = sum(1 for t in transactions if t.match and t.match.confirmed)
    missing = sum(
        1 for t in transactions
        if t.needs_receipt and (not t.match or (t.match.match_type not in ("acknowledged_missing", "no_receipt_needed") and not t.match.confirmed))
    )
    orphaned = sum(1 for r in receipts if not r.match)
    ready = missing == 0 and len(transactions) > 0

    # Update status
    new_status = "ready" if ready else "draft"
    if report.status != "exported":
        report.status = new_status
        report.updated_at = datetime.utcnow()
        await db.commit()

    return ReportDashboard(
        report=ReportOut.model_validate(report),
        stats=ReportStats(
            total_transactions=len(transactions),
            total_spend=round(total_spend, 2),
            matched=matched,
            missing_receipts=missing,
            orphaned_receipts=orphaned,
            ready_to_export=ready,
        ),
    )


@router.delete("/{report_id}", status_code=204)
async def delete_report(report_id: str, db: AsyncSession = Depends(get_db)):
    report = await _get_report_or_404(report_id, db)
    await db.delete(report)
    await db.commit()


@router.get("/{report_id}/todo", response_model=TodoList)
async def get_todo(report_id: str, db: AsyncSession = Depends(get_db)):
    await _get_report_or_404(report_id, db)

    result = await db.execute(
        select(Transaction)
        .where(Transaction.report_id == report_id, Transaction.needs_receipt == True)  # noqa: E712
        .options(selectinload(Transaction.match))
        .order_by(Transaction.booking_date)
    )
    transactions = result.scalars().all()

    missing = [
        t for t in transactions
        if not t.match or t.match.match_type not in ("acknowledged_missing", "no_receipt_needed")
        and not t.match.confirmed
    ]

    return TodoList(
        report_id=report_id,
        missing_count=len(missing),
        items=[
            TodoItem(
                transaction_id=t.id,
                booking_date=t.booking_date,
                description=t.description,
                amount=t.amount,
                currency=t.currency,
            )
            for t in missing
        ],
    )


async def _get_report_or_404(report_id: str, db: AsyncSession) -> MonthlyReport:
    result = await db.execute(select(MonthlyReport).where(MonthlyReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Report not found")
    return report
