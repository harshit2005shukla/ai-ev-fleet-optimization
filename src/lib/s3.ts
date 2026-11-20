import fs from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

export type StorageStage = "raw" | "processed" | "models";

export interface StorageWriteResult {
  backend: "s3" | "local";
  uri: string;
  localPath: string;
}

const globalStorage = globalThis as typeof globalThis & {
  __evArtifactCache?: Map<string, string>;
};

const artifactCache =
  globalStorage.__evArtifactCache ??
  (globalStorage.__evArtifactCache = new Map<string, string>());

function getS3Config() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  const bucket = process.env.S3_BUCKET_NAME?.trim();

  if (accessKeyId && secretAccessKey && bucket) {
    return { accessKeyId, secretAccessKey, region, bucket };
  }
  return null;
}

export function isS3Configured(): boolean {
  return getS3Config() !== null;
}

export function getStorageStatus() {
  const cfg = getS3Config();
  return {
    mode: cfg ? ("s3" as const) : ("local" as const),
    bucket: cfg?.bucket ?? null,
    region: cfg?.region ?? null,
    localModelPath: process.env.MODEL_PATH || "data/models",
  };
}

function resolveLocalDir(stage: StorageStage): string {
  const customModelPath = process.env.MODEL_PATH?.trim();
  if (stage === "models" && customModelPath) {
    return path.resolve(/* turbopackIgnore: true */ customModelPath);
  }
  return path.join(process.cwd(), "data", stage);
}

/**
 * Persists an artifact (raw telemetry JSON/CSV, cleaned dataset, or serialized ML model)
 * to AWS S3 (`s3://<bucket>/<stage>/<filename>`) when credentials are configured,
 * with automatic local fallback under `data/<stage>/<filename>`.
 */
export async function saveArtifact(
  stage: StorageStage,
  filename: string,
  payload: string,
  contentType = "application/json"
): Promise<StorageWriteResult> {
  const cacheKey = `${stage}/${filename}`;
  if (stage === "models") {
    artifactCache.set(cacheKey, payload);
  }

  const dir = resolveLocalDir(stage);
  const localPath = path.join(dir, filename);

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(localPath, payload, "utf-8");
  } catch {
    // Ephemeral / read-only containers continue gracefully using in-memory cache
  }

  const cfg = getS3Config();
  if (cfg) {
    try {
      const client = new S3Client({
        region: cfg.region,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });
      const key = `${stage}/${filename}`;
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: payload,
          ContentType: contentType,
        })
      );
      return {
        backend: "s3",
        uri: `s3://${cfg.bucket}/${key}`,
        localPath,
      };
    } catch (error) {
      console.warn(
        `[Storage] S3 upload failed for ${stage}/${filename}, using local fallback:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return {
    backend: "local",
    uri: `data/${stage}/${filename}`,
    localPath,
  };
}

/**
 * Loads an artifact from AWS S3 (if configured) or local storage.
 */
export async function loadArtifact(
  stage: StorageStage,
  filename: string
): Promise<string | null> {
  const cacheKey = `${stage}/${filename}`;
  if (stage === "models") {
    const cached = artifactCache.get(cacheKey);
    if (cached) return cached;
  }

  const cfg = getS3Config();
  if (cfg) {
    try {
      const client = new S3Client({
        region: cfg.region,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });
      const res = await client.send(
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: cacheKey,
        })
      );
      if (res.Body) {
        const text = await res.Body.transformToString("utf-8");
        if (stage === "models") artifactCache.set(cacheKey, text);
        return text;
      }
    } catch {
      // Fall through to local cache
    }
  }

  try {
    const localPath = path.join(resolveLocalDir(stage), filename);
    const text = await fs.readFile(localPath, "utf-8");
    if (stage === "models") artifactCache.set(cacheKey, text);
    return text;
  } catch {
    return artifactCache.get(cacheKey) ?? null;
  }
}
