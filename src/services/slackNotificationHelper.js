import { sendNewExternalLinkNotification, sendNewNotationNotification } from './slackService.js';

/**
 * Helper function to trigger Slack notification for new external link
 * This is called from collectionService after successfully adding an external link
 */
export async function triggerNewExternalLinkNotification(collectionId, externalLinkData, userId) {
  try {
    // Run notification in background - don't await
    sendNewExternalLinkNotification(collectionId, externalLinkData, userId)
      .then(result => {
        if (result.success) {
          console.log(`Slack notification sent for external link ${externalLinkData.id}`);
        }
      })
      .catch(error => {
        console.error('Failed to send Slack notification for external link:', error);
      });
  } catch (error) {
    // Don't throw - this shouldn't break the main flow
    console.error('Error triggering Slack notification:', error);
  }
}

/**
 * Helper function to trigger Slack notification for new notation
 * This is called from notation service after successfully adding a notation
 */
export async function triggerNewNotationNotification(notationData, collectionExternalLinkId, userId) {
  try {
    // Run notification in background - don't await
    sendNewNotationNotification(notationData, collectionExternalLinkId, userId, false)
      .then(result => {
        if (result.success) {
          console.log(`Slack notification sent for notation ${notationData.id}`);
        }
      })
      .catch(error => {
        console.error('Failed to send Slack notification for notation:', error);
      });
  } catch (error) {
    // Don't throw - this shouldn't break the main flow
    console.error('Error triggering Slack notification:', error);
  }
}

/**
 * Helper function to trigger Slack notification for notation update
 * This is called from collection service after successfully updating a notation
 */
export async function triggerNotationUpdateNotification(notationData, collectionExternalLinkId, userId) {
  try {
    // Run notification in background - don't await
    sendNewNotationNotification(notationData, collectionExternalLinkId, userId, true)
      .then(result => {
        if (result.success) {
          console.log(`Slack update notification sent for notation ${notationData.id}`);
        }
      })
      .catch(error => {
        console.error('Failed to send Slack update notification for notation:', error);
      });
  } catch (error) {
    // Don't throw - this shouldn't break the main flow
    console.error('Error triggering Slack update notification:', error);
  }
}