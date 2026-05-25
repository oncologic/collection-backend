import { db } from '../db/index.js';
import dotenv from 'dotenv';

import { resources, resourceTags } from '../models/resources.js';
import { collections } from '../models/collections.js';
import { externalLinks } from '../models/external_links.js';
import {
  collectionExternalLinksNotations,
  collectionExternalLinkNotationTags,
} from '../models/collectionExternalLinksNotations.js';
import { collectionExternalLinkTagDefinitions } from '../models/collectionExternalLinkTags.js';
import { linkGroups } from '../models/linkGroup.js';
import { attachments } from '../models/attachments.js';
import { events } from '../models/events.js';
import {
  organizations,
  organizationResources,
} from '../models/organizations.js';
import { tags } from '../models/tags.js';
import { sql, eq, isNull, gt, or, and, inArray } from 'drizzle-orm';
import {
  dedupeAndRankSemanticSearchResults,
  normalizeSemanticSearchResult,
} from './semanticSearchUtils.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Configure embeddings. The database currently stores vector(1536), so local
// embedding vectors are normalized to the configured storage dimension.
const EMBEDDING_PROVIDER = String(
  process.env.EMBEDDING_PROVIDER || 'openai'
).toLowerCase();
const EMBEDDING_API_URL =
  process.env.EMBEDDING_API_URL || 'https://api.openai.com/v1/embeddings';
const EMBEDDING_OLLAMA_BASE_URL = (
  process.env.EMBEDDING_BASE_URL ||
  process.env.OLLAMA_BASE_URL ||
  'http://localhost:11434'
).replace(/\/+$/, '');
const EMBEDDING_OLLAMA_PATH =
  process.env.EMBEDDING_OLLAMA_PATH || '/api/embed';
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ||
  (EMBEDDING_PROVIDER === 'ollama'
    ? 'nomic-embed-text'
    : 'text-embedding-3-small');
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_MODEL_DIMENSIONS = parsePositiveInteger(
  process.env.EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_PROVIDER === 'ollama' ? 768 : EMBEDDING_DIMENSIONS
);

// Token limits for different models
const MODEL_TOKEN_LIMITS = {
  'text-embedding-3-small': 8192,
  'text-embedding-3-large': 8192,
  'text-embedding-ada-002': 8192,
  'nomic-embed-text': 8192,
  'mxbai-embed-large': 512,
  'all-minilm': 256,
};

// More conservative token estimation - actual tokens can be higher than this estimate
// Using 3 characters per token (conservative) instead of 4 to avoid hitting limits
const CHARS_PER_TOKEN = 3;
const MAX_TOKENS = MODEL_TOKEN_LIMITS[EMBEDDING_MODEL] || 8192;
// Leave some buffer for safety (use 90% of max tokens)
const SAFE_MAX_TOKENS = Math.floor(MAX_TOKENS * 0.9); // ~7372 tokens
const MAX_CHARS = SAFE_MAX_TOKENS * CHARS_PER_TOKEN;

let hasLoggedEmbeddingDimensionNormalization = false;

// 🚀 MEMORY MANAGEMENT CONFIGURATION
const MEMORY_CONFIG = {
  // Maximum concurrent embedding operations
  MAX_CONCURRENT_EMBEDDINGS: 3,
  // Maximum concurrent bulk processing operations
  MAX_CONCURRENT_BULK_OPERATIONS: 2,
  // Batch size for bulk operations
  BULK_BATCH_SIZE: 10,
  // Rate limiting
  API_RATE_LIMIT_MS: 1000, // 1 second between API calls
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 2000,
  // Memory cleanup intervals
  CLEANUP_INTERVAL_MS: 30000, // 30 seconds
  // Maximum text size before aggressive chunking
  MAX_TEXT_SIZE: 50000, // 50KB
};

const resourceEmbeddingBackfillJobs = new Map();

const getResourceEmbeddingBackfillJobKey = (tenantIds = []) =>
  [...tenantIds].sort().join(',');

const serializeResourceEmbeddingBackfillJob = (job) =>
  job
    ? {
        tenantIds: job.tenantIds,
        state: job.state,
        forceAll: job.forceAll,
        totalCount: job.totalCount,
        processedCount: job.processedCount,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
      }
    : null;

// 🔄 CONCURRENCY CONTROL - Semaphore implementation
class Semaphore {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.currentConcurrent = 0;
    this.queue = [];
  }

  get available() {
    return this.maxConcurrent - this.currentConcurrent;
  }

  get waiting() {
    return this.queue.length;
  }

  async acquire(callback) {
    return new Promise((resolve) => {
      const executeCallback = async () => {
        try {
          const result = await callback();
          resolve(result);
        } catch (error) {
          resolve(Promise.reject(error));
        } finally {
          this.release();
        }
      };

      if (this.currentConcurrent < this.maxConcurrent) {
        this.currentConcurrent++;
        executeCallback();
      } else {
        this.queue.push(executeCallback);
      }
    });
  }

  release() {
    this.currentConcurrent--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.currentConcurrent++;
      next();
    }
  }
}

// Create semaphores for different operations
const embeddingSemaphore = new Semaphore(
  MEMORY_CONFIG.MAX_CONCURRENT_EMBEDDINGS
);
const bulkProcessingSemaphore = new Semaphore(
  MEMORY_CONFIG.MAX_CONCURRENT_BULK_OPERATIONS
);

// 🧹 MEMORY CLEANUP UTILITIES
const memoryCleanup = {
  trackedObjects: new WeakSet(),

  forceGC() {
    if (global.gc) {
      global.gc();
    }
  },

  forceCleanup() {
    this.forceGC();
    this.trackedObjects = new WeakSet();
  },

  cleanup(obj) {
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        obj.length = 0; // Clear array
      } else {
        Object.keys(obj).forEach((key) => {
          delete obj[key];
        });
      }
    }
  },

  // Monitor memory usage
  logMemoryUsage(context = '') {
    const memUsage = process.memoryUsage();
    const formatMB = (bytes) => Math.round(bytes / 1024 / 1024);

    // Warn if memory usage is high
    if (formatMB(memUsage.heapUsed) > 500) {
      console.warn('⚠️ High memory usage detected!');
    }
  },
};

// Start lightweight memory logging without keeping CLI processes alive.
const passiveMemoryLogInterval = setInterval(() => {
  memoryCleanup.logMemoryUsage('(periodic check)');
}, MEMORY_CONFIG.CLEANUP_INTERVAL_MS);
passiveMemoryLogInterval.unref?.();

// 🔄 RATE LIMITED API CALLS
let lastApiCall = 0;

const rateLimitedApiCall = async (apiCall) => {
  // Rate limiting
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;
  if (timeSinceLastCall < MEMORY_CONFIG.API_RATE_LIMIT_MS) {
    const delay = MEMORY_CONFIG.API_RATE_LIMIT_MS - timeSinceLastCall;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastApiCall = Date.now();

  // Retry logic
  let lastError;
  for (let attempt = 1; attempt <= MEMORY_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const result = await apiCall();
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`🔄 API call attempt ${attempt} failed:`, error.message);

      if (attempt < MEMORY_CONFIG.MAX_RETRIES) {
        const delay = MEMORY_CONFIG.RETRY_DELAY_MS * attempt;

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
};

/**
 * Estimate token count for text (rough approximation)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
const estimateTokenCount = (text) => {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
};

/**
 * Memory-efficient text chunking that minimizes duplication
 * @param {string} text - Text to chunk
 * @param {number} maxChars - Maximum characters per chunk
 * @returns {string[]} Array of text chunks
 */
const chunkText = (text, maxChars = MAX_CHARS) => {
  if (!text || text.length <= maxChars) {
    return [text || ''];
  }

  // 🧹 MEMORY OPTIMIZATION: Use indices instead of creating substring copies
  const chunks = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + maxChars, text.length);

    // Try to break at word boundaries to avoid cutting words
    if (endIndex < text.length) {
      const lastSpace = text.lastIndexOf(' ', endIndex);
      const lastPeriod = text.lastIndexOf('.', endIndex);
      const lastNewline = text.lastIndexOf('\n', endIndex);

      // Find the best break point
      const breakPoint = Math.max(lastSpace, lastPeriod, lastNewline);
      if (breakPoint > startIndex + maxChars * 0.8) {
        endIndex = breakPoint + 1;
      }
    }

    // Only create substring when needed (lazy evaluation)
    const chunk = text.substring(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    startIndex = endIndex;
  }

  return chunks.length > 0 ? chunks : [''];
};

/**
 * Memory-efficient embedding generation with proper cleanup
 * @param {string} text - Text to embed (will be chunked if too long)
 * @returns {Promise<number[]>} Averaged embedding vector
 */
export const generateChunkedEmbedding = async (text) => {
  if (!text || text.trim().length === 0) {
    // Return zero vector for empty text
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
  }

  // 🧹 MEMORY CHECK: Skip extremely large texts
  if (text.length > MEMORY_CONFIG.MAX_TEXT_SIZE) {
    console.warn(
      `⚠️ Text too large (${text.length} chars), truncating to ${MEMORY_CONFIG.MAX_TEXT_SIZE}`
    );
    text = text.substring(0, MEMORY_CONFIG.MAX_TEXT_SIZE) + '...';
  }

  memoryCleanup.logMemoryUsage('(before chunking)');

  const chunks = chunkText(text);

  if (chunks.length === 1) {
    // Single chunk - use rate-limited API call
    const tokens = estimateTokenCount(chunks[0]);
    if (tokens > SAFE_MAX_TOKENS) {
      console.warn(`⚠️ Single chunk still has ~${tokens} tokens, may fail`);
    }

    try {
      const result = await rateLimitedApiCall(async () => {
        return await generateEmbeddings(chunks[0]);
      });

      // 🧹 CLEANUP: Clear chunk reference
      chunks.length = 0;
      return result;
    } catch (error) {
      console.error(
        `Failed to generate embedding for single chunk (${tokens} tokens):`,
        error.message
      );
      chunks.length = 0;
      throw error;
    }
  }

  // 🔄 MEMORY-EFFICIENT PROCESSING: Process chunks sequentially to avoid memory explosion
  const chunkEmbeddings = [];
  let processedChunks = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const tokens = estimateTokenCount(chunk);

      try {
        const embedding = await rateLimitedApiCall(async () => {
          return await generateEmbeddings(chunk);
        });

        chunkEmbeddings.push(embedding);
        processedChunks++;

        // 🧹 MEMORY CLEANUP: Clear processed chunk
        chunks[i] = null;

        // Periodic memory check
        if (i % 5 === 0) {
          memoryCleanup.logMemoryUsage(`(chunk ${i + 1}/${chunks.length})`);
        }
      } catch (error) {
        console.error(
          `Error generating embedding for chunk ${i + 1}:`,
          error.message
        );
        console.warn(`Skipping chunk ${i + 1} and using zero vector`);
        chunkEmbeddings.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
      }
    }

    // 🧹 CLEANUP: Clear chunks array
    chunks.length = 0;

    // Average the embeddings efficiently
    const avgEmbedding = new Array(EMBEDDING_DIMENSIONS).fill(0);
    const validEmbeddings = chunkEmbeddings.filter(
      (embedding) => embedding && !embedding.every((val) => val === 0)
    );

    if (validEmbeddings.length === 0) {
      console.warn(
        'All chunks failed to generate embeddings, returning zero vector'
      );
      chunkEmbeddings.length = 0;
      return new Array(EMBEDDING_DIMENSIONS).fill(0);
    }

    // 🔄 MEMORY-EFFICIENT AVERAGING: Process one embedding at a time
    for (let i = 0; i < validEmbeddings.length; i++) {
      const embedding = validEmbeddings[i];
      for (let j = 0; j < EMBEDDING_DIMENSIONS; j++) {
        avgEmbedding[j] += embedding[j];
      }
      // Clear processed embedding
      validEmbeddings[i] = null;
    }

    // Divide by number of valid chunks to get average
    const validCount = validEmbeddings.length;
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      avgEmbedding[i] /= validCount;
    }

    // 🧹 FINAL CLEANUP
    chunkEmbeddings.length = 0;
    validEmbeddings.length = 0;

    memoryCleanup.logMemoryUsage('(after embedding generation)');

    return avgEmbedding;
  } catch (error) {
    // 🧹 ERROR CLEANUP
    chunks.length = 0;
    chunkEmbeddings.length = 0;
    throw error;
  }
};

const normalizeEmbeddingDimensions = (embedding) => {
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding provider returned a non-array embedding');
  }

  const numericEmbedding = embedding.map((value) =>
    typeof value === 'number' ? value : Number(value)
  );

  if (numericEmbedding.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding provider returned non-numeric values');
  }

  if (numericEmbedding.length === EMBEDDING_DIMENSIONS) {
    return numericEmbedding;
  }

  if (!hasLoggedEmbeddingDimensionNormalization) {
    console.info(
      `Embedding dimension normalization enabled: provider=${EMBEDDING_PROVIDER}, model=${EMBEDDING_MODEL}, modelDimensions=${numericEmbedding.length}, storageDimensions=${EMBEDDING_DIMENSIONS}`
    );
    hasLoggedEmbeddingDimensionNormalization = true;
  }

  if (numericEmbedding.length > EMBEDDING_DIMENSIONS) {
    return numericEmbedding.slice(0, EMBEDDING_DIMENSIONS);
  }

  return [
    ...numericEmbedding,
    ...new Array(EMBEDDING_DIMENSIONS - numericEmbedding.length).fill(0),
  ];
};

const normalizeEmbeddings = (embeddings) =>
  embeddings.map((embedding) => normalizeEmbeddingDimensions(embedding));

export const getEmbeddingConfiguration = () => ({
  provider: EMBEDDING_PROVIDER,
  model: EMBEDDING_MODEL,
  modelDimensions: EMBEDDING_MODEL_DIMENSIONS,
  storageDimensions: EMBEDDING_DIMENSIONS,
  baseUrl:
    EMBEDDING_PROVIDER === 'ollama'
      ? EMBEDDING_OLLAMA_BASE_URL
      : EMBEDDING_API_URL,
});

