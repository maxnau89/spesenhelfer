"""
JWT authentication for Spesenhelfer.

Validates tokens issued by the wsai platform (platform.alphatransition.com).
Both apps share the same JWT_SECRET_KEY — no database lookup needed.
Token payload contains: sub (email), user_id, role, exp.
"""

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from backend.settings import settings

security = HTTPBearer()


class TokenUser(BaseModel):
    email: str
    user_id: str | None = None
    role: str = "user"
    name: str | None = None  # from JWT if present

    @property
    def display_name(self) -> str:
        """Best-effort full name: JWT name field or email-derived."""
        if self.name:
            return self.name
        local = self.email.split("@")[0]
        parts = local.replace("_", ".").split(".")
        return " ".join(p.capitalize() for p in parts)


def _decode(token: str) -> dict | None:
    if not settings.jwt_secret_key:
        return None
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> TokenUser:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = _decode(credentials.credentials)
    if not payload:
        raise exc
    email = payload.get("sub")
    if not email:
        raise exc
    return TokenUser(
        email=email,
        user_id=payload.get("user_id"),
        role=payload.get("role", "user"),
        name=payload.get("name"),
    )


# Convenience type alias for route signatures
CurrentUser = Annotated[TokenUser, Depends(get_current_user)]
