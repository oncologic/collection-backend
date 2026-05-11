import { db } from '../db/index.js';
import { eq, lt, and } from 'drizzle-orm';
import { pendingInvitations } from '../models/pendingInvitations.js';

/**
 * Clean up expired invitations
 * This function should be run periodically (e.g., daily) to mark expired invitations
 */
export const cleanupExpiredInvitations = async () => {
  try {
    const now = new Date();

    // Update expired invitations
    const result = await db
      .update(pendingInvitations)
      .set({
        status: 'expired',
        updatedAt: now,
      })
      .where(
        and(
          eq(pendingInvitations.status, 'pending'),
          lt(pendingInvitations.expiresAt, now)
        )
      )
      .returning({ id: pendingInvitations.id });

    console.log(`Marked ${result.length} invitations as expired`);
    return result.length;
  } catch (error) {
    console.error('Error cleaning up expired invitations:', error);
    throw error;
  }
};

/**
 * Get invitation statistics
 * Useful for monitoring and analytics
 */
export const getInvitationStats = async () => {
  try {
    const stats = await db.execute(`
      SELECT 
        status,
        COUNT(*) as count,
        COUNT(CASE WHEN expires_at < NOW() THEN 1 END) as expired_count
      FROM pending_invitations 
      GROUP BY status
    `);

    return stats.rows;
  } catch (error) {
    console.error('Error getting invitation stats:', error);
    throw error;
  }
};

/**
 * Delete old expired invitations (older than 30 days)
 * This helps keep the database clean
 */
export const deleteOldExpiredInvitations = async (daysOld = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await db
      .delete(pendingInvitations)
      .where(
        and(
          eq(pendingInvitations.status, 'expired'),
          lt(pendingInvitations.updatedAt, cutoffDate)
        )
      )
      .returning({ id: pendingInvitations.id });

    console.log(`Deleted ${result.length} old expired invitations`);
    return result.length;
  } catch (error) {
    console.error('Error deleting old expired invitations:', error);
    throw error;
  }
};