const joinUrl = (baseUrl, path) =>
  `${baseUrl.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;

const generateOpenAIEmbeddings = async (input) => {
  const response = await fetch(EMBEDDING_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input,
      model: EMBEDDING_MODEL,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Embedding API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data = await response.json();
  return data.data.map((item) => item.embedding);
};

const generateOllamaEmbeddings = async (input) => {
  const response = await fetch(
    joinUrl(EMBEDDING_OLLAMA_BASE_URL, EMBEDDING_OLLAMA_PATH),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Ollama embedding API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data = await response.json();

  if (Array.isArray(data.embeddings)) {
    return data.embeddings;
  }

  if (Array.isArray(data.embedding)) {
    return [data.embedding];
  }

  if (Array.isArray(data.data)) {
    return data.data.map((item) => item.embedding).filter(Boolean);
  }

  throw new Error('Ollama embedding API returned an unsupported response');
};

/**
 * Generate embeddings using the configured provider
 * @param {string|string[]} texts - Text or array of texts to embed
 * @returns {Promise<number[]|number[][]>} Embedding vector(s)
 */
export const generateEmbeddings = async (texts) => {
  try {
    const isArray = Array.isArray(texts);
    let input = isArray ? texts : [texts];

    // Filter out empty strings and ensure we have valid input
    input = input.filter((text) => text && text.trim().length > 0);

    if (input.length === 0) {
      throw new Error('No valid text provided for embedding generation');
    }

    // Check for texts that are too long using token estimation
    const longTexts = input.filter((text) => {
      const tokens = estimateTokenCount(text);
      return tokens > SAFE_MAX_TOKENS;
    });

    if (longTexts.length > 0) {
      console.warn(
        `⚠️ Found ${longTexts.length} texts exceeding ${SAFE_MAX_TOKENS} tokens. Use generateChunkedEmbedding for long texts.`
      );

      // Log details about the problematic texts
      longTexts.forEach((text, index) => {
        const tokens = estimateTokenCount(text);
        console.warn(
          `   Text ${index + 1}: ~${tokens} tokens (${text.length} chars)`
        );
      });

      // Truncate long texts as fallback - but this is not ideal
      input = input.map((text) => {
        const tokens = estimateTokenCount(text);
        if (tokens > SAFE_MAX_TOKENS) {
          // Roughly estimate where to cut off
          const targetLength = Math.floor(
            (text.length * SAFE_MAX_TOKENS) / tokens
          );
          return text.substring(0, targetLength) + '...';
        }
        return text;
      });
    }

    const rawEmbeddings =
      EMBEDDING_PROVIDER === 'ollama'
        ? await generateOllamaEmbeddings(input)
        : await generateOpenAIEmbeddings(input);

    if (rawEmbeddings.length !== input.length) {
      throw new Error(
        `Embedding provider returned ${rawEmbeddings.length} embeddings for ${input.length} inputs`
      );
    }

    const embeddings = normalizeEmbeddings(rawEmbeddings);

    return isArray ? embeddings : embeddings[0];
  } catch (error) {
    console.error('Error generating embeddings:', error);
    throw error;
  }
};

/**
 * Prepare text for embedding by cleaning and combining fields
 * @param {Object} resource - Resource object
 * @returns {Object} Processed text fields
 */
export const prepareTextForEmbedding = (resource) => {
  const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const processTimestamps = (timestamps) => {
    if (!timestamps) return '';

    // If it's already a string (not JSON), return it directly
    if (typeof timestamps === 'string') {
      // Check if it looks like JSON
      if (
        timestamps.trim().startsWith('[') ||
        timestamps.trim().startsWith('{')
      ) {
        try {
          const timestampData = JSON.parse(timestamps);
          if (Array.isArray(timestampData)) {
            return timestampData
              .map(
                (ts) =>
                  `${ts.title || ts.text || ts} at ${ts.formattedTime || ts.time || ''}`
              )
              .join(', ');
          }
          return String(timestampData);
        } catch {
          // If JSON parsing fails, treat as plain text
          return timestamps;
        }
      } else {
        // It's already formatted text, return as-is
        return timestamps;
      }
    }

    // If it's an array or object, process it
    try {
      if (Array.isArray(timestamps)) {
        return timestamps
          .map(
            (ts) =>
              `${ts.title || ts.text || ts} at ${ts.formattedTime || ts.time || ''}`
          )
          .join(', ');
      } else if (typeof timestamps === 'object') {
        return JSON.stringify(timestamps);
      }
      return String(timestamps);
    } catch {
      return String(timestamps || '');
    }
  };

  const name = cleanText(resource.name) || 'Untitled Resource';
  const description =
    cleanText(resource.description) || 'No description available';
  const fullText = cleanText(resource.fullText) || 'No content available';
  const timestamps = processTimestamps(resource.timestamps) || '';
  const organizationNames = cleanText(
    Array.isArray(resource.organizationNames)
      ? resource.organizationNames.join(', ')
      : ''
  );
  const tagNames = cleanText(
    Array.isArray(resource.tagNames) ? resource.tagNames.join(', ') : ''
  );

  return {
    name,
    description,
    fullText,
    timestamps,
    organizations: organizationNames,
    tags: tagNames,
    combined:
      [
        name,
        description,
        fullText,
        timestamps,
        organizationNames ? `Organizations: ${organizationNames}` : '',
        tagNames ? `Tags: ${tagNames}` : '',
      ]
        .filter((text) => text && text.trim().length > 0)
        .join(' ') || 'No content available',
  };
};

const hydrateResourceEmbeddingContext = async (resource) => {
  const [organizationRows, tagRows] = await Promise.all([
    db
      .select({ name: organizations.name })
      .from(organizationResources)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationResources.organizationId)
      )
      .where(eq(organizationResources.resourceId, resource.id)),
    db
      .select({ name: tags.name })
      .from(resourceTags)
      .innerJoin(tags, eq(tags.id, resourceTags.tagId))
      .where(eq(resourceTags.resourceId, resource.id)),
  ]);

  return {
    ...resource,
    organizationNames: organizationRows.map((row) => row.name).filter(Boolean),
    tagNames: tagRows.map((row) => row.name).filter(Boolean),
  };
};

/**
 * Update embeddings for specific resources
 * @param {string[]} resourceIds - Array of resource IDs to update (optional)
 * @returns {Promise<void>}
 */
const buildResourceEmbeddingConditions = ({
  resourceIds = null,
  tenantIds = null,
  onlyStale = true,
} = {}) => {
  const conditions = [];

  if (Array.isArray(resourceIds) && resourceIds.length > 0) {
    conditions.push(inArray(resources.id, resourceIds));
  } else if (onlyStale) {
    conditions.push(
      or(
        isNull(resources.vectorUpdatedAt),
        gt(resources.updatedAt, resources.vectorUpdatedAt)
      )
    );
  }

  if (Array.isArray(tenantIds) && tenantIds.length > 0) {
    conditions.push(inArray(resources.tenantId, tenantIds));
  }

  return conditions;
};

export const queueResourceEmbeddingBackfillForTenants = async (
  tenantIds = [],
  forceAll = false
) => {
  const jobKey = getResourceEmbeddingBackfillJobKey(tenantIds);
  const existingJob = resourceEmbeddingBackfillJobs.get(jobKey);

  if (existingJob && ['queued', 'running'].includes(existingJob.state)) {
    return {
      queuedCount: existingJob.totalCount,
      resourceIds: [],
      job: serializeResourceEmbeddingBackfillJob(existingJob),
      alreadyRunning: true,
    };
  }

  const conditions = buildResourceEmbeddingConditions({
    tenantIds,
    onlyStale: !forceAll,
  });

  let query = db.select({ id: resources.id }).from(resources);

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const pendingResources = await query;
  const pendingResourceIds = pendingResources.map((resource) => resource.id);
  const now = new Date().toISOString();

  const baseJob = {
    tenantIds: [...tenantIds],
    state: pendingResourceIds.length > 0 ? 'queued' : 'completed',
    forceAll,
    totalCount: pendingResourceIds.length,
    processedCount: pendingResourceIds.length > 0 ? 0 : pendingResourceIds.length,
    queuedAt: now,
    startedAt: null,
    completedAt: pendingResourceIds.length > 0 ? null : now,
    error: null,
  };

  resourceEmbeddingBackfillJobs.set(jobKey, baseJob);

  if (pendingResourceIds.length === 0) {
    return {
      queuedCount: 0,
      resourceIds: [],
      job: serializeResourceEmbeddingBackfillJob(baseJob),
      alreadyRunning: false,
    };
  }

  setTimeout(() => {
    updateResourceEmbeddings({
      resourceIds: pendingResourceIds,
      tenantIds,
      onlyStale: false,
      onProgress: ({ processedCount, totalCount }) => {
        const currentJob = resourceEmbeddingBackfillJobs.get(jobKey);

        if (!currentJob) {
          return;
        }

        resourceEmbeddingBackfillJobs.set(jobKey, {
          ...currentJob,
          state: 'running',
          startedAt: currentJob.startedAt || new Date().toISOString(),
          processedCount,
          totalCount,
          error: null,
        });
      },
    })
      .then(() => {
        const currentJob = resourceEmbeddingBackfillJobs.get(jobKey);

        if (currentJob) {
          resourceEmbeddingBackfillJobs.set(jobKey, {
            ...currentJob,
            state: 'completed',
            processedCount: currentJob.totalCount,
            completedAt: new Date().toISOString(),
            error: null,
          });
        }
      })
      .catch((error) => {
        console.error('Error backfilling resource embeddings:', error);

        const currentJob = resourceEmbeddingBackfillJobs.get(jobKey);

        if (currentJob) {
          resourceEmbeddingBackfillJobs.set(jobKey, {
            ...currentJob,
            state: 'failed',
            completedAt: new Date().toISOString(),
            error: error.message,
          });
        }
      });

    const currentJob = resourceEmbeddingBackfillJobs.get(jobKey);

    if (currentJob) {
      resourceEmbeddingBackfillJobs.set(jobKey, {
        ...currentJob,
        state: 'running',
        startedAt: currentJob.startedAt || new Date().toISOString(),
      });
    }
  }, 0);

  return {
    queuedCount: pendingResourceIds.length,
    resourceIds: pendingResourceIds,
    job: serializeResourceEmbeddingBackfillJob(baseJob),
    alreadyRunning: false,
  };
};

export const updateResourceEmbeddings = async ({
  resourceIds = null,
  tenantIds = null,
  onlyStale = true,
  onProgress = null,
} = {}) => {
  try {
    let query = db.select().from(resources);

    const conditions = buildResourceEmbeddingConditions({
      resourceIds,
      tenantIds,
      onlyStale,
    });

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const items = await query;

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const resourceWithContext = await hydrateResourceEmbeddingContext(item);
      const texts = prepareTextForEmbedding(resourceWithContext);

      // Generate embeddings for each field using chunked approach
      // Debug timestamps processing

      const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
      const descriptionEmbedding = await generateChunkedEmbedding(
        texts.description || ''
      );
      const fullTextEmbedding = await generateChunkedEmbedding(
        texts.fullText || ''
      );
      const timestampsEmbedding = await generateChunkedEmbedding(
        texts.timestamps || ''
      );
      const combinedEmbedding = await generateChunkedEmbedding(
        texts.combined || ''
      );

      // Update the database with vector embeddings using raw SQL
      await db.execute(sql`
        UPDATE resources
        SET
          name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
          description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
          full_text_embedding = ${JSON.stringify(fullTextEmbedding)}::vector(1536),
          timestamps_embedding = ${JSON.stringify(timestampsEmbedding)}::vector(1536),
          combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
          vector_updated_at = CURRENT_TIMESTAMP
        WHERE id = ${item.id}
      `);

      if (typeof onProgress === 'function') {
        await onProgress({
          resourceId: item.id,
          processedCount: index + 1,
          totalCount: items.length,
        });
      }
    }
  } catch (error) {
    console.error('Error updating resource embeddings:', error);
    throw error;
  }
};

export const getResourceEmbeddingBackfillStatusForTenants = async (
  tenantIds = []
) => {
  const jobKey = getResourceEmbeddingBackfillJobKey(tenantIds);
  const currentJob = resourceEmbeddingBackfillJobs.get(jobKey) || null;

  const stats = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_count,
      COUNT(combined_embedding)::int AS embedded_count,
      COUNT(*) FILTER (
        WHERE vector_updated_at IS NULL OR updated_at > vector_updated_at
      )::int AS stale_count
    FROM resources
    WHERE tenant_id = ANY(ARRAY[${sql.join(tenantIds)}]::uuid[])
  `);

  const counts = stats.rows[0] || {
    total_count: 0,
    embedded_count: 0,
    stale_count: 0,
  };

  const serializedJob = serializeResourceEmbeddingBackfillJob(currentJob);
  let state = serializedJob?.state || 'idle';

  if (!serializedJob && Number(counts.stale_count) === 0) {
    state = 'completed';
  }

  return {
    state,
    job: serializedJob,
    totalResources: Number(counts.total_count || 0),
    embeddedResources: Number(counts.embedded_count || 0),
    staleResources: Number(counts.stale_count || 0),
  };
};

/**
 * Build permission filter for semantic search
 * @param {string} userId - Current user ID
 * @param {array} collaboratedItemIds - Array of items user can access via collaboration
 * @param {string} itemType - Type of item (collections, external_links, etc.)
 * @returns {sql} SQL where clause for permissions
 */
const buildPermissionFilter = (
  userId,
  collaboratedItemIds = [],
  itemType = 'collections'
) => {
  // Validate input parameters
  if (!userId) {
    console.warn(
      '⚠️ Permission filter called without userId - this may expose private content'
    );
    return sql`1 = 0`; // Return no results if no user ID provided
  }

  const userIdField =
    itemType === 'resources'
      ? 'added_by_user_id'
      : itemType === 'events'
        ? 'added_by_user_id'
        : itemType === 'external_links'
          ? 'added_by_user_id'
          : itemType === 'attachments'
            ? 'user_id'
            : itemType === 'link_groups'
              ? 'user_id'
              : 'user_id'; // Default for collections and notations

  // Handle different permission models based on table structure
  let permissionClause;

  if (itemType === 'resources') {
    // Resources have tenant-specific access rules
    // Community tenant: Only resources added by the user
    // Kidney tenant: All resources in the tenant
    // Other tenants: All resources in the tenant (default)
    permissionClause = sql`(
      CASE
        WHEN tenant_id = ${process.env.COMMUNITY_TENANT}::uuid THEN ${sql.raw(userIdField)} = ${userId}
        ELSE 1 = 1
      END
    )`;
  } else {
    // Other tables have visibility column - public items OR items owned by user
    permissionClause = sql`(visibility = 'public' OR ${sql.raw(userIdField)} = ${userId})`;
  }

  // Add collaborated items if any exist
  if (collaboratedItemIds && collaboratedItemIds.length > 0) {
    permissionClause = sql`${permissionClause} OR id = ANY(ARRAY[${sql.join(
      collaboratedItemIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )}])`;
  }

  return permissionClause;
};

/**
 * Get all items user can access via collaboration
 * @param {string} userId - Current user ID
 * @param {string} userEmail - Current user email
 * @returns {Object} Object with arrays of accessible item IDs by type
 */
const getUserCollaboratedItems = async (userId, userEmail) => {
  if (!userId || !userEmail) {
    console.warn(
      '⚠️ getUserCollaboratedItems called without userId or userEmail'
    );
    return { collections: [], external_links: [] };
  }

  const { findUserCollaborationsForPinning } = await import(
    './collaborationService.js'
  );

  try {
    const collaborations = await findUserCollaborationsForPinning(
      userEmail,
      userId
    );

    const collaboratedItems = {
      collections: collaborations
        .filter((item) => item.type === 'collection')
        .map((item) => item.id),
      external_links: collaborations
        .filter((item) => item.type === 'external_link')
        .map((item) => item.id),
    };

    return collaboratedItems;
  } catch (error) {
    console.error('Error getting user collaborated items:', error);
    return { collections: [], external_links: [] };
  }
};

const buildUuidMembershipClause = (ids = [], columnExpression) => {
  if (!ids.length) {
    return sql`false`;
  }

  return sql`${sql.raw(columnExpression)} = ANY(ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  )}]::uuid[])`;
};

/**
 * Perform semantic search on resources with permission filtering
 * @param {string} searchQuery - User's search query
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Search results with similarity scores
 */
