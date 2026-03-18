from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.auth import get_current_user
from backend.database import init_db, _migrate
from backend.routers import health, reports, transactions, receipts, matches, export, eigenbeleg
from backend.settings import settings


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    await _migrate()
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

app.include_router(health.router)  # public — no auth

# All /api/* routes require valid JWT (issued by platform.alphatransition.com)
_auth = [Depends(get_current_user)]
app.include_router(reports.router, dependencies=_auth)
app.include_router(transactions.router, dependencies=_auth)
app.include_router(receipts.router, dependencies=_auth)
app.include_router(matches.router, dependencies=_auth)
app.include_router(export.router, dependencies=_auth)
app.include_router(eigenbeleg.router, dependencies=_auth)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.api_host, port=settings.api_port, reload=True)
