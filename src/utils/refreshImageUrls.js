import { generatePresignedUrl } from './s3.js';

/**
 * Extracts imageKey from a signed storage URL.
 * @param {string} url - The presigned URL
 * @returns {string|null} - The imageKey if found, null otherwise
 */
function extractImageKeyFromUrl(url) {
  if (!url) return null;

  try {
    // Check if this is the authenticated proxy endpoint
    if (url.includes('/api/attachments/view/')) {
      const proxyMatch = url.match(/\/api\/attachments\/view\/([^?]+)/);
      if (proxyMatch?.[1]) {
        return decodeURIComponent(proxyMatch[1]);
      }
    }

    // Check if it's a CDN URL whose path is the storage key.
    const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;
    if (cloudFrontDomain && url.includes(cloudFrontDomain)) {
      // Extract the path after the domain
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      // Remove leading slash and extract key
      const key = pathname.startsWith('/') ? pathname.slice(1) : pathname;
      return decodeURIComponent(key);
    }

    // Check if it's an Azure Blob Storage URL.
    if (url.includes('.blob.core.windows.net')) {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
      const keyParts =
        containerName && pathParts[0] === containerName
          ? pathParts.slice(1)
          : pathParts.slice(1);

      return keyParts.length ? decodeURIComponent(keyParts.join('/')) : null;
    }

    // Check if it's an S3 presigned URL
    if (url.includes('amazonaws.com') || url.includes('s3.')) {
      // Extract key from query parameters or path
      const urlObj = new URL(url);
      // S3 presigned URLs have the key in the pathname
      const pathname = urlObj.pathname;
      // Remove leading slash and bucket name if present
      const key = pathname.split('/').slice(2).join('/'); // Remove bucket name
      return key ? decodeURIComponent(key) : null;
    }

    // Check if it's a direct S3 URL with key in path
    const s3Pattern = /s3[.-][^.]+\.amazonaws\.com\/([^?]+)/;
    const match = url.match(s3Pattern);
    if (match) {
      return decodeURIComponent(match[1]);
    }

    return null;
  } catch (error) {
    console.error('Error extracting imageKey from URL:', error);
    return null;
  }
}

function extractImageKeyFromTag(fullImgTag) {
  const dataImageKeyMatch = fullImgTag.match(
    /data-image-key=["']([^"']+)["']/i
  );
  if (dataImageKeyMatch?.[1]) {
    return dataImageKeyMatch[1];
  }

  return null;
}

/**
 * Refreshes expired presigned URLs in HTML content
 * @param {string} htmlContent - The HTML content with potentially expired image URLs
 * @param {Array} attachments - Array of attachment objects with imageKey property
 * @param {number} expiresInSeconds - Expiration time for new URLs (default: 86400 = 24 hours)
 * @returns {string} - HTML content with refreshed image URLs
 */
export async function refreshImageUrlsInHtml(
  htmlContent,
  attachments = [],
  options = 86400
) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return htmlContent;
  }

  try {
    const normalizedOptions =
      typeof options === 'number'
        ? { expiresInSeconds: options }
        : options || {};
    const { expiresInSeconds = 86400, accessMode = 'proxy' } =
      normalizedOptions;

    // Create a map of imageKey to attachment for quick lookup
    const attachmentMap = new Map();
    attachments.forEach((attachment) => {
      if (attachment.imageKey) {
        attachmentMap.set(attachment.imageKey, attachment);
      }
    });

    // Use regex to find all img tags with src attributes
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let updatedHtml = htmlContent;
    const replacements = [];

    // Find all image URLs
    let match;
    while ((match = imgRegex.exec(htmlContent)) !== null) {
      const fullImgTag = match[0];
      const imageUrl = match[1];

      // Skip base64 images
      if (imageUrl.startsWith('data:')) {
        continue;
      }

      // Extract imageKey from URL
      let imageKey =
        extractImageKeyFromTag(fullImgTag) || extractImageKeyFromUrl(imageUrl);

      // If we can't extract from URL, try to find it in attachments
      if (!imageKey) {
        // Check if URL contains attachment ID or other identifier
        // This is a fallback - ideally we'd store imageKey in a data attribute
        for (const [key, attachment] of attachmentMap.entries()) {
          if (imageUrl.includes(key) || imageUrl.includes(attachment.id)) {
            imageKey = key;
            break;
          }
        }
      }

      // If we found an imageKey, generate a fresh presigned URL
      if (imageKey) {
        if (!attachmentMap.has(imageKey)) {
          replacements.push({
            old: fullImgTag,
            new: '',
          });
          continue;
        }

        try {
          let replacementUrl;

          if (accessMode === 'signed') {
            replacementUrl = await generatePresignedUrl(
              imageKey,
              expiresInSeconds
            );
          } else {
            const baseUrl =
              process.env.NEXT_PUBLIC_API_URL || process.env.FRONTEND_URL || '';
            replacementUrl = `${baseUrl}/api/attachments/view/${encodeURIComponent(
              imageKey
            )}`;
          }

          let newImgTag = fullImgTag.replace(imageUrl, replacementUrl);

          // Add data-image-key attribute for later refreshes across contexts.
          if (!newImgTag.includes('data-image-key')) {
            newImgTag = newImgTag.replace(
              />$/,
              ` data-image-key="${imageKey}">`
            );
          }

          replacements.push({
            old: fullImgTag,
            new: newImgTag,
          });
        } catch (error) {
          console.error(`Error generating fresh URL for ${imageKey}:`, error);
          // Continue with other images even if one fails
        }
      }
    }

    // Apply all replacements
    replacements.forEach(({ old, new: newTag }) => {
      updatedHtml = updatedHtml.replace(old, newTag);
    });

    return updatedHtml;
  } catch (error) {
    console.error('Error refreshing image URLs:', error);
    // Return original content if there's an error
    return htmlContent;
  }
}

/**
 * Gets attachment imageKeys from notation attachments
 * @param {string} notationId - The notation ID
 * @returns {Promise<Array>} - Array of attachment objects with imageKey
 */
export async function getNotationAttachmentImageKeys(notationId) {
  try {
    const { getNotationAttachments } =
      await import('../services/notationAttachmentService.js');
    const { getAttachmentsByIds } =
      await import('../services/attachmentService.js');

    // Get notation attachments
    const notationAttachments = await getNotationAttachments(notationId, null);

    // Extract attachment IDs
    const attachmentIds = notationAttachments.map((na) => na.attachmentId);

    if (attachmentIds.length === 0) {
      return [];
    }

    // Get full attachment details with imageKeys
    const attachments = await getAttachmentsByIds(attachmentIds, null, []);

    return attachments.filter((a) => a.imageKey);
  } catch (error) {
    console.error('Error getting notation attachment imageKeys:', error);
    return [];
  }
}
