import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'fs';
import { constructStorageUrl, uploadToStorage } from './storage.js';

dotenv.config({ path: '.env.local' });

export const uploadToS3 = async (file) => {
  const key = `organization-logos/${Date.now()}-${file.originalname}`;
  const fileInput = file.buffer || file.path;

  if (!fileInput) {
    throw new Error('Invalid file format - no path or buffer found');
  }

  try {
    await uploadToStorage(fileInput, key, file.mimetype);
    if (
      typeof fileInput === 'string' &&
      fileInput.includes('temp-uploads') &&
      fs.existsSync(fileInput)
    ) {
      fs.unlinkSync(fileInput);
    }
    return key;
  } catch (error) {
    console.error('Error uploading to Azure Blob Storage:', error);
    if (
      typeof fileInput === 'string' &&
      fileInput.includes('temp-uploads') &&
      fs.existsSync(fileInput)
    ) {
      fs.unlinkSync(fileInput);
    }
    throw error;
  }
};

export const constructS3Url = (key) => constructStorageUrl(key);
