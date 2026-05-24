import { generateSignedStorageUrl } from './storage.js';

/**
 * Generates a signed URL for a stored file.
 * Kept under the old CloudFront export name for compatibility with existing
 * controllers and services.
 *
 * @param {string} fileKey - The blob key.
 * @param {number} expiresInSeconds - Expiration time in seconds.
 * @returns {string|null} A signed Azure Blob Storage URL.
 */
export const generatePresignedCloudFrontUrl = (
  fileKey,
  expiresInSeconds = 86400
) => generateSignedStorageUrl(fileKey, expiresInSeconds);
