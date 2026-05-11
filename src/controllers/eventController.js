import {
  createEventService,
  deleteEventService,
  getAllEvents,
  getAllEventsPaginated,
  getEventById,
  updateEventService,
  getEventsByOrganizationIdService,
  getEventsBySubscriptionsService,
  searchEventsService,
} from '../services/eventService.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { uploadToS3, constructS3Url } from '../utils/s3Utils.js';
import {
  isUserAdvocateInTenant,
  canEditOrDeleteItem,
} from '../utils/authHelpers.js';

export const eventController = {
  async createEvent(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const eventData = { ...req.body };

      // Handle tenantId assignment
      const requestedTenantId = eventData.tenantId;
      const authorizedTenantIds = tenantIds || [];

      // Validate that the requested tenant is authorized
      if (requestedTenantId) {
        if (!authorizedTenantIds.includes(requestedTenantId)) {
          return res.status(403).json({
            error:
              'You are not authorized to create events in the requested tenant',
          });
        }
        eventData.tenantId = requestedTenantId;
      } else if (authorizedTenantIds.length > 0) {
        // Default to first authorized tenant if no specific tenant requested
        eventData.tenantId = authorizedTenantIds[0];
      } else {
        return res.status(400).json({
          error: 'No tenant specified and no authorized tenants found',
        });
      }

      // Check if user is trying to create event in kidney tenant
      const KIDNEY_TENANT_ID = process.env.KIDNEY_TENANT_ID;
      if (
        eventData.tenantId === KIDNEY_TENANT_ID &&
        !isUserAdvocateInTenant(req, KIDNEY_TENANT_ID)
      ) {
        return res.status(403).json({
          error:
            'Only administrators or advocates can create events in the kidney cancer tenant',
        });
      }

      // Validate visibility permissions
      // Admins, advocates, or users in personal tenant can make events public
      const COMMUNITY_TENANT_ID = process.env.COMMUNITY_TENANT;
      if (eventData.visibility === 'public') {
        const isAdvocateInTenant = isUserAdvocateInTenant(
          req,
          eventData.tenantId
        );
        if (
          !req.auth.isAdmin &&
          !isAdvocateInTenant &&
          eventData.tenantId !== COMMUNITY_TENANT_ID
        ) {
          return res.status(403).json({
            error:
              'Only administrators, advocates, or users in the personal tenant can make events public',
          });
        }
      }

      const event = await createEventService(
        eventData,
        req.auth.dbUserId,
        tenantIds
      );

      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(500).json({ error: 'Failed to create event' });
    }
  },

  async bulkCreateEvents(req, res) {
    try {
      const { events } = req.body;
      const tenantIds = req.tenantIds;
      const userId = req.auth.dbUserId;

      if (!events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'Events array is required' });
      }

      if (events.length > 100) {
        return res
          .status(400)
          .json({ error: 'Maximum 100 events can be imported at once' });
      }

      const results = {
        successful: 0,
        failed: 0,
        errors: [],
        created: [],
      };

      // Process events sequentially to avoid overwhelming the database
      for (let i = 0; i < events.length; i++) {
        try {
          const eventData = {
            ...events[i],
            addedByUserId: userId,
          };

          // Handle tenantId assignment for bulk import
          const requestedTenantId = eventData.tenantId;
          const authorizedTenantIds = tenantIds || [];

          // Validate that the requested tenant is authorized
          if (requestedTenantId) {
            if (!authorizedTenantIds.includes(requestedTenantId)) {
              throw new Error(
                'Not authorized to create events in the requested tenant'
              );
            }
            eventData.tenantId = requestedTenantId;
          } else if (authorizedTenantIds.length > 0) {
            // Default to first authorized tenant if no specific tenant requested
            eventData.tenantId = authorizedTenantIds[0];
          } else {
            throw new Error(
              'No tenant specified and no authorized tenants found'
            );
          }

          // Check if user is trying to create event in kidney tenant
          const KIDNEY_TENANT_ID = process.env.KIDNEY_TENANT_ID;
          if (
            eventData.tenantId === KIDNEY_TENANT_ID &&
            !isUserAdvocateInTenant(req, KIDNEY_TENANT_ID)
          ) {
            throw new Error(
              'Only administrators or advocates can create events in the kidney cancer tenant'
            );
          }

          // Validate visibility permissions
          const COMMUNITY_TENANT_ID = process.env.COMMUNITY_TENANT;
          if (eventData.visibility === 'public') {
            const isAdvocateInTenant = isUserAdvocateInTenant(
              req,
              eventData.tenantId
            );
            if (
              !req.auth.isAdmin &&
              !isAdvocateInTenant &&
              eventData.tenantId !== COMMUNITY_TENANT_ID
            ) {
              throw new Error(
                'Only administrators, advocates, or users in the personal tenant can make events public'
              );
            }
          }

          const createdEvent = await createEventService(
            eventData,
            userId,
            tenantIds
          );

          results.successful++;
          results.created.push(createdEvent);
        } catch (error) {
          results.failed++;
          results.errors.push({
            row: i + 1,
            error: error.message || 'Unknown error',
            event: events[i],
          });
        }
      }

      res.status(200).json({
        message: `Bulk import completed. Successfully created ${results.successful} events.`,
        results,
      });
    } catch (error) {
      console.error('Error in bulk event creation:', error);
      res.status(500).json({ error: 'Failed to process bulk event import' });
    }
  },

  async deleteEvent(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const eventId = req.params.id;
      const tenantIds = req.tenantIds;

      // First get the event to check ownership
      const event = await getEventById(eventId, userId, tenantIds);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Check if user can delete this event
      if (!canEditOrDeleteItem(req, event)) {
        return res.status(403).json({
          error: 'You are not authorized to delete this event',
        });
      }

      const deletedEvent = await deleteEventService(eventId);
      res.status(200).json(deletedEvent);
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  },

  async updateEvent(req, res) {
    try {
      let imageKey = null;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      // If there's a file in the request, upload it to S3
      if (req.file) {
        imageKey = await uploadToS3(req.file);
      }

      // Get current event to check organizations
      const currentEvent = await getEventById(req.params.id, userId, tenantIds);
      if (!currentEvent) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Check if user can update this event
      if (!canEditOrDeleteItem(req, currentEvent)) {
        return res.status(403).json({
          error: 'You are not authorized to update this event',
        });
      }

      // Get current organization IDs
      const currentOrgIds = currentEvent.organizations.map((org) => org.id);

      // Get new organization IDs from request and ensure it's not null
      const newOrgIds = (req.body.organizations || []).map((org) =>
        typeof org === 'object' ? org.id : org
      );

      if (!Array.isArray(newOrgIds)) {
        return res
          .status(400)
          .json({ error: 'Organizations must be provided as an array' });
      }

      // Find organizations to remove (present in current but not in new)
      const orgsToRemove = currentOrgIds.filter(
        (id) => id && !newOrgIds.includes(id)
      );

      const orgsToAdd = newOrgIds.filter(
        (id) => id && !currentOrgIds.includes(id)
      );

      // Add the image key to the event data if a new image was uploaded
      const eventData = {
        ...req.body,
        ...(imageKey && { imageKey }),
        organizationsToRemove: orgsToRemove.filter(Boolean),
        orgsToAdd: orgsToAdd.filter(Boolean),
      };

      const event = await updateEventService(req.params.id, eventData);

      // Return the event without logoUrl (events don't have logos)
      const responseData = {
        ...event,
      };

      res.status(200).json(responseData);
    } catch (error) {
      console.error('Error updating event:', error);
      res.status(500).json({ error: 'Failed to update event' });
    }
  },

  async getAllEvents(req, res) {
    try {
      let tenantIds = req.tenantIds;
      const isPublicAccess = req.auth.isPublicAccess;

      // For public access, filter to only tenants that allow public events
      if (isPublicAccess) {
        const publicEventTenants = req.auth.publicTenantsWithEvents || [];

        if (publicEventTenants.length === 0) {
          return res.status(403).json({
            error:
              'Public access to events is not available for the requested tenants. Please sign in to access events.',
          });
        }

        tenantIds = publicEventTenants;
      }

      const events = await getAllEvents(
        isPublicAccess ? null : req.auth.dbUserId,
        null,
        tenantIds
      );

      if (events.length === 0) {
        return res.status(200).json(events);
      }

      // Add logo URLs to each event's organizations
      const eventsWithUrls = events.map((event) => ({
        ...event,
        organizations: event.organizations.map((organization) => ({
          ...organization,
          imageUrl: organization.imageKey
            ? generatePresignedCloudFrontUrl(organization.imageKey)
            : organization.imageUrl || null,
        })),
        // Remove logoUrl as events don't have logos, only organizations do
      }));

      res.status(200).json(eventsWithUrls);
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  },

  async getAllEventsPaginated(req, res) {
    try {
      let tenantIds = req.tenantIds;
      const isPublicAccess = req.auth.isPublicAccess;

      // For public access, filter to only tenants that allow public events
      if (isPublicAccess) {
        const publicEventTenants = req.auth.publicTenantsWithEvents || [];

        if (publicEventTenants.length === 0) {
          return res.status(403).json({
            error:
              'Public access to events is not available for the requested tenants. Please sign in to access events.',
          });
        }

        tenantIds = publicEventTenants;
      }

      // Extract pagination and filter parameters from query
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const sortBy = req.query.sortBy || 'startDate';
      const sortOrder = req.query.sortOrder || 'desc';
      const filterDate = req.query.filterDate || null;
      const filterStartDate = req.query.filterStartDate || null;
      const filterEndDate = req.query.filterEndDate || null;

      // Validate parameters
      if (page < 1 || limit < 1 || limit > 100) {
        return res.status(400).json({ error: 'Invalid pagination parameters' });
      }

      const result = await getAllEventsPaginated(
        isPublicAccess ? null : req.auth.dbUserId,
        tenantIds,
        {
          page,
          limit,
          sortBy,
          sortOrder,
          filterDate,
          filterStartDate,
          filterEndDate,
        }
      );

      if (result.data.length === 0) {
        return res.status(200).json(result);
      }

      // Add logo URLs to each event's organizations
      const eventsWithUrls = result.data.map((event) => ({
        ...event,
        organizations: event.organizations.map((organization) => ({
          ...organization,
          imageUrl: organization.imageKey
            ? generatePresignedCloudFrontUrl(organization.imageKey)
            : organization.imageUrl || null,
        })),
        // Remove logoUrl as events don't have logos, only organizations do
      }));

      res.status(200).json({
        ...result,
        data: eventsWithUrls,
      });
    } catch (error) {
      console.error('Error fetching paginated events:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  },

  async getEventById(req, res) {
    try {
      let tenantIds = req.tenantIds;
      const isPublicAccess = req.auth.isPublicAccess;

      // For public access, filter to only tenants that allow public events
      if (isPublicAccess) {
        const publicEventTenants = req.auth.publicTenantsWithEvents || [];

        if (publicEventTenants.length === 0) {
          return res.status(403).json({
            error:
              'Public access to events is not available for the requested tenants. Please sign in to access events.',
          });
        }

        tenantIds = publicEventTenants;
      }

      const event = await getEventById(
        req.params.id,
        isPublicAccess ? null : req.auth.dbUserId,
        tenantIds
      );
      if (!event) {
        return res.status(403).json({ error: 'Event not found' });
      }

      // For public access, verify the event belongs to a tenant that allows public events
      if (isPublicAccess) {
        const publicEventTenants = req.auth.publicTenantsWithEvents || [];
        if (!publicEventTenants.includes(event.tenantId)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Return the event without logoUrl (events don't have logos)
      const eventWithUrl = {
        ...event,
      };

      res.status(200).json(eventWithUrl);
    } catch (error) {
      console.error('Error fetching event:', error);
      res.status(500).json({ error: 'Failed to fetch event' });
    }
  },
  async getEventsByOrganizationId(req, res) {
    try {
      const events = await getEventsByOrganizationIdService(
        req.params.id,
        req.auth.dbUserId,
        req.tenantIds
      );

      res.status(200).json(events);
    } catch (error) {
      console.error('Error fetching events by organization ID:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  },
  async getEventsBySubscriptions(req, res) {
    try {
      const events = await getEventsBySubscriptionsService(
        req.auth.dbUserId,
        req.tenantIds
      );

      res.status(200).json(events);
    } catch (error) {
      console.error('Error fetching events by subscriptions:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  },

  async searchEvents(req, res) {
    try {
      let tenantIds = req.tenantIds;
      const isPublicAccess = req.auth.isPublicAccess;

      // For public access, filter to only tenants that allow public events
      if (isPublicAccess) {
        const publicEventTenants = req.auth.publicTenantsWithEvents || [];

        if (publicEventTenants.length === 0) {
          return res.status(403).json({
            error:
              'Public access to events is not available for the requested tenants. Please sign in to access events.',
          });
        }

        tenantIds = publicEventTenants;
      }

      const { query: searchQuery, limit = 50, includeAll = false } = req.query;

      if (!searchQuery || searchQuery.trim().length === 0) {
        return res.status(400).json({ error: 'Search query is required' });
      }

      const result = await searchEventsService(
        isPublicAccess ? null : req.auth.dbUserId,
        tenantIds,
        {
          searchQuery: searchQuery.trim(),
          limit: parseInt(limit),
          includeAll: includeAll === 'true',
        }
      );

      // Add logo URLs to each event
      const eventsWithUrls = result.map((event) => ({
        ...event,
        organizations: event.organizations.map((organization) => ({
          ...organization,
          imageUrl: organization.imageKey
            ? generatePresignedCloudFrontUrl(organization.imageKey)
            : organization.imageUrl || null,
        })),
        // Remove logoUrl as events don't have logos, only organizations do
      }));

      res.status(200).json(eventsWithUrls);
    } catch (error) {
      console.error('Error searching events:', error);
      res.status(500).json({ error: 'Failed to search events' });
    }
  },
};

export const withComputedFieldsEvent = (event) => {
  if (event.imageKey) {
    event.imageUrl = constructS3Url(event.imageKey);
  }
  return event;
};