export const semanticSearchResources = async (searchQuery, options = {}) => {
  const {
    limit = 20,
    threshold = 0.2,
    tenantIds = null,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  try {
    // 💰 Use pre-generated embedding if provided, otherwise generate new one
    const embedding =
      queryEmbedding || (await generateChunkedEmbedding(searchQuery));

    let whereClause = sql`
      combined_embedding IS NOT NULL
      AND (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) > ${threshold}
    `;

    // Add permission filtering if userId provided
    if (userId) {
      const permissionFilter = buildPermissionFilter(userId, [], 'resources');
      whereClause = sql`${whereClause} AND (${permissionFilter})`;
    }

    // Filter by tenant(s) if provided
    if (tenantIds && tenantIds.length > 0) {
      whereClause = sql`${whereClause} AND tenant_id = ANY(ARRAY[${sql.join(
        tenantIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}])`;
    }

    const results = await db.execute(sql`
      SELECT
        id,
        name,
        description,
        url,
        timestamps,
        full_text,
        duration_value,
        duration_unit,
        tenant_id,
        created_at,
        updated_at,
        added_by_user_id,
        (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) as similarity
      FROM resources
      WHERE ${whereClause}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    return results.rows;
  } catch (error) {
    console.error('Error in semantic search:', error);
    throw error;
  }
};

/**
 * Find similar resources to a given resource
 * @param {string} resourceId - ID of the reference resource
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Similar resources
 */
export const findSimilarResources = async (resourceId, options = {}) => {
  const { limit = 10, threshold = 0.8, excludeSelf = true } = options;

  try {
    // Get the embedding of the reference resource
    const resource = await db.execute(sql`
      SELECT combined_embedding FROM resources WHERE id = ${resourceId}
    `);

    const referenceEmbedding = resource.rows[0]?.combined_embedding;

    if (!referenceEmbedding) {
      throw new Error('Reference resource embedding not found');
    }

    let whereClause = sql`
      combined_embedding IS NOT NULL
      AND (1 - (combined_embedding <=> ${referenceEmbedding}::vector(1536))) > ${threshold}
    `;

    if (excludeSelf) {
      whereClause = sql`${whereClause} AND id != ${resourceId}`;
    }

    const similarResources = await db.execute(sql`
      SELECT
        id,
        name,
        description,
        url,
        (1 - (combined_embedding <=> ${referenceEmbedding}::vector(1536))) as similarity_score
      FROM resources
      WHERE ${whereClause}
      ORDER BY similarity_score DESC
      LIMIT ${limit}
    `);

    return similarResources.rows;
  } catch (error) {
    console.error('Error finding similar resources:', error);
    throw error;
  }
};

/**
 * Auto-update embeddings for a single resource (call this after create/update)
 * @param {string} resourceId - ID of the resource to update
 * @returns {Promise<void>}
 */
export const autoUpdateResourceEmbedding = async (resourceId) => {
  try {
    const resource = await db
      .select()
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (resource.length === 0) {
      console.warn(`⚠️ Resource not found: ${resourceId}`);
      return;
    }

    const item = resource[0];
    const resourceWithContext = await hydrateResourceEmbeddingContext(item);
    const texts = prepareTextForEmbedding(resourceWithContext);

    // Generate embeddings for each field using chunked approach
    const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
    const descriptionEmbedding = await generateChunkedEmbedding(
      texts.description || ''
    );
    const fullTextEmbedding = await generateChunkedEmbedding(
      texts.fullText || ''
    );
    const timestampsEmbedding = await generateChunkedEmbedding(
      texts.timestamps || ''
    );
    const combinedEmbedding = await generateChunkedEmbedding(
      texts.combined || ''
    );

    // Update the database with vector embeddings
    await db.execute(sql`
      UPDATE resources
      SET
        name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
        description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
        full_text_embedding = ${JSON.stringify(fullTextEmbedding)}::vector(1536),
        timestamps_embedding = ${JSON.stringify(timestampsEmbedding)}::vector(1536),
        combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
        vector_updated_at = CURRENT_TIMESTAMP
      WHERE id = ${resourceId}
    `);
  } catch (error) {
    console.error(
      `❌ Error auto-updating embeddings for resource ${resourceId}:`,
      error
    );
    // Don't throw - we don't want to break the main resource operation
  }
};

/**
 * Background job to process pending embeddings
 * @returns {Promise<void>}
 */
export const processPendingEmbeddings = async () => {
  try {
    // Find resources that need embedding updates
    const pendingResources = await db
      .select()
      .from(resources)
      .where(
        or(
          isNull(resources.vectorUpdatedAt),
          gt(resources.updatedAt, resources.vectorUpdatedAt)
        )
      )
      .limit(50); // Process in batches

    if (pendingResources.length === 0) {
      return;
    }

    for (const resource of pendingResources) {
      await autoUpdateResourceEmbedding(resource.id);
      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error('❌ Error processing pending embeddings:', error);
    throw error;
  }
};

/**
 * Process pending notation embeddings in batches
 * @returns {Promise<void>}
 */
export const processPendingNotationEmbeddings = async () => {
  try {
    // Find notations that need embedding updates
    const pendingNotations = await db
      .select()
      .from(collectionExternalLinksNotations)
      .where(
        or(
          isNull(collectionExternalLinksNotations.vectorUpdatedAt),
          gt(
            collectionExternalLinksNotations.updatedAt,
            collectionExternalLinksNotations.vectorUpdatedAt
          )
        )
      )
      .limit(50); // Process in batches

    if (pendingNotations.length === 0) {
      console.log('✅ No pending notation embeddings to process');
      return;
    }

    console.log(
      `🔄 Processing ${pendingNotations.length} pending notation embeddings...`
    );

    for (const notation of pendingNotations) {
      try {
        await autoUpdateNotationEmbedding(notation.id);
        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error processing notation ${notation.id}:`, error);
        // Continue processing other notations even if one fails
      }
    }

    console.log('✅ Notation embeddings processing completed');
  } catch (error) {
    console.error('❌ Error processing pending notation embeddings:', error);
    throw error;
  }
};

/**
 * Perform semantic search on resource timestamps
 * @param {string} searchQuery - User's search query
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Search results with similarity scores
 */
export const semanticSearchResourceTimestamps = async (
  searchQuery,
  options = {}
) => {
  const { limit = 20, threshold = 0.3, tenantIds = null } = options;

  try {
    const queryEmbedding = await generateChunkedEmbedding(searchQuery);

    let whereClause = sql`
      timestamps_embedding IS NOT NULL
      AND (1 - (timestamps_embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536))) > ${threshold}
    `;

    // Filter by tenant(s) if provided - resources are public within their tenant
    if (tenantIds && tenantIds.length > 0) {
      whereClause = sql`${whereClause} AND tenant_id = ANY(ARRAY[${sql.join(
        tenantIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}])`;
    }

    const results = await db.execute(sql`
      SELECT
        id,
        name,
        description,
        url,
        timestamps,
        duration_value,
        duration_unit,
        tenant_id,
        created_at,
        updated_at,
        (1 - (timestamps_embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536))) as similarity_score
      FROM resources
      WHERE ${whereClause}
      ORDER BY similarity_score DESC
      LIMIT ${limit}
    `);

    return results.rows;
  } catch (error) {
    console.error('Error in timestamps semantic search:', error);
    throw error;
  }
};

