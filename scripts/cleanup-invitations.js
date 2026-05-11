#!/usr/bin/env node

/**
 * Invitation Cleanup Script
 *
 * This script should be run periodically (e.g., daily via cron) to:
 * 1. Mark expired invitations as 'expired'
 * 2. Delete old expired invitations (30+ days old)
 * 3. Log statistics about the cleanup process
 *
 * Usage:
 *   node scripts/cleanup-invitations.js
 *
 * Cron example (daily at 2 AM):
 *   0 2 * * * cd /path/to/app && node scripts/cleanup-invitations.js >> logs/invitation-cleanup.log 2>&1
 */

import {
  cleanupExpiredInvitations,
  deleteOldExpiredInvitations,
  getInvitationStats,
} from '../src/utils/invitationCleanup.js';

async function runCleanup() {
  const startTime = new Date();

  try {
    // Get initial statistics
    console.log('\n📊 Initial Statistics:');
    const initialStats = await getInvitationStats();
    initialStats.forEach((stat) => {
      console.log(`  ${stat.status}: ${stat.count} invitations`);
    });

    // Mark expired invitations
    console.log('\n⏰ Marking expired invitations...');
    const expiredCount = await cleanupExpiredInvitations();
    console.log(`  Marked ${expiredCount} invitations as expired`);

    // Delete old expired invitations
    console.log('\n🗑️  Deleting old expired invitations...');
    const deletedCount = await deleteOldExpiredInvitations();
    console.log(`  Deleted ${deletedCount} old expired invitations`);

    // Get final statistics
    console.log('\n📊 Final Statistics:');
    const finalStats = await getInvitationStats();
    finalStats.forEach((stat) => {
      console.log(`  ${stat.status}: ${stat.count} invitations`);
    });

    const endTime = new Date();
    const duration = endTime - startTime;
    console.log(`\n✅ Cleanup completed successfully in ${duration}ms`);
    console.log(
      `=== Invitation Cleanup Finished at ${endTime.toISOString()} ===\n`
    );

    // Exit with success
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    console.error('Stack trace:', error.stack);

    // Exit with error
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the cleanup
runCleanup();
