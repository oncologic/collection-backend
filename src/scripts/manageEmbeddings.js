#!/usr/bin/env node

import { Command } from 'commander';
import { db } from '../db/index.js';
import {
  updateResourceEmbeddings,
  updateCollectionEmbeddings,
  updateExternalLinkEmbeddings,
  updateNotationEmbeddings,
  updateLinkGroupEmbeddings,
  updateAttachmentEmbeddings,
  updateAllCollectionEmbeddings,
  generateChunkedEmbedding,
  semanticSearchResources,
  semanticSearchAllCollectionContentExtended,
} from '../services/vectorService.js';
import { sql } from 'drizzle-orm';

const program = new Command();

program
  .name('manage-embeddings')
  .description('CLI tool for managing vector embeddings')
  .version('1.0.0');

/**
 * Initialize embeddings for all existing data
 */
program
  .command('init')
  .description('Initialize embeddings for all existing data')
  .option(
    '-t, --type <type>',
    'Type to initialize (resources|collections|link-groups|all)',
    'all'
  )
  .option('-b, --batch-size <number>', 'Batch size for processing', '10')
  .option(
    '-d, --delay <number>',
    'Delay between batches in milliseconds',
    '2000'
  )
  .option(
    '--dry-run',
    'Show what would be processed without actually processing'
  )
  .option(
    '--force',
    'Force regeneration of all embeddings (resets vector_updated_at)'
  )
  .action(async (options) => {
    console.log(`🚀 Starting embedding initialization for: ${options.type}`);

    try {
      if (options.force && !options.dryRun) {
        console.log('🔄 Force mode: Resetting all vector timestamps...');

        if (options.type === 'all' || options.type === 'resources') {
          await db.execute(sql`UPDATE resources SET vector_updated_at = NULL`);
        }
        if (options.type === 'all' || options.type === 'collections') {
          await db.execute(
            sql`UPDATE collections SET vector_updated_at = NULL`
          );
          await db.execute(
            sql`UPDATE external_links SET vector_updated_at = NULL`
          );
          await db.execute(
            sql`UPDATE collection_external_links_notations SET vector_updated_at = NULL`
          );
          await db.execute(
            sql`UPDATE attachments SET vector_updated_at = NULL`
          );
        }
        if (options.type === 'all' || options.type === 'link-groups') {
          await db.execute(
            sql`UPDATE link_groups SET vector_updated_at = NULL`
          );
        }

        console.log(
          '✅ Vector timestamps reset - all items will be reprocessed'
        );
      }

      if (options.dryRun) {
        console.log('📋 DRY RUN MODE - No embeddings will be generated');

        if (options.type === 'all' || options.type === 'resources') {
          const resourceCount = await db.execute(
            sql`SELECT COUNT(*) as count FROM resources WHERE combined_embedding IS NULL OR vector_updated_at IS NULL`
          );
          console.log(
            `Resources needing embeddings: ${resourceCount.rows[0].count}`
          );
        }

        if (options.type === 'all' || options.type === 'collections') {
          const collectionCount = await db.execute(
            sql`SELECT COUNT(*) as count FROM collections WHERE combined_embedding IS NULL OR vector_updated_at IS NULL`
          );
          const externalLinkCount = await db.execute(
            sql`SELECT COUNT(*) as count FROM external_links WHERE combined_embedding IS NULL OR vector_updated_at IS NULL`
          );
          const notationCount = await db.execute(
            sql`SELECT COUNT(*) as count FROM collection_external_links_notations WHERE combined_embedding IS NULL OR vector_updated_at IS NULL`
          );
          const attachmentCount = await db.execute(
            sql`SELECT COUNT(*) as count FROM attachments WHERE combined_embedding IS NULL OR vector_updated_at IS NULL`
          );

          console.log(
            `Collections needing embeddings: ${collectionCount.rows[0].count}`
          );
          console.log(
            `External links needing embeddings: ${externalLinkCount.rows[0].count}`
          );
          console.log(
            `Notations needing embeddings: ${notationCount.rows[0].count}`
          );
          console.log(
            `Attachments needing embeddings: ${attachmentCount.rows[0].count}`
          );
        }

        if (options.type === 'all' || options.type === 'link-groups') {
          const linkGroupCount = await db.execute(
            sql`SELECT COUNT(*) as count FROM link_groups WHERE combined_embedding IS NULL OR vector_updated_at IS NULL`
          );
          console.log(
            `Link groups needing embeddings: ${linkGroupCount.rows[0].count}`
          );
        }

        return;
      }

      // Execute the appropriate initialization
      switch (options.type) {
        case 'resources':
          await updateResourceEmbeddings();
          break;
        case 'collections':
          await updateAllCollectionEmbeddings();
          break;
        case 'link-groups':
          await updateLinkGroupEmbeddings();
          break;
        case 'all':
        default:
          console.log('🔄 Initializing all embeddings...');
          await updateResourceEmbeddings();
          await updateAllCollectionEmbeddings();
          break;
      }

      console.log('✅ Embedding initialization completed successfully!');
    } catch (error) {
      console.error('❌ Error during initialization:', error);
      process.exit(1);
    }
  });

