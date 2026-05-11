#!/usr/bin/env node

/**
 * Comprehensive Embedding Generation Script
 *
 * This script generates embeddings for ALL content types in the system:
 * - Collections
 * - External Links
 * - Notations
 * - Link Groups
 * - Attachments
 * - Resources
 * - Organizations
 *
 * Usage:
 * - Heroku: heroku run node scripts/generateAllEmbeddings.js --app your-app-name
 * - Heroku Run Terminal: node scripts/generateAllEmbeddings.js
 * - Local: node scripts/generateAllEmbeddings.js
 *
 * Environment Variables:
 * - DEBUG_EMBEDDINGS=true : Enable detailed embedding generation logs
 * - NODE_ENV=development : Enable debug logs in development
 */

import { generateAndStoreEmbeddingsForAllContent } from '../src/services/vectorService.js';

// Environment-based logging
const DEBUG_EMBEDDINGS =
  process.env.DEBUG_EMBEDDINGS === 'true' ||
  process.env.NODE_ENV === 'development';

async function main() {
  const startTime = Date.now();

  console.log('🚀 Starting comprehensive embedding generation...');

  try {
    const results = await generateAndStoreEmbeddingsForAllContent();

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('\n✅ Embedding generation completed successfully!');
    console.log(`📊 Total items processed: ${results.totalProcessed}`);

    if (results.breakdown) {
      console.log('📋 Breakdown by content type:');
      Object.entries(results.breakdown).forEach(([type, count]) => {
        console.log(`   - ${type}: ${count}`);
      });
    }

    console.log(
      `⏱️ Total time: ${Math.floor(duration / 60)}m ${duration % 60}s`
    );
  } catch (error) {
    console.error('❌ Error during embedding generation:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Gracefully shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Gracefully shutting down...');
  process.exit(0);
});

main();
