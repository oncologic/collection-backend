import { db } from '../db/index.js';
import {
  eventSponsorshipTiers,
  sponsorshipTiers,
  sponsorshipFeatures,
  sponsorshipItems,
} from '../models/sponsorship.js';
import { sql } from 'drizzle-orm';

export const getCollectionsByEventIdService = async (eventId) => {
  const collectionTiersResult = await db.execute(sql`
    WITH collection_info AS (
      SELECT c.*, ec.order_position
      FROM collections c
      JOIN event_collections ec ON ec.collection_id = c.id
      WHERE ec.event_id = ${eventId}::uuid
    )
    SELECT 
      ci.id as collection_id,
      ci.name as collection_name,
      ci.description as collection_description,
      ci.order_position as collection_order,
      st.id as tier_id,
      st.name as tier_name,
      st.description as tier_description,
      st.price,
      st.type,
      st.highlight,
      st.image_url,
      cst.metadata,
      cst.order_position as tier_order
    FROM collection_info ci
    JOIN collection_sponsorship_tiers cst ON cst.collection_id = ci.id
    JOIN sponsorship_tiers st ON st.id = cst.sponsorship_tier_id
    ORDER BY ci.order_position, cst.order_position
  `);

  const result = collectionTiersResult.rows.reduce((collections, row) => {
    const existingCollection = collections.find(
      (c) => c.collection_id === row.collection_id
    );

    const tier = {
      id: row.tier_id,
      name: row.tier_name,
      type: row.type,
      price: row.price,
      highlight: row.highlight,
      image_url: row.image_url,
      description: row.tier_description,
      order_position: row.tier_order,
      metadata: row.metadata,
    };

    if (existingCollection) {
      existingCollection.tiers.push(tier);
    } else {
      collections.push({
        collection_id: row.collection_id,
        collection_name: row.collection_name,
        collection_description: row.collection_description,
        collection_order: row.collection_order,
        tiers: [tier],
      });
    }

    return collections;
  }, []);

  return result;
};

export const getItemEventDetailsService = async (tierId, items) => {
  // ... same implementation
};

export const getSponsorTiersByEventIdService = async (eventId) => {
  const [eventTiersResult, collectionTiersResult] = await Promise.all([
    db.execute(sql`
      WITH grouped_features AS (
        SELECT DISTINCT ON (st.id, sf.order_position)
          st.id as tier_id,
          st.name as tier_name,
          st.order_position as order_position,
          st.description as tier_description,
          st.price as price,
          st.type as type,
          st.highlight as tier_highlight,
          st.image_url as tier_image_url,
          sf.order_position as feature_order,
          sf.qty as feature_qty,
          si.name as item_name,
          si.description as item_description,
          si.type as item_type
        FROM event_sponsorship_tiers est
        INNER JOIN sponsorship_tiers st ON est.sponsorship_tier_id = st.id
        LEFT JOIN sponsorship_features sf ON sf.sponsorship_tier_id = st.id
        LEFT JOIN sponsorship_items si ON sf.sponsorship_item_id = si.id
        WHERE est.event_id = ${eventId}
        ORDER BY st.id, sf.order_position
      )
      SELECT 
        tier_id as id,
        tier_name as name,
        tier_description as description,
        order_position as order_position,
        price as price,
        tier_highlight as highlight,
        tier_image_url as image_url,
        jsonb_agg(
          CASE 
            WHEN feature_order IS NOT NULL THEN
              jsonb_build_object(
                'order_position', feature_order,
                'qty', feature_qty,
                'name', item_name,
                'description', item_description
              )
          END
        ) FILTER (WHERE feature_order IS NOT NULL) as items
      FROM grouped_features
      GROUP BY 
        tier_id, 
        tier_name, 
        tier_description, 
        order_position,
        price,
        tier_highlight, 
        tier_image_url
      ORDER BY order_position
    `),
    getCollectionsByEventIdService(eventId),
  ]);

  return {
    eventTiers: eventTiersResult.rows,
    collectionTiers: collectionTiersResult,
  };
};