/**
 * Update embeddings for modified data
 */
program
  .command('update')
  .description('Update embeddings for modified data')
  .option(
    '-t, --type <type>',
    'Type to update (resources|collections|link-groups|all)',
    'all'
  )
  .action(async (options) => {
    console.log(`🔄 Updating embeddings for modified ${options.type}...`);

    try {
      switch (options.type) {
        case 'resources':
          await updateResourceEmbeddings();
          break;
        case 'collections':
          await updateCollectionEmbeddings();
          await updateExternalLinkEmbeddings();
          await updateNotationEmbeddings();
          await updateAttachmentEmbeddings();
          break;
        case 'link-groups':
          await updateLinkGroupEmbeddings();
          break;
        case 'all':
        default:
          await updateResourceEmbeddings();
          await updateAllCollectionEmbeddings();
          break;
      }

      console.log('✅ Embedding update completed successfully!');
    } catch (error) {
      console.error('❌ Error during update:', error);
      process.exit(1);
    }
  });

/**
 * Test semantic search
 */
program
  .command('search [query]')
  .description('Test semantic search functionality')
  .option('-l, --limit <number>', 'Number of results', '10')
  .option('-t, --threshold <number>', 'Similarity threshold (0-1)', '0.2')
  .action(async (query, options) => {
    const searchQuery = query || 'kidney cancer treatment';
    console.log(`🔍 Searching for: "${searchQuery}"`);

    try {
      const results = await semanticSearchAllCollectionContentExtended(
        searchQuery,
        {
          limit: parseInt(options.limit),
          threshold: parseFloat(options.threshold),
        }
      );

      if (results.length === 0) {
        console.log(
          `No results found with threshold ${options.threshold}. Try lowering the threshold with --threshold 0.1`
        );
        return;
      }

      console.log(
        `\n📊 Found ${results.length} results (threshold: ${options.threshold}):`
      );
      results.forEach((result, index) => {
        console.log(`\n${index + 1}. ${result.title || result.name}`);
        console.log(
          `   Similarity: ${(parseFloat(result.similarity_score || result.similarity) * 100).toFixed(1)}%`
        );
        console.log(
          `   Type: ${result.content_type || result.search_type || 'resource'}`
        );
        console.log(
          `   Description: ${(result.description || result.notes || 'No description')?.substring(0, 100)}...`
        );
      });
    } catch (error) {
      console.error('❌ Search failed:', error);
      process.exit(1);
    }
  });

/**
 * Health check for vector database
 */
