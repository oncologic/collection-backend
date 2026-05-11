import { createOpportunityService } from '../services/opportunityService.js';
import { createOrganizationService } from '../services/organizationService.js';
import { generateStructuredOpportunitiesService } from '../services/aiService.js';
import { getOrganizationsByIdsService } from '../services/organizationService.js';

export const opportunityAIController = {
  // Preview structured opportunities from AI prompt
  previewStructuredOpportunities: async (req, res) => {
    try {
      const { prompt, metadata = {}, organizationId, organizationIds = [] } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds || [];

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          message: 'Prompt is required',
        });
      }

      // Extract metadata
      const { organizations = [], tags = [] } = metadata;

      // Fetch organizations if IDs provided
      let availableOrganizations = organizations;
      if ((organizationId || organizationIds.length > 0) && organizations.length === 0) {
        const orgIds = organizationId ? [organizationId] : organizationIds;
        availableOrganizations = await getOrganizationsByIdsService(orgIds, userId, tenantIds);
      }

      // Generate structured opportunities using AI service
      const structuredResult = await generateStructuredOpportunitiesService(
        prompt,
        availableOrganizations,
        tags,
        userId,
        tenantIds
      );

      // Ensure we have data
      if (!structuredResult.data || structuredResult.data.length === 0) {
        return res.status(400).json({
          message: 'Could not generate opportunity from the provided description',
        });
      }

      // Get the single opportunity (or first if multiple)
      let opportunity = Array.isArray(structuredResult.data)
        ? structuredResult.data[0]
        : structuredResult.data;

      // Process tags - for now, just pass them as tag names
      if (opportunity.tags && Array.isArray(opportunity.tags)) {
        opportunity.tagDetails = opportunity.tags
          .filter(tag => typeof tag === 'string')
          .map(tagName => ({ name: tagName, isNew: true }));
      } else {
        opportunity.tagDetails = [];
      }

      // Set defaults and validate data types
      opportunity = {
        ...opportunity,
        isVolunteer: opportunity.isVolunteer !== false, // Default to true
        isRemote: opportunity.isRemote !== false, // Default to true
        spotsAvailable: opportunity.spotsAvailable || 1,
        estimatedHours: parseInt(opportunity.estimatedHours) || null,
        compensationAmount: parseFloat(opportunity.compensationAmount) || null,
        status: 'active',
        visibility: 'private',
      };

      // Add organization details if provided
      if (organizationId || organizationIds) {
        opportunity.organizationIds = organizationIds || [organizationId].filter(Boolean);
      }

      // Return preview data for frontend confirmation
      return res.json({
        message: 'Preview generated successfully',
        preview: opportunity,
        originalPrompt: prompt,
        metadata,
      });
    } catch (error) {
      console.error('Error previewing structured opportunities:', error);
      return res.status(500).json({
        message: 'Error generating preview',
        error: error.message,
      });
    }
  },

  // Confirm and create the opportunity
  confirmStructuredOpportunities: async (req, res) => {
    try {
      const { opportunity, organizationIds, newOrganizations = [] } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate required fields
      if (!opportunity || !opportunity.title || !opportunity.description) {
        return res.status(400).json({
          message: 'Opportunity with title and description is required',
        });
      }

      // Create any new organizations first
      const createdOrgIds = [];
      if (newOrganizations.length > 0) {
        for (const org of newOrganizations) {
          try {
            const orgData = {
              name: org.name,
              acronym: org.acronym || '',
              description: org.description || '',
              website: org.website || '',
              city: org.city || '',
              state: org.state || '',
              category: org.category || '',
              tenantId: tenantIds[0],
              userId,
            };

            const createdOrg = await createOrganizationService(
              orgData,
              userId,
              tenantIds
            );
            createdOrgIds.push(createdOrg.id);
          } catch (error) {
            console.error('Error creating organization:', error);
          }
        }
      }

      // Prepare opportunity data
      const opportunityData = {
        title: opportunity.title,
        description: opportunity.description,
        requirements: opportunity.requirements || '',
        responsibilities: opportunity.responsibilities || '',
        isVolunteer: opportunity.isVolunteer !== false,
        compensationType: opportunity.compensationType || null,
        compensationAmount: opportunity.compensationAmount || null,
        compensationCurrency: 'USD',
        timeCommitment: opportunity.timeCommitment || '',
        frequency: opportunity.frequency || 'as_needed',
        estimatedHours: opportunity.estimatedHours || null,
        duration: opportunity.duration || '',
        spotsAvailable: opportunity.spotsAvailable || 1,
        isRemote: opportunity.isRemote !== false,
        location: opportunity.location || '',
        applicationDeadline: opportunity.applicationDeadline || null,
        startDate: opportunity.startDate || null,
        endDate: opportunity.endDate || null,
        requiredSkills: opportunity.requiredSkills || [],
        preferredSkills: opportunity.preferredSkills || [],
        status: 'active',
        visibility: opportunity.visibility || 'private',
        organizations: [...(organizationIds || []), ...createdOrgIds],
        tags: [], // TODO: Implement tag creation once tag service is available
        tenantId: tenantIds[0],
      };

      // Create the opportunity
      const createdOpportunity = await createOpportunityService(
        opportunityData,
        userId,
        tenantIds
      );

      return res.json({
        message: 'Opportunity created successfully',
        opportunity: createdOpportunity,
        createdCount: 1,
      });
    } catch (error) {
      console.error('Error creating opportunity:', error);
      return res.status(500).json({
        message: 'Error creating opportunity',
        error: error.message,
      });
    }
  },
};