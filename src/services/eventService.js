import { db } from '../db/index.js';
import { events } from '../models/events.js';
import { tags } from '../models/tags.js';
import { eventTags } from '../models/events.js';
import { eq, and, inArray, or, ilike } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { organizationEvents } from '../models/organizations.js';
import {
  eventTypes,
  expertiseLevels,
  resourceTypes,
  sensitivityLevels,
} from '../models/metadata.js';
import { organizationMembers } from '../models/organizations.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';

// Helper to build community tenant visibility condition for events
// Community tenant events are ONLY visible to their creator
const buildEventVisibilityCondition = (dbUserId) => {
  const communityTenantId = process.env.COMMUNITY_TENANT;

  if (!dbUserId) {
    // Public/unauthenticated access: only show public events from non-community tenants
    return sql`(
      ${events.tenantId} != ${communityTenantId}::uuid 
      AND ${events.visibility} = 'public'
    )`;
  }

  // Authenticated access: show events where either:
  // 1. Event is NOT in community tenant AND (is public OR owned by user)
  // 2. Event IS in community tenant AND owned by user
  return sql`(
    CASE 
      WHEN ${events.tenantId} = ${communityTenantId}::uuid THEN ${events.addedByUserId} = ${dbUserId}
      ELSE (${events.visibility} = 'public' OR ${events.addedByUserId} = ${dbUserId})
    END
  )`;
};

const getEventsWithRelations = (qb, dbUserId, tenants) => {
  // Define condition: if dbUserId is provided, add the user_id check,
  // otherwise, only enforce that the collection visibility is public.
  const collectionsCondition = dbUserId
    ? sql`AND (c.visibility = 'public' OR c.user_id = ${dbUserId})`
    : sql`AND c.visibility = 'public'`;

  // Define condition for external links
  const externalLinksCondition = dbUserId
    ? sql`WHERE cel.event_id = ${events.id} AND (cel.user_id = ${dbUserId})`
    : sql`WHERE cel.event_id = ${events.id}`;

  return qb
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      startDate: events.startDate,
      endDate: events.endDate,
      virtualEvent: events.virtualEvent,
      inPersonEvent: events.inPersonEvent,
      visibility: events.visibility,
      locationName: events.locationName,
      locationAddress: events.locationAddress,
      locationCity: events.locationCity,
      locationState: events.locationState,
      locationPostal: events.locationPostal,
      locationCountry: events.locationCountry,
      url: events.registrationLink,
      expertiseLevelId: events.expertiseLevelId,
      createdAt: events.createdAt,
      updatedAt: events.updatedAt,
      typeId: events.typeId,
      eventType: eventTypes.name,
      expertiseLevel: expertiseLevels.name,
      tenantId: events.tenantId,
      timezone: events.timezone,
      addedByUserId: events.addedByUserId,
      hasSponsorship: events.hasSponsorship,
      professional: events.professional,
      isGoogleCalendarEvent: events.isGoogleCalendarEvent,
      googleCalendarSync: sql`
        COALESCE(
          (
            SELECT jsonb_build_object(
              'googleEventId', gce.google_event_id,
              'googleCalendarId', gce.google_calendar_id,
              'syncStatus', gce.sync_status,
              'syncDirection', gce.sync_direction,
              'lastSyncedAt', gce.last_synced_at
            )
            FROM google_calendar_events gce
            WHERE gce.entity_type = 'event' AND gce.entity_id = ${events.id}
            LIMIT 1
          ),
          NULL
        )
      `.as('googleCalendarSync'),
      organizations: sql`
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'name', o.name,
                'imageUrl', o.image_url,
                'imageKey', o.image_key,
                'primary', oe.primary
              )
            )
            FROM organization_events oe
            JOIN organizations o ON o.id = oe.organization_id
            WHERE oe.event_id = ${events.id}
              AND o.tenant_id = ANY(ARRAY[${sql.join(tenants, sql`, `)}]::uuid[])
          ),
          '[]'::jsonb
        )
      `.as('organizations'),
      collections: sql`
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'name', c.name
              )
            )
            FROM collections c
            WHERE c.event_id = ${events.id}
            ${collectionsCondition}
          ),
          '[]'::jsonb
        )
      `.as('collections'),
      externalLinks: sql`
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', el.id,
                'name', el.name,
                'status', cel.status,
                'eventId', cel.event_id
              )
            )
            FROM collection_external_links cel
            INNER JOIN external_links el ON el.id = cel.external_link_id
            ${externalLinksCondition}
          ),
          '[]'::jsonb
        )
      `.as('externalLinks'),
    })
    .from(events)
    .innerJoin(eventTypes, eq(events.typeId, eventTypes.id))
    .leftJoin(expertiseLevels, eq(events.expertiseLevelId, expertiseLevels.id))
    .where(buildEventVisibilityCondition(dbUserId));
};

