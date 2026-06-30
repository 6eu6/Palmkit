/**
 * Cloudflare R2 Client — Phase 2 File Storage
 *
 * R2 is S3-compatible object storage. Free tier: 10GB-month storage,
 * 10 million Class A operations/month, no egress fees to internet.
 *
 * We store generated project files here:
 *   Key format: projects/{projectId}/jobs/{jobId}/files/{filePath}
 *   Example:    projects/abc-123/jobs/def-456/files/index.html
 *
 * Env vars required:
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET (default: palmkit-files)
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from './logger';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET = process.env.R2_BUCKET ?? 'palmkit-files';

let r2: S3Client | null = null;

if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
  r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
} else {
  logger.warn(
    'R2 env vars missing — file storage will fail. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.',
  );
}

/**
 * Write a file to R2. Overwrites if exists.
 */
export async function putFile(key: string, content: string | Uint8Array): Promise<void> {
  if (!r2) throw new Error('R2 client not initialized — missing env vars');

  const body = typeof content === 'string' ? new TextEncoder().encode(content) : content;

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
    }),
  );

  logger.debug(`R2 PUT ${key} (${body.byteLength} bytes)`);
}

/**
 * Read a file from R2. Returns null if not found.
 */
export async function getFile(key: string): Promise<Uint8Array | null> {
  if (!r2) throw new Error('R2 client not initialized — missing env vars');

  try {
    const response = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));

    if (!response.Body) return null;

    // response.Body is a Readable stream in Node — convert to Uint8Array.
    const chunks: Uint8Array[] = [];

    for await (const chunk of response.Body as any) {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
    }

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;

    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }

    return result;
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Read a file from R2 as UTF-8 text.
 */
export async function getFileText(key: string): Promise<string | null> {
  const bytes = await getFile(key);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}

/**
 * Build the R2 key for a project file.
 *   buildKey('def-456', 'src/pages/Checkout.tsx', 'abc-123')
 *   → 'projects/abc-123/jobs/def-456/files/src/pages/Checkout.tsx'
 *
 * @deprecated Use buildWorkspaceKey for new code. This is kept for backward
 * compatibility with existing /api/files and /api/jobs endpoints that still
 * read from the job-scoped layout.
 */
export function buildKey(jobId: string, filePath: string, projectId?: string): string {
  const pid = projectId ?? jobId;
  const normalized = filePath.replace(/^\/+/, '').replace(/\.\./g, '');
  return `projects/${pid}/jobs/${jobId}/files/${normalized}`;
}

/**
 * Build the R2 key for a file in the unified workspace.
 *
 * The workspace is a single source of truth per project. All files live under
 * `projects/{projectId}/workspace/{path}` — no job-scoping, no scattering.
 *
 * Examples:
 *   buildWorkspaceKey('abc-123', 'src/App.tsx')
 *     → 'projects/abc-123/workspace/src/App.tsx'
 *   buildWorkspaceKey('abc-123', 'worklog.md')
 *     → 'projects/abc-123/workspace/worklog.md'
 *   buildWorkspaceKey('abc-123', 'uploads/photo.png')
 *     → 'projects/abc-123/workspace/uploads/photo.png'
 */
export function buildWorkspaceKey(projectId: string, filePath: string): string {
  const normalized = filePath.replace(/^\/+/, '').replace(/\.\./g, '');
  return `projects/${projectId}/workspace/${normalized}`;
}

/**
 * Build the R2 key for the project worklog (memory file).
 */
export function buildWorklogKey(projectId: string): string {
  return `projects/${projectId}/workspace/worklog.md`;
}

/**
 * Build the R2 key for the project manifest (metadata).
 */
export function buildManifestKey(projectId: string): string {
  return `projects/${projectId}/workspace/manifest.json`;
}

/**
 * List all objects in R2 under a given prefix.
 * Uses the S3 ListObjectsV2 API with pagination.
 */
export async function listObjects(prefix: string, maxKeys: number = 1000): Promise<string[]> {
  if (!r2) throw new Error('R2 client not initialized — missing env vars');

  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of response.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Delete an object from R2. Returns true if deleted, false if not found.
 */
export async function deleteFile(key: string): Promise<boolean> {
  if (!r2) throw new Error('R2 client not initialized — missing env vars');

  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      }),
    );
    return true;
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * Get the bucket name (for the CF Pages proxy route).
 */
export function getBucketName(): string {
  return R2_BUCKET;
}