program
  .command('health')
  .description('Check health of vector embeddings')
  .action(async () => {
    console.log('🔍 Running vector database health check...');

    try {
      // Check database connection
      await db.execute(sql`SELECT 1`);
      console.log('✅ Database connection: OK');

      // Check pgvector extension
      const extensionCheck = await db.execute(sql`
        SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as has_vector
      `);

      if (extensionCheck.rows[0].has_vector) {
        console.log('✅ pgvector extension: OK');
      } else {
        console.log('❌ pgvector extension: NOT INSTALLED');
        return;
      }

      console.log('\n📊 Embedding Statistics:');

      // Check resources
      const resourceStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(combined_embedding) as embedded_rows,
          COUNT(*) - COUNT(combined_embedding) as missing_embeddings
        FROM resources
      `);
      console.log(`\n🗂️  Resources:`);
      console.log(`   Total: ${resourceStats.rows[0].total_rows}`);
      console.log(`   With embeddings: ${resourceStats.rows[0].embedded_rows}`);
      console.log(
        `   Missing embeddings: ${resourceStats.rows[0].missing_embeddings}`
      );

      // Check collections
      const collectionStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(combined_embedding) as embedded_rows,
          COUNT(*) - COUNT(combined_embedding) as missing_embeddings
        FROM collections
      `);
      console.log(`\n📚 Collections:`);
      console.log(`   Total: ${collectionStats.rows[0].total_rows}`);
      console.log(
        `   With embeddings: ${collectionStats.rows[0].embedded_rows}`
      );
      console.log(
        `   Missing embeddings: ${collectionStats.rows[0].missing_embeddings}`
      );

      // Check external links
      const externalLinkStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(combined_embedding) as embedded_rows,
          COUNT(*) - COUNT(combined_embedding) as missing_embeddings
        FROM external_links
      `);
      console.log(`\n🔗 External Links:`);
      console.log(`   Total: ${externalLinkStats.rows[0].total_rows}`);
      console.log(
        `   With embeddings: ${externalLinkStats.rows[0].embedded_rows}`
      );
      console.log(
        `   Missing embeddings: ${externalLinkStats.rows[0].missing_embeddings}`
      );

      // Check link groups
      const linkGroupStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(combined_embedding) as embedded_rows,
          COUNT(*) - COUNT(combined_embedding) as missing_embeddings
        FROM link_groups
      `);
      console.log(`\n🔗 Link Groups:`);
      console.log(`   Total: ${linkGroupStats.rows[0].total_rows}`);
      console.log(
        `   With embeddings: ${linkGroupStats.rows[0].embedded_rows}`
      );
      console.log(
        `   Missing embeddings: ${linkGroupStats.rows[0].missing_embeddings}`
      );

      // Check notations
      const notationStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(combined_embedding) as embedded_rows,
          COUNT(*) - COUNT(combined_embedding) as missing_embeddings
        FROM collection_external_links_notations
      `);
      console.log(`\n📝 Notations:`);
      console.log(`   Total: ${notationStats.rows[0].total_rows}`);
      console.log(`   With embeddings: ${notationStats.rows[0].embedded_rows}`);
      console.log(
        `   Missing embeddings: ${notationStats.rows[0].missing_embeddings}`
      );

      // Check attachments
      const attachmentStats = await db.execute(sql`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(combined_embedding) as embedded_rows,
          COUNT(*) - COUNT(combined_embedding) as missing_embeddings
        FROM attachments
      `);
      console.log(`\n📎 Attachments:`);
      console.log(`   Total: ${attachmentStats.rows[0].total_rows}`);
      console.log(
        `   With embeddings: ${attachmentStats.rows[0].embedded_rows}`
      );
      console.log(
        `   Missing embeddings: ${attachmentStats.rows[0].missing_embeddings}`
      );

      // Calculate totals
      const totalMissing =
        parseInt(resourceStats.rows[0].missing_embeddings) +
        parseInt(collectionStats.rows[0].missing_embeddings) +
        parseInt(externalLinkStats.rows[0].missing_embeddings) +
        parseInt(linkGroupStats.rows[0].missing_embeddings) +
        parseInt(notationStats.rows[0].missing_embeddings) +
        parseInt(attachmentStats.rows[0].missing_embeddings);

      if (totalMissing > 0) {
        console.log(`\n⚠️  Total missing embeddings: ${totalMissing}`);
        console.log('\n💡 Available commands:');
        console.log(
          '   npm run embeddings -- init --type all          # Initialize all embeddings'
        );
        console.log(
          '   npm run embeddings -- init --type link-groups  # Initialize only link groups'
        );
        console.log(
          '   npm run embeddings -- init --type collections  # Initialize collections, external links, notations, attachments'
        );
        console.log(
          '   npm run embeddings -- init --type resources    # Initialize only resources'
        );
      } else {
        console.log('\n✅ All embeddings are up to date!');
      }
    } catch (error) {
      console.error('❌ Health check failed:', error);
      process.exit(1);
    }
  });

/**
 * Test embedding generation
 */
program
  .command('test')
  .description('Test embedding generation with sample text')
  .option('-t, --text <text>', 'Text to generate embedding for', 'Hello world')
  .action(async (options) => {
    console.log(`🧪 Testing embedding generation for: "${options.text}"`);

    try {
      const embedding = await generateChunkedEmbedding(options.text);

      console.log(`✅ Generated embedding with ${embedding.length} dimensions`);
      console.log(
        `📊 First 5 values: [${embedding
          .slice(0, 5)
          .map((v) => v.toFixed(4))
          .join(', ')}...]`
      );

      // Test similarity with itself (should be 1.0)
      const similarity = await db.execute(sql`
        SELECT (1 - (${JSON.stringify(embedding)}::vector(1536) <=> ${JSON.stringify(embedding)}::vector(1536))) as similarity
      `);

      console.log(
        `🔍 Self-similarity: ${similarity.rows[0].similarity} (should be 1.0)`
      );
    } catch (error) {
      console.error('❌ Test failed:', error);
      process.exit(1);
    }
  });

program.parse();
