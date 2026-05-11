import {
  createOpportunityService,
  updateOpportunityService,
  getOpportunitiesService,
  getOpportunityByIdService,
  applyToOpportunityService,
  reviewApplicationService,
  deleteApplicationService,
  saveOpportunityService,
  unsaveOpportunityService,
  getUserApplicationsService,
  getOpportunityApplicationsService,
  sendOpportunityMessageService,
  getOpportunityMessagesService,
} from '../services/opportunityService.js';
// TODO: Add vector embedding support for opportunities
// import { autoUpdateOpportunityEmbedding } from '../services/vectorService.js';
import { isUserAdvocateInTenant } from '../utils/authHelpers.js';

export const opportunityController = {
  // Create a new opportunity
  async createOpportunity(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds || [];

      // Check if user is an advocate or admin (required to create opportunities)
      const isAdvocate = await isUserAdvocateInTenant(userId, tenantIds);
      if (!isAdvocate && !req.auth.isAdmin) {
        return res.status(403).json({
          error: 'Only advocates and administrators can create opportunities',
        });
      }

      const opportunityData = req.body;

      // Validate required fields
      if (!opportunityData.title || !opportunityData.description) {
        return res.status(400).json({
          error: 'Title and description are required',
        });
      }

      // Handle tenantId assignment
      const requestedTenantId = opportunityData.tenantId;
      if (requestedTenantId) {
        if (!tenantIds.includes(requestedTenantId)) {
          return res.status(403).json({
            error: 'You are not authorized to create opportunities in the requested tenant',
          });
        }
        opportunityData.tenantId = requestedTenantId;
      } else if (tenantIds.length > 0) {
        opportunityData.tenantId = tenantIds[0];
      }

      const opportunity = await createOpportunityService(
        opportunityData,
        userId,
        tenantIds
      );

      // TODO: Update embeddings for search when vector support is added
      // if (opportunity.id) {
      //   autoUpdateOpportunityEmbedding(opportunity.id, tenantIds).catch((err) =>
      //     console.error('Failed to update opportunity embeddings:', err)
      //   );
      // }

      res.status(201).json(opportunity);
    } catch (error) {
      console.error('Error creating opportunity:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Update an opportunity
  async updateOpportunity(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth.dbUserId;
      const updateData = req.body;

      const updated = await updateOpportunityService(id, updateData, userId, req);

      // TODO: Update embeddings when vector support is added
      // if (updated.id) {
      //   autoUpdateOpportunityEmbedding(updated.id, req.tenantIds).catch((err) =>
      //     console.error('Failed to update opportunity embeddings:', err)
      //   );
      // }

      res.json(updated);
    } catch (error) {
      console.error('Error updating opportunity:', error);
      if (error.message === 'Unauthorized to update this opportunity') {
        res.status(403).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  },

  // Get opportunities with filters
  async getOpportunities(req, res) {
    try {
      const userId = req.auth?.dbUserId || null;
      const tenantIds = req.tenantIds || [];
      const filters = {
        isVolunteer: req.query.isVolunteer === 'true' ? true : req.query.isVolunteer === 'false' ? false : undefined,
        isRemote: req.query.isRemote === 'true' ? true : req.query.isRemote === 'false' ? false : undefined,
        frequency: req.query.frequency,
        organizationId: req.query.organizationId,
        availableOnly: req.query.availableOnly === 'true',
        showPast: req.query.showPast === 'true',
        sortBy: req.query.sortBy || 'newest',
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
      };

      const opportunities = await getOpportunitiesService(filters, userId, tenantIds);
      res.json(opportunities);
    } catch (error) {
      console.error('Error getting opportunities:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get a single opportunity by ID
  async getOpportunityById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth?.dbUserId || null;
      const tenantIds = req.tenantIds || [];

      const opportunity = await getOpportunityByIdService(id, userId, tenantIds);
      
      if (!opportunity) {
        return res.status(404).json({ error: 'Opportunity not found' });
      }

      res.json(opportunity);
    } catch (error) {
      console.error('Error getting opportunity by ID:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Apply to an opportunity
  async applyToOpportunity(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth?.dbUserId || null;
      const applicationData = req.body;

      // If no userId, require email-based application
      if (!userId) {
        if (!applicationData.applicantEmail) {
          return res.status(400).json({ 
            error: 'Either authentication is required, or applicant email must be provided' 
          });
        }
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(applicationData.applicantEmail)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
      }

      const application = await applyToOpportunityService(id, applicationData, userId);
      res.status(201).json(application);
    } catch (error) {
      console.error('Error applying to opportunity:', error);
      if (error.message.includes('already applied')) {
        res.status(400).json({ error: error.message });
      } else if (error.message.includes('No spots available')) {
        res.status(400).json({ error: error.message });
      } else if (error.message.includes('required')) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  },

  // Review an application (for advocates/admins/creators)
  async reviewApplication(req, res) {
    try {
      const { applicationId } = req.params;
      const reviewerId = req.auth.dbUserId;
      const reviewData = req.body;

      if (!['approved', 'rejected', 'reviewing'].includes(reviewData.status)) {
        return res.status(400).json({
          error: 'Invalid status. Must be approved, rejected, or reviewing',
        });
      }

      const updated = await reviewApplicationService(applicationId, reviewData, reviewerId, req);
      res.json(updated);
    } catch (error) {
      console.error('Error reviewing application:', error);
      if (error.message === 'Unauthorized to review this application') {
        res.status(403).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  },

  // Delete an application
  async deleteApplication(req, res) {
    try {
      const { applicationId } = req.params;
      const userId = req.auth.dbUserId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      await deleteApplicationService(applicationId, userId, req);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting application:', error);
      if (error.message === 'Unauthorized to delete this application') {
        res.status(403).json({ error: error.message });
      } else if (error.message === 'Application not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  },

  // Save/bookmark an opportunity
  async saveOpportunity(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth.dbUserId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await saveOpportunityService(id, userId);
      res.json(result);
    } catch (error) {
      console.error('Error saving opportunity:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Unsave an opportunity
  async unsaveOpportunity(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth.dbUserId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await unsaveOpportunityService(id, userId);
      res.json(result);
    } catch (error) {
      console.error('Error unsaving opportunity:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get user's applications
  async getUserApplications(req, res) {
    try {
      const userId = req.auth.dbUserId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const applications = await getUserApplicationsService(userId);
      res.json(applications);
    } catch (error) {
      console.error('Error getting user applications:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Send a message about an opportunity
  async sendMessage(req, res) {
    try {
      const senderId = req.auth.dbUserId;
      const messageData = req.body;

      if (!senderId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!messageData.message || !messageData.recipientId || !messageData.opportunityId) {
        return res.status(400).json({
          error: 'Message, recipientId, and opportunityId are required',
        });
      }

      const message = await sendOpportunityMessageService(messageData, senderId);
      res.status(201).json(message);
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get messages for an opportunity or application
  async getMessages(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const filters = {
        opportunityId: req.query.opportunityId,
        applicationId: req.query.applicationId,
      };

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!filters.opportunityId && !filters.applicationId) {
        return res.status(400).json({
          error: 'Either opportunityId or applicationId is required',
        });
      }

      const messages = await getOpportunityMessagesService(filters, userId);
      res.json(messages);
    } catch (error) {
      console.error('Error getting messages:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get opportunity applications (for opportunity creators)
  async getOpportunityApplications(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth?.dbUserId;
      const tenantIds = req.tenantIds || req.auth?.tenantIds || [];

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const applications = await getOpportunityApplicationsService(id, userId, tenantIds, req);
      res.json(applications);
    } catch (error) {
      console.error('Error getting opportunity applications:', error);
      res.status(500).json({ error: error.message });
    }
  },
};