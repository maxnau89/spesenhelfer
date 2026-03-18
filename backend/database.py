import os
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.settings import settings

# Ensure data directory exists
os.makedirs(os.path.dirname(settings.database_url.replace("sqlite+aiosqlite:///", "")), exist_ok=True)

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migrate: add extra_receipt_ids column if not present (existing DBs)
        await conn.execute(
            __import__("sqlalchemy").text(
                "ALTER TABLE match ADD COLUMN extra_receipt_ids TEXT DEFAULT '[]'"
            ).execution_options(compile_kwargs={"literal_binds": True})
        ) if False else None  # placeholder — run via try/except below


async def _migrate() -> None:
    """Add columns to existing SQLite DB that predate them."""
    import sqlalchemy as sa
    async with engine.begin() as conn:
        try:
            await conn.execute(sa.text("ALTER TABLE match ADD COLUMN extra_receipt_ids TEXT DEFAULT '[]'"))
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(sa.text("ALTER TABLE receipt ADD COLUMN extracted_currency TEXT"))
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(sa.text("ALTER TABLE monthly_report ADD COLUMN eigenbeleg_count INTEGER DEFAULT 0"))
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(sa.text("ALTER TABLE monthly_report ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''"))
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(sa.text("ALTER TABLE receipt ADD COLUMN content_hash TEXT"))
        except Exception:
            pass  # column already exists