// export const getSponsorshipTiersByEventId = async (eventId) => {
//   const results = await db.execute(sql`
//     WITH tier_items AS (
//       SELECT
//         st.id as tier_id,
//         st.name as tier_name,
//         st.description as tier_description,
//         st.price,
//         st.type,
//         st.highlight,
//         st.image_url,
//         st.order_position as tier_order,
//         si.id as item_id,
//         si.name as item_name,
//         si.description as item_description,
//         si.type as item_type,
//         si.image_url as item_image_url,
//         sf.order_position as item_order,
//         sf.qty
//       FROM event_sponsorship_tiers est
//       JOIN sponsorship_tiers st ON st.id = est.sponsorship_tier_id
//       LEFT JOIN sponsorship_features sf ON sf.sponsorship_tier_id = st.id
//       LEFT JOIN sponsorship_items si ON si.id = sf.sponsorship_item_id
//       WHERE est.event_id = ${eventId}
//     )
//     SELECT jsonb_agg(
//       jsonb_build_object(
//         'id', ti.tier_id,
//         'name', ti.tier_name,
//         'description', ti.tier_description,
//         'price', ti.price,
//         'type', ti.type,
//         'highlight', ti.highlight,
//         'imageUrl', ti.image_url,
//         'orderPosition', ti.tier_order,
//         'items', (
//           SELECT jsonb_agg(
//             jsonb_build_object(
//               'id', ti2.item_id,
//               'name', ti2.item_name,
//               'description', ti2.item_description,
//               'type', ti2.item_type,
//               'imageUrl', ti2.item_image_url,
//               'qty', ti2.qty,
//               'orderPosition', ti2.item_order
//             )
//             ORDER BY ti2.item_order
//           )
//           FROM tier_items ti2
//           WHERE ti2.tier_id = ti.tier_id
//           AND ti2.item_id IS NOT NULL
//         )
//       )
//       ORDER BY ti.tier_order
//     ) as tiers
//     FROM tier_items ti
//     GROUP BY ti.tier_id
//   `);

//   return results.rows[0].tiers || [];
// };

export const getFeaturesByTierIdService = async (tierId) => {
  const featuresResult = await db.execute(sql`
    SELECT
      si.id as item_id,
      si.name as item_name,
      si.description as item_description,
      si.link as item_link,
      si.image_url as item_image_url,
      si.type as item_type,
      sf.event_id,
      ev.title as event_name,
      st.name as tier_name,
      st.id as tier_id,
      st.type as tier_type,
      st.price as tier_price,
      st.highlight as tier_highlight,
      st.image_url as tier_image_url,
      st.description as tier_description,
      st.order_position as tier_order,
    sf.order_position as item_order_position,
      sf.qty as qty
    FROM sponsorship_features sf
    JOIN sponsorship_items si ON si.id = sf.sponsorship_item_id
    JOIN sponsorship_tiers st ON st.id = sf.sponsorship_tier_id
    JOIN events ev ON ev.id = sf.event_id
    WHERE sf.sponsorship_tier_id = ${tierId}
    AND sf.event_id = ev.id
    GROUP BY
      sf.event_id,
      si.id,
      si.name,
      si.description,
      si.link,
      si.image_url,
      si.type,
      ev.title,
      st.name,
      st.id,
      st.type,
      st.price,
      st.highlight,
      st.image_url,
      st.description,
      st.order_position,
      sf.order_position,
      sf.qty
    ORDER BY si.name
  `);

  if (!featuresResult.rows.length) {
    return [];
  }

  const groupedByEvent = featuresResult.rows.reduce((acc, row) => {
    const eventId = row.event_id;
    const existingEvent = acc.find((event) => event.id === eventId);

    const item = {
      id: row.item_id,
      name: row.item_name,
      description: row.item_description,
      link: row.item_link,
      imageUrl: row.item_image_url,
      type: row.item_type,
      qty: row.qty,
      orderPosition: row.item_order_position,
    };

    if (existingEvent) {
      const itemExists = existingEvent.items.some(
        (existingItem) => existingItem.id === item.id
      );
      if (!itemExists) {
        existingEvent.items.push(item);
      }
    } else {
      acc.push({
        id: eventId,
        name: row.event_name,
        items: [item],
        tier: {
          id: row.tier_id,
          name: row.tier_name,
          type: row.tier_type,
          price: row.tier_price,
          highlight: row.tier_highlight,
          imageUrl: row.tier_image_url,
          description: row.tier_description,
          orderPosition: row.tier_order,
        },
      });
    }

    return acc;
  }, []);

  return groupedByEvent;
};

export const getEventTiersByEventIdService = async (eventId) => {
  const eventTiersResult = await db.execute(sql`
    SELECT * FROM event_sponsorship_tiers est
    JOIN sponsorship_tiers st ON st.id = est.sponsorship_tier_id
    WHERE est.event_id = ${eventId}
  `);
  return eventTiersResult.rows;
};
