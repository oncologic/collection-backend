import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const s3Client = new S3Client({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: process.env.AWS_REGION,
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

export const uploadToS3 = async (file) => {
  const params = {
    Bucket: BUCKET_NAME,
    Key: `organization-logos/${Date.now()}-${file.originalname}`,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  };

  try {
    const command = new PutObjectCommand(params);
    await s3Client.send(command);
    return params.Key;
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw error;
  }
};

export const constructS3Url = (key) => {
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};
