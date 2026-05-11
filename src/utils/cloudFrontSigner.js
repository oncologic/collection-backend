import { getSignedUrl } from '@aws-sdk/cloudfront-signer';

const normalizeCloudFrontPath = (fileKey = '') =>
  fileKey
    .split('/')
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join('/');

/**
 * Generates a presigned CloudFront URL for an image key.
 *
 * @param {string} fileKey - The key of the file stored on S3.
 * @param {number} expiresInSeconds - Expiration time in seconds (default is 86400 seconds or 24 hours).
 * @returns {string} - A presigned URL that expires after the specified time.
 */
export const generatePresignedCloudFrontUrl = (
  fileKey,
  expiresInSeconds = 86400 // Default to 1 day (safer for security)
) => {
  // Check for null, undefined, or string versions of these values
  if (
    !fileKey ||
    fileKey === 'null' ||
    fileKey === 'undefined' ||
    fileKey === null ||
    fileKey === undefined
  ) {
    return null;
  }

  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;

  if (!cloudFrontDomain) {
    throw new Error(
      'CLOUDFRONT_DOMAIN is not defined in the environment variables'
    );
  }

  const normalizedDomain = cloudFrontDomain.replace(/\/+$/, '');
  const encodedFileKey = normalizeCloudFrontPath(fileKey);

  // Construct the URL based on your CloudFront distribution domain from env variable
  const url = `${normalizedDomain}/${encodedFileKey}`;

  // Set the expiration time from now
  const expirationDate = new Date(Date.now() + expiresInSeconds * 1000);

  // Return the signed URL using your CloudFront key pair details
  const signedUrl = getSignedUrl({
    url,
    keyPairId: process.env.CLOUDFRONT_KEY_PAIR,
    privateKey: process.env.CLOUDFRONT_PRIVATE.replace(/\\n/g, '\n'),
    dateLessThan: expirationDate,
  });
  return signedUrl;
};
