import { db } from '../src/db/index.js';
import { events } from '../src/models/events.js';
import { eventTypes } from '../src/models/metadata.js';
import {
  googleCalendarEvents,
  googleCalendarIntegrations,
} from '../src/models/googleCalendarSync.js';
import { eq, and, sql, inArray } from 'drizzle-orm';

// Script to fix Google Calendar sync issues
async function fixGoogleCalendarSync() {
  console.log('Starting Google Calendar sync fix...\n');

  try {
    // Step 1: Check existing event types
    console.log('1. Checking existing event types...');
    const existingEventTypes = await db.select().from(eventTypes);
    console.log('Current event types:', existingEventTypes);

    // Step 2: Check if we need to create a Google Calendar event type
    const googleCalendarEventType = existingEventTypes.find(
      (type) => type.name === 'Google Calendar Event'
    );

    let googleCalendarTypeId;
    if (!googleCalendarEventType) {
      console.log('\n2. Creating Google Calendar event type...');
      const [newEventType] = await db
        .insert(eventTypes)
        .values({
          name: 'Google Calendar Event',
          description: 'Events synced from Google Calendar',
        })
        .returning();
      googleCalendarTypeId = newEventType.id;
      console.log('Created event type with ID:', googleCalendarTypeId);
    } else {
      googleCalendarTypeId = googleCalendarEventType.id;
      console.log(
        '\n2. Google Calendar event type already exists with ID:',
        googleCalendarTypeId
      );
    }

    // Step 3: Find and remove duplicate events
    console.log('\n3. Finding duplicate Google Calendar events...');

    // Find all Google Calendar events with their mappings
    const googleCalendarMappings = await db
      .select({
        googleEventId: googleCalendarEvents.googleEventId,
        entityId: googleCalendarEvents.entityId,
        integrationId: googleCalendarEvents.integrationId,
        createdAt: googleCalendarEvents.createdAt,
      })
      .from(googleCalendarEvents)
      .where(eq(googleCalendarEvents.entityType, 'event'));

    // Group by googleEventId and integrationId to find duplicates
    const eventGroups = {};
    googleCalendarMappings.forEach((mapping) => {
      const key = `${mapping.googleEventId}-${mapping.integrationId}`;
      if (!eventGroups[key]) {
        eventGroups[key] = [];
      }
      eventGroups[key].push(mapping);
    });

    // Identify duplicates (keep the oldest one)
    const duplicateEventIds = [];
    let duplicateCount = 0;

    for (const [key, mappings] of Object.entries(eventGroups)) {
      if (mappings.length > 1) {
        // Sort by creation date, keep the oldest
        mappings.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        // Mark all but the first as duplicates
        for (let i = 1; i < mappings.length; i++) {
          duplicateEventIds.push(mappings[i].entityId);
          duplicateCount++;
        }
      }
    }

    if (duplicateEventIds.length > 0) {
      console.log(`Found ${duplicateCount} duplicate events to remove`);

      // Delete duplicate events from events table
      await db.delete(events).where(inArray(events.id, duplicateEventIds));

      // Delete corresponding mappings
      await db
        .delete(googleCalendarEvents)
        .where(
          and(
            eq(googleCalendarEvents.entityType, 'event'),
            inArray(googleCalendarEvents.entityId, duplicateEventIds)
          )
        );

      console.log(
        `Deleted ${duplicateCount} duplicate events and their mappings`
      );
    } else {
      console.log('No duplicate events found');
    }

    // Step 4: Update existing events with incorrect type_id
    console.log('\n4. Updating events with incorrect type_id...');
    const updateResult = await db
      .update(events)
      .set({ typeId: googleCalendarTypeId })
      .where(and(eq(events.isGoogleCalendarEvent, true), eq(events.typeId, 9)));

    console.log('Updated events with correct type_id');

    // Step 5: Show summary
    console.log('\n5. Summary:');
    const totalGoogleEvents = await db
      .select({ count: sql`count(*)` })
      .from(events)
      .where(eq(events.isGoogleCalendarEvent, true));

    const totalMappings = await db
      .select({ count: sql`count(*)` })
      .from(googleCalendarEvents)
      .where(eq(googleCalendarEvents.entityType, 'event'));

    console.log(
      `- Total Google Calendar events: ${totalGoogleEvents[0].count}`
    );
    console.log(`- Total event mappings: ${totalMappings[0].count}`);
    console.log(`- Google Calendar event type ID: ${googleCalendarTypeId}`);

    console.log('\n✅ Fix completed successfully!');
    console.log(
      '\nNOTE: Update src/services/googleCalendarServiceV2.js line 545 to use typeId:',
      googleCalendarTypeId
    );
  } catch (error) {
    console.error('Error fixing Google Calendar sync:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the fix
fixGoogleCalendarSync();
