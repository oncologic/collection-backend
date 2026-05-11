import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // Add additional configuration for better reliability
  maxAttempts: 3,
  retryMode: 'adaptive',
});

export const s3Uploader = async (fileInput, key, contentType) => {
  try {
    let body;
    let fileSize;

    // Determine if input is a buffer, file path, or stream
    if (Buffer.isBuffer(fileInput)) {
      // Handle buffer input (memory storage)
      body = fileInput;
      fileSize = fileInput.length;
    } else if (typeof fileInput === 'string') {
      // Handle file path input (disk storage)
      body = fs.createReadStream(fileInput);
      const stats = fs.statSync(fileInput);
      fileSize = stats.size;
    } else if (fileInput && typeof fileInput.pipe === 'function') {
      // Handle stream input
      body = fileInput;
      fileSize = fileInput.size || 0;
    } else {
      throw new Error(
        'Invalid file input type. Expected buffer, file path, or stream.'
      );
    }

    // Configure upload parameters
    const uploadParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    };

    // Use simple PutObject for files smaller than 20MB to avoid multipart issues
    if (fileSize < 20 * 1024 * 1024) {
      console.log(`Using simple upload for ${key} (${fileSize} bytes)`);

      // For file paths, read the entire file into a buffer for simple upload
      if (typeof fileInput === 'string') {
        uploadParams.Body = fs.readFileSync(fileInput);
      }

      const command = new PutObjectCommand(uploadParams);
      const result = await s3Client.send(command);

      console.log(`Successfully uploaded ${key} to S3 using simple upload`);

      // Clean up file if it was a temporary file
      if (typeof fileInput === 'string' && fileInput.includes('temp-uploads')) {
        try {
          fs.unlinkSync(fileInput);
          console.log(`Cleaned up temporary file: ${fileInput}`);
        } catch (cleanupError) {
          console.warn(
            `Failed to clean up temporary file ${fileInput}:`,
            cleanupError
          );
        }
      }

      return result;
    }

    // Use multipart upload for larger files
    console.log(`Using multipart upload for ${key} (${fileSize} bytes)`);

    // Ensure we use file stream for multipart uploads
    if (typeof fileInput === 'string') {
      body = fs.createReadStream(fileInput);
    }

    const parallelUpload = new Upload({
      client: s3Client,
      params: {
        ...uploadParams,
        Body: body,
      },
      // Use larger part size and reduce concurrency for better reliability
      partSize: 20 * 1024 * 1024, // 20MB parts
      queueSize: 1, // Sequential uploads to avoid timing issues
      leavePartsOnError: false,
      tags: [
        {
          Key: 'UploadType',
          Value: 'attachment',
        },
      ],
    });

    // Optional: Listen for progress events for debugging
    parallelUpload.on('httpUploadProgress', (progress) => {
      console.log(
        `Upload progress for ${key}: ${progress.loaded} of ${progress.total} bytes (${Math.round((progress.loaded / progress.total) * 100)}%)`
      );
    });

    // Add error handling for the upload process
    parallelUpload.on('error', (error) => {
      console.error(`Upload error for ${key}:`, error);
    });

    // Wait for the upload to complete
    const result = await parallelUpload.done();
    console.log(`Successfully uploaded ${key} to S3 using multipart upload`);

    // Clean up file if it was a temporary file
    if (typeof fileInput === 'string' && fileInput.includes('temp-uploads')) {
      try {
        fs.unlinkSync(fileInput);
        console.log(`Cleaned up temporary file: ${fileInput}`);
      } catch (cleanupError) {
        console.warn(
          `Failed to clean up temporary file ${fileInput}:`,
          cleanupError
        );
      }
    }

    return result;
  } catch (error) {
    console.error(`S3 upload failed for ${key}:`, error);

    // Clean up temporary file on error
    if (typeof fileInput === 'string' && fileInput.includes('temp-uploads')) {
      try {
        fs.unlinkSync(fileInput);
      } catch (cleanupError) {
        console.warn(
          `Failed to clean up temporary file on error:`,
          cleanupError
        );
      }
    }

    // Provide more specific error messages
    if (error.name === 'InvalidPart') {
      throw new Error(
        'Upload failed due to invalid multipart upload. Please try uploading a smaller file or try again.'
      );
    } else if (error.name === 'NoSuchUpload') {
      throw new Error(
        'Upload session expired. Please try uploading the file again.'
      );
    } else if (error.name === 'EntityTooLarge') {
      throw new Error('File is too large. Please upload a smaller file.');
    } else if (error.name === 'AccessDenied') {
      throw new Error(
        'Upload failed due to permission issues. Please contact support.'
      );
    } else {
      throw new Error(`Upload failed: ${error.message}`);
    }
  }
};

export const s3Delete = async (key) => {
  const deleteParams = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
  };

  try {
    const command = new DeleteObjectCommand(deleteParams);
    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    throw new Error('Failed to delete file from S3');
  }
};
