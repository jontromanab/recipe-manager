"""Stub authentication.

Bearer tokens map to a fixed set of users. In production this module would
verify a JWT / session from an identity provider; everything downstream only
depends on `CurrentUser`, so the swap stays local to this file.
"""

from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.errors import Forbidden, Unauthorized

Role = Literal["viewer", "editor"]


@dataclass(frozen=True)
class User:
    id: str
    name: str
    org_id: str
    org_name: str
    role: Role

    @property
    def can_edit(self) -> bool:
        return self.role == "editor"


ORGS = {"bistro": "Bistro Verde", "harbor": "Harbor Grill"}

USERS_BY_TOKEN: dict[str, User] = {
    "bistro-editor": User("u1", "Ana (chef)", "bistro", ORGS["bistro"], "editor"),
    "bistro-viewer": User("u2", "Ben (line cook)", "bistro", ORGS["bistro"], "viewer"),
    "harbor-editor": User("u3", "Chloe (chef)", "harbor", ORGS["harbor"], "editor"),
    "harbor-viewer": User("u4", "Dev (line cook)", "harbor", ORGS["harbor"], "viewer"),
}

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if creds is None:
        raise Unauthorized("Missing bearer token")
    user = USERS_BY_TOKEN.get(creds.credentials)
    if user is None:
        raise Unauthorized("Invalid bearer token")
    return user


def require_editor(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not user.can_edit:
        raise Forbidden("Editor role required")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
EditorUser = Annotated[User, Depends(require_editor)]
