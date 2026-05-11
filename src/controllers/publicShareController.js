import {
  getPublicCollectionService,
  getPublicExternalLinkService,
} from '../services/publicShareService.js';

export const publicShareController = {
  /**
   * Get public collection data by ID
   * No authentication required - public endpoint
   */
  async getPublicCollection(req, res) {
    try {
      const { collectionId } = req.params;

      if (!collectionId) {
        return res.status(400).json({
          error: 'Collection ID is required',
          message: 'Please provide a valid collection ID',
        });
      }

      const collection = await getPublicCollectionService(collectionId);

      if (!collection) {
        return res.status(404).json({
          error: 'Collection not found',
          message:
            'The requested collection either does not exist or is not publicly shared',
        });
      }

      // Add metadata about the response
      const response = {
        ...collection,
        _metadata: {
          type: 'public_collection',
          generatedAt: new Date().toISOString(),
          itemCount: collection.externalLinks?.length || 0,
          disclaimer:
            'This is a shared collection. Only public and unlisted items are included.',
        },
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching public collection:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred while fetching the collection',
      });
    }
  },

  /**
   * Get public external link data by ID
   * No authentication required - public endpoint
   */
  async getPublicExternalLink(req, res) {
    try {
      const { externalLinkId } = req.params;

      if (!externalLinkId) {
        return res.status(400).json({
          error: 'External link ID is required',
          message: 'Please provide a valid external link ID',
        });
      }

      const externalLink = await getPublicExternalLinkService(externalLinkId);

      if (!externalLink) {
        return res.status(404).json({
          error: 'External link not found',
          message:
            'The requested external link either does not exist or is not publicly shared',
        });
      }

      // Add metadata about the response
      const response = {
        ...externalLink,
        _metadata: {
          type: 'public_external_link',
          generatedAt: new Date().toISOString(),
          attachmentCount: externalLink.attachments?.length || 0,
          notationCount: externalLink.notations?.length || 0,
          linkGroupCount: externalLink.linkGroups?.length || 0,
          resourceCount: externalLink.resources?.length || 0,
          socialMediaAccountCount: externalLink.socialMediaAccounts?.length || 0,
          disclaimer:
            'This is a shared external link. Only public and unlisted items are included.',
        },
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching public external link:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred while fetching the external link',
      });
    }
  },

  /**
   * Health check endpoint for public share API
   */
  async healthCheck(req, res) {
    res.json({
      status: 'ok',
      service: 'public-share-api',
      timestamp: new Date().toISOString(),
      endpoints: [
        {
          path: '/api/public/collection/:collectionId',
          method: 'GET',
          description: 'Get public collection data with external links',
        },
        {
          path: '/api/public/external-link/:externalLinkId',
          method: 'GET',
          description:
            'Get public external link data with attachments, notations, resources, and social media accounts',
        },
      ],
    });
  },
};
