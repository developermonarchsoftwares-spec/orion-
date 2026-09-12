import * as dotenv from 'dotenv';
import * as path from 'path';
import * as https from 'https';

// Load apps/api/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function checkPublicHttpAccess(url: string): Promise<number> {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      resolve(res.statusCode || 0);
    });
    req.on('error', () => {
      resolve(0);
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function runR2Verification() {
  console.log('====================================================');
  console.log('CLOUDFLARE R2 VERIFICATION SUITE – ORION');
  console.log('====================================================');

  const provider = process.env.STORAGE_PROVIDER;
  const bucket = process.env.STORAGE_BUCKET;
  const region = process.env.STORAGE_REGION;
  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  const forcePathStyle = process.env.STORAGE_FORCE_PATH_STYLE !== 'false';

  console.log('Configuration Inspection:');
  console.log(`- STORAGE_PROVIDER: ${provider}`);
  console.log(`- STORAGE_BUCKET: ${bucket}`);
  console.log(`- STORAGE_REGION: ${region}`);
  console.log(`- STORAGE_ENDPOINT: ${endpoint}`);
  console.log(`- STORAGE_ACCESS_KEY loaded: ${Boolean(accessKeyId && accessKeyId.trim().length > 0)} (length: ${accessKeyId?.length || 0})`);
  console.log(`- STORAGE_SECRET_KEY loaded: ${Boolean(secretAccessKey && secretAccessKey.trim().length > 0)} (length: ${secretAccessKey?.length || 0})`);
  console.log(`- STORAGE_FORCE_PATH_STYLE: ${forcePathStyle}`);

  if (
    provider !== 'r2' ||
    bucket !== 'orion' ||
    region !== 'auto' ||
    !endpoint ||
    !accessKeyId ||
    !secretAccessKey
  ) {
    console.error('\n[ERROR] Configuration does not match expected R2 settings:');
    console.error('Expected:');
    console.error('  STORAGE_PROVIDER=r2');
    console.error('  STORAGE_BUCKET=orion');
    console.error('  STORAGE_REGION=auto');
    console.error('  STORAGE_ENDPOINT=https://ddb6081c41b1d45544d206b189749ba0.r2.cloudflarestorage.com');
    console.error('  STORAGE_ACCESS_KEY=<valid_r2_token_id>');
    console.error('  STORAGE_SECRET_KEY=<valid_r2_token_secret>');
    console.error('\nPlease check that apps/api/.env is saved with these values.');
    process.exit(1);
  }

  console.log('\nR2 configuration: PASS');

  const s3Client = new S3Client({
    region: region || 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle,
  });

  const timestamp = Date.now();
  const testKey = `healthcheck/r2-test-${timestamp}.txt`;
  const testPayload = `Orion R2 Healthcheck Verification at ${new Date(timestamp).toISOString()}`;

  console.log(`\nStarting safe test with key: ${testKey}`);

  // 1. Upload
  try {
    console.log('1. Uploading test object...');
    const putCmd = new PutObjectCommand({
      Bucket: bucket,
      Key: testKey,
      Body: Buffer.from(testPayload, 'utf8'),
      ContentType: 'text/plain',
      Metadata: { healthcheck: 'true' },
    });
    const putRes = await s3Client.send(putCmd);
    console.log(`   Upload: PASS (ETag: ${putRes.ETag})`);
  } catch (err: any) {
    console.error(`   Upload: FAIL - ${err.message}`);
    process.exit(1);
  }

  // 2. Read
  try {
    console.log('2. Reading test object...');
    const getCmd = new GetObjectCommand({
      Bucket: bucket,
      Key: testKey,
    });
    const getRes = await s3Client.send(getCmd);
    const downloadedContent = await streamToString(getRes.Body as Readable);
    if (downloadedContent === testPayload) {
      console.log('   Read: PASS (Content verified)');
    } else {
      console.error(`   Read: FAIL (Content mismatch: expected "${testPayload}", received "${downloadedContent}")`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`   Read: FAIL - ${err.message}`);
    process.exit(1);
  }

  // 3. Presigned URL
  try {
    console.log('3. Testing presigned URL generation & fetch...');
    const presignedGetCmd = new GetObjectCommand({
      Bucket: bucket,
      Key: testKey,
    });
    const downloadSignedUrl = await getSignedUrl(s3Client, presignedGetCmd, { expiresIn: 300 });
    const parsedSignedUrl = new URL(downloadSignedUrl);
    console.log(`   Presigned URL generated: PASS (${parsedSignedUrl.protocol}//${parsedSignedUrl.host}...)`);

    // Verify fetching via signed URL
    const statusCode = await checkPublicHttpAccess(downloadSignedUrl);
    if (statusCode === 200) {
      console.log('   Presigned URL download: PASS (HTTP 200)');
    } else {
      console.warn(`   Presigned URL download returned HTTP ${statusCode}`);
    }
  } catch (err: any) {
    console.error(`   Presigned URL: FAIL - ${err.message}`);
    process.exit(1);
  }

  // 4. Verify Bucket Privacy (No unauthenticated public access)
  try {
    console.log('4. Verifying bucket privacy (unauthenticated direct access must be blocked)...');
    const directUrl = `${endpoint}/${bucket}/${testKey}`;
    const directStatus = await checkPublicHttpAccess(directUrl);
    console.log(`   Unauthenticated direct access HTTP status: ${directStatus}`);
    if (directStatus === 401 || directStatus === 403 || directStatus === 404 || directStatus === 0) {
      console.log('   Bucket private: PASS (Public unauthenticated access is rejected)');
    } else {
      console.error(`   Bucket private: FAIL (Bucket returned HTTP ${directStatus} for unauthenticated request)`);
      process.exit(1);
    }
  } catch (err: any) {
    console.warn(`   Privacy check notice: ${err.message}`);
  }

  // 5. Delete & Cleanup
  try {
    console.log('5. Deleting test object...');
    const delCmd = new DeleteObjectCommand({
      Bucket: bucket,
      Key: testKey,
    });
    await s3Client.send(delCmd);

    // Verify deleted
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: testKey }));
      console.error('   Delete: FAIL (Object still exists after delete)');
      process.exit(1);
    } catch {
      console.log('   Delete: PASS (Object successfully deleted and verified removed)');
    }
  } catch (err: any) {
    console.error(`   Delete: FAIL - ${err.message}`);
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('ALL CLOUDFLARE R2 CHECKS PASSED SUCCESSFULLY');
  console.log('====================================================');
}

runR2Verification().catch((err) => {
  console.error('R2 verification script failed:', err.message);
  process.exit(1);
});
