import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';

const DEFAULT_URL_EXPIRATION_SECONDS = 86400;
const DEFAULT_UPLOAD_EXPIRATION_SECONDS = 15 * 60;
const SAS_CLOCK_SKEW_SECONDS = 5 * 60;
const DEFAULT_STREAM_BUFFER_SIZE = 8 * 1024 * 1024;
const DEFAULT_STREAM_CONCURRENCY = 4;

let cachedAzureClient;

const parseConnectionStringValue = (connectionString, key) => {
  if (!connectionString) return null;

  const prefix = `${key}=`;
  const segment = connectionString
    .split(';')
    .find((part) => part.toLowerCase().startsWith(prefix.toLowerCase()));

  return segment ? segment.slice(prefix.length) : null;
};

const getAzureStorageConfig = () => {
  if (cachedAzureClient) {
    return cachedAzureClient;
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const accountName =
    process.env.AZURE_STORAGE_ACCOUNT_NAME ||
    parseConnectionStringValue(connectionString, 'AccountName');
  const accountKey =
    process.env.AZURE_STORAGE_ACCOUNT_KEY ||
    parseConnectionStringValue(connectionString, 'AccountKey');
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
  const blobEndpoint =
    process.env.AZURE_STORAGE_BLOB_ENDPOINT ||
    parseConnectionStringValue(connectionString, 'BlobEndpoint') ||
    (accountName ? `https://${accountName}.blob.core.windows.net` : null);

  if (!accountName || !accountKey || !containerName) {
    throw new Error(
      'Azure Blob Storage is not configured. Set AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_ACCOUNT_KEY, and AZURE_STORAGE_CONTAINER_NAME, or provide AZURE_STORAGE_CONNECTION_STRING plus AZURE_STORAGE_CONTAINER_NAME.'
    );
  }

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const serviceClient = connectionString
    ? BlobServiceClient.fromConnectionString(connectionString)
    : new BlobServiceClient(blobEndpoint, credential);

  cachedAzureClient = {
    accountName,
    accountKey,
    blobEndpoint,
    containerName,
    credential,
    serviceClient,
    containerClient: serviceClient.getContainerClient(containerName),
  };

  return cachedAzureClient;
};

const isUsableStorageKey = (key) =>
  key &&
  key !== 'null' &&
  key !== 'undefined' &&
  key !== null &&
  key !== undefined;

export const getBlockBlobClient = (key) => {
  if (!isUsableStorageKey(key)) {
    throw new Error('Storage key is required');
  }

  return getAzureStorageConfig().containerClient.getBlockBlobClient(key);
};

export const uploadToStorage = async (fileInput, key, contentType) => {
  const blockBlobClient = getBlockBlobClient(key);
  const uploadOptions = {
    blobHTTPHeaders: {
      blobContentType: contentType || 'application/octet-stream',
    },
  };

  if (Buffer.isBuffer(fileInput)) {
    return blockBlobClient.uploadData(fileInput, uploadOptions);
  }

  if (typeof fileInput === 'string') {
    return blockBlobClient.uploadFile(fileInput, uploadOptions);
  }

  if (fileInput && typeof fileInput.pipe === 'function') {
    return blockBlobClient.uploadStream(
      fileInput,
      DEFAULT_STREAM_BUFFER_SIZE,
      DEFAULT_STREAM_CONCURRENCY,
      uploadOptions
    );
  }

  throw new Error(
    'Invalid file input type. Expected buffer, file path, or stream.'
  );
};

export const deleteFromStorage = async (key) => {
  const blockBlobClient = getBlockBlobClient(key);
  return blockBlobClient.deleteIfExists();
};

export const downloadFromStorage = async (key) => {
  const blockBlobClient = getBlockBlobClient(key);
  const response = await blockBlobClient.download();

  if (!response.readableStreamBody) {
    const error = new Error('File not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    body: response.readableStreamBody,
    contentType: response.contentType || 'application/octet-stream',
    contentLength: response.contentLength,
  };
};

export const getStorageProperties = async (key) => {
  const blockBlobClient = getBlockBlobClient(key);
  return blockBlobClient.getProperties();
};

export const generateSignedStorageUrl = (
  key,
  expiresInSeconds = DEFAULT_URL_EXPIRATION_SECONDS
) => {
  if (!isUsableStorageKey(key)) {
    return null;
  }

  const { containerName, credential } = getAzureStorageConfig();
  const blockBlobClient = getBlockBlobClient(key);
  const now = Date.now();
  const expiresOn = new Date(now + expiresInSeconds * 1000);
  const startsOn = new Date(now - SAS_CLOCK_SKEW_SECONDS * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    credential
  ).toString();

  return `${blockBlobClient.url}?${sasToken}`;
};

export const generateUploadStorageUrl = (
  key,
  expiresInSeconds = DEFAULT_UPLOAD_EXPIRATION_SECONDS
) => {
  if (!isUsableStorageKey(key)) {
    return null;
  }

  const { containerName, credential } = getAzureStorageConfig();
  const blockBlobClient = getBlockBlobClient(key);
  const now = Date.now();
  const expiresOn = new Date(now + expiresInSeconds * 1000);
  const startsOn = new Date(now - SAS_CLOCK_SKEW_SECONDS * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse('cw'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    credential
  ).toString();

  return {
    url: `${blockBlobClient.url}?${sasToken}`,
    expiresIn: expiresInSeconds,
    expiresOn,
  };
};

export const constructStorageUrl = (key) => {
  if (!isUsableStorageKey(key)) {
    return null;
  }

  if (process.env.AZURE_STORAGE_PUBLIC_ACCESS === 'true') {
    return getBlockBlobClient(key).url;
  }

  return generateSignedStorageUrl(key);
};
