import fs from 'fs';
import { deleteFromStorage, uploadToStorage } from './storage.js';

const cleanupTempFile = (fileInput) => {
  if (typeof fileInput !== 'string' || !fileInput.includes('temp-uploads')) {
    return;
  }

  try {
    if (fs.existsSync(fileInput)) {
      fs.unlinkSync(fileInput);
      console.log(`Cleaned up temporary file: ${fileInput}`);
    }
  } catch (cleanupError) {
    console.warn(
      `Failed to clean up temporary file ${fileInput}:`,
      cleanupError
    );
  }
};

export const s3Uploader = async (fileInput, key, contentType) => {
  try {
    const result = await uploadToStorage(fileInput, key, contentType);
    console.log(`Successfully uploaded ${key} to Azure Blob Storage`);
    cleanupTempFile(fileInput);
    return result;
  } catch (error) {
    console.error(`Azure Blob Storage upload failed for ${key}:`, error);
    cleanupTempFile(fileInput);

    if (error.statusCode === 413 || error.code === 'RequestBodyTooLarge') {
      throw new Error('File is too large. Please upload a smaller file.');
    }

    if (error.statusCode === 403 || error.code === 'AuthorizationFailure') {
      throw new Error(
        'Upload failed due to permission issues. Please contact support.'
      );
    }

    throw new Error(`Upload failed: ${error.message}`);
  }
};

export const s3Delete = async (key) => {
  try {
    await deleteFromStorage(key);
  } catch (error) {
    console.error('Error deleting file from Azure Blob Storage:', error);
    throw new Error('Failed to delete file from Azure Blob Storage');
  }
};