export async function createEventService(data, dbUserId, tenantIds) {
  try {
    // Clean and validate the data
    const cleanData = {
      ...data,
      addedByUserId: dbUserId,
      expertiseLevelId: data.expertiseLevelId || null,
      typeId: data.typeId || data.eventTypeId || null,
    };

    // Convert timestamp fields to explicit SQL timestamps with timezone
    const eventData = {
      ...cleanData,
      startDate: cleanData.startTime
        ? sql`${cleanData.startTime}::timestamptz`
        : null,
      endDate: cleanData.endTime
        ? sql`${cleanData.endTime}::timestamptz`
        : null,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    };

    return await db.transaction(async (tx) => {
      const [event] = await tx.insert(events).values(eventData).returning();

      // Handle tags
      if (data.tags) {
        await Promise.all(
          data.tags.map((tag) =>
            tx.insert(eventTags).values({
              eventId: event.id,
              tagId: tag,
            })
          )
        );
      }

      // Handle organizations
      if (data.organizations) {
        await Promise.all(
          data.organizations.map((organizationId) =>
            tx.insert(organizationEvents).values({
              eventId: event.id,
              organizationId,
              primary: data.primary,
            })
          )
        );
      }

      return event;
    });
  } catch (error) {
    console.error('Error creating event:', error);
    throw new Error('Failed to create event');
  }
}

export async function deleteEventService(id) {
  return await db.transaction(async (tx) => {
    // First delete from organization_events
    await tx
      .delete(organizationEvents)
      .where(eq(organizationEvents.eventId, id));

    // Delete from event_tags
    await tx.delete(eventTags).where(eq(eventTags.eventId, id));

    // Then delete the event itself
    const deletedEvent = await tx
      .delete(events)
      .where(eq(events.id, id))
      .returning();

    return deletedEvent[0];
  });
}

export const updateEventService = async (eventId, eventData) => {
  try {
    // Extract orgsToAdd from eventData and ensure it's an array
    const orgsToAdd = Array.isArray(eventData.orgsToAdd)
      ? eventData.orgsToAdd
      : [];

    // Extract organizationsToRemove from eventData and ensure it's an array
    const organizationsToRemove = Array.isArray(eventData.organizationsToRemove)
      ? eventData.organizationsToRemove
      : [];

    // Remove these properties from the data we'll use to update the event
    const {
      orgsToAdd: _orgsToAdd,
      organizationsToRemove: _organizationsToRemove,
      tags: _tags,
      eventType: _eventType,
      expertiseLevel: _expertiseLevel,
      ...cleanEventData
    } = eventData;

    // Format the timestamps properly
    const updatedEventData = {
      ...cleanEventData,
      startTime: cleanEventData.startTime
        ? new Date(cleanEventData.startTime).toISOString()
        : undefined,
      endTime: cleanEventData.endTime
        ? new Date(cleanEventData.endTime).toISOString()
        : undefined,
    };

    return await db.transaction(async (tx) => {
      // Remove organizations if any are specified
      if (organizationsToRemove.length > 0) {
        await tx.execute(
          sql`DELETE FROM organization_events 
              WHERE event_id = ${eventId} 
              AND organization_id = ANY(ARRAY[${sql.join(
                organizationsToRemove
              )}]::uuid[])`
        );
      }

      // Add new organizations if any are specified
      if (orgsToAdd.length > 0) {
        await tx.execute(
          sql`INSERT INTO organization_events (event_id, organization_id)
              SELECT ${eventId}, unnest(ARRAY[${sql.join(orgsToAdd)}]::uuid[])
              ON CONFLICT DO NOTHING`
        );
      }

      // Rest of the update logic remains the same
      const result = await tx.execute(
        sql`
          UPDATE events
          SET 
            title = COALESCE(${updatedEventData.title}, title),
            description = COALESCE(${updatedEventData.description}, description),
            type_id = COALESCE(${updatedEventData.typeId}, type_id),
            expertise_level_id = COALESCE(${updatedEventData.expertiseLevelId}, expertise_level_id),
            visibility = COALESCE(${updatedEventData.visibility}, visibility),
            start_date = COALESCE(${updatedEventData.startTime}::timestamptz, start_date),
            end_date = COALESCE(${updatedEventData.endTime}::timestamptz, end_date),
            virtual_event = COALESCE(${updatedEventData.virtualEvent}, virtual_event),
            in_person_event = COALESCE(${updatedEventData.inPersonEvent}, in_person_event),
            location_name = COALESCE(${updatedEventData.locationName}, location_name),
            location_address = COALESCE(${updatedEventData.locationAddress}, location_address),
            location_city = COALESCE(${updatedEventData.locationCity}, location_city),
            location_state = COALESCE(${updatedEventData.locationState}, location_state),
            location_postal = COALESCE(${updatedEventData.locationPostal}, location_postal),
            location_country = COALESCE(${updatedEventData.locationCountry}, location_country),
            registration_link = COALESCE(${updatedEventData.registrationLink}, registration_link),
            timezone = COALESCE(${updatedEventData.timezone}, timezone),
            professional = COALESCE(${updatedEventData.professional}, professional),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${eventId}
          RETURNING *`
      );

      return result.rows[0];
    });
  } catch (error) {
    console.error('Error in updateEventService:', error);
    throw error;
  }
};

