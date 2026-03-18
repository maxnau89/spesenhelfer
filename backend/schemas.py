import json
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, field_validator


# ── Match ──────────────────────────────────────────────────────────────────────

class MatchOut(BaseModel):
    id: str
    transaction_id: str
    receipt_id: Optional[str]
    extra_receipt_ids: list[str] = []
    match_type: str
    confidence: float
    confirmed: bool
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

    @field_validator("extra_receipt_ids", mode="before")
    @classmethod
    def parse_extra_receipt_ids(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return []
        return v or []


class MatchCreate(BaseModel):
    transaction_id: str
    receipt_id: Optional[str] = None
    match_type: str = "manual"
    notes: Optional[str] = None


class MatchUpdate(BaseModel):
    receipt_id: Optional[str] = None
    match_type: Optional[str] = None
    confirmed: Optional[bool] = None
    notes: Optional[str] = None


# ── Transaction ────────────────────────────────────────────────────────────────

class TransactionOut(BaseModel):
    id: str
    report_id: str
    booking_date: date
    value_date: Optional[date]
    description: str
    amount: float
    currency: str
    category: Optional[str]
    needs_receipt: bool
    match: Optional[MatchOut]

    class Config:
        from_attributes = True


class TransactionUpdate(BaseModel):
    category: Optional[str] = None
    needs_receipt: Optional[bool] = None


# ── Receipt ────────────────────────────────────────────────────────────────────

class ReceiptOut(BaseModel):
    id: str
    report_id: str
    filename: str
    extracted_date: Optional[date]
    extracted_amount: Optional[float]
    extracted_currency: Optional[str]
    extracted_vendor: Optional[str]
    extraction_confidence: float
    extraction_method: str
    match: Optional[MatchOut]

    class Config:
        from_attributes = True


# ── Report ─────────────────────────────────────────────────────────────────────

class ReportCreate(BaseModel):
    year: int
    month: int
    notes: Optional[str] = None


class ReportStats(BaseModel):
    total_transactions: int
    total_spend: float
    matched: int
    missing_receipts: int
    orphaned_receipts: int
    ready_to_export: bool


class ReportOut(BaseModel):
    id: str
    year: int
    month: int
    status: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReportUpdate(BaseModel):
    notes: Optional[str] = None


class ReportDashboard(BaseModel):
    report: ReportOut
    stats: ReportStats


# ── Todo ───────────────────────────────────────────────────────────────────────

class TodoItem(BaseModel):
    transaction_id: str
    booking_date: date
    description: str
    amount: float
    currency: str


class TodoList(BaseModel):
    report_id: str
    missing_count: int
    items: list[TodoItem]
