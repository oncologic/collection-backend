import { sharedLinkService } from '../services/sharedLinksService.js';

export const sharedLinkController = {
  // Create a new shared link
  createSharedLink: async (req, res) => {
    try {
      const { type, id, expiryDays, emailList, description } = req.body;
      const tenantIds = req.tenantIds;
      const userId = req.auth.dbUserId;

      // Validate input
      if (!type || !id) {
        return res
          .status(400)
          .json({ error: 'Missing required fields: type and id' });
      }

      // Validate type
      const validTypes = ['collection', 'resource', 'external_link'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
        });
      }

      const sharedLink = await sharedLinkService.createSharedLink(
        userId,
        type,
        id,
        expiryDays,
        emailList,
        description,
        tenantIds
      );

      res.status(201).json(sharedLink);
    } catch (error) {
      console.error('Error in createSharedLink controller:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Validate email access for a shared link
  validateEmailAccess: async (req, res) => {
    try {
      const { linkId } = req.params;
      const { email, token: bodyToken } = req.body;
      const { token: queryToken } = req.query;
      const tokenFromHeader = req.headers['x-shared-token'];
      const finalToken = bodyToken || queryToken || tokenFromHeader;

      if (!linkId || !email) {
        return res
          .status(400)
          .json({ error: 'Missing required parameters: linkId and email' });
      }

      // First try the standard validation
      try {
        const result = await sharedLinkService.validateEmailAccess(
          linkId,
          email,
          finalToken
        );
        return res.status(200).json(result);
      } catch (error) {
        // If standard validation fails and we have a token, try auto-resolution
        if (finalToken && error.message.includes('not found or has expired')) {
          try {
            // Try to validate using the validateAndGetContent method which handles auto-resolution
            const contentResult = await sharedLinkService.validateAndGetContent(
              linkId,
              finalToken,
              email
            );

            // Extract validation info from the content result
            const result = {
              hasAccess:
                contentResult.metadata.accessLevel === 'email_authorized',
              accessLevel: contentResult.metadata.accessLevel,
              resolvedVia:
                contentResult.metadata.resolvedVia || 'auto_resolution',
            };

            if (contentResult.metadata.parentCollection) {
              result.parentCollection = contentResult.metadata.parentCollection;
            }

            return res.status(200).json(result);
          } catch (autoResolveError) {
            // If auto-resolution also fails, throw the original error
            throw error;
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Error in validateEmailAccess controller:', error);

      if (error.message.includes('Email is required')) {
        return res.status(400).json({ error: error.message });
      } else if (error.message.includes('not found or has expired')) {
        return res.status(404).json({ error: error.message });
      } else if (error.message.includes('Access denied')) {
        return res.status(403).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  },

  // Access content via shared link
  accessSharedContent: async (req, res) => {
    try {
      const { linkId } = req.params;
      const { token, email } = req.query;

      if (!linkId || !token) {
        return res
          .status(400)
          .json({ error: 'Missing required parameters: linkId and token' });
      }

      if (!email) {
        return res
          .status(400)
          .json({ error: 'Email is required to access shared content' });
      }

      const result = await sharedLinkService.validateAndGetContent(
        linkId,
        token,
        email
      );

      res.status(200).json(result);
    } catch (error) {
      console.error('Error in accessSharedContent controller:', error);

      // Determine appropriate status code based on error
      if (error.message.includes('Invalid or expired token')) {
        return res.status(401).json({ error: error.message });
      } else if (error.message.includes('Link is invalid')) {
        return res.status(403).json({ error: error.message });
      } else if (error.message.includes('Email is required')) {
        return res.status(400).json({ error: error.message });
      } else if (error.message.includes('Access denied')) {
        return res.status(403).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  },

  // Get all shared links for current user
  getUserSharedLinks: async (req, res) => {
    try {
      const userId = req.auth.dbUserId;

      const sharedLinks = await sharedLinkService.getUserSharedLinks(userId);

      res.status(200).json(sharedLinks);
    } catch (error) {
      console.error('Error in getUserSharedLinks controller:', error);
      res.status(500).json({ error: error.message });
    }
  },

  getSharedLinksByTypeAndId: async (req, res) => {
    try {
      const { type, id } = req.params;
      const userId = req.auth.dbUserId;

      if (!type || !id) {
        return res
          .status(400)
          .json({ error: 'Missing required parameters: type and id' });
      }

      // Validate type
      const validTypes = ['collection', 'resource', 'external_link'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
        });
      }

      const sharedLinks = await sharedLinkService.getSharedLinksByTypeAndId(
        type,
        id,
        userId
      );

      res.status(200).json(sharedLinks);
    } catch (error) {
      console.error('Error in getSharedLinksByTypeAndId controller:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get all link groups for a shared link
  getAllSharedLinkGroups: async (req, res) => {
    try {
      const { linkId } = req.params;
      const { token, email } = req.query;

      if (!linkId || !token) {
        return res
          .status(400)
          .json({ error: 'Missing required parameters: linkId and token' });
      }

      if (!email) {
        return res
          .status(400)
          .json({ error: 'Email is required to access link groups' });
      }

      const linkGroups = await sharedLinkService.getAllSharedLinkGroups(
        linkId,
        token,
        email
      );

      res.status(200).json(linkGroups);
    } catch (error) {
      console.error('Error in getAllSharedLinkGroups controller:', error);

      if (error.message.includes('Invalid or expired token')) {
        return res.status(401).json({ error: error.message });
      } else if (error.message.includes('Link is invalid')) {
        return res.status(403).json({ error: error.message });
      } else if (error.message.includes('Email is required')) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  },

  // Revoke a shared link
  revokeSharedLink: async (req, res) => {
    try {
      const { linkId } = req.params;
      const userId = req.auth.dbUserId;

      if (!linkId) {
        return res
          .status(400)
          .json({ error: 'Missing required parameter: linkId' });
      }

      const revokedLink = await sharedLinkService.revokeSharedLink(
        linkId,
        userId
      );

      res.status(200).json({
        message: 'Shared link revoked successfully',
        linkId: revokedLink.id,
      });
    } catch (error) {
      console.error('Error in revokeSharedLink controller:', error);

      if (error.message.includes('permission')) {
        return res.status(403).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  },

  // Update a shared link
  updateSharedLink: async (req, res) => {
    try {
      const { linkId } = req.params;
      const userId = req.auth.dbUserId;
      const updates = req.body;

      if (!linkId) {
        return res
          .status(400)
          .json({ error: 'Missing required parameter: linkId' });
      }

      const updatedLink = await sharedLinkService.updateSharedLink(
        linkId,
        userId,
        updates
      );

      res.status(200).json(updatedLink);
    } catch (error) {
      console.error('Error in updateSharedLink controller:', error);

      if (error.message.includes('No valid update fields')) {
        return res.status(400).json({ error: error.message });
      } else if (error.message.includes('permission')) {
        return res.status(403).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  },

  // Get shared link by ID
  getSharedLinkById: async (req, res) => {
    try {
      const { linkId } = req.params;

      if (!linkId) {
        return res
          .status(400)
          .json({ error: 'Missing required parameter: linkId' });
      }

      const sharedLink = await sharedLinkService.getSharedLinkById(linkId);

      res.status(200).json(sharedLink);
    } catch (error) {
      console.error('Error in getSharedLinkById controller:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Submit reviewer information for a shared link
  submitReviewerInfo: async (req, res) => {
    try {
      const { linkId } = req.params;
      const { token, email: userEmail } = req.query;
      const { firstName, lastName, email } = req.body;

      if (!linkId || !token || !firstName || !lastName || !email) {
        return res.status(400).json({
          error:
            'Missing required fields: linkId, token, firstName, lastName, and email are required',
        });
      }

      // Validate email access first
      try {
        await sharedLinkService.validateEmailAccess(linkId, userEmail || email);
      } catch (error) {
        return res.status(403).json({
          error: 'Email access validation failed: ' + error.message,
        });
      }

      const reviewer = await sharedLinkService.addReviewer(
        linkId,
        token,
        firstName,
        lastName,
        email
      );

      res.status(200).json(reviewer);
    } catch (error) {
      console.error('Error in submitReviewerInfo controller:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Submit feedback for a specific item in a shared link
  submitItemFeedback: async (req, res) => {
    try {
      const { linkId } = req.params;
      const { token, email } = req.query;
      const { itemId, reviewerId, action, note } = req.body;

      if (!linkId || !token || !itemId || !reviewerId || !action) {
        return res.status(400).json({
          error:
            'Missing required fields: linkId, token, itemId, reviewerId, and action are required',
        });
      }

      if (!email) {
        return res.status(400).json({
          error: 'Email is required to submit feedback',
        });
      }

      // Validate email access
      try {
        await sharedLinkService.validateEmailAccess(linkId, email);
      } catch (error) {
        return res.status(403).json({
          error: 'Email access validation failed: ' + error.message,
        });
      }

      const result = await sharedLinkService.addFeedback(
        linkId,
        itemId,
        reviewerId,
        action,
        note
      );

      res.status(200).json(result);
    } catch (error) {
      console.error('Error in submitItemFeedback controller:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Submit a complete review for a shared link
  submitReview: async (req, res) => {
    try {
      const { linkId } = req.params;
      const { token, reviewerId, feedbackData, email } = req.body;

      if (!linkId || !token || !reviewerId || !feedbackData) {
        return res.status(400).json({
          error:
            'Missing required fields: linkId, token, reviewerId, and feedbackData are required',
        });
      }

      if (!email) {
        return res.status(400).json({
          error: 'Email is required to submit review',
        });
      }

      // Validate email access
      try {
        await sharedLinkService.validateEmailAccess(linkId, email);
      } catch (error) {
        return res.status(403).json({
          error: 'Email access validation failed: ' + error.message,
        });
      }

      const result = await sharedLinkService.submitReview(
        linkId,
        reviewerId,
        feedbackData
      );

      res.status(200).json(result);
    } catch (error) {
      console.error('Error in submitReview controller:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get review data for a shared link
  getReviewData: async (req, res) => {
    try {
      const { linkId, id = null } = req.params;
      const { token, email } = req.query;

      if (!linkId || !token) {
        return res.status(400).json({
          error: 'Missing required fields: linkId and token are required',
        });
      }

      if (!email) {
        return res.status(400).json({
          error: 'Email is required to access review data',
        });
      }

      // Add additional validation to ensure linkId is a valid UUID
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(linkId)) {
        return res.status(400).json({
          error: 'Invalid linkId format. Must be a valid UUID',
        });
      }

      // Validate email access
      try {
        await sharedLinkService.validateEmailAccess(linkId, email);
      } catch (error) {
        return res.status(403).json({
          error: 'Email access validation failed: ' + error.message,
        });
      }

      const reviewData = await sharedLinkService.getReviewStatus(linkId, token);

      // Check if reviewData is null or undefined and provide a fallback
      if (!reviewData) {
        return res.status(404).json({
          error: 'No review data found for the provided link and token',
        });
      }

      res.status(200).json(reviewData);
    } catch (error) {
      console.error('Error in getReviewData controller:', error);

      // Add specific error handling for common issues
      if (error.message.includes('Invalid or expired token')) {
        return res.status(401).json({ error: error.message });
      } else if (error.message.includes('Link is invalid')) {
        return res.status(403).json({ error: error.message });
      } else if (error.message.includes('Cannot convert undefined or null')) {
        return res.status(404).json({
          error: 'Review data not found or is in an invalid format',
        });
      }

      res.status(500).json({ error: error.message });
    }
  },
};
