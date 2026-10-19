from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Recipe(Base):
    """A recipe is one aggregate: always read and written whole.

    Ingredients, steps and tags are JSON columns (validated by Pydantic) rather
    than child tables. `search_text` and `tags_index` are denormalised on write
    so search is a portable LIKE query on SQLite and Postgres.
    """

    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    yield_quantity: Mapped[float] = mapped_column(Float)
    yield_unit: Mapped[str] = mapped_column(String(32))
    yield_portions: Mapped[float | None] = mapped_column(Float, nullable=True)
    ingredients: Mapped[list[dict]] = mapped_column(JSON, default=list)
    steps: Mapped[list[str]] = mapped_column(JSON, default=list)

    search_text: Mapped[str] = mapped_column(Text, default="")
    tags_index: Mapped[str] = mapped_column(Text, default="")

    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # SQLAlchemy adds "WHERE version = :old" to every UPDATE and bumps it,
    # so two concurrent writers can't both win even between check and commit.
    __mapper_args__ = {"version_id_col": version}