// Add this to your AI service
const detectNegation = (query) => {
  // Common negation patterns that indicate user frustration or exclusion
  const negationPatterns = [
    /\b(don't|do not|doesn't|does not|haven't|have not|hasn't|has not)\s+have\b/i,
    /\b(not|no|never)\s+(diagnosed|have|diagnosed with|suffering from)\b/i,
    /\b(without|lacking|missing)\b/i,
    /\b(ruled out|excluded|eliminating)\b/i,
    /\b(i\s+am\s+not|i'm\s+not|we\s+are\s+not|we're\s+not)\b/i,
    /\b(none|neither|nothing)\b/i,
  ];

  const medicalTerms = [
    'RMC',
    'renal medullary carcinoma',
    'chromophobe',
    'chRCC',
    'chromophobe renal cell carcinoma',
    'ccRCC',
    'clear cell renal cell carcinoma',
    'tRCC',
    'translocation renal cell carcinoma',
    'HLRCC',
    'hereditary leiomyomatosis',
    'sarcomatoid',
    'papillary',
    'collecting duct',
    'oncocytoma',
    'angiomyolipoma',
    'kidney cancer',
    'renal cancer',
    'renal cell carcinoma',
    'metastatic',
    'advanced kidney cancer',
    'stage 4',
    'stage IV',
  ];

  // Check if query contains negation patterns
  const hasNegation = negationPatterns.some((pattern) => pattern.test(query));

  if (!hasNegation) {
    return { isNegated: false, originalQuery: query };
  }

  // Extract mentioned medical terms
  const mentionedTerms = medicalTerms.filter((term) =>
    new RegExp(
      `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i'
    ).test(query)
  );

  if (mentionedTerms.length === 0) {
    return { isNegated: false, originalQuery: query };
  }

  return {
    isNegated: true,
    originalQuery: query,
    negatedTerms: mentionedTerms,
    suggestion:
      mentionedTerms.length === 1
        ? `It looks like you're saying you don't have ${mentionedTerms[0]}. Would you like to search for information about other kidney cancer types or treatments that might be relevant to your situation?`
        : `It looks like you're expressing that you don't have certain conditions (${mentionedTerms.join(', ')}). Would you like to search for information about other kidney cancer types or treatments?`,
  };
};

const processNegatedQuery = async (query, negationResult) => {
  // If user is expressing negation, try to redirect to more helpful searches
  const redirectPrompt = `User said: "${query}"

They are expressing that they DON'T have certain medical conditions.
Negated terms: ${negationResult.negatedTerms.join(', ')}

Generate 2-3 alternative search queries that would be more helpful, focusing on:
1. General kidney cancer information (if they mentioned specific subtypes they don't have)
2. Finding the right diagnosis or subtype
3. Understanding different kidney cancer types

Return only the alternative queries, one per line:`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: redirectPrompt }],
        max_tokens: 150,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const alternatives = data.choices[0].message.content
      .trim()
      .split('\n')
      .filter((line) => line.trim());

    return {
      isNegated: true,
      originalQuery: query,
      negatedTerms: negationResult.negatedTerms,
      suggestion: negationResult.suggestion,
      alternativeQueries: alternatives,
    };
  } catch (error) {
    console.error('Failed to process negated query:', error);
    return {
      isNegated: true,
      originalQuery: query,
      negatedTerms: negationResult.negatedTerms,
      suggestion: negationResult.suggestion,
      alternativeQueries: [
        'kidney cancer types and subtypes',
        'how to determine kidney cancer subtype',
        'kidney cancer diagnosis and classification',
      ],
    };
  }
};

const enhanceSearchQuery = async (userQuery) => {
  try {
    const prompt = `Extract key medical search terms from: "${userQuery}"

Focus on:
- Drug names (like belzutifan, sunitinib)
- Medical conditions
- Treatment types
- Specific medical terms

Return 3-5 concise search terms separated by commas:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Query enhancement failed:', error);
    return userQuery; // Fallback to original
  }
};

const multiQuerySearch = async (originalQuery, tenantIds) => {
  // Generate multiple search variations
  const queries = [
    originalQuery,
    await enhanceSearchQuery(originalQuery),
    // Extract just drug names
    originalQuery.match(/\b[A-Z][a-z]+[A-Z][a-z]+\b/g)?.join(' ') ||
      originalQuery,
  ];

  // Search with each query
  const allResults = await Promise.all(
    queries.map((query) =>
      semanticSearchResources(query, { tenantIds, limit: 20 })
    )
  );

  // Combine and deduplicate results
  const combined = allResults.flat();
  const unique = combined.filter(
    (item, index, arr) => arr.findIndex((x) => x.id === item.id) === index
  );

  return unique.sort((a, b) => b.similarity_score - a.similarity_score);
};

/**
 * Hybrid search combining semantic similarity and keyword matching
 * @param {string} searchQuery - User's search query
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Search results with combined scores
 */
export const hybridSearchResources = async (searchQuery, options = {}) => {
  const {
    limit = 20,
    threshold = 0.2,
    tenantIds = null,
    useEnhancement = true,
    useMultiQuery = true,
    userId = null,
    userEmail = null,
  } = options;

  try {
    const queryEmbedding = await generateChunkedEmbedding(searchQuery);

    // Extract keywords for text search
    const keywords = searchQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2);
    const keywordPattern = keywords.join('|');

    let whereClause = sql`
      combined_embedding IS NOT NULL
      AND (
        (1 - (combined_embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536))) > ${threshold}
        OR
        (
          LOWER(name) ~ ${keywordPattern} OR
          LOWER(description) ~ ${keywordPattern} OR
          LOWER(full_text) ~ ${keywordPattern} OR
          LOWER(timestamps) ~ ${keywordPattern}
        )
      )
    `;

    // Add permission filtering if userId provided
    if (userId) {
      const permissionFilter = buildPermissionFilter(userId, [], 'resources');
      whereClause = sql`${whereClause} AND (${permissionFilter})`;
    }

    // Filter by tenant(s) if provided
    if (tenantIds && tenantIds.length > 0) {
      whereClause = sql`${whereClause} AND tenant_id = ANY(ARRAY[${sql.join(
        tenantIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}])`;
    }

    const results = await db.execute(sql`
      SELECT
        id,
        name,
        description,
        url,
        timestamps,
        full_text,
        duration_value,
        duration_unit,
        tenant_id,
        created_at,
        updated_at,
        added_by_user_id,
        (1 - (combined_embedding <=> ${JSON.stringify(queryEmbedding)}::vector(1536))) as similarity_score
      FROM resources
      WHERE ${whereClause}
      ORDER BY similarity_score DESC
      LIMIT ${limit}
    `);

    return results.rows;
  } catch (error) {
    console.error('Error in hybrid search:', error);
    throw error;
  }
};

/**
 * Prepare text for embedding by cleaning and combining fields (Collections)
 * @param {Object} collection - Collection object
 * @returns {Object} Processed text fields
 */
export const prepareCollectionTextForEmbedding = (collection) => {
  const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const name = cleanText(collection.name) || 'Untitled Collection';
  const description =
    cleanText(collection.description) || 'No description available';
  const hashtags = cleanText(collection.hashtags) || '';

  return {
    name,
    description,
    hashtags,
    combined:
      [name, description, hashtags]
        .filter((text) => text && text.trim().length > 0)
        .join(' ') || 'No content available',
  };
};

/**
 * Prepare text for embedding by cleaning and combining fields (External Links)
 * @param {Object} externalLink - External link object
 * @returns {Object} Processed text fields
 */
export const prepareExternalLinkTextForEmbedding = (externalLink) => {
  const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const processTimestamps = (timestamps) => {
    if (!timestamps) return '';

    // If it's already a string (not JSON), return it directly
    if (typeof timestamps === 'string') {
      // Check if it looks like JSON
      if (
        timestamps.trim().startsWith('[') ||
        timestamps.trim().startsWith('{')
      ) {
        try {
          const timestampData = JSON.parse(timestamps);
          if (Array.isArray(timestampData)) {
            return timestampData
              .map(
                (ts) =>
                  `${ts.title || ts.text || ts} at ${ts.formattedTime || ts.time || ''}`
              )
              .join(', ');
          }
          return String(timestampData);
        } catch {
          return timestamps;
        }
      } else {
        return timestamps;
      }
    }

    try {
      if (Array.isArray(timestamps)) {
        return timestamps
          .map(
            (ts) =>
              `${ts.title || ts.text || ts} at ${ts.formattedTime || ts.time || ''}`
          )
          .join(', ');
      } else if (typeof timestamps === 'object') {
        return JSON.stringify(timestamps);
      }
      return String(timestamps);
    } catch {
      return String(timestamps || '');
    }
  };

  const name = cleanText(externalLink.name) || 'Untitled Link';
  const description =
    cleanText(externalLink.description) || 'No description available';
  const notes = cleanText(externalLink.notes) || '';
  const fullText = cleanText(externalLink.fullText) || '';
  const timestamps = processTimestamps(externalLink.timestamps) || '';

  return {
    name,
    description,
    notes,
    fullText,
    timestamps,
    combined:
      [name, description, notes, fullText, timestamps]
        .filter((text) => text && text.trim().length > 0)
        .join(' ') || 'No content available',
  };
};

/**
 * Prepare text for notation embedding
 * @param {Object} notation - Notation object
 * @returns {Object} - Prepared text for embedding
 */
const prepareNotationTextForEmbedding = (notation) => {
  const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const title = cleanText(notation.title || '');
  const description = cleanText(notation.description || '');
  const notes = cleanText(notation.notes || '');
  const category = cleanText(notation.category || '');

  // Process tags - extract tag names for embedding
  const tags =
    notation.tags && Array.isArray(notation.tags)
      ? notation.tags
          .map((tag) => cleanText(tag.name || ''))
          .filter(Boolean)
          .join(' ')
      : '';

  const combined = [title, description, notes, category, tags]
    .filter(Boolean)
    .join(' ');

  return {
    title,
    description,
    notes,
    category,
    tags,
    combined,
  };
};

/**
 * Prepare text for link group embedding
 * @param {Object} linkGroup - Link group object
 * @returns {Object} - Prepared text for embedding
 */
const prepareLinkGroupTextForEmbedding = (linkGroup) => {
  const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const name = cleanText(linkGroup.name || '');
  const description = cleanText(linkGroup.description || '');
  const category = cleanText(linkGroup.category || '');

  const combined = [name, description, category].filter(Boolean).join(' ');

  return {
    name,
    description,
    category,
    combined,
  };
};

/**
 * Prepare text for attachment embedding
 * @param {Object} attachment - Attachment object
 * @returns {Object} - Prepared text for embedding
 */
const prepareAttachmentTextForEmbedding = (attachment) => {
  const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const title = cleanText(attachment.title || '');
  const description = cleanText(attachment.description || '');

  const combined = [title, description].filter(Boolean).join(' ');

  return {
    title,
    description,
    combined,
  };
};

/**
 * Prepare text for organization embedding
 * @param {Object} organization - Organization object
 * @returns {Object} - Prepared text for embedding
 */
export const prepareOrganizationTextForEmbedding = (organization) => {
  const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const name = cleanText(organization.name || '');
  const description = cleanText(organization.description || '');
  const category = cleanText(organization.category || '');
  const website = cleanText(organization.website || '');
  const address = cleanText(organization.address || '');
  const city = cleanText(organization.city || '');
  const state = cleanText(organization.state || '');

  const combined = [name, description, category, website, address, city, state]
    .filter(Boolean)
    .join(' ');

  return {
    name,
    description,
    category,
    combined,
  };
};

/**
 * Prepare text for event embedding
 * @param {Object} event - Event object
 * @returns {Object} - Prepared text for embedding
 */
export const prepareEventTextForEmbedding = (event) => {
  const cleanText = (text) => {
    if (!text) return '';
    return String(text).replace(/\s+/g, ' ').trim();
  };

  const formatDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  };

  const title = cleanText(event.title || 'Untitled Event');
  const description = cleanText(event.description || '');
  const location = [
    event.locationName,
    event.locationAddress,
    event.locationCity,
    event.locationState,
    event.locationPostal,
    event.locationCountry,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(' ');
  const timing = [
    formatDate(event.startDate),
    formatDate(event.endDate),
    cleanText(event.timezone),
  ]
    .filter(Boolean)
    .join(' ');

  const combined = [title, description, location, timing]
    .filter(Boolean)
    .join(' ');

  return {
    title,
    description,
    location,
    timing,
    combined: combined || 'No event content available',
  };
};

/**
 * Update embeddings for collections
 * @param {string[]} collectionIds - Array of collection IDs to update (optional)
 * @returns {Promise<void>}
 */
export const updateCollectionEmbeddings = async (collectionIds = null) => {
  try {
    let query = db.select().from(collections);

    if (collectionIds && collectionIds.length > 0) {
      query = query.where(eq(collections.id, collectionIds[0]));
    } else {
      query = query.where(
        or(
          isNull(collections.vectorUpdatedAt),
          gt(collections.updatedAt, collections.vectorUpdatedAt)
        )
      );
    }

    const items = await query;

    for (const item of items) {
      const texts = prepareCollectionTextForEmbedding(item);

      const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
      const descriptionEmbedding = await generateChunkedEmbedding(
        texts.description || ''
      );
      const hashtagsEmbedding = await generateChunkedEmbedding(
        texts.hashtags || ''
      );
      const combinedEmbedding = await generateChunkedEmbedding(
        texts.combined || ''
      );

      await db.execute(sql`
        UPDATE collections
        SET
          name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
          description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
          hashtags_embedding = ${JSON.stringify(hashtagsEmbedding)}::vector(1536),
          combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
          vector_updated_at = CURRENT_TIMESTAMP
        WHERE id = ${item.id}
      `);
    }
  } catch (error) {
    console.error('Error updating collection embeddings:', error);
    throw error;
  }
};

/**
 * Update embeddings for external links
 * @param {string[]} externalLinkIds - Array of external link IDs to update (optional)
 * @returns {Promise<void>}
 */
export const updateExternalLinkEmbeddings = async (externalLinkIds = null) => {
  try {
    let query = db.select().from(externalLinks);

    if (externalLinkIds && externalLinkIds.length > 0) {
      query = query.where(eq(externalLinks.id, externalLinkIds[0]));
    } else {
      query = query.where(
        or(
          isNull(externalLinks.vectorUpdatedAt),
          gt(externalLinks.updatedAt, externalLinks.vectorUpdatedAt)
        )
      );
    }

    const items = await query;

    for (const item of items) {
      const texts = prepareExternalLinkTextForEmbedding(item);

      const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
      const descriptionEmbedding = await generateChunkedEmbedding(
        texts.description || ''
      );
      const notesEmbedding = await generateChunkedEmbedding(texts.notes || '');
      const fullTextEmbedding = await generateChunkedEmbedding(
        texts.fullText || ''
      );
      const timestampsEmbedding = await generateChunkedEmbedding(
        texts.timestamps || ''
      );
      const combinedEmbedding = await generateChunkedEmbedding(
        texts.combined || ''
      );

      await db.execute(sql`
        UPDATE external_links
        SET
          name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
          description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
          notes_embedding = ${JSON.stringify(notesEmbedding)}::vector(1536),
          full_text_embedding = ${JSON.stringify(fullTextEmbedding)}::vector(1536),
          timestamps_embedding = ${JSON.stringify(timestampsEmbedding)}::vector(1536),
          combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
          vector_updated_at = CURRENT_TIMESTAMP
        WHERE id = ${item.id}
      `);
    }
  } catch (error) {
    console.error('Error updating external link embeddings:', error);
    throw error;
  }
};

/**
 * Update embeddings for organizations
 * @param {string[]} organizationIds - Array of organization IDs to update (optional)
 * @returns {Promise<void>}
 */
export const updateOrganizationEmbeddings = async (organizationIds = null) => {
  try {
    let query = db.select().from(organizations);

    if (organizationIds && organizationIds.length > 0) {
      query = query.where(eq(organizations.id, organizationIds[0]));
    } else {
      query = query.where(
        or(
          isNull(organizations.vectorUpdatedAt),
          gt(organizations.updatedAt, organizations.vectorUpdatedAt)
        )
      );
    }

    const items = await query;

    for (const item of items) {
      const texts = prepareOrganizationTextForEmbedding(item);

      const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
      const descriptionEmbedding = await generateChunkedEmbedding(
        texts.description || ''
      );
      const categoryEmbedding = await generateChunkedEmbedding(
        texts.category || ''
      );
      const combinedEmbedding = await generateChunkedEmbedding(
        texts.combined || ''
      );

      await db.execute(sql`
        UPDATE organizations
        SET
          name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
          description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
          category_embedding = ${JSON.stringify(categoryEmbedding)}::vector(1536),
          combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
          vector_updated_at = CURRENT_TIMESTAMP
        WHERE id = ${item.id}
      `);
    }
  } catch (error) {
    console.error('Error updating organization embeddings:', error);
    throw error;
  }
};

/**
 * Update embeddings for events
 * @param {string[]} eventIds - Array of event IDs to update (optional)
 * @returns {Promise<void>}
 */
export const updateEventEmbeddings = async (eventIds = null) => {
  try {
    let query = db.select().from(events);

    if (eventIds && eventIds.length > 0) {
      query = query.where(inArray(events.id, eventIds));
    } else {
      query = query.where(
        or(
          isNull(events.vectorUpdatedAt),
          gt(events.updatedAt, events.vectorUpdatedAt)
        )
      );
    }

    const items = await query;

    for (const item of items) {
      const texts = prepareEventTextForEmbedding(item);

      const titleEmbedding = await generateChunkedEmbedding(
        texts.title || texts.combined
      );
      const descriptionEmbedding = await generateChunkedEmbedding(
        texts.description || texts.combined
      );
      const locationEmbedding = await generateChunkedEmbedding(
        texts.location || texts.combined
      );
      const combinedEmbedding = await generateChunkedEmbedding(
        texts.combined || ''
      );

      await db.execute(sql`
        UPDATE events
        SET
          title_embedding = ${JSON.stringify(titleEmbedding)}::vector(1536),
          description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
          location_embedding = ${JSON.stringify(locationEmbedding)}::vector(1536),
          combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
          vector_updated_at = CURRENT_TIMESTAMP
        WHERE id = ${item.id}
      `);
    }
  } catch (error) {
    console.error('Error updating event embeddings:', error);
    throw error;
  }
};

/**
 * Perform semantic search on collections with permission filtering
 * @param {string} searchQuery - User's search query
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Search results with similarity scores
 */
export const semanticSearchCollections = async (searchQuery, options = {}) => {
  const {
    limit = 20,
    threshold = 0.2,
    tenantIds = null,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  try {
    // 💰 Use pre-generated embedding if provided, otherwise generate new one
    const embedding =
      queryEmbedding || (await generateChunkedEmbedding(searchQuery));

    let whereClause = sql`
      combined_embedding IS NOT NULL
      AND (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) > ${threshold}
    `;

    // Add permission filtering if userId provided
    if (userId) {
      const collaboratedItems = userEmail
        ? await getUserCollaboratedItems(userId, userEmail)
        : { collections: [] };
      const permissionFilter = buildPermissionFilter(
        userId,
        collaboratedItems.collections,
        'collections'
      );
      whereClause = sql`${whereClause} AND (${permissionFilter})`;
    }

    if (tenantIds && tenantIds.length > 0) {
      whereClause = sql`${whereClause} AND tenant_id = ANY(ARRAY[${sql.join(
        tenantIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}])`;
    }

    const results = await db.execute(sql`
      SELECT
        id,
        name,
        description,
        hashtags,
        type,
        start_date,
        end_date,
        source_template_id,
        workflow_metadata,
        tenant_id,
        created_at,
        updated_at,
        visibility,
        user_id,
        (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) as similarity_score
      FROM collections
      WHERE ${whereClause}
      ORDER BY similarity_score DESC
      LIMIT ${limit}
    `);

    return results.rows.map((row) =>
      normalizeSemanticSearchResult(row, { search_type: 'collection' })
    );
  } catch (error) {
    console.error('Error in semantic search collections:', error);
    throw error;
  }
};

/**
 * Perform semantic search on external links with permission filtering
 * @param {string} searchQuery - User's search query
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Search results with similarity scores
 */
export const semanticSearchExternalLinks = async (
  searchQuery,
  options = {}
) => {
  const {
    limit = 20,
    threshold = 0.2,
    tenantIds = null,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  try {
    // 💰 Use pre-generated embedding if provided, otherwise generate new one
    const embedding =
      queryEmbedding || (await generateChunkedEmbedding(searchQuery));

    let whereClause = sql`
      combined_embedding IS NOT NULL
      AND (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) > ${threshold}
    `;

    // Add permission filtering if userId provided
    if (userId) {
      const collaboratedItems = userEmail
        ? await getUserCollaboratedItems(userId, userEmail)
        : { collections: [], external_links: [] };
      const collectionCollaboratorClause = buildUuidMembershipClause(
        collaboratedItems.collections,
        'c.id'
      );
      const externalLinkCollaboratorClause = buildUuidMembershipClause(
        collaboratedItems.external_links,
        'external_links.id'
      );
      whereClause = sql`${whereClause}
        AND (
          external_links.visibility = 'public'
          OR external_links.added_by_user_id = ${userId}
          OR (
            external_links.visibility = 'unlisted'
            AND ${externalLinkCollaboratorClause}
          )
          OR EXISTS (
            SELECT 1
            FROM collection_external_links cel
            JOIN collections c ON cel.collection_id = c.id
            WHERE cel.external_link_id = external_links.id
              AND (
                c.user_id = ${userId}
                OR ${collectionCollaboratorClause}
              )
              AND external_links.visibility IN ('public', 'unlisted')
          )
        )`;
    }

    if (tenantIds && tenantIds.length > 0) {
      whereClause = sql`${whereClause} AND tenant_id = ANY(ARRAY[${sql.join(
        tenantIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}])`;
    }

    const results = await db.execute(sql`
      SELECT
        id,
        name,
        description,
        notes,
        full_text,
        timestamps,
        url,
        tenant_id,
        created_at,
        updated_at,
        visibility,
        added_by_user_id,
        (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) as similarity_score
      FROM external_links
      WHERE ${whereClause}
      ORDER BY similarity_score DESC
      LIMIT ${limit}
    `);

    return results.rows.map((row) =>
      normalizeSemanticSearchResult(row, { search_type: 'external_link' })
    );
  } catch (error) {
    console.error('Error in semantic search external links:', error);
    throw error;
  }
};

/**
 * Comprehensive semantic search across all collection content with permission filtering
 * @param {string} searchText - Text to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Combined search results with similarity scores
 */
export const semanticSearchAllCollectionContentExtended = async (
  searchText,
  options = {}
) => {
  const {
    limit = 10,
    threshold = 0.7,
    collectionIds = null,
    userId = null,
  } = options;

  const startTime = Date.now();
  memoryCleanup.logMemoryUsage('(search start)');

  try {
    // 🤖 Detect negation in search query
    const isNegativeQuery =
      /\b(not|don't|doesn't|isn't|aren't|won't|can't|shouldn't)\b/i.test(
        searchText
      );

    // 🎯 OPTIMIZATION: Generate search embedding once and reuse
    const searchEmbedding = await generateChunkedEmbedding(searchText);

    memoryCleanup.logMemoryUsage('(after search embedding)');

    // 🔄 Execute searches with controlled concurrency

    const searchPromises = [
      embeddingSemaphore.acquire(async () =>
        semanticSearchCollections(searchText, {
          limit,
          threshold,
          collectionIds,
          userId,
          queryEmbedding: searchEmbedding,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchContent(searchText, {
          limit,
          threshold,
          collectionIds,
          userId,
          queryEmbedding: searchEmbedding,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchDocuments(searchText, {
          limit,
          threshold,
          collectionIds,
          userId,
          queryEmbedding: searchEmbedding,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchResearchPapers(searchText, {
          limit,
          threshold,
          collectionIds,
          userId,
          queryEmbedding: searchEmbedding,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchUsers(searchText, {
          limit,
          threshold,
          collectionIds,
          userId,
          queryEmbedding: searchEmbedding,
        })
      ),
    ];

    const [
      collectionsResults,
      contentResults,
      documentsResults,
      papersResults,
      usersResults,
    ] = await Promise.all(searchPromises);

    // 🧹 CLEANUP: Clear search embedding after use
    searchEmbedding.length = 0;

    memoryCleanup.logMemoryUsage('(after parallel searches)');

    // 🎯 Combine and process results with memory efficiency
    const allResults = [];

    // Add results with proper cleanup
    if (collectionsResults?.results) {
      allResults.push(
        ...collectionsResults.results.map((r) => ({ ...r, type: 'collection' }))
      );
    }
    if (contentResults?.results) {
      allResults.push(
        ...contentResults.results.map((r) => ({ ...r, type: 'content' }))
      );
    }
    if (documentsResults?.results) {
      allResults.push(
        ...documentsResults.results.map((r) => ({ ...r, type: 'document' }))
      );
    }
    if (papersResults?.results) {
      allResults.push(
        ...papersResults.results.map((r) => ({ ...r, type: 'research_paper' }))
      );
    }
    if (usersResults?.results) {
      allResults.push(
        ...usersResults.results.map((r) => ({ ...r, type: 'user' }))
      );
    }

    // 🚫 Apply negation filtering if needed
    let filteredResults = allResults;
    if (isNegativeQuery) {
      const negationKeywords = searchText.match(
        /\b(not|don't|doesn't|isn't|aren't|won't|can't|shouldn't)\s+(\w+)/gi
      );
      if (negationKeywords) {
        const excludeTerms = negationKeywords.map((match) =>
          match
            .replace(
              /\b(not|don't|doesn't|isn't|aren't|won't|can't|shouldn't)\s+/i,
              ''
            )
            .toLowerCase()
        );

        filteredResults = allResults.filter((result) => {
          const textToCheck =
            `${result.title || ''} ${result.content || result.text || ''}`.toLowerCase();
          return !excludeTerms.some((term) => textToCheck.includes(term));
        });
      }
    }

    // 🏆 Sort by similarity score and limit results
    const sortedResults = filteredResults
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, limit);

    // 🧹 CLEANUP: Clear intermediate arrays
    allResults.length = 0;
    filteredResults.length = 0;

    const duration = Date.now() - startTime;
    const totalFound = sortedResults.length;

    memoryCleanup.logMemoryUsage('(search complete)');

    // 🧹 FINAL CLEANUP
    if (collectionsResults?.results) collectionsResults.results.length = 0;
    if (contentResults?.results) contentResults.results.length = 0;
    if (documentsResults?.results) documentsResults.results.length = 0;
    if (papersResults?.results) papersResults.results.length = 0;
    if (usersResults?.results) usersResults.results.length = 0;

    return {
      success: true,
      results: sortedResults,
      totalFound,
      searchTime: duration,
      breakdown: {
        collections: collectionsResults?.results?.length || 0,
        content: contentResults?.results?.length || 0,
        documents: documentsResults?.results?.length || 0,
        papers: papersResults?.results?.length || 0,
        users: usersResults?.results?.length || 0,
      },
      query: searchText,
      options: { limit, threshold, collectionIds, userId },
    };
  } catch (error) {
    console.error('❌ Comprehensive semantic search failed:', error.message);
    console.error(error.stack);

    // 🧹 ERROR CLEANUP
    memoryCleanup.forceCleanup();

    throw error;
  }
};

/**
 * Auto-update embeddings for a single attachment (call this after create/update)
 * @param {string} attachmentId - ID of the attachment to update
 * @returns {Promise<void>}
 */
export const autoUpdateAttachmentEmbedding = async (attachmentId) => {
  try {
    const attachment = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1);

    if (attachment.length === 0) {
      console.warn(`⚠️ Attachment not found: ${attachmentId}`);
      return;
    }

    const item = attachment[0];
    const texts = prepareAttachmentTextForEmbedding(item);

    const titleEmbedding = await generateChunkedEmbedding(texts.title || '');
    const descriptionEmbedding = await generateChunkedEmbedding(
      texts.description || ''
    );
    const combinedEmbedding = await generateChunkedEmbedding(
      texts.combined || ''
    );

    await db.execute(sql`
      UPDATE attachments
      SET
        title_embedding = ${JSON.stringify(titleEmbedding)}::vector(1536),
        description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
        combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
        vector_updated_at = CURRENT_TIMESTAMP
      WHERE id = ${attachmentId}
    `);
  } catch (error) {
    console.error(
      `❌ Error auto-updating embeddings for attachment ${attachmentId}:`,
      error
    );
    // Don't throw - we don't want to break the main attachment operation
  }
};

/**
 * Auto-update embeddings for a single event (call this after create/update)
 * @param {string} eventId - ID of the event to update
 * @returns {Promise<void>}
 */
export const autoUpdateEventEmbedding = async (eventId) => {
  try {
    const event = await db
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (event.length === 0) {
      console.warn(`⚠️ Event not found: ${eventId}`);
      return;
    }

    const item = event[0];
    const texts = prepareEventTextForEmbedding(item);

    const titleEmbedding = await generateChunkedEmbedding(
      texts.title || texts.combined
    );
    const descriptionEmbedding = await generateChunkedEmbedding(
      texts.description || texts.combined
    );
    const locationEmbedding = await generateChunkedEmbedding(
      texts.location || texts.combined
    );
    const combinedEmbedding = await generateChunkedEmbedding(
      texts.combined || ''
    );

    await db.execute(sql`
      UPDATE events
      SET
        title_embedding = ${JSON.stringify(titleEmbedding)}::vector(1536),
        description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
        location_embedding = ${JSON.stringify(locationEmbedding)}::vector(1536),
        combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
        vector_updated_at = CURRENT_TIMESTAMP
      WHERE id = ${eventId}
    `);
  } catch (error) {
    console.error(
      `❌ Error auto-updating embeddings for event ${eventId}:`,
      error
    );
    // Don't throw - we don't want to break the main event operation
  }
};

/**
 * Auto-update embeddings for a single link group (call this after create/update)
 * @param {string} linkGroupId - ID of the link group to update
 * @returns {Promise<void>}
 */
export const autoUpdateLinkGroupEmbedding = async (linkGroupId) => {
  try {
    const linkGroup = await db
      .select()
      .from(linkGroups)
      .where(eq(linkGroups.id, linkGroupId))
      .limit(1);

    if (linkGroup.length === 0) {
      console.warn(`⚠️ Link group not found: ${linkGroupId}`);
      return;
    }

    const item = linkGroup[0];
    const texts = prepareLinkGroupTextForEmbedding(item);

    const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
    const descriptionEmbedding = await generateChunkedEmbedding(
      texts.description || ''
    );
    const categoryEmbedding = await generateChunkedEmbedding(
      texts.category || ''
    );
    const combinedEmbedding = await generateChunkedEmbedding(
      texts.combined || ''
    );

    await db.execute(sql`
      UPDATE link_groups
      SET
        name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
        description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
        category_embedding = ${JSON.stringify(categoryEmbedding)}::vector(1536),
        combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
        vector_updated_at = CURRENT_TIMESTAMP
      WHERE id = ${linkGroupId}
    `);
  } catch (error) {
    console.error(
      `❌ Error auto-updating embeddings for link group ${linkGroupId}:`,
      error
    );
    // Don't throw - we don't want to break the main link group operation
  }
};

/**
 * Update embeddings for collection external links notations
 * @param {string[]} notationIds - Array of notation IDs to update (optional)
 * @returns {Promise<void>}
 */
export const updateNotationEmbeddings = async (notationIds = null) => {
  try {
    let query = db.select().from(collectionExternalLinksNotations);

    if (notationIds && notationIds.length > 0) {
      query = query.where(
        inArray(collectionExternalLinksNotations.id, notationIds)
      );
    } else {
      query = query.where(
        or(
          isNull(collectionExternalLinksNotations.vectorUpdatedAt),
          gt(
            collectionExternalLinksNotations.updatedAt,
            collectionExternalLinksNotations.vectorUpdatedAt
          )
        )
      );
    }

    const items = await query;

    // Fetch tags for all notations in batch
    const itemIds = items.map((item) => item.id);
    const tagsData = await db
      .select({
        notationId:
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
        tag: {
          id: collectionExternalLinkTagDefinitions.id,
          name: collectionExternalLinkTagDefinitions.name,
          description: collectionExternalLinkTagDefinitions.description,
          color: collectionExternalLinkTagDefinitions.color,
        },
      })
      .from(collectionExternalLinkNotationTags)
      .innerJoin(
        collectionExternalLinkTagDefinitions,
        eq(
          collectionExternalLinkNotationTags.tagId,
          collectionExternalLinkTagDefinitions.id
        )
      )
      .where(
        inArray(
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
          itemIds
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

    // Group tags by notation ID
    const tagsByNotationId = {};
    tagsData.forEach(({ notationId, tag }) => {
      if (!tagsByNotationId[notationId]) {
        tagsByNotationId[notationId] = [];
      }
      tagsByNotationId[notationId].push(tag);
    });

    let processedCount = 0;
    let errorCount = 0;

    for (const item of items) {
      try {
        // Add tags to the item
        const itemWithTags = {
          ...item,
          tags: tagsByNotationId[item.id] || [],
        };

        const texts = prepareNotationTextForEmbedding(itemWithTags);

        // Pre-check if any text is extremely long
        const combinedTokens = estimateTokenCount(texts.combined || '');
        if (combinedTokens > MAX_TOKENS * 2) {
          // More than 2x the limit
          console.warn(
            `⚠️ Skipping notation ${item.id} - text is extremely long (~${combinedTokens} tokens)`
          );
          errorCount++;
          continue;
        }

        const titleEmbedding = await generateChunkedEmbedding(
          texts.title || ''
        );
        const descriptionEmbedding = await generateChunkedEmbedding(
          texts.description || ''
        );
        const notesEmbedding = await generateChunkedEmbedding(
          texts.notes || ''
        );
        const categoryEmbedding = await generateChunkedEmbedding(
          texts.category || ''
        );
        const combinedEmbedding = await generateChunkedEmbedding(
          texts.combined || ''
        );

        await db.execute(sql`
          UPDATE collection_external_links_notations
          SET
            title_embedding = ${JSON.stringify(titleEmbedding)}::vector(1536),
            description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
            notes_embedding = ${JSON.stringify(notesEmbedding)}::vector(1536),
            category_embedding = ${JSON.stringify(categoryEmbedding)}::vector(1536),
            combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
            vector_updated_at = CURRENT_TIMESTAMP
          WHERE id = ${item.id}
        `);
        processedCount++;
      } catch (error) {
        console.error(
          `❌ Error processing notation ${item.id} (${item.title}):`,
          error.message
        );
        errorCount++;

        // Continue processing other items instead of failing completely
        continue;
      }
    }

    if (errorCount > 0) {
      console.warn(
        `⚠️ ${errorCount} notations failed to process. Check logs for details.`
      );
    }
  } catch (error) {
    console.error('Error updating notation embeddings:', error);
    throw error;
  }
};

/**
 * Update embeddings for link groups
 * @param {string[]} linkGroupIds - Array of link group IDs to update (optional)
 * @returns {Promise<void>}
 */
export const updateLinkGroupEmbeddings = async (linkGroupIds = null) => {
  try {
    let query = db.select().from(linkGroups);

    if (linkGroupIds && linkGroupIds.length > 0) {
      query = query.where(eq(linkGroups.id, linkGroupIds[0]));
    } else {
      query = query.where(
        or(
          isNull(linkGroups.vectorUpdatedAt),
          gt(linkGroups.updatedAt, linkGroups.vectorUpdatedAt)
        )
      );
    }

    const items = await query;

    for (const item of items) {
      const texts = prepareLinkGroupTextForEmbedding(item);

      const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
      const descriptionEmbedding = await generateChunkedEmbedding(
        texts.description || ''
      );
      const categoryEmbedding = await generateChunkedEmbedding(
        texts.category || ''
      );
      const combinedEmbedding = await generateChunkedEmbedding(
        texts.combined || ''
      );

      await db.execute(sql`
        UPDATE link_groups
        SET
          name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
          description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
          category_embedding = ${JSON.stringify(categoryEmbedding)}::vector(1536),
          combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
          vector_updated_at = CURRENT_TIMESTAMP
        WHERE id = ${item.id}
      `);
    }
  } catch (error) {
    console.error('Error updating link group embeddings:', error);
    throw error;
  }
};

/**
 * Update embeddings for attachments
 * @param {string[]} attachmentIds - Array of attachment IDs to update (optional)
 * @returns {Promise<void>}
 */
export const updateAttachmentEmbeddings = async (attachmentIds = null) => {
  try {
    let query = db.select().from(attachments);

    if (attachmentIds && attachmentIds.length > 0) {
      query = query.where(eq(attachments.id, attachmentIds[0]));
    } else {
      query = query.where(
        or(
          isNull(attachments.vectorUpdatedAt),
          gt(attachments.updatedAt, attachments.vectorUpdatedAt)
        )
      );
    }

    const items = await query;

    for (const item of items) {
      const texts = prepareAttachmentTextForEmbedding(item);

      const titleEmbedding = await generateChunkedEmbedding(texts.title || '');
      const descriptionEmbedding = await generateChunkedEmbedding(
        texts.description || ''
      );
      const combinedEmbedding = await generateChunkedEmbedding(
        texts.combined || ''
      );

      await db.execute(sql`
        UPDATE attachments
        SET
          title_embedding = ${JSON.stringify(titleEmbedding)}::vector(1536),
          description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
          combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
          vector_updated_at = CURRENT_TIMESTAMP
        WHERE id = ${item.id}
      `);
    }
  } catch (error) {
    console.error('Error updating attachment embeddings:', error);
    throw error;
  }
};

/**
 * Auto-update embeddings for a single collection (call this after create/update)
 * @param {string} collectionId - ID of the collection to update
 * @returns {Promise<void>}
 */
export const autoUpdateCollectionEmbedding = async (collectionId) => {
  try {
    const collection = await db
      .select()
      .from(collections)
      .where(eq(collections.id, collectionId))
      .limit(1);

    if (collection.length === 0) {
      console.warn(`⚠️ Collection not found: ${collectionId}`);
      return;
    }

    const item = collection[0];
    const texts = prepareCollectionTextForEmbedding(item);

    const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
    const descriptionEmbedding = await generateChunkedEmbedding(
      texts.description || ''
    );
    const hashtagsEmbedding = await generateChunkedEmbedding(
      texts.hashtags || ''
    );
    const combinedEmbedding = await generateChunkedEmbedding(
      texts.combined || ''
    );

    await db.execute(sql`
      UPDATE collections
      SET
        name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
        description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
        hashtags_embedding = ${JSON.stringify(hashtagsEmbedding)}::vector(1536),
        combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
        vector_updated_at = CURRENT_TIMESTAMP
      WHERE id = ${collectionId}
    `);
  } catch (error) {
    console.error(
      `❌ Error auto-updating embeddings for collection ${collectionId}:`,
      error
    );
    // Don't throw - we don't want to break the main collection operation
  }
};

/**
 * Auto-update embeddings for a single external link (call this after create/update)
 * @param {string} externalLinkId - ID of the external link to update
 * @returns {Promise<void>}
 */
export const autoUpdateExternalLinkEmbedding = async (externalLinkId) => {
  try {
    const externalLink = await db
      .select()
      .from(externalLinks)
      .where(eq(externalLinks.id, externalLinkId))
      .limit(1);

    if (externalLink.length === 0) {
      console.warn(`⚠️ External link not found: ${externalLinkId}`);
      return;
    }

    const item = externalLink[0];
    const texts = prepareExternalLinkTextForEmbedding(item);

    const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
    const descriptionEmbedding = await generateChunkedEmbedding(
      texts.description || ''
    );
    const notesEmbedding = await generateChunkedEmbedding(texts.notes || '');
    const fullTextEmbedding = await generateChunkedEmbedding(
      texts.fullText || ''
    );
    const timestampsEmbedding = await generateChunkedEmbedding(
      texts.timestamps || ''
    );
    const combinedEmbedding = await generateChunkedEmbedding(
      texts.combined || ''
    );

    await db.execute(sql`
      UPDATE external_links
      SET
        name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
        description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
        notes_embedding = ${JSON.stringify(notesEmbedding)}::vector(1536),
        full_text_embedding = ${JSON.stringify(fullTextEmbedding)}::vector(1536),
        timestamps_embedding = ${JSON.stringify(timestampsEmbedding)}::vector(1536),
        combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
        vector_updated_at = CURRENT_TIMESTAMP
      WHERE id = ${externalLinkId}
    `);
  } catch (error) {
    console.error(
      `❌ Error auto-updating embeddings for external link ${externalLinkId}:`,
      error
    );
    // Don't throw - we don't want to break the main external link operation
  }
};

/**
 * Auto-update embeddings for a specific notation
 * @param {string} notationId - ID of the notation to update
 * @returns {Promise<void>}
 */
export const autoUpdateNotationEmbedding = async (notationId) => {
  try {
    // Fetch notation with its tags
    const notation = await db
      .select()
      .from(collectionExternalLinksNotations)
      .where(eq(collectionExternalLinksNotations.id, notationId))
      .limit(1);

    if (notation.length === 0) {
      console.warn(`⚠️ Notation not found: ${notationId}`);
      return;
    }

    // Get tags for this notation
    const tagsData = await db
      .select({
        tag: {
          id: collectionExternalLinkTagDefinitions.id,
          name: collectionExternalLinkTagDefinitions.name,
          description: collectionExternalLinkTagDefinitions.description,
          color: collectionExternalLinkTagDefinitions.color,
        },
      })
      .from(collectionExternalLinkNotationTags)
      .innerJoin(
        collectionExternalLinkTagDefinitions,
        eq(
          collectionExternalLinkNotationTags.tagId,
          collectionExternalLinkTagDefinitions.id
        )
      )
      .where(
        eq(
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
          notationId
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

    const tags = tagsData.map(({ tag }) => tag);

    const item = { ...notation[0], tags };
    const texts = prepareNotationTextForEmbedding(item);

    const titleEmbedding = await generateChunkedEmbedding(texts.title || '');
    const descriptionEmbedding = await generateChunkedEmbedding(
      texts.description || ''
    );
    const notesEmbedding = await generateChunkedEmbedding(texts.notes || '');
    const categoryEmbedding = await generateChunkedEmbedding(
      texts.category || ''
    );
    const combinedEmbedding = await generateChunkedEmbedding(
      texts.combined || ''
    );

    await db.execute(sql`
      UPDATE collection_external_links_notations
      SET
        title_embedding = ${JSON.stringify(titleEmbedding)}::vector(1536),
        description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
        notes_embedding = ${JSON.stringify(notesEmbedding)}::vector(1536),
        category_embedding = ${JSON.stringify(categoryEmbedding)}::vector(1536),
        combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
        vector_updated_at = CURRENT_TIMESTAMP
      WHERE id = ${notationId}
    `);
  } catch (error) {
    console.error(
      `❌ Error auto-updating embeddings for notation ${notationId}:`,
      error
    );
    // Don't throw - we don't want to break the main notation operation
  }
};

/**
 * Update all collection-related embeddings (unified function)
 * @returns {Promise<void>}
 */
export const updateAllCollectionEmbeddings = async () => {
  try {
    // Update collections
    await updateCollectionEmbeddings();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Update external links
    await updateExternalLinkEmbeddings();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Update notations
    await updateNotationEmbeddings();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Update link groups
    await updateLinkGroupEmbeddings();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Update attachments
    await updateAttachmentEmbeddings();
  } catch (error) {
    console.error(
      '❌ Error in comprehensive collection embeddings update:',
      error
    );
    throw error;
  }
};

/**
 * Semantic search in collection external links notations
 * @param {string} searchText - Text to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Search results with similarity scores
 */
export const semanticSearchNotations = async (searchText, options = {}) => {
  const {
    limit = 10,
    minSimilarity = 0.3,
    collectionId = null,
    externalLinkId = null,
    tenantIds = null,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  // 💰 Use pre-generated embedding if provided, otherwise generate new one
  const embedding =
    queryEmbedding || (await generateChunkedEmbedding(searchText));

  let baseQuery = sql`
    SELECT
      celn.*,
      cel.collection_id,
      cel.external_link_id,
      el.name as external_link_name,
      el.url as external_link_url,
      c.name as collection_name,
      (1 - (celn.combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) AS similarity
    FROM collection_external_links_notations celn
    INNER JOIN collection_external_links cel ON celn.collection_external_link_id = cel.id
    INNER JOIN external_links el ON cel.external_link_id = el.id
    INNER JOIN collections c ON cel.collection_id = c.id
    WHERE celn.combined_embedding IS NOT NULL
  `;

  if (collectionId) {
    baseQuery = sql`${baseQuery} AND cel.collection_id = ${collectionId}`;
  }

  if (externalLinkId) {
    baseQuery = sql`${baseQuery} AND cel.external_link_id = ${externalLinkId}`;
  }

  if (tenantIds && tenantIds.length > 0) {
    baseQuery = sql`${baseQuery} AND c.tenant_id = ANY(ARRAY[${sql.join(
      tenantIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )}])`;
  }

  // Add permission filtering if userId provided
  if (userId) {
    const collaboratedItems = userEmail
      ? await getUserCollaboratedItems(userId, userEmail)
      : { collections: [], external_links: [] };
    const collectionCollaboratorClause = buildUuidMembershipClause(
      collaboratedItems.collections,
      'c.id'
    );
    const externalLinkCollaboratorClause = buildUuidMembershipClause(
      collaboratedItems.external_links,
      'el.id'
    );

    baseQuery = sql`${baseQuery}
      AND (
        (
          c.visibility = 'public'
          OR c.user_id = ${userId}
          OR ${collectionCollaboratorClause}
        )
        AND (
          el.visibility = 'public'
          OR el.added_by_user_id = ${userId}
          OR ${externalLinkCollaboratorClause}
          OR ${collectionCollaboratorClause}
        )
        AND (
          celn.visibility = 'public'
          OR celn.user_id = ${userId}
          OR el.added_by_user_id = ${userId}
          OR c.user_id = ${userId}
          OR (
            celn.visibility = 'unlisted'
            AND (
              ${collectionCollaboratorClause}
              OR ${externalLinkCollaboratorClause}
            )
          )
        )
      )`;
  }

  const finalQuery = sql`
    ${baseQuery}
    AND (1 - (celn.combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) >= ${minSimilarity}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;

  const results = await db.execute(finalQuery);

  return results.rows.map((row) => ({
    ...row,
    similarity: parseFloat(row.similarity).toFixed(4),
    search_type: 'notation',
  }));
};

/**
 * Semantic search in link groups with permission filtering
 * @param {string} searchText - Text to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Search results with similarity scores
 */
export const semanticSearchLinkGroups = async (searchText, options = {}) => {
  const {
    limit = 10,
    minSimilarity = 0.3,
    collectionId = null,
    tenantIds = null,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  // 💰 Use pre-generated embedding if provided, otherwise generate new one
  const embedding =
    queryEmbedding || (await generateChunkedEmbedding(searchText));

  let baseQuery = sql`
    SELECT
      lg.*,
      r.id as resource_id,
      r.name as resource_title,
      r.description as resource_description,
      r.created_at as resource_created_at,
      r.updated_at as resource_updated_at,
      (1 - (lg.combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) AS similarity
    FROM link_groups lg
    LEFT JOIN resources r
      ON lg.linking_type = 'resource'
      AND lg.linking_id = r.id
    WHERE lg.combined_embedding IS NOT NULL
  `;

  if (collectionId) {
    baseQuery = sql`${baseQuery} AND lg.collection_id = ${collectionId}`;
  }

  if (tenantIds && tenantIds.length > 0) {
    baseQuery = sql`${baseQuery} AND lg.tenant_id = ANY(ARRAY[${sql.join(
      tenantIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )}])`;
  }

  // Add permission filtering if userId provided
  if (userId) {
    const collaboratedItems = userEmail
      ? await getUserCollaboratedItems(userId, userEmail)
      : { collections: [], external_links: [] };
    const collectionCollaboratorClause = buildUuidMembershipClause(
      collaboratedItems.collections,
      'c.id'
    );
    const externalLinkCollaboratorClause = buildUuidMembershipClause(
      collaboratedItems.external_links,
      'el.id'
    );

    baseQuery = sql`${baseQuery}
      AND (
        (
          lg.linking_type = 'resource'
          AND EXISTS (
            SELECT 1
            FROM resources r2
            WHERE r2.id = lg.linking_id::uuid
              AND r2.status = 'approved'
              ${
                tenantIds && tenantIds.length > 0
                  ? sql`AND r2.tenant_id = ANY(ARRAY[${sql.join(
                      tenantIds.map((id) => sql`${id}::uuid`),
                      sql`, `
                    )}])`
                  : sql``
              }
              AND (
                CASE
                  WHEN r2.tenant_id = ${process.env.COMMUNITY_TENANT}::uuid THEN r2.added_by_user_id = ${userId}
                  ELSE 1 = 1
                END
              )
              AND (
                lg.visibility IN ('public', 'unlisted')
                OR lg.user_id = ${userId}
                OR r2.added_by_user_id = ${userId}
              )
          )
        )
        OR (
          lg.linking_type != 'external_link'
          AND lg.linking_type != 'resource'
          AND (lg.visibility = 'public' OR lg.user_id = ${userId})
        )
        OR (
          lg.linking_type = 'external_link'
          AND EXISTS (
            SELECT 1
            FROM external_links el
            JOIN collection_external_links cel ON el.id = cel.external_link_id
            JOIN collections c ON cel.collection_id = c.id
            WHERE el.id = lg.linking_id::uuid
              AND (
                c.visibility = 'public'
                OR c.user_id = ${userId}
                OR ${collectionCollaboratorClause}
              )
              AND (
                el.visibility = 'public'
                OR el.added_by_user_id = ${userId}
                OR ${externalLinkCollaboratorClause}
                OR ${collectionCollaboratorClause}
              )
              AND (
                lg.visibility = 'public'
                OR lg.user_id = ${userId}
                OR el.added_by_user_id = ${userId}
                OR c.user_id = ${userId}
                OR (
                  lg.visibility = 'unlisted'
                  AND (
                    ${collectionCollaboratorClause}
                    OR ${externalLinkCollaboratorClause}
                  )
                )
              )
          )
        )
      )`;
  }

  const finalQuery = sql`
    ${baseQuery}
    AND (1 - (lg.combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) >= ${minSimilarity}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;

  const results = await db.execute(finalQuery);

  return results.rows.map((row) => ({
    ...row,
    similarity: parseFloat(row.similarity).toFixed(4),
    search_type: 'link_group',
  }));
};

/**
 * Semantic search in attachments with permission filtering
 * @param {string} searchText - Text to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Search results with similarity scores
 */
export const semanticSearchAttachments = async (searchText, options = {}) => {
  const {
    limit = 10,
    minSimilarity = 0.3,
    collectionId = null,
    tenantIds = null,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  // 💰 Use pre-generated embedding if provided, otherwise generate new one
  const embedding =
    queryEmbedding || (await generateChunkedEmbedding(searchText));

  let baseQuery = sql`
    SELECT
      a.*,
      r.id as resource_id,
      r.name as resource_title,
      r.description as resource_description,
      r.created_at as resource_created_at,
      r.updated_at as resource_updated_at,
      (1 - (a.combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) AS similarity
    FROM attachments a
    LEFT JOIN resource_attachments ra ON a.id = ra.attachment_id
    LEFT JOIN resources r
      ON ra.resource_id = r.id
      AND r.status = 'approved'
    WHERE a.combined_embedding IS NOT NULL
  `;

  if (collectionId) {
    baseQuery = sql`${baseQuery} AND a.collection_id = ${collectionId}`;
  }

  if (tenantIds && tenantIds.length > 0) {
    baseQuery = sql`${baseQuery} AND a.tenant_id = ANY(ARRAY[${sql.join(
      tenantIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )}])`;
  }

  // Add permission filtering if userId provided
  if (userId) {
    const collaboratedItems = userEmail
      ? await getUserCollaboratedItems(userId, userEmail)
      : { collections: [], external_links: [] };
    const collectionCollaboratorClause = buildUuidMembershipClause(
      collaboratedItems.collections,
      'c.id'
    );
    const externalLinkCollaboratorClause = buildUuidMembershipClause(
      collaboratedItems.external_links,
      'el.id'
    );

    baseQuery = sql`${baseQuery}
      AND (
        (
          NOT EXISTS (
            SELECT 1 FROM external_link_attachments ela
            WHERE ela.attachment_id = a.id
          )
          AND (a.visibility = 'public' OR a.user_id = ${userId})
        )
        OR EXISTS (
          SELECT 1
          FROM external_link_attachments ela
          JOIN external_links el ON el.id = ela.external_link_id
          JOIN collection_external_links cel ON el.id = cel.external_link_id
          JOIN collections c ON cel.collection_id = c.id
          WHERE ela.attachment_id = a.id
            AND (
              c.visibility = 'public'
              OR c.user_id = ${userId}
              OR ${collectionCollaboratorClause}
            )
            AND (
              el.visibility = 'public'
              OR el.added_by_user_id = ${userId}
              OR ${externalLinkCollaboratorClause}
              OR ${collectionCollaboratorClause}
            )
            AND (
              a.visibility = 'public'
              OR a.user_id = ${userId}
              OR el.added_by_user_id = ${userId}
              OR c.user_id = ${userId}
              OR (
                a.visibility = 'unlisted'
                AND (
                  ${collectionCollaboratorClause}
                  OR ${externalLinkCollaboratorClause}
                )
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM resource_attachments ra
          JOIN resources r2 ON r2.id = ra.resource_id
          WHERE ra.attachment_id = a.id
            AND r2.status = 'approved'
            ${
              tenantIds && tenantIds.length > 0
                ? sql`AND r2.tenant_id = ANY(ARRAY[${sql.join(
                    tenantIds.map((id) => sql`${id}::uuid`),
                    sql`, `
                  )}])`
                : sql``
            }
            AND (
              CASE
                WHEN r2.tenant_id = ${process.env.COMMUNITY_TENANT}::uuid THEN r2.added_by_user_id = ${userId}
                ELSE 1 = 1
              END
            )
            AND (
              a.visibility IN ('public', 'unlisted')
              OR a.user_id = ${userId}
              OR r2.added_by_user_id = ${userId}
            )
        )
      )`;
  }

  const finalQuery = sql`
    ${baseQuery}
    AND (1 - (a.combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) >= ${minSimilarity}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;

  const results = await db.execute(finalQuery);

  return results.rows.map((row) => ({
    ...row,
    similarity: parseFloat(row.similarity).toFixed(4),
    search_type: 'attachment',
  }));
};

/**
 * Helper function to handle search responses with negation detection
 * @param {Object} searchResult - Result from semanticSearchAllCollectionContentExtended
 * @returns {Object} - Formatted response for frontend
 */
export const handleSearchResponse = (searchResult) => {
  if (searchResult.isNegated) {
    return {
      success: true,
      isNegated: true,
      message: searchResult.message,
      suggestion: searchResult.suggestion,
      alternativeQueries: searchResult.alternativeQueries,
      negatedTerms: searchResult.negatedTerms,
      originalQuery: searchResult.originalQuery,
      results: [],
      totalFound: 0,
    };
  }

  return {
    success: true,
    isNegated: false,
    originalQuery: searchResult.originalQuery,
    processedQuery: searchResult.processedQuery,
    results: searchResult.results,
    totalFound: searchResult.totalFound,
    breakdown: searchResult.breakdown,
  };
};

/**
 * Enhanced semantic search with built-in negation handling
 * This is the main function to use for all search operations
 * @param {string} searchText - Text to search for
 * @param {Object} options - Search options
 * @returns {Promise<Object>} - Formatted search response
 */
export const performSemanticSearch = async (searchText, options = {}) => {
  try {
    // Use the COMPLETE search function that includes ALL content types
    const searchResult = await semanticSearchAllContent(searchText, options);
    return handleSearchResponse(searchResult);
  } catch (error) {
    console.error('❌ Error in performSemanticSearch:', error);
    return {
      success: false,
      error: error.message,
      originalQuery: searchText,
      results: [],
      totalFound: 0,
    };
  }
};

/**
 * Filter search results to remove content that mentions negated terms
 * This is an additional safety measure to prevent showing irrelevant results
 * @param {Array} results - Search results array
 * @param {Array} negatedTerms - Terms that should be filtered out
 * @returns {Array} - Filtered results
 */
const filterNegatedTermsFromResults = (results, negatedTerms) => {
  if (!negatedTerms || negatedTerms.length === 0) {
    return results;
  }

  return results.filter((result) => {
    const textToCheck = [
      result.name || result.title || '',
      result.description || '',
      result.notes || '',
      result.full_text || '',
    ]
      .join(' ')
      .toLowerCase();

    // Check if any negated terms appear prominently in the result
    return !negatedTerms.some((term) => {
      const regex = new RegExp(
        `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'i'
      );
      return regex.test(textToCheck);
    });
  });
};

/**
 * Advanced negation detection with contextual understanding
 * @param {string} query - User query to analyze
 * @returns {Object} - Enhanced negation analysis
 */
export const advancedNegationDetection = (query) => {
  const basicNegation = detectNegation(query);

  if (!basicNegation.isNegated) {
    return basicNegation;
  }

  // Additional context clues that suggest user frustration or confusion
  const frustrationPatterns = [
    /\b(confused|lost|don't understand|help|frustrated|stuck)\b/i,
    /\b(what\s+do\s+i\s+have|what\s+type|which\s+kind)\b/i,
    /\b(misdiagnosed|wrong|incorrect)\b/i,
  ];

  const hasFrustration = frustrationPatterns.some((pattern) =>
    pattern.test(query)
  );

  return {
    ...basicNegation,
    userFrustration: hasFrustration,
    confidence: hasFrustration ? 'high' : 'medium',
    recommendedAction: hasFrustration
      ? 'redirect_to_general_info'
      : 'suggest_alternatives',
  };
};

/**
 * Memory-efficient bulk embedding generation with concurrency control
 * @param {Array<{id: string, text: string}>} items - Items to process
 * @param {string} type - Type of content for logging
 * @returns {Promise<Array<{id: string, embedding: number[]}>>}
 */
const processBulkEmbeddings = async (items, type = 'items') => {
  if (!items || items.length === 0) {
    return [];
  }

  memoryCleanup.logMemoryUsage('(before bulk processing)');

  const results = [];
  const batchSize = MEMORY_CONFIG.BULK_BATCH_SIZE;
  let processedCount = 0;

  try {
    // Process in batches to control memory usage
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      // Process batch items with semaphore control
      const batchPromises = batch.map(async (item) => {
        return await embeddingSemaphore.acquire(async () => {
          try {
            const embedding = await generateChunkedEmbedding(item.text);
            processedCount++;

            if (processedCount % 10 === 0) {
              console.log(
                `   ✅ Processed ${processedCount}/${items.length} ${type}`
              );
            }

            return {
              id: item.id,
              embedding: embedding,
            };
          } catch (error) {
            console.error(
              `❌ Failed to generate embedding for ${type} ${item.id}:`,
              error.message
            );
            return {
              id: item.id,
              embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
            };
          }
        });
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // 🧹 MEMORY CLEANUP: Clear batch references
      batch.length = 0;
      batchResults.length = 0;

      // Memory cleanup between batches
      if (i % (batchSize * 2) === 0) {
        memoryCleanup.forceCleanup();
        memoryCleanup.logMemoryUsage(
          `(batch ${Math.floor(i / batchSize) + 1})`
        );
      }

      // Small delay between batches to prevent overwhelming the system
      if (i + batchSize < items.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    memoryCleanup.logMemoryUsage('(after bulk processing)');

    return results;
  } catch (error) {
    console.error(`❌ Bulk embedding processing failed:`, error.message);
    // 🧹 ERROR CLEANUP
    results.length = 0;
    throw error;
  }
};

/**
 * Memory-efficient bulk database insertion with concurrency control
 * @param {Array} records - Records to insert
 * @param {string} tableName - Target table name
 * @param {Function} insertFn - Database insertion function
 * @returns {Promise<void>}
 */
const processBulkInserts = async (records, tableName, insertFn) => {
  if (!records || records.length === 0) {
    return;
  }

  memoryCleanup.logMemoryUsage('(before bulk insert)');

  const batchSize = MEMORY_CONFIG.BULK_BATCH_SIZE;
  let insertedCount = 0;

  try {
    // Process in batches with semaphore control
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      await bulkProcessingSemaphore.acquire(async () => {
        try {
          await insertFn(batch);
          insertedCount += batch.length;

          // 🧹 MEMORY CLEANUP: Clear batch references and embeddings
          for (const record of batch) {
            if (record.embedding && Array.isArray(record.embedding)) {
              record.embedding.length = 0;
              record.embedding = null;
            }
          }
          batch.length = 0;
        } catch (error) {
          console.error(
            `❌ Batch insert failed for ${tableName}:`,
            error.message
          );
          throw error;
        }
      });

      // Memory cleanup between batches
      if (i % (batchSize * 3) === 0) {
        memoryCleanup.forceCleanup();
        memoryCleanup.logMemoryUsage(`(inserted ${insertedCount})`);
      }
    }

    memoryCleanup.logMemoryUsage('(after bulk insert)');
  } catch (error) {
    console.error(`❌ Bulk insert to ${tableName} failed:`, error.message);
    throw error;
  }
};

/**
 * 🚀 MEMORY-OPTIMIZED: Generate and store embeddings for all content with proper memory management
 * Updated to use Drizzle ORM and your actual database schema
 */
export const generateAndStoreEmbeddingsForAllContent = async () => {
  const startTime = Date.now();
  memoryCleanup.logMemoryUsage('(start)');

  try {
    // 🔄 STEP 1: Process Collections
    const collectionsData = await db.select().from(collections);

    if (collectionsData.length > 0) {
      // Use existing updateCollectionEmbeddings function
      await updateCollectionEmbeddings();
    }

    // 🔄 STEP 2: Process External Links (Content)
    const externalLinksData = await db.select().from(externalLinks);

    if (externalLinksData.length > 0) {
      // Use existing updateExternalLinkEmbeddings function
      await updateExternalLinkEmbeddings();
    }

    // 🔄 STEP 3: Process Notations (Documents)
    const notationsData = await db
      .select()
      .from(collectionExternalLinksNotations);

    if (notationsData.length > 0) {
      // Use existing updateNotationEmbeddings function
      await updateNotationEmbeddings();
    }

    // 🔄 STEP 4: Process Link Groups (Research Papers)
    const linkGroupsData = await db.select().from(linkGroups);

    if (linkGroupsData.length > 0) {
      // Use existing updateLinkGroupEmbeddings function
      await updateLinkGroupEmbeddings();
    }

    // 🔄 STEP 5: Process Attachments (User Profiles)
    const attachmentsData = await db.select().from(attachments);

    if (attachmentsData.length > 0) {
      // Use existing updateAttachmentEmbeddings function
      await updateAttachmentEmbeddings();
    }

    // 🔄 STEP 6: Process Resources
    const resourcesData = await db.select().from(resources);

    if (resourcesData.length > 0) {
      // Use existing updateResourceEmbeddings function
      await updateResourceEmbeddings();
    }

    // 🔄 STEP 7: Process Organizations
    const organizationsData = await db.select().from(organizations);

    if (organizationsData.length > 0) {
      // Use existing updateOrganizationEmbeddings function
      await updateOrganizationEmbeddings();
    }

    // 🧹 FINAL CLEANUP
    memoryCleanup.forceCleanup();

    const duration = Date.now() - startTime;
    const totalProcessed =
      collectionsData.length +
      externalLinksData.length +
      notationsData.length +
      linkGroupsData.length +
      attachmentsData.length +
      resourcesData.length +
      organizationsData.length;

    console.log(
      `\n✅ COMPLETED: Generated embeddings for ${totalProcessed} items in ${Math.round(duration / 1000)}s`
    );
    console.log(
      `📊 Processed: ${collectionsData.length} collections, ${externalLinksData.length} external links, ${notationsData.length} notations, ${linkGroupsData.length} link groups, ${attachmentsData.length} attachments, ${resourcesData.length} resources, ${organizationsData.length} organizations`
    );
    memoryCleanup.logMemoryUsage('(final)');

    return {
      success: true,
      totalProcessed,
      duration: Math.round(duration / 1000),
      breakdown: {
        collections: collectionsData.length,
        externalLinks: externalLinksData.length,
        notations: notationsData.length,
        linkGroups: linkGroupsData.length,
        attachments: attachmentsData.length,
        resources: resourcesData.length,
        organizations: organizationsData.length,
      },
    };
  } catch (error) {
    console.error('❌ Bulk embedding generation failed:', error.message);
    console.error(error.stack);

    // 🧹 ERROR CLEANUP
    memoryCleanup.forceCleanup();

    throw error;
  }
};

// 🧹 MEMORY MONITORING SYSTEM
let memoryMonitorInterval = null;

/**
 * Start the memory monitoring system
 */
export const startMemoryMonitoring = () => {
  if (memoryMonitorInterval) {
    console.log('🔍 Memory monitoring already running');
    return;
  }

  console.log('🚀 Starting memory monitoring system...');

  memoryMonitorInterval = setInterval(() => {
    try {
      memoryCleanup.forceCleanup();
      memoryCleanup.logMemoryUsage('(periodic cleanup)');

      // Check if memory usage is getting too high
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

      if (heapUsedMB > 500) {
        // Alert if using more than 500MB
        console.warn(
          `⚠️ HIGH MEMORY USAGE: ${heapUsedMB}MB heap used (${heapTotalMB}MB total)`
        );

        if (heapUsedMB > 800) {
          // Force aggressive cleanup if over 800MB
          console.warn('🚨 CRITICAL MEMORY USAGE - Forcing aggressive cleanup');
          if (global.gc) {
            global.gc();
            global.gc(); // Run twice for more thorough cleanup
          }
        }
      }
    } catch (error) {
      console.error('❌ Memory monitoring error:', error.message);
    }
  }, MEMORY_CONFIG.CLEANUP_INTERVAL_MS);
  memoryMonitorInterval.unref?.();

  console.log(
    `✅ Memory monitoring started (interval: ${MEMORY_CONFIG.CLEANUP_INTERVAL_MS}ms)`
  );
};

/**
 * Stop the memory monitoring system
 */
export const stopMemoryMonitoring = () => {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
    memoryMonitorInterval = null;
    console.log('🛑 Memory monitoring stopped');
  }
};

/**
 * Get current memory statistics
 */
export const getMemoryStats = () => {
  const memUsage = process.memoryUsage();
  return {
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
    rss: Math.round(memUsage.rss / 1024 / 1024),
    arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024),
    config: MEMORY_CONFIG,
    semaphores: {
      embedding: {
        available: embeddingSemaphore.available,
        waiting: embeddingSemaphore.waiting,
      },
      bulkProcessing: {
        available: bulkProcessingSemaphore.available,
        waiting: bulkProcessingSemaphore.waiting,
      },
    },
  };
};

// 🚀 AUTO-START: Start memory monitoring when this module is loaded
if (process.env.NODE_ENV !== 'test') {
  // Delay startup to allow other systems to initialize
  const startupTimer = setTimeout(() => {
    startMemoryMonitoring();
  }, 5000);
  startupTimer.unref?.();
}

// 🧹 CLEANUP: Stop monitoring on process exit
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down memory monitoring...');
  stopMemoryMonitoring();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down memory monitoring...');
  stopMemoryMonitoring();
  process.exit(0);
});

console.log('✅ Vector Service initialized with memory optimization');
console.log('📊 Memory Configuration:', MEMORY_CONFIG);

/**
 * Semantic search for content - searches external links
 */
export const semanticSearchContent = async (searchText, options = {}) => {
  console.log(`🔍 Searching external links for: "${searchText}"`);

  const {
    limit = 20,
    threshold = 0.2,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  try {
    // Use existing external links search
    const results = await semanticSearchExternalLinks(searchText, {
      limit,
      threshold,
      queryEmbedding,
      userId,
      userEmail,
    });

    return {
      results: results.map((result) => ({
        ...result,
        type: 'external_link',
        title: result.name,
        content: result.description || result.notes || result.full_text,
      })),
    };
  } catch (error) {
    console.error('Error in content search:', error);
    return { results: [] };
  }
};

/**
 * Semantic search for documents - searches notations
 */
export const semanticSearchDocuments = async (searchText, options = {}) => {
  console.log(`🔍 Searching notations for: "${searchText}"`);

  const {
    limit = 20,
    threshold = 0.2,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  try {
    // Use existing notations search
    const results = await semanticSearchNotations(searchText, {
      limit,
      minSimilarity: threshold,
      queryEmbedding,
      userId,
      userEmail,
    });

    return {
      results: results.map((result) => ({
        ...result,
        type: 'notation',
        title: result.title,
        content: result.description || result.notes,
      })),
    };
  } catch (error) {
    console.error('Error in document search:', error);
    return { results: [] };
  }
};

/**
 * Semantic search for research papers - searches link groups
 */
export const semanticSearchResearchPapers = async (
  searchText,
  options = {}
) => {
  console.log(`🔍 Searching link groups for: "${searchText}"`);

  const {
    limit = 20,
    threshold = 0.2,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  try {
    // Use existing link groups search
    const results = await semanticSearchLinkGroups(searchText, {
      limit,
      minSimilarity: threshold,
      queryEmbedding,
      userId,
      userEmail,
    });

    return {
      results: results.map((result) => ({
        ...result,
        type: 'link_group',
        title: result.name,
        content: result.description,
      })),
    };
  } catch (error) {
    console.error('Error in research papers search:', error);
    return { results: [] };
  }
};

/**
 * Semantic search for users - searches attachments
 */
export const semanticSearchUsers = async (searchText, options = {}) => {
  console.log(`🔍 Searching attachments for: "${searchText}"`);

  const {
    limit = 20,
    threshold = 0.2,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
  } = options;

  try {
    // Use existing attachments search
    const results = await semanticSearchAttachments(searchText, {
      limit,
      minSimilarity: threshold,
      queryEmbedding,
      userId,
      userEmail,
    });

    return {
      results: results.map((result) => ({
        ...result,
        type: 'attachment',
        title: result.title,
        content: result.description,
      })),
    };
  } catch (error) {
    console.error('Error in users search:', error);
    return { results: [] };
  }
};

/**
 * Semantic search for events with permission filtering
 * @param {string} searchText - Text to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Search results with similarity scores
 */
export const semanticSearchEvents = async (searchText, options = {}) => {
  const {
    limit = 10,
    threshold = 0.3,
    queryEmbedding = null,
    userId = null,
    tenantIds = null,
  } = options;

  console.log(`🔍 Semantic search in events: "${searchText}"`);

  try {
    // 💰 Use pre-generated embedding if provided, otherwise generate new one
    const embedding =
      queryEmbedding || (await generateChunkedEmbedding(searchText));
    const keywordPattern = `%${searchText}%`;

    // Community tenant events are only visible to their creator
    const communityTenantId = process.env.COMMUNITY_TENANT;

    let whereClause;
    if (communityTenantId) {
      whereClause = userId
        ? sql`
          (title IS NOT NULL OR description IS NOT NULL)
          AND (
            CASE
              WHEN tenant_id = ${communityTenantId}::uuid THEN added_by_user_id = ${userId}
              ELSE (visibility = 'public' OR added_by_user_id = ${userId})
            END
          )
        `
        : sql`
          (title IS NOT NULL OR description IS NOT NULL)
          AND tenant_id != ${communityTenantId}::uuid
          AND visibility = 'public'
        `;
    } else {
      whereClause = userId
        ? sql`
          (title IS NOT NULL OR description IS NOT NULL)
          AND (visibility = 'public' OR added_by_user_id = ${userId})
        `
        : sql`
          (title IS NOT NULL OR description IS NOT NULL)
          AND visibility = 'public'
        `;
    }

    if (tenantIds && tenantIds.length > 0) {
      whereClause = sql`${whereClause} AND tenant_id = ANY(ARRAY[${sql.join(
        tenantIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}])`;
    }

    const textSearchVector = sql`to_tsvector(
      'english',
      concat_ws(' ', title, description, location_name, location_city, location_state)
    )`;
    const textSearchQuery = sql`plainto_tsquery('english', ${searchText})`;

    const results = await db.execute(sql`
      WITH visible_events AS (
        SELECT
          id,
          title,
          description,
          start_date,
          end_date,
          location_name,
          location_city,
          location_state,
          registration_link,
          tenant_id,
          created_at,
          updated_at,
          visibility,
          added_by_user_id,
          combined_embedding
        FROM events
        WHERE ${whereClause}
      ),
      semantic_matches AS (
        SELECT
          id,
          title,
          description,
          start_date,
          end_date,
          location_name,
          location_city,
          location_state,
          registration_link,
          tenant_id,
          created_at,
          updated_at,
          visibility,
          added_by_user_id,
          (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) AS semantic_score,
          0.0::float AS keyword_score,
          'semantic' AS matched_via
        FROM visible_events
        WHERE combined_embedding IS NOT NULL
          AND (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) > ${threshold}
      ),
      keyword_matches AS (
        SELECT
          id,
          title,
          description,
          start_date,
          end_date,
          location_name,
          location_city,
          location_state,
          registration_link,
          tenant_id,
          created_at,
          updated_at,
          visibility,
          added_by_user_id,
          0.0::float AS semantic_score,
          CASE
            WHEN title ILIKE ${keywordPattern} THEN 0.95
            WHEN description ILIKE ${keywordPattern} THEN 0.8
            WHEN location_name ILIKE ${keywordPattern}
              OR location_city ILIKE ${keywordPattern}
              OR location_state ILIKE ${keywordPattern} THEN 0.7
            ELSE GREATEST(ts_rank_cd(${textSearchVector}, ${textSearchQuery}), 0.45)
          END AS keyword_score,
          'keyword' AS matched_via
        FROM visible_events
        WHERE title ILIKE ${keywordPattern}
          OR description ILIKE ${keywordPattern}
          OR location_name ILIKE ${keywordPattern}
          OR location_city ILIKE ${keywordPattern}
          OR location_state ILIKE ${keywordPattern}
          OR ${textSearchVector} @@ ${textSearchQuery}
      ),
      ranked_matches AS (
        SELECT
          *,
          GREATEST(semantic_score, keyword_score) AS similarity_score,
          ROW_NUMBER() OVER (
            PARTITION BY id
            ORDER BY GREATEST(semantic_score, keyword_score) DESC
          ) AS match_rank
        FROM (
          SELECT * FROM semantic_matches
          UNION ALL
          SELECT * FROM keyword_matches
        ) matches
      )
      SELECT
        id,
        title,
        description,
        start_date,
        end_date,
        location_name,
        location_city,
        location_state,
        registration_link as url,
        tenant_id,
        created_at,
        updated_at,
        visibility,
        added_by_user_id,
        semantic_score,
        keyword_score,
        similarity_score,
        matched_via
      FROM ranked_matches
      WHERE match_rank = 1
      ORDER BY similarity_score DESC
      LIMIT ${limit}
    `);

    const rows = results.rows;

    console.log(`✅ Found ${rows.length} event results for "${searchText}"`);

    return rows.map((row) => ({
      ...row,
      similarity: parseFloat(row.similarity_score).toFixed(4),
      search_type: 'event',
      name: row.title, // Standardize field names
      content: row.description,
    }));
  } catch (error) {
    console.error('Error in semantic search events:', error);
    return [];
  }
};

/**
 * Semantic search for organizations with permission filtering
 * @param {string} searchText - Text to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Search results with similarity scores
 */
export const semanticSearchOrganizations = async (searchText, options = {}) => {
  const {
    limit = 10,
    threshold = 0.3,
    queryEmbedding = null,
    userId = null,
    userEmail = null,
    tenantIds = null,
  } = options;

  // Community tenant organizations are only visible to their creator
  const communityTenantId = process.env.COMMUNITY_TENANT;

  try {
    // Build visibility condition for Community tenant
    const communityVisibilityCondition = userId
      ? sql`AND (
          CASE
            WHEN tenant_id = ${communityTenantId}::uuid THEN user_id = ${userId}
            ELSE true
          END
        )`
      : sql`AND tenant_id != ${communityTenantId}::uuid`;

    // First, let's check if we have ANY organizations at all
    const totalOrgsResult = await db.execute(sql`
      SELECT COUNT(*) as total_count,
             COUNT(CASE WHEN combined_embedding IS NOT NULL THEN 1 END) as with_embeddings,
             COUNT(CASE WHEN combined_embedding IS NULL THEN 1 END) as without_embeddings
      FROM organizations
      WHERE 1=1
      ${
        tenantIds && tenantIds.length > 0
          ? sql`AND tenant_id = ANY(ARRAY[${sql.join(
              tenantIds.map((id) => sql`${id}::uuid`),
              sql`, `
            )}])`
          : sql``
      }
      ${communityVisibilityCondition}
    `);

    // Let's also do a simple keyword search to see if the organization exists
    const keywordSearch = await db.execute(sql`
      SELECT id, name, acronym, description,
             CASE
               WHEN combined_embedding IS NOT NULL THEN 'HAS_EMBEDDING'
               ELSE 'NO_EMBEDDING'
             END as embedding_status
      FROM organizations
      WHERE (
        LOWER(name) LIKE LOWER(${'%' + searchText + '%'}) OR
        LOWER(acronym) LIKE LOWER(${'%' + searchText + '%'}) OR
        LOWER(description) LIKE LOWER(${'%' + searchText + '%'})
      )
      ${
        tenantIds && tenantIds.length > 0
          ? sql`AND tenant_id = ANY(ARRAY[${sql.join(
              tenantIds.map((id) => sql`${id}::uuid`),
              sql`, `
            )}])`
          : sql``
      }
      ${communityVisibilityCondition}
      LIMIT 20
    `);

    // 💰 Use pre-generated embedding if provided, otherwise generate new one
    const embedding =
      queryEmbedding || (await generateChunkedEmbedding(searchText));

    let whereClause = sql`
      combined_embedding IS NOT NULL
      AND (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) > ${threshold}
    `;

    // Filter by tenant(s) if provided
    if (tenantIds && tenantIds.length > 0) {
      whereClause = sql`${whereClause} AND tenant_id = ANY(ARRAY[${sql.join(
        tenantIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )}])`;
    }

    // Add Community tenant visibility check
    whereClause = sql`${whereClause} ${communityVisibilityCondition}`;

    const results = await db.execute(sql`
      SELECT
        id,
        name,
        acronym,
        description,
        category,
        website,
        email,
        phone,
        address,
        city,
        state,
        country,
        tenant_id,
        created_at,
        updated_at,
        (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) as similarity_score
      FROM organizations
      WHERE ${whereClause}
      ORDER BY similarity_score DESC
      LIMIT ${limit}
    `);

    if (DEBUG_SEARCH) {
      results.rows.forEach((org, index) => {
        console.log(
          `   ${index + 1}. "${org.name}" (${org.acronym}) - similarity: ${parseFloat(org.similarity_score).toFixed(4)}`
        );
      });
    }

    // If vector search found nothing, let's try with a lower threshold
    if (results.rows.length === 0 && DEBUG_SEARCH) {
      console.log(
        '⚠️  No vector results found, trying with lower threshold (0.1)...'
      );

      const lowerThresholdResults = await db.execute(sql`
        SELECT
          id,
          name,
          acronym,
          description,
          (1 - (combined_embedding <=> ${JSON.stringify(embedding)}::vector(1536))) as similarity_score
        FROM organizations
        WHERE combined_embedding IS NOT NULL
          ${
            tenantIds && tenantIds.length > 0
              ? sql`AND tenant_id = ANY(ARRAY[${sql.join(
                  tenantIds.map((id) => sql`${id}::uuid`),
                  sql`, `
                )}])`
              : sql``
          }
        ORDER BY similarity_score DESC
        LIMIT 10
      `);

      console.log(
        `🔍 Lower threshold search found ${lowerThresholdResults.rows.length} results:`
      );
      lowerThresholdResults.rows.forEach((org, index) => {
        console.log(
          `   ${index + 1}. "${org.name}" (${org.acronym}) - similarity: ${parseFloat(org.similarity_score).toFixed(4)}`
        );
      });
    }

    const mappedResults = results.rows.map((row) => ({
      ...row,
      similarity: parseFloat(row.similarity_score).toFixed(4),
      search_type: 'organization',
      title: row.name, // Standardize field names
      content: row.description,
      url: row.website, // Map website to url for consistency
    }));

    return mappedResults;
  } catch (error) {
    debugError(
      DEBUG_SEARCH,
      '❌ Error in semantic search organizations:',
      error
    );

    return [];
  }
};

/**
 * COMPLETE comprehensive semantic search across ALL content types
 * This is the main search function that should be used by the AI
 * @param {string} searchText - Text to search for
 * @param {Object} options - Search options
 * @returns {Promise<Object>} - Combined search results with similarity scores
 */
export const semanticSearchAllContent = async (searchText, options = {}) => {
  const {
    limit = 50,
    threshold = 0.2,
    minSimilarity = 0.2,
    userId = null,
    userEmail = null,
    tenantIds = null,
  } = options;

  console.log(`🔍 Starting COMPLETE comprehensive search...`);
  console.log(`   Query: "${searchText}"`);
  console.log(`   Options:`, { limit, threshold, userId, tenantIds });

  const startTime = Date.now();
  memoryCleanup.logMemoryUsage('(complete search start)');

  try {
    // 🎯 Generate search embedding once and reuse for all searches
    console.log('🧠 Generating search embedding...');
    const queryEmbedding = await generateChunkedEmbedding(searchText);

    // 🔄 Execute ALL searches in parallel with controlled concurrency
    console.log('🔍 Executing parallel searches across ALL content types...');

    const [
      resourcesResults,
      eventsResults,
      organizationsResults,
      collectionsResults,
      externalLinksResults,
      notationsResults,
      linkGroupsResults,
      attachmentsResults,
    ] = await Promise.all([
      embeddingSemaphore.acquire(async () =>
        semanticSearchResources(searchText, {
          limit: Math.ceil(limit / 8),
          threshold,
          queryEmbedding,
          userId,
          userEmail,
          tenantIds,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchEvents(searchText, {
          limit: Math.ceil(limit / 8),
          threshold,
          queryEmbedding,
          userId,
          userEmail,
          tenantIds,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchOrganizations(searchText, {
          limit: Math.ceil(limit / 8),
          threshold,
          queryEmbedding,
          userId,
          userEmail,
          tenantIds,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchCollections(searchText, {
          limit: Math.ceil(limit / 8),
          threshold,
          queryEmbedding,
          userId,
          userEmail,
          tenantIds,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchExternalLinks(searchText, {
          limit: Math.ceil(limit / 8),
          threshold,
          queryEmbedding,
          userId,
          userEmail,
          tenantIds,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchNotations(searchText, {
          limit: Math.ceil(limit / 8),
          minSimilarity,
          queryEmbedding,
          userId,
          userEmail,
          tenantIds,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchLinkGroups(searchText, {
          limit: Math.ceil(limit / 8),
          minSimilarity,
          queryEmbedding,
          userId,
          userEmail,
          tenantIds,
        })
      ),
      embeddingSemaphore.acquire(async () =>
        semanticSearchAttachments(searchText, {
          limit: Math.ceil(limit / 8),
          minSimilarity,
          queryEmbedding,
          userId,
          userEmail,
          tenantIds,
        })
      ),
    ]);

    // 🧹 CLEANUP: Clear search embedding after use
    queryEmbedding.length = 0;

    memoryCleanup.logMemoryUsage('(after all parallel searches)');

    const resourceResultMap = new Map(
      resourcesResults.map((result) => [
        result.id,
        normalizeSemanticSearchResult(result, {
          type: 'resource',
          matchedVia: 'resource',
          matchedChildren: {
            attachments: [],
            linkGroups: [],
          },
        }),
      ])
    );

    const mergeResourceChildHit = (result, childType) => {
      if (!result.resource_id || !result.resource_title) {
        return;
      }

      const existing =
        resourceResultMap.get(result.resource_id) ||
        normalizeSemanticSearchResult(
          {
            id: result.resource_id,
            name: result.resource_title,
            description: result.resource_description,
            created_at: result.resource_created_at,
            updated_at: result.resource_updated_at,
            similarity: result.similarity,
            search_type: 'resource',
          },
          {
            type: 'resource',
            matchedVia: childType,
            matchedChildren: {
              attachments: [],
              linkGroups: [],
            },
          }
        );

      existing.matchedChildren = existing.matchedChildren || {
        attachments: [],
        linkGroups: [],
      };

      const existingSimilarity = Number.parseFloat(existing.similarity || 0);
      const nextSimilarity = Number.parseFloat(result.similarity || 0);

      if (nextSimilarity > existingSimilarity) {
        existing.similarity = nextSimilarity.toFixed(4);
      }

      if (existing.matchedVia !== 'resource') {
        existing.matchedVia = existing.matchedVia || childType;
      }

      if (childType === 'attachment') {
        const exists = existing.matchedChildren.attachments.some(
          (attachment) => attachment.id === result.id
        );

        if (!exists) {
          existing.matchedChildren.attachments.push({
            id: result.id,
            title: result.title || result.name,
            description: result.description,
            type: 'attachment',
          });
        }
      }

      if (childType === 'link_group') {
        const exists = existing.matchedChildren.linkGroups.some(
          (linkGroup) => linkGroup.id === result.id
        );

        if (!exists) {
          existing.matchedChildren.linkGroups.push({
            id: result.id,
            title: result.title || result.name,
            description: result.description,
            type: 'link_group',
          });
        }
      }

      resourceResultMap.set(result.resource_id, existing);
    };

    attachmentsResults.forEach((result) =>
      mergeResourceChildHit(result, 'attachment')
    );
    linkGroupsResults.forEach((result) =>
      mergeResourceChildHit(result, 'link_group')
    );

    const normalizedResourceResults = Array.from(resourceResultMap.values());

    // 🎯 Combine all results including both search-based and all organizations
    const allResults = [
      ...normalizedResourceResults,
      ...eventsResults.map((r) =>
        normalizeSemanticSearchResult(r, { type: 'event' })
      ),
      ...organizationsResults.map((r) =>
        normalizeSemanticSearchResult(r, { type: 'organization' })
      ),
      ...collectionsResults.map((r) =>
        normalizeSemanticSearchResult(r, { type: 'collection' })
      ),
      ...externalLinksResults.map((r) =>
        normalizeSemanticSearchResult(r, { type: 'external_link' })
      ),
      ...notationsResults.map((r) =>
        normalizeSemanticSearchResult(r, { type: 'notation' })
      ),
      ...linkGroupsResults.map((r) =>
        normalizeSemanticSearchResult(r, { type: 'link_group' })
      ),
      ...attachmentsResults.map((r) =>
        normalizeSemanticSearchResult(r, { type: 'attachment' })
      ),
    ];

    const sortedResults = dedupeAndRankSemanticSearchResults(allResults, {
      threshold,
      limit,
    });

    const searchDuration = Date.now() - startTime;
    memoryCleanup.logMemoryUsage('(complete search end)');

    const breakdown = {
      resources: resourcesResults.length,
      events: eventsResults.length,
      organizations: organizationsResults.length,
      collections: collectionsResults.length,
      external_links: externalLinksResults.length,
      notations: notationsResults.length,
      link_groups: linkGroupsResults.length,
      attachments: attachmentsResults.length,
    };

    console.log(`✅ COMPLETE search completed in ${searchDuration}ms`);
    console.log(`📊 Results breakdown:`, breakdown);
    console.log(`🎯 Total items found: ${allResults.length}`);
    console.log(`🔝 Top results returned: ${sortedResults.length}`);

    return {
      results: sortedResults,
      totalFound: allResults.length,
      searchDuration,
      breakdown,
      query: searchText,
      options: { limit, threshold, minSimilarity },
    };
  } catch (error) {
    console.error('❌ Error in comprehensive search:', error);
    memoryCleanup.logMemoryUsage('(error in complete search)');
    return {
      results: [],
      totalFound: 0,
      searchDuration: Date.now() - startTime,
      breakdown: {},
      error: error.message,
      query: searchText,
    };
  }
};

/**
 * Auto-update embeddings for a single organization (call this after create/update)
 * @param {string} organizationId - ID of the organization to update
 * @returns {Promise<void>}
 */
export const autoUpdateOrganizationEmbedding = async (organizationId) => {
  try {
    console.log(
      `🔄 Auto-updating embeddings for organization: ${organizationId}`
    );

    const organization = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (organization.length === 0) {
      console.warn(`⚠️ Organization not found: ${organizationId}`);
      return;
    }

    const item = organization[0];
    const texts = prepareOrganizationTextForEmbedding(item);

    const nameEmbedding = await generateChunkedEmbedding(texts.name || '');
    const descriptionEmbedding = await generateChunkedEmbedding(
      texts.description || ''
    );
    const categoryEmbedding = await generateChunkedEmbedding(
      texts.category || ''
    );
    const combinedEmbedding = await generateChunkedEmbedding(
      texts.combined || ''
    );

    await db.execute(sql`
      UPDATE organizations
      SET
        name_embedding = ${JSON.stringify(nameEmbedding)}::vector(1536),
        description_embedding = ${JSON.stringify(descriptionEmbedding)}::vector(1536),
        category_embedding = ${JSON.stringify(categoryEmbedding)}::vector(1536),
        combined_embedding = ${JSON.stringify(combinedEmbedding)}::vector(1536),
        vector_updated_at = CURRENT_TIMESTAMP
      WHERE id = ${organizationId}
    `);

    console.log(
      `✅ Successfully updated embeddings for organization: ${organizationId}`
    );
  } catch (error) {
    console.error(
      `❌ Error auto-updating embeddings for organization ${organizationId}:`,
      error
    );
    // Don't throw - we don't want to break the main organization operation
  }
};

/**
 * Detect if a search query is likely looking for an organization
 * @param {string} query - Search query
 * @returns {boolean} - True if query seems to be for an organization
 */
export const isOrganizationQuery = (query) => {
  const organizationKeywords = [
    'organization',
    'org',
    'foundation',
    'association',
    'institute',
    'center',
    'centre',
    'society',
    'council',
    'alliance',
    'coalition',
    'network',
    'consortium',
    'federation',
    'agency',
    'company',
    'corporation',
    'corp',
    'inc',
    'llc',
    'ltd',
    'group',
    'hospital',
    'clinic',
    'medical',
    'health',
    'cancer',
    'research',
    'university',
    'college',
    'academy',
    'school',
    'department',
    'division',
    'branch',
  ];

  const lowerQuery = query.toLowerCase();

  // Check for organizational keywords
  const hasOrgKeywords = organizationKeywords.some((keyword) =>
    lowerQuery.includes(keyword)
  );

  // Check for acronym patterns (2-6 uppercase letters)
  const hasAcronym = /\b[A-Z]{2,6}\b/.test(query);

  // Check for proper nouns (multiple capitalized words)
  const hasProperNouns = /\b[A-Z][a-z]+(\s+[A-Z][a-z]+)+\b/.test(query);

  return hasOrgKeywords || hasAcronym || hasProperNouns;
};

/**
 * Keyword-based organization search as fallback when vector search fails
 * @param {string} searchText - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Organization results
 */
export const keywordSearchOrganizations = async (searchText, options = {}) => {
  const { limit = 10, tenantIds = null } = options;

  try {
    const results = await db.execute(sql`
      SELECT
        id,
        name,
        acronym,
        description,
        category,
        website,
        email,
        phone,
        address,
        city,
        state,
        country,
        tenant_id,
        created_at,
        updated_at,
        CASE
          WHEN LOWER(name) = LOWER(${searchText}) THEN 1.0
          WHEN LOWER(acronym) = LOWER(${searchText}) THEN 0.95
          WHEN LOWER(name) LIKE LOWER(${'%' + searchText + '%'}) THEN 0.8
          WHEN LOWER(acronym) LIKE LOWER(${'%' + searchText + '%'}) THEN 0.75
          WHEN LOWER(description) LIKE LOWER(${'%' + searchText + '%'}) THEN 0.6
          ELSE 0.5
        END as similarity_score
      FROM organizations
      WHERE (
        LOWER(name) LIKE LOWER(${'%' + searchText + '%'}) OR
        LOWER(acronym) LIKE LOWER(${'%' + searchText + '%'}) OR
        LOWER(description) LIKE LOWER(${'%' + searchText + '%'})
      )
      ${
        tenantIds && tenantIds.length > 0
          ? sql`AND tenant_id = ANY(ARRAY[${sql.join(
              tenantIds.map((id) => sql`${id}::uuid`),
              sql`, `
            )}])`
          : sql``
      }
      ORDER BY similarity_score DESC, name ASC
      LIMIT ${limit}
    `);

    if (DEBUG_SEARCH) {
      results.rows.forEach((org, index) => {
        console.log(
          `   ${index + 1}. "${org.name}" (${org.acronym}) - score: ${parseFloat(org.similarity_score).toFixed(2)}`
        );
      });
    }

    const mappedResults = results.rows.map((row) => ({
      ...row,
      similarity: parseFloat(row.similarity_score).toFixed(4),
      search_type: 'organization_keyword',
      title: row.name,
      content: row.description,
      url: row.website,
    }));

    return mappedResults;
  } catch (error) {
    debugError(
      DEBUG_SEARCH,
      '❌ Error in keyword search organizations:',
      error
    );

    return [];
  }
};

// Environment-based logging controls
const DEBUG_SEARCH =
  process.env.DEBUG_SEARCH === 'true' || process.env.NODE_ENV === 'development';
const DEBUG_EMBEDDINGS =
  process.env.DEBUG_EMBEDDINGS === 'true' ||
  process.env.NODE_ENV === 'development';
const DEBUG_MEMORY = process.env.DEBUG_MEMORY === 'true';

// Helper functions for conditional logging
const debugLog = (condition, ...args) => {
  if (condition) console.log(...args);
};

const debugError = (condition, ...args) => {
  if (condition) console.error(...args);
};
