import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.AWS_REGION;
const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Generates a presigned URL for uploading to S3.
 * @param {string} key - The key (filename) for the S3 object.
 * @param {number} expiresInSeconds - Expiration time in seconds (default: 86400 = 24 hours).
 */
export const generatePresignedUrl = async (key, expiresInSeconds = 86400) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, {
      expiresIn: expiresInSeconds, // Use the provided expiration time
    });

    return url;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw error;
  }
};
