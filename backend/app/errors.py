import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app")


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, **extra):
        super().__init__(message)
        self.message = message
        self.extra = extra


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class VersionConflict(AppError):
    status_code = 409
    code = "version_conflict"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class InvalidInput(AppError):
    status_code = 422
    code = "invalid_input"


def _body(code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, **extra}}


def register_error_handlers(app: FastAPI) -> None:
    """Every error leaves the API as {"error": {"code", "message", ...}}."""

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return JSONResponse(_body(exc.code, exc.message, **exc.extra), exc.status_code, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        details = [
            {"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()
        ]
        return JSONResponse(_body("invalid_input", "Request validation failed", details=details), 422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        return JSONResponse(_body("http_error", str(exc.detail)), exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        # Log the details server-side; never leak them to the client.
        logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse(_body("internal_error", "Something went wrong. Please try again."), 500)
