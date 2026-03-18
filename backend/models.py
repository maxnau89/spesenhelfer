import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


def new_uuid() -> str:
    return str(uuid.uuid4())


class MonthlyReport(Base):
    __tablename__ = "monthly_report"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    owner_email: Mapped[str] = mapped_column(String, nullable=False, index=True, default="")
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, default="draft")  # draft|ready|exported
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    eigenbeleg_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="report", cascade="all, delete-orphan")
    receipts: Mapped[list["Receipt"]] = relationship(back_populates="report", cascade="all, delete-orphan")


class Transaction(Base):
    __tablename__ = "transaction"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    report_id: Mapped[str] = mapped_column(String, ForeignKey("monthly_report.id"), nullable=False)
    booking_date: Mapped[date] = mapped_column(Date, nullable=False)
    value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String, default="EUR")
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    needs_receipt: Mapped[bool] = mapped_column(Boolean, default=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    report: Mapped["MonthlyReport"] = relationship(back_populates="transactions")
    match: Mapped["Match | None"] = relationship(back_populates="transaction", uselist=False, cascade="all, delete-orphan")


class Receipt(Base):
    __tablename__ = "receipt"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    report_id: Mapped[str] = mapped_column(String, ForeignKey("monthly_report.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    upload_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    extracted_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    extracted_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    extracted_currency: Mapped[str | None] = mapped_column(String, nullable=True)
    extracted_vendor: Mapped[str | None] = mapped_column(String, nullable=True)
    extraction_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    extraction_method: Mapped[str] = mapped_column(String, default="pdfplumber")  # pdfplumber|vision_llm
    raw_extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    report: Mapped["MonthlyReport"] = relationship(back_populates="receipts")
    match: Mapped["Match | None"] = relationship(back_populates="receipt", uselist=False)


class Match(Base):
    __tablename__ = "match"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    transaction_id: Mapped[str] = mapped_column(String, ForeignKey("transaction.id"), nullable=False, unique=True)
    receipt_id: Mapped[str | None] = mapped_column(String, ForeignKey("receipt.id"), nullable=True)
    # JSON array of additional receipt IDs for split-ticket scenarios (e.g. DB Hin+Rückfahrt)
    extra_receipt_ids: Mapped[str] = mapped_column(Text, default="[]")
    match_type: Mapped[str] = mapped_column(String, default="auto")  # auto|manual|acknowledged_missing|no_receipt_needed
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    transaction: Mapped["Transaction"] = relationship(back_populates="match")
    receipt: Mapped["Receipt | None"] = relationship(back_populates="match")
