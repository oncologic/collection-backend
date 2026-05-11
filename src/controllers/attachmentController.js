import { v4 as uuidv4 } from 'uuid';
import { s3Uploader, s3Delete } from '../utils/s3Uploader.js';
import {
  createAttachmentService,
  deleteAttachmentService,
  findAttachmentByUserById,
  attachmentService,
  findAccessibleAttachmentByImageKey,
} from '../services/attachmentService.js';
import heicConvert from 'heic-convert';
import { promisify } from 'util';
import { getExternalLinkByIdService } from '../services/collectionService.js';
import { subscriptionService } from '../services/subscriptionService.js';
import fs from 'fs';
import { getResourceByIdService } from '../services/resourceService.js';
import { canEditOrDeleteItem } from '../utils/authHelpers.js';

export const attachmentController = {
  async createAttachment(req, res) {
    try {
      const {
        title,
        description,
        highlighted,
        externalLinkId,
        resourceId,
        existingAttachmentId,
        visibility,
      } = req.body;

      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (externalLinkId && resourceId) {
        return res.status(400).json({
          error:
            'Attachments can only be linked to either an external link or a resource at one time',
        });
      }

      if (!externalLinkId && !resourceId) {
        return res.status(400).json({
          error: 'Either externalLinkId or resourceId is required',
        });
      }

      let parentTenantId = null;

      if (externalLinkId) {
        const externalLink = await getExternalLinkByIdService(
          externalLinkId,
          userId
        );

        if (!externalLink) {
          return res.status(404).json({ error: 'External link not found' });
        }

        parentTenantId = externalLink.tenantId;
      }

      if (resourceId) {
        const resource = await getResourceByIdService(
          resourceId,
          userId,
          tenantIds
        );

        if (!resource) {
          return res.status(404).json({ error: 'Resource not found' });
        }

        if (!canEditOrDeleteItem(req, resource)) {
          return res.status(403).json({
            error:
              'Forbidden: You must be an admin, advocate, or the resource creator to manage resource attachments',
          });
        }

        parentTenantId = resource.tenantId;
      }

      if (existingAttachmentId) {
        const attachment = await findAttachmentByUserById(
          existingAttachmentId,
          userId
        );
        if (!attachment) {
          return res.status(404).json({ error: 'Attachment not found' });
        }

        if (parentTenantId && attachment.tenant_id !== parentTenantId) {
          return res.status(403).json({
            error:
              'Attachment belongs to a different tenant than the selected parent item',
          });
        }

        // Create new attachment association and return early
        if (externalLinkId) {
          const updatedAttachment =
            await attachmentService.addExistingAttachmentToExternalLink({
              attachmentId: existingAttachmentId,
              externalLinkId,
              highlighted: highlighted || false,
              tenantId: attachment.tenant_id,
            });
          return res.status(200).json({ attachments: [updatedAttachment] });
        }

        if (resourceId) {
          const updatedAttachment =
            await attachmentService.addExistingAttachmentToResource({
              attachmentId: existingAttachmentId,
              resourceId,
              highlighted: highlighted || false,
            });
          return res.status(200).json({ attachments: [updatedAttachment] });
        }
      }

      // Check subscription limits for new attachments
      const canCreateAttachment = await subscriptionService.canCreateAttachment(
        userId,
        tenantIds
      );
      if (!canCreateAttachment.allowed) {
        return res.status(403).json({
          error: 'Attachment limit reached',
          details: {
            current: canCreateAttachment.current,
            limit: canCreateAttachment.limit,
            remaining: canCreateAttachment.remaining,
          },
        });
      }

      const files = req.files || [];

      // Add cleanup function for buffers
      const buffersToClean = [];

      if (files.length === 0) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Check if the number of files being uploaded would exceed the limit
      if (
        canCreateAttachment.limit !== -1 &&
        canCreateAttachment.remaining < files.length
      ) {
        return res.status(403).json({
          error: `Cannot upload ${files.length} files. Only ${canCreateAttachment.remaining} attachments remaining in your plan.`,
          details: {
            current: canCreateAttachment.current,
            limit: canCreateAttachment.limit,
            remaining: canCreateAttachment.remaining,
            requestedFiles: files.length,
          },
        });
      }

      // Process each file concurrently.
      const attachments = await Promise.all(
        files.map(async (file) => {
          let fileInput;
          let mimeType = file.mimetype;

          // Determine if we're dealing with disk storage or memory storage
          if (file.path) {
            // Disk storage - we have a file path
            fileInput = file.path;

            // Handle HEIC/HEIF format conversion for disk storage
            if (mimeType === 'image/heic' || mimeType === 'image/heif') {
              try {
                // Read file, convert, write back
                const originalBuffer = fs.readFileSync(file.path);
                const convertedBuffer = await heicConvert({
                  buffer: originalBuffer,
                  format: 'JPEG',
                  quality: 0.9,
                });

                // Write converted file back to disk
                const convertedPath = file.path.replace(
                  /\.(heic|heif)$/i,
                  '.jpg'
                );
                fs.writeFileSync(convertedPath, convertedBuffer);

                // Clean up original file
                fs.unlinkSync(file.path);

                fileInput = convertedPath;
                mimeType = 'image/jpeg';
              } catch (conversionError) {
                // Clean up file on error
                if (fs.existsSync(file.path)) {
                  fs.unlinkSync(file.path);
                }
                throw new Error('Error converting HEIC image');
              }
            }
          } else if (file.buffer) {
            // Memory storage - we have a buffer
            let buffer = file.buffer;

            // Handle HEIC/HEIF format conversion for memory storage
            if (mimeType === 'image/heic' || mimeType === 'image/heif') {
              try {
                const convertedBuffer = await heicConvert({
                  buffer: file.buffer,
                  format: 'JPEG',
                  quality: 0.9,
                });
                buffersToClean.push(buffer); // Track original buffer
                buffer = convertedBuffer;
                mimeType = 'image/jpeg';
              } catch (conversionError) {
                throw new Error('Error converting HEIC image');
              }
            }

            fileInput = buffer;
          } else {
            throw new Error('Invalid file format - no path or buffer found');
          }

          // Generate a unique key using uuid and the file's original extension.
          const fileExtension =
            mimeType === 'image/jpeg'
              ? 'jpg'
              : file.originalname.split('.').pop();
          const key = `${uuidv4()}.${fileExtension}`;

          try {
            // Upload file to S3 (handles both buffer and file path)
            await s3Uploader(fileInput, key, mimeType);
          } catch (s3Error) {
            console.error(
              `S3 upload failed for file ${file.originalname}:`,
              s3Error
            );

            // Clean up temporary file if it exists and wasn't cleaned by s3Uploader
            if (typeof fileInput === 'string' && fs.existsSync(fileInput)) {
              try {
                fs.unlinkSync(fileInput);
              } catch (cleanupError) {
                console.warn(
                  'Failed to clean up file after S3 error:',
                  cleanupError
                );
              }
            }

            // Re-throw with more context
            throw new Error(
              `Failed to upload ${file.originalname}: ${s3Error.message}`
            );
          }

          // Determine the stored file type.
          const storedFileType = mimeType.startsWith('image/')
            ? 'image'
            : mimeType.startsWith('video/')
              ? 'video'
              : mimeType === 'application/pdf'
                ? 'pdf'
                : mimeType === 'text/csv'
                  ? 'csv'
                  : mimeType === 'text/tab-separated-values'
                    ? 'tsv'
                    : mimeType === 'application/vnd.ms-excel'
                      ? 'excel'
                      : mimeType ===
                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                        ? 'excel'
                        : mimeType ===
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                          ? 'word'
                          : mimeType === 'application/vnd.ms-powerpoint'
                            ? 'powerpoint'
                            : mimeType ===
                                'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                              ? 'powerpoint'
                              : 'other';

          // Save attachment info to the database, including the S3 key.
          const attachment = await createAttachmentService({
            title,
            description,
            type: storedFileType,
            imageKey: key,
            highlighted,
            externalLinkId,
            resourceId,
            userId: userId,
            tenantId: parentTenantId,
            visibility,
          });

          return attachment;
        })
      );

      // Cleanup buffers
      buffersToClean.forEach((buffer) => {
        buffer = null;
      });

      return res.status(200).json({ attachments });
    } catch (error) {
      // Handle specific error types
      if (error.message === 'Error converting HEIC image') {
        return res.status(400).json({ error: error.message });
      }

      // Handle S3 upload errors specifically
      if (error.message.includes('Failed to upload')) {
        return res.status(400).json({
          error: 'File upload failed',
          details: error.message,
        });
      }

      if (
        error.message.includes('Upload failed due to invalid multipart upload')
      ) {
        return res.status(400).json({
          error:
            'Upload failed. The file may be too large or corrupted. Please try uploading a smaller file or try again.',
          details: 'Multipart upload error',
        });
      }

      if (error.message.includes('Upload session expired')) {
        return res.status(400).json({
          error: 'Upload session expired. Please try uploading the file again.',
          details: 'Session timeout',
        });
      }

      console.error('Attachment creation error:', error);
      return res.status(500).json({ error: 'Error creating attachment' });
    } finally {
      // Ensure buffers are cleaned up even if an error occurs
      if (req.files) {
        req.files.forEach((file) => {
          // Clean up memory buffers
          if (file.buffer) {
            file.buffer = null;
          }

          // Clean up temporary files
          if (file.path && fs.existsSync(file.path)) {
            try {
              fs.unlinkSync(file.path);
            } catch (cleanupError) {
              console.warn(
                `Failed to clean up temporary file ${file.path}:`,
                cleanupError
              );
            }
          }
        });
      }
    }
  },

  async updateAttachment(req, res) {
    try {
      const { id } = req.params;
      const { title, description, visibility, highlighted } = req.body;
      const userId = req.auth.dbUserId;

      // Check if attachment belongs to the user
      const attachment = await findAttachmentByUserById(id, userId);

      if (!attachment) {
        return res.status(404).json({
          error: 'Attachment not found or does not belong to the user',
        });
      }

      // Update the attachment
      const updatedAttachment = await attachmentService.updateAttachmentService(
        {
          id,
          title,
          description,
          visibility,
          highlighted,
          userId,
        }
      );

      return res.status(200).json({ attachment: updatedAttachment });
    } catch (error) {
      console.error('Error updating attachment:', error);
      return res.status(500).json({ error: 'Error updating attachment' });
    }
  },

  async deleteAttachment(req, res) {
    try {
      const { id } = req.params;
      const { externalLinkId, resourceId } = req.body;
      const userId = req.auth.dbUserId;

      if (externalLinkId && resourceId) {
        return res.status(400).json({
          error:
            'Attachment deletion can only target either an external link or a resource association at one time',
        });
      }

      // check if attachment belongs to the user
      const attachment = await findAttachmentByUserById(id, userId);

      if (!attachment) {
        return res.status(404).json({
          error: 'Attachment not found or does not belong to the user',
        });
      }

      // If externalLinkId is provided, only remove the relationship
      if (externalLinkId) {
        await attachmentService.removeAttachmentFromExternalLink({
          attachmentId: id,
          externalLinkId,
        });

        // Check if attachment still has other references
        const references =
          await attachmentService.checkAttachmentReferences(id);

        // If no references remain, delete the attachment completely
        if (!references.hasReferences) {
          //delete from s3
          await s3Delete(attachment.image_key);

          //delete from database
          await deleteAttachmentService(id);

          return res.status(200).json({
            message:
              'Attachment removed from external link and deleted completely (no other references)',
          });
        }

        return res.status(200).json({
          message: 'Attachment removed from external link successfully',
        });
      }

      if (resourceId) {
        await attachmentService.removeAttachmentFromResource({
          attachmentId: id,
          resourceId,
        });

        const references =
          await attachmentService.checkAttachmentReferences(id);

        if (!references.hasReferences) {
          await s3Delete(attachment.image_key);
          await deleteAttachmentService(id);

          return res.status(200).json({
            message:
              'Attachment removed from resource and deleted completely (no other references)',
          });
        }

        return res.status(200).json({
          message: 'Attachment removed from resource successfully',
        });
      }

      // Original behavior: delete attachment completely
      //delete from s3
      await s3Delete(attachment.image_key);

      //delete from database
      await deleteAttachmentService(id);

      return res
        .status(200)
        .json({ message: 'Attachment deleted successfully' });
    } catch (error) {
      console.error('Error in deleteAttachment:', error);
      return res.status(500).json({ error: 'Error deleting attachment' });
    }
  },

  async searchAttachments(req, res) {
    try {
      const { q } = req.query;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds || [];

      const attachments = await attachmentService.searchAttachments({
        q,
        userId,
        tenantIds,
      });

      return res.status(200).json({ attachments });
    } catch (error) {
      console.error('Error searching attachments:', error);
      return res.status(500).json({ error: 'Error searching attachments' });
    }
  },

  /**
   * Proxy endpoint to download images with proper CORS headers
   * This avoids CORS issues when downloading images from S3/CloudFront
   */
  async downloadImage(req, res) {
    try {
      let { imageKey } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (!imageKey) {
        return res.status(400).json({ error: 'Image key is required' });
      }

      // Decode the imageKey (it's URL encoded)
      imageKey = decodeURIComponent(imageKey);

      // Set CORS headers first (before any operations)
      const origin = req.headers.origin;
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:5174',
      ].filter(Boolean);

      if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      } else if (process.env.NODE_ENV !== 'production') {
        res.header('Access-Control-Allow-Origin', '*');
      }

      res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');

      // Try to verify user has access to this attachment (optional check)
      const attachment = await findAccessibleAttachmentByImageKey(
        imageKey,
        userId,
        tenantIds
      );

      if (!attachment) {
        return res.status(403).json({ error: 'Access denied to attachment' });
      }

      // Fetch image from S3
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const REGION = process.env.AWS_REGION;
      const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

      const s3Client = new S3Client({
        region: REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: imageKey,
      });

      const response = await s3Client.send(command);

      // Set content type and disposition headers
      const contentType = response.ContentType || 'image/jpeg';
      const filename = imageKey.split('/').pop() || 'image';
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );

      // Stream the image to the response
      response.Body.pipe(res);
    } catch (error) {
      console.error('Error downloading image:', error);

      // Set CORS headers even on error
      const origin = req.headers.origin;
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:5174',
      ].filter(Boolean);

      if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      } else if (process.env.NODE_ENV !== 'production') {
        res.header('Access-Control-Allow-Origin', '*');
      }

      if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
        return res.status(404).json({ error: 'Image not found' });
      }

      return res.status(500).json({ error: 'Error downloading image' });
    }
  },

  /**
   * View image endpoint - serves images through backend proxy
   * This allows permanent URLs that never expire - proxy generates fresh URLs on-demand
   */
  async viewImage(req, res) {
    try {
      let { imageKey } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (!imageKey) {
        return res.status(400).json({ error: 'Image key is required' });
      }

      imageKey = decodeURIComponent(imageKey);

      const attachment = await findAccessibleAttachmentByImageKey(
        imageKey,
        userId,
        tenantIds
      );

      if (!attachment) {
        return res.status(403).json({ error: 'Access denied to attachment' });
      }

      // Fetch image directly from S3 (more efficient than generating presigned URL then fetching)
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const REGION = process.env.AWS_REGION;
      const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

      const s3Client = new S3Client({
        region: REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: imageKey,
      });

      const response = await s3Client.send(command);

      if (!response.Body) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Set appropriate headers
      const contentType = response.ContentType || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

      // Stream the image directly from S3
      response.Body.pipe(res);
    } catch (error) {
      console.error('Error viewing image:', error);

      if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
        return res.status(404).json({ error: 'Image not found' });
      }

      res.status(500).json({ error: 'Error viewing image' });
    }
  },

  /**
   * Refresh a presigned URL for an image by imageKey
   */
  async refreshImageUrl(req, res) {
    try {
      const { imageKey } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (!imageKey) {
        return res.status(400).json({ error: 'Image key is required' });
      }

      const decodedImageKey = decodeURIComponent(imageKey);

      const attachment = await findAccessibleAttachmentByImageKey(
        decodedImageKey,
        userId,
        tenantIds
      );

      if (!attachment) {
        return res.status(403).json({ error: 'Access denied to attachment' });
      }

      // Use reasonable expiration times - shorter for security, but auto-refresh when needed
      const { generatePresignedCloudFrontUrl } = await import(
        '../utils/cloudFrontSigner.js'
      );
      const { generatePresignedUrl } = await import('../utils/s3.js');

      let freshUrl;
      if (process.env.CLOUDFRONT_DOMAIN) {
        // CloudFront: 30 days expiration
        freshUrl = generatePresignedCloudFrontUrl(decodedImageKey, 2592000);
      } else {
        // S3: 7 days expiration (maximum allowed)
        freshUrl = await generatePresignedUrl(decodedImageKey, 604800);
      }

      if (!freshUrl) {
        return res.status(500).json({ error: 'Failed to generate fresh URL' });
      }

      res.json({
        url: freshUrl,
        expiresIn: process.env.CLOUDFRONT_DOMAIN ? 2592000 : 604800,
      });
    } catch (error) {
      console.error('Error refreshing image URL:', error);
      res.status(500).json({ error: 'Error refreshing image URL' });
    }
  },
};
