/**
 * Quick verification: test the R2 bucket is accessible.
 * Usage: R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=palmkit-files bun run scripts/test-r2.ts
 */
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET ?? 'palmkit-files';

console.log(`Testing R2 bucket: ${BUCKET}`);

// 1. List objects
try {
  const list = await R2.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 5 }));
  console.log('✓ List OK — objects:', list.KeyCount ?? 0);
} catch (e: any) {
  console.log('✗ List failed:', e.message);
  process.exit(1);
}

// 2. Put a test file
const testKey = '_worker_health_check.txt';
const testContent = `Palmkit worker health check at ${new Date().toISOString()}`;

try {
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: testKey, Body: testContent }));
  console.log('✓ Put OK —', testKey);
} catch (e: any) {
  console.log('✗ Put failed:', e.message);
  process.exit(1);
}

// 3. Get it back
try {
  const resp = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: testKey }));
  const text = await resp.Body!.transformToString();
  console.log('✓ Get OK — content matches:', text === testContent);
} catch (e: any) {
  console.log('✗ Get failed:', e.message);
  process.exit(1);
}

console.log('\n✅ R2 is ready for the worker.');
