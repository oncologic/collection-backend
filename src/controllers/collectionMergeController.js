import { mergeCollectionsService } from '../services/mergeCollectionsService.js';

/**
 * Controller to handle collection merge requests
 */
export const mergeCollections = async (req, res) => {
  try {
    const { sourceCollectionId, targetCollectionId, mergeOptions } = req.body;
    const userId = req.auth?.dbUserId;

    // Validate user authentication
    if (!userId) {
      return res.status(401).json({
        error: 'User authentication required',
      });
    }

    // Validate required fields
    if (!sourceCollectionId || !targetCollectionId) {
      return res.status(400).json({
        error: 'Both sourceCollectionId and targetCollectionId are required',
      });
    }

    // Validate UUIDs
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !uuidRegex.test(sourceCollectionId) ||
      !uuidRegex.test(targetCollectionId)
    ) {
      return res.status(400).json({
        error: 'Invalid collection ID format',
      });
    }

    // Validate merge options
    const validatedMergeOptions = {
      keepSourceCollection: mergeOptions?.keepSourceCollection === true,
      conflictResolution: ['target', 'source'].includes(
        mergeOptions?.conflictResolution
      )
        ? mergeOptions.conflictResolution
        : 'target',
    };

    // Call the merge service
    const result = await mergeCollectionsService({
      sourceCollectionId,
      targetCollectionId,
      mergeOptions: validatedMergeOptions,
      user: { id: userId },
    });

    res.status(200).json({
      message: 'Collections merged successfully',
      ...result,
    });
  } catch (error) {
    console.error('Error merging collections:', error);

    if (error.message.includes('not found or access denied')) {
      return res.status(404).json({
        error: 'One or both collections not found or you do not have access',
      });
    }

    if (error.message.includes('Cannot merge a collection with itself')) {
      return res.status(400).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to merge collections',
      details: error.message,
    });
  }
};
