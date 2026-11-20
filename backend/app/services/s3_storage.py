from __future__ import annotations

import logging
from pathlib import Path
from typing import Tuple
from app.config import settings

logger = logging.getLogger(__name__)


def upload_or_store_local(local_file: Path, stage: str) -> Tuple[str, str]:
    """
    Uploads raw telemetry (`raw/`), cleaned datasets (`processed/`), or trained ML models (`models/`)
    to AWS S3 when AWS credentials are configured; otherwise keeps artifacts in local storage.
    Never exposes or logs AWS secret keys.
    """
    local_file.parent.mkdir(parents=True, exist_ok=True)
    if not settings.s3_enabled:
        return "local", str(local_file)

    try:
        import boto3  # type: ignore

        client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        key = f"{stage.strip('/')}/{local_file.name}"
        client.upload_file(str(local_file), settings.s3_bucket_name, key)
        uri = f"s3://{settings.s3_bucket_name}/{key}"
        logger.info("Uploaded artifact to %s", uri)
        return "s3", uri
    except Exception as exc:
        logger.warning("S3 upload skipped, using local storage fallback: %s", exc)
        return "local", str(local_file)


def ensure_local_model(filename: str) -> Path:
    """Downloads a joblib artifact from S3 if missing after a container restart."""
    model_dir = Path(settings.model_path)
    model_dir.mkdir(parents=True, exist_ok=True)
    local_path = model_dir / filename
    if local_path.exists() or not settings.s3_enabled:
        return local_path

    try:
        import boto3  # type: ignore

        client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        client.download_file(settings.s3_bucket_name, f"models/{filename}", str(local_path))
    except Exception as exc:
        logger.warning("Could not fetch %s from S3: %s", filename, exc)
    return local_path
