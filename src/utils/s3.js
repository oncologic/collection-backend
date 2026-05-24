import { generateSignedStorageUrl } from './storage.js';

/**
 * Generates a signed URL for reading an Azure blob.
 * Kept under the old export name so existing call sites do not need to change.
 *
 * @param {string} key - The blob key.
 * @param {number} expiresInSeconds - Expiration time in seconds.
 */
export const generatePresignedUrl = async (key, expiresInSeconds = 86400) =>
  generateSignedStorageUrl(key, expiresInSeconds);
