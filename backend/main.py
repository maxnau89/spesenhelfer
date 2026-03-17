from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import init_db
from backend.routers import health, reports, transactions, receipts, matches, export
from backend.settings import settings


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield


app = FastAPI(
    title="Spesenhelfer API",
    description="Expense report automation — Kreditkartenabrechnung & Reisekostenabrechnung",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(health.router)
app.include_router(reports.router)
app.include_router(transactions.router)
app.include_router(receipts.router)
app.include_router(matches.router)
app.include_router(export.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.api_host, port=settings.api_port, reload=True)
