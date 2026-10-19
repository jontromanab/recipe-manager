from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import sessionmaker

from app.auth import CurrentUser
from app.config import Settings
from app.db import init_db, make_engine
from app.errors import register_error_handlers
from app.routers import recipes
from app.schemas import Me
from app.seed import seed


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    session_factory = sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(engine)
        if settings.seed_on_startup:
            with session_factory() as session:
                seed(session)
        yield
        engine.dispose()

    app = FastAPI(title="Recipe Manager API", version="0.1.0", lifespan=lifespan)
    app.state.engine = engine
    app.state.session_factory = session_factory

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok"}

    @api.get("/me", response_model=Me, tags=["meta"])
    def me(user: CurrentUser) -> Me:
        return Me(id=user.id, name=user.name, org_id=user.org_id, org_name=user.org_name, role=user.role)

    api.include_router(recipes.router)
    app.include_router(api)
    return app

