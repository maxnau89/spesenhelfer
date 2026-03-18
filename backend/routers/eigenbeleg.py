"""
Eigenbeleg generation endpoint.

POST /api/v1/reports/{report_id}/eigenbeleg
  → generates a PDF, saves it as a Receipt, optionally links it to a Match.
"""

import os
from datetime import date, datetime

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth import CurrentUser, get_current_user
from backend.database import get_db
from backend.models import Match, MonthlyReport, Receipt
from backend.schemas import ReceiptOut
from backend.services.eigenbeleg_generator import (
    EIGENBELEG_GRUENDE,
    EigenbelegData,
    generate_eigenbeleg_pdf,
)
from backend.settings import settings

router = APIRouter(tags=["Eigenbeleg"])


class EigenbelegRequest(BaseModel):
    transaction_id: str | None = None          # link to this transaction's match
    betrag_original: float
    currency: str = "EUR"
    betrag_eur: float
    eur_rate: float | None = None
    empfaenger: str
    verwendungszweck: str
    grund: str
    ort: str = "Stuttgart"
    ausgabedatum: date
    name: str = "Maximilian Naumow"


@router.get("/api/v1/eigenbeleg/gruende")
async def list_gruende():
    return {"gruende": EIGENBELEG_GRUENDE}


@router.post("/api/v1/reports/{report_id}/eigenbeleg", response_model=ReceiptOut, status_code=201)
async def create_eigenbeleg(
    report_id: str,
    body: EigenbelegRequest,
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    # Load report
    result = await db.execute(select(MonthlyReport).where(MonthlyReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(404, "Report not found")

    # Increment eigenbeleg counter
    report.eigenbeleg_count = (report.eigenbeleg_count or 0) + 1
    belegnummer = f"{report.eigenbeleg_count:04d}"

    # Generate PDF
    data = EigenbelegData(
        belegnummer=belegnummer,
        betrag_original=body.betrag_original,
        currency=body.currency.upper(),
        betrag_eur=body.betrag_eur,
        eur_rate=body.eur_rate,
        empfaenger=body.empfaenger,
        verwendungszweck=body.verwendungszweck,
        grund=body.grund,
        ort=body.ort,
        ausgabedatum=body.ausgabedatum,
        erstelldatum=date.today(),
        name=body.name,
    )
    pdf_bytes = generate_eigenbeleg_pdf(data)

    # Save PDF to disk
    upload_dir = os.path.join(
        settings.upload_dir, f"{report.year}-{report.month:02d}", "receipts"
    )
    os.makedirs(upload_dir, exist_ok=True)
    filename = f"Eigenbeleg_{belegnummer}_{body.ausgabedatum.strftime('%Y%m%d')}.pdf"
    file_path = os.path.join(upload_dir, filename)
    with open(file_path, "wb") as f:
        f.write(pdf_bytes)

    # Create Receipt record
    receipt = Receipt(
        report_id=report_id,
        filename=filename,
        file_path=file_path,
        extracted_date=body.ausgabedatum,
        extracted_amount=body.betrag_eur,
        extracted_currency="EUR",
        extracted_vendor=body.empfaenger.splitlines()[0][:80],
        extraction_confidence=1.0,
        extraction_method="eigenbeleg",
    )
    db.add(receipt)
    await db.flush()  # get receipt.id

    # Link to transaction's match if provided
    if body.transaction_id:
        match_result = await db.execute(
            select(Match)
            .where(Match.transaction_id == body.transaction_id)
            .options(selectinload(Match.receipt))
        )
        existing_match = match_result.scalar_one_or_none()
        if existing_match:
            existing_match.receipt_id = receipt.id
            existing_match.match_type = "manual"
            existing_match.confirmed = True
        else:
            new_match = Match(
                transaction_id=body.transaction_id,
                receipt_id=receipt.id,
                match_type="manual",
                confidence=1.0,
                confirmed=True,
            )
            db.add(new_match)

    await db.commit()

    # Re-query with match eagerly loaded to avoid async greenlet error during serialization
    result = await db.execute(
        select(Receipt).where(Receipt.id == receipt.id).options(selectinload(Receipt.match))
    )
    return result.scalar_one()
