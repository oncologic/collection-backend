#!/usr/bin/env node

import { processPendingEmbeddings, processPendingNotationEmbeddings } from '../src/services/vectorService.js';

/**
 * Background job to process pending embeddings
 * Can be run as a cron job or scheduled task
 */
async function main() {
  console.log('🚀 Starting embedding processing job...');
  console.log(`⏰ Started at: ${new Date().toISOString()}`);

  try {
    // Process resource embeddings
    console.log('📚 Processing resource embeddings...');
    await processPendingEmbeddings();
    
    // Process notation embeddings
    console.log('📝 Processing notation embeddings...');
    await processPendingNotationEmbeddings();
    
    console.log('✅ Embedding processing job completed successfully');
  } catch (error) {
    console.error('❌ Embedding processing job failed:', error);
    process.exit(1);
  }

  console.log(`⏰ Completed at: ${new Date().toISOString()}`);
  process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

main();