export async function getAllEvents(dbUserId, filterDate = null, tenants) {
  try {
    // Get base query with community tenant visibility rules
    let query = getEventsWithRelations(db, dbUserId, tenants).where(
      and(
        buildEventVisibilityCondition(dbUserId),
        inArray(events.tenantId, tenants)
      )
    );

    // Add date filter if filterDate is provided
    if (filterDate) {
      query = query.where(sql`${events.updatedAt} >= ${filterDate}`);
    }

    const eventsData = await query;

    // Fetch tags linked to resources
    const tagsData = await db
      .select({
        eventId: eventTags.eventId,
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(eventTags)
      .leftJoin(tags, eq(eventTags.tagId, tags.id));

    // Combine tags with events
    const eventsWithTags = eventsData.map((event) => {
      const eventTags = tagsData
        .filter((tag) => tag.eventId === event.id)
        .map((t) => ({ id: t.tagId, name: t.tagName }));

      return {
        ...event,
        tags: eventTags,
      };
    });

    return eventsWithTags;
  } catch (error) {
    console.error('Error fetching all events:', error);
    throw new Error('Failed to fetch events');
  }
}

export async function getAllEventsPaginated(dbUserId, tenants, options = {}) {
  const {
    page = 1,
    limit = 20,
    filterDate = null,
    filterStartDate = null,
    filterEndDate = null,
    sortBy = 'startDate',
    sortOrder = 'desc',
  } = options;

  try {
    // Calculate offset
    const offset = (page - 1) * limit;

    // Build where conditions with community tenant visibility rules
    const whereConditions = [
      buildEventVisibilityCondition(dbUserId),
      inArray(events.tenantId, tenants),
    ];

    // Add date filtering
    if (filterStartDate && filterEndDate) {
      // Use date range filtering if both dates are provided
      whereConditions.push(
        and(
          sql`${events.startDate} >= ${filterStartDate}::date`,
          sql`${events.startDate} <= ${filterEndDate}::date`
        )
      );
    } else if (filterDate) {
      // Fallback to single date filter
      whereConditions.push(sql`${events.updatedAt} >= ${filterDate}`);
    }

    // Get total count
    const [countResult] = await db
      .select({ count: sql`count(*)` })
      .from(events)
      .where(and(...whereConditions));

    const totalCount = parseInt(countResult.count);

    // Get paginated events
    let query = getEventsWithRelations(db, dbUserId, tenants)
      .where(and(...whereConditions))
      .limit(limit)
      .offset(offset);

    // Add sorting
    if (sortBy === 'startDate') {
      query = query.orderBy(
        sortOrder === 'desc'
          ? sql`${events.startDate} DESC`
          : sql`${events.startDate} ASC`
      );
    } else if (sortBy === 'createdAt') {
      query = query.orderBy(
        sortOrder === 'desc'
          ? sql`${events.createdAt} DESC`
          : sql`${events.createdAt} ASC`
      );
    }

    const eventsData = await query;

    // Get event IDs for tag fetching
    const eventIds = eventsData.map((event) => event.id);

    // Fetch tags only for the events in this page
    const tagsData =
      eventIds.length > 0
        ? await db
            .select({
              eventId: eventTags.eventId,
              tagId: tags.id,
              tagName: tags.name,
            })
            .from(eventTags)
            .leftJoin(tags, eq(eventTags.tagId, tags.id))
            .where(inArray(eventTags.eventId, eventIds))
        : [];

    // Combine tags with events
    const eventsWithTags = eventsData.map((event) => {
      const eventTags = tagsData
        .filter((tag) => tag.eventId === event.id)
        .map((t) => ({ id: t.tagId, name: t.tagName }));

      return {
        ...event,
        tags: eventTags,
      };
    });

    // Return paginated response
    return {
      data: eventsWithTags,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page * limit < totalCount,
      },
    };
  } catch (error) {
    console.error('Error fetching paginated events:', error);
    throw new Error('Failed to fetch events');
  }
}

export async function getEventById(id, dbUserId, tenants) {
  try {
    const [event] = await getEventsWithRelations(db, dbUserId, tenants).where(
      and(eq(events.id, id), inArray(events.tenantId, tenants))
    );

    if (!event) {
      return event;
    }

    //for any events that have an organization and an image_key, add the image_url to the event
    if (event.organizations && event.organizations.length > 0) {
      event.organizations.forEach((organization) => {
        if (organization.imageKey) {
          organization.imageUrl = generatePresignedCloudFrontUrl(
            organization.imageKey
          );
        }
      });
    }

    // Fetch tags for this resource
    const tagsData = await db
      .select({
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(eventTags)
      .leftJoin(tags, eq(eventTags.tagId, tags.id))
      .where(eq(eventTags.eventId, id));

    return {
      ...event,
      tags: tagsData,
    };
  } catch (error) {
    console.error('Error fetching event:', error);
    throw error;
  }
}

export async function getEventsByOrganizationIdService(
  organizationId,
  dbUserId,
  tenants
) {
  try {
    const eventsList = await getEventsWithRelations(db, dbUserId, tenants)
      .innerJoin(organizationEvents, eq(events.id, organizationEvents.eventId))
      .where(eq(organizationEvents.organizationId, organizationId));
    return eventsList;
  } catch (error) {
    console.error('Error fetching events by organization ID:', error);
    throw new Error(
      `Failed to fetch events with organization ID: ${organizationId}`
    );
  }
}

export async function getEventsBySubscriptionsService(userId, tenants) {
  try {
    // Calculate date 3 months ago from current date
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const eventsResult = await getEventsWithRelations(db, userId, tenants)
      .innerJoin(organizationEvents, eq(events.id, organizationEvents.eventId))
      .innerJoin(
        organizationMembers,
        eq(
          organizationEvents.organizationId,
          organizationMembers.organizationId
        )
      )
      .where(
        and(
          eq(organizationMembers.userId, userId),
          // Filter events that either:
          // - start in the future, or
          // - started within the last 3 months
          sql`${events.startDate} >= ${threeMonthsAgo.toISOString()}::timestamptz`,
          inArray(events.tenantId, tenants)
        )
      );

    return eventsResult;
  } catch (error) {
    console.error('Error fetching events by subscriptions:', error);
    throw new Error('Failed to fetch events');
  }
}

export async function searchEventsService(dbUserId, tenants, options = {}) {
  const { searchQuery, limit = 50, includeAll = false } = options;

  try {
    // Build the search pattern for ILIKE
    const searchPattern = `%${searchQuery}%`;

    // Build base where conditions with community tenant visibility rules
    const baseConditions = [
      buildEventVisibilityCondition(dbUserId),
      inArray(events.tenantId, tenants),
    ];

    // Add search conditions - search across multiple fields
    const searchConditions = or(
      ilike(events.title, searchPattern),
      ilike(events.description, searchPattern),
      ilike(events.locationCity, searchPattern),
      ilike(events.locationState, searchPattern),
      // Search in organization names using subquery
      sql`EXISTS (
        SELECT 1 FROM organization_events oe
        JOIN organizations o ON o.id = oe.organization_id
        WHERE oe.event_id = ${events.id}
        AND o.name ILIKE ${searchPattern}
      )`,
      // Search in tags using subquery
      sql`EXISTS (
        SELECT 1 FROM event_tags et
        JOIN tags t ON t.id = et.tag_id
        WHERE et.event_id = ${events.id}
        AND t.name ILIKE ${searchPattern}
      )`
    );

    const whereConditions = includeAll
      ? [...baseConditions, searchConditions]
      : [...baseConditions, searchConditions];

    // Get events matching search criteria
    const eventsData = await getEventsWithRelations(db, dbUserId, tenants)
      .where(and(...whereConditions))
      .orderBy(sql`${events.startDate} DESC`)
      .limit(limit);

    // Get event IDs for tag fetching
    const eventIds = eventsData.map((event) => event.id);

    // Fetch tags for matched events
    const tagsData =
      eventIds.length > 0
        ? await db
            .select({
              eventId: eventTags.eventId,
              tagId: tags.id,
              tagName: tags.name,
            })
            .from(eventTags)
            .leftJoin(tags, eq(eventTags.tagId, tags.id))
            .where(inArray(eventTags.eventId, eventIds))
        : [];

    // Combine tags with events
    const eventsWithTags = eventsData.map((event) => {
      const eventTags = tagsData
        .filter((tag) => tag.eventId === event.id)
        .map((t) => ({ id: t.tagId, name: t.tagName }));

      return {
        ...event,
        tags: eventTags,
      };
    });

    return eventsWithTags;
  } catch (error) {
    console.error('Error searching events:', error);
    throw new Error('Failed to search events');
  }
}

export async function getEventsByIdsService(eventIds, dbUserId, tenants) {
  try {
    // Normalize eventIds to always be an array and extract IDs if objects are passed
    let normalizedEventIds;
    if (Array.isArray(eventIds)) {
      normalizedEventIds = eventIds.map((item) =>
        typeof item === 'object' && item !== null ? item.id : item
      );
    } else {
      normalizedEventIds = [
        typeof eventIds === 'object' && eventIds !== null
          ? eventIds.id
          : eventIds,
      ];
    }

    // Filter out any undefined or null values
    normalizedEventIds = normalizedEventIds.filter((id) => id != null);

    if (normalizedEventIds.length === 0) {
      return [];
    }

    // Get events with relations (includes community tenant visibility rules)
    const eventResults = await getEventsWithRelations(
      db,
      dbUserId,
      tenants
    ).where(
      and(
        inArray(events.id, normalizedEventIds),
        inArray(events.tenantId, tenants),
        buildEventVisibilityCondition(dbUserId)
      )
    );

    // Fetch tags for these events using the normalized array
    const tagsData = await db
      .select({
        eventId: eventTags.eventId,
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(eventTags)
      .leftJoin(tags, eq(eventTags.tagId, tags.id))
      .where(inArray(eventTags.eventId, normalizedEventIds));

    // Combine tags with events using normalized array
    const eventsWithTags = eventResults.map((event) => ({
      ...event,
      tags: tagsData
        .filter((tag) => tag.eventId === event.id)
        .map((t) => ({ id: t.tagId, name: t.tagName })),
    }));

    return eventsWithTags;
  } catch (error) {
    console.error('Error fetching events by IDs:', error);
    throw new Error('Failed to fetch events');
  }
}

export const getBasicEventsByIdsService = async (eventIds, userId, tenants) => {
  try {
    const results = await db
      .select({
        id: events.id,
        title: events.title,
        visibility: events.visibility,
        addedByUserId: events.addedByUserId,
        createdAt: events.createdAt,
        updatedAt: events.updatedAt,
      })
      .from(events)
      .where(
        and(
          inArray(events.id, eventIds),
          buildEventVisibilityCondition(userId),
          inArray(events.tenantId, tenants)
        )
      );

    return results;
  } catch (error) {
    console.error('Error in getBasicEventsByIdsService:', error);
    throw new Error('Failed to fetch events');
  }
};
