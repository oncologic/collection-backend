import {
  getFeaturesByTierIdService,
  getCollectionsByEventIdService,
  getEventTiersByEventIdService,
} from '../services/sponsorshipService.js';
import { snakeToCamelCase } from '../utils/general.js';

export const getSponsorTiersByEventId = async (req, res) => {
  try {
    // Step 1: Get collections and their tiers for this event
    const collections = await getCollectionsByEventIdService(req.params.id);

    // Step 2: Get items for each tier for all collections
    const collectionsWithItems = await Promise.all(
      collections.map(async (collection) => {
        const tiersWithItems = await Promise.all(
          collection.tiers.map(async (tier) => {
            if (!tier?.id) return tier;

            const tierItems = await getFeaturesByTierIdService(tier.id);
            return {
              ...tier,
              events: tierItems || {},
            };
          })
        );

        return {
          ...collection,
          tiers: tiersWithItems,
        };
      })
    );

    // Get all items for an event
    const eventItems = await getEventTiersByEventIdService(req.params.id);

    const eventTiersWithItems = await Promise.all(
      eventItems.map(async (tier) => {
        const tierItems = await getFeaturesByTierIdService(
          tier.sponsorship_tier_id
        );
        // Filter events array to only include the matching event
        const filteredEvents = tierItems.filter(
          (event) => event.id === req.params.id
        );

        const data = {
          tierName: tier.name,
          tierId: tier.sponsorship_tier_id,
          tierType: tier.type,
          tierPrice: tier.price,
          tierHighlight: tier.highlight,
          tierImageUrl: tier.image_url,
          tierDescription: tier.description,
          tierOrder: tier.order_position,
          events: filteredEvents,
        };
        return data;
      })
    );

    // Filter out tiers that have no events for this specific event
    const filteredEventTiers = eventTiersWithItems.filter(
      (tier) => tier.events.length > 0
    );

    const data = {
      collections: collectionsWithItems,
      eventTiers: filteredEventTiers,
    };

    res.json(snakeToCamelCase(data));
  } catch (error) {
    console.error('Error fetching sponsors:', error);
    res.status(500).json({
      error: 'Failed to fetch sponsorship tiers',
      message: error.message,
    });
  }
};
