from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List
from dotenv import load_dotenv

load_dotenv()


def _normalize_db_url(raw_url: str) -> str:
    url = raw_url.strip()
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


def _parse_cors(raw: str) -> List[str]:
    if not raw or raw.strip() == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = "AI-Powered EV Fleet Optimization & Charging Analytics API"
    database_url: str = field(
        default_factory=lambda: _normalize_db_url(
            os.getenv(
                "DATABASE_URL",
                "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
            )
        )
    )
    aws_access_key_id: str = field(default_factory=lambda: os.getenv("AWS_ACCESS_KEY_ID", "").strip())
    aws_secret_access_key: str = field(default_factory=lambda: os.getenv("AWS_SECRET_ACCESS_KEY", "").strip())
    aws_region: str = field(default_factory=lambda: os.getenv("AWS_REGION", "us-east-1").strip())
    s3_bucket_name: str = field(default_factory=lambda: os.getenv("S3_BUCKET_NAME", "").strip())
    cors_origins: List[str] = field(
        default_factory=lambda: _parse_cors(os.getenv("CORS_ORIGINS", "*"))
    )
    model_path: str = field(default_factory=lambda: os.getenv("MODEL_PATH", "ml/models"))
    random_state: int = 42

    @property
    def s3_enabled(self) -> bool:
        return bool(self.aws_access_key_id and self.aws_secret_access_key and self.s3_bucket_name)


settings = Settings()
