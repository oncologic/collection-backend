// src/services/sharedLinkService.js
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { sharedLinks } from '../models/sharedLinks.js';
import { collections } from '../models/collections.js';
import { resources } from '../models/resources.js';
import { collectionExternalLinks } from '../models/external_links.js';
import { eq, and, gt, sql, inArray, or } from 'drizzle-orm';
import {
  getCollectionByIdService,
  getCollectionByIdServiceSharedLink,
} from './collectionService.js';
import { getResourceByIdService } from './resourceService.js';
import { getExternalLinkByIdService } from './collectionService.js';
import { getExternalLinksForCollectionByIdService } from './collectionService.js';
import { getResourcesForCollectionByIdService } from './collectionService.js';
import {
  isYoutubeUrl,
  parseTimestamps,
  snakeToCamelCase,
} from '../utils/general.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { sharedLinkReviews } from '../models/sharedLinkReviews.js';
import { reviewers } from '../models/reviewers.js';
import { users } from '../models/users.js';
import {
  getLinkGroupByIdService,
  getLinkGroupByIdServiceShared,
} from './metadataService.js';
import { hydrateNotationMediaService } from './notationService.js';
import { RESOURCE_ACCESS_MODES } from './resourceAccessService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const DEFAULT_EXPIRY_DAYS = 30;

// Helper function to check if email is in allowed list
const isEmailAllowed = (email, allowedEmailsString) => {
  if (!email || !allowedEmailsString) return false;

  const allowedEmails = allowedEmailsString
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  return allowedEmails.includes(email.toLowerCase());
};

const filterGroupedLinkGroupsByVisibility = (linkGroups, hasEmailAccess) => {
  if (!linkGroups) return linkGroups;

  if (Array.isArray(linkGroups)) {
    return linkGroups.filter((group) => {
      if (!group) return false;
      return hasEmailAccess
        ? group.visibility !== 'private'
        : group.visibility === 'public';
    });
  }

  return Object.entries(linkGroups).reduce((acc, [category, items]) => {
    if (!Array.isArray(items)) return acc;

    const filteredItems = items.filter((group) => {
      if (!group) return false;
      return hasEmailAccess
        ? group.visibility !== 'private'
        : group.visibility === 'public';
    });

    if (filteredItems.length > 0) {
      acc[category] = filteredItems;
    }

    return acc;
  }, {});
};

// Helper function to filter content based on visibility
const filterContentByVisibility = (content, hasEmailAccess) => {
  if (!content) return content;

  // If user has email access, show everything that's not private
  if (hasEmailAccess) {
    // For collections, filter out private items
    if (content.external_links) {
      content.external_links = content.external_links
        .filter((link) => link && link.visibility !== 'private')
        .map((link) => {
          // Also filter notations within each external link
          if (link.notations && Array.isArray(link.notations)) {
            link.notations = link.notations
              .filter(
                (notation) => notation && notation.visibility !== 'private'
              )
              .map((notation) => {
                // Filter attachments within notations
                if (
                  notation.attachments &&
                  Array.isArray(notation.attachments)
                ) {
                  notation.attachments = notation.attachments.filter(
                    (attachment) =>
                      attachment && attachment.visibility !== 'private'
                  );
                }
                return notation;
              });
          }
          return link;
        });
    }
    if (content.resources) {
      content.resources = content.resources.filter(
        (resource) => resource && resource.visibility !== 'private'
      );
    }
    // Filter notations directly on the content object
    if (content.notations && Array.isArray(content.notations)) {
      content.notations = content.notations
        .filter((notation) => notation && notation.visibility !== 'private')
        .map((notation) => {
          // Filter attachments within notations
          if (notation.attachments && Array.isArray(notation.attachments)) {
            notation.attachments = notation.attachments.filter(
              (attachment) => attachment && attachment.visibility !== 'private'
            );
          }
          return notation;
        });
    }
    // Filter attachments directly on the content object
    if (content.attachments && Array.isArray(content.attachments)) {
      content.attachments = content.attachments.filter(
        (attachment) => attachment && attachment.visibility !== 'private'
      );
    }
    // Filter linkGroups directly on the content object
    if (content.linkGroups) {
      content.linkGroups = filterGroupedLinkGroupsByVisibility(
        content.linkGroups,
        true
      );
    }
    return content;
  }

  // If no email access, still allow direct-link access to unlisted content
  if (content.external_links) {
    content.external_links = content.external_links
      .filter((link) => link && link.visibility !== 'private')
      .map((link) => {
        // Also filter notations within each external link
        if (link.notations && Array.isArray(link.notations)) {
          link.notations = link.notations
            .filter(
              (notation) => notation && notation.visibility !== 'private'
            )
            .map((notation) => {
              // Filter attachments within notations
              if (notation.attachments && Array.isArray(notation.attachments)) {
                notation.attachments = notation.attachments.filter(
                  (attachment) => attachment && attachment.visibility !== 'private'
                );
              }
              return notation;
            });
        }
        return link;
      });
  }
  if (content.resources) {
    content.resources = content.resources.filter(
      (resource) => resource && resource.visibility !== 'private'
    );
  }
  // Filter notations directly on the content object
  if (content.notations && Array.isArray(content.notations)) {
    content.notations = content.notations
      .filter((notation) => notation && notation.visibility !== 'private')
      .map((notation) => {
        // Filter attachments within notations
        if (notation.attachments && Array.isArray(notation.attachments)) {
          notation.attachments = notation.attachments.filter(
            (attachment) => attachment && attachment.visibility !== 'private'
          );
        }
        return notation;
      });
  }
  // Filter attachments directly on the content object
  if (content.attachments && Array.isArray(content.attachments)) {
    content.attachments = content.attachments.filter(
      (attachment) => attachment && attachment.visibility !== 'private'
    );
  }
  // Filter linkGroups directly on the content object
  if (content.linkGroups) {
    content.linkGroups = filterGroupedLinkGroupsByVisibility(
      content.linkGroups,
      false
    );
  }

  return content;
};

const hydrateSharedLinkNotationMedia = async (content) => {
  if (!content) {
    return content;
  }

  if (content.notations && Array.isArray(content.notations)) {
    content.notations = await hydrateNotationMediaService(content.notations, {
      accessMode: 'signed',
      expiresInSeconds: 3600,
      allowedAttachmentVisibilities: ['public', 'unlisted'],
    });
  }

  if (content.external_links && Array.isArray(content.external_links)) {
    content.external_links = await Promise.all(
      content.external_links.map(async (link) => ({
        ...link,
        notations: await hydrateNotationMediaService(link.notations || [], {
          accessMode: 'signed',
          expiresInSeconds: 3600,
          allowedAttachmentVisibilities: ['public', 'unlisted'],
        }),
      }))
    );
  }

  return content;
};

export const sharedLinkService = {
  // Create a new shared link
  createSharedLink: async (
    userId,
    type,
    id,
    expiryDays = DEFAULT_EXPIRY_DAYS,
    emailList,
    description,
    tenantIds
  ) => {
    try {
      let itemExists = false;
      let externalLinksToShare = [];

      switch (type) {
        case 'collection':
          const collection = await getCollectionByIdService(
            id,
            userId,
            tenantIds
          );
          itemExists = !!collection;

          // If it's a collection, get all associated external links
          if (itemExists && collection.type === 'external') {
            const { external_links } =
              await getExternalLinksForCollectionByIdService(id, userId);
            externalLinksToShare = external_links || [];
          }
          break;
        case 'resource':
          const resource = await getResourceByIdService(id, userId, tenantIds);
          itemExists = !!resource;
          break;
        case 'external_link':
          const externalLink = await getExternalLinkByIdService(id, userId);
          itemExists = !!externalLink;
          break;
        default:
          throw new Error(`Invalid link type: ${type}`);
      }

      if (!itemExists) {
        throw new Error(`${type} with ID ${id} not found`);
      }

      // Calculate expiry date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiryDays);

      // Generate JWT token
      const payload = {
        type,
        id,
        exp: Math.floor(expiresAt.getTime() / 1000),
      };

      const accessToken = jwt.sign(payload, JWT_SECRET);

      // Create shared link records
      const baseValues = {
        createdByUserId: userId,
        expiresAt,
        accessToken,
        isActive: true,
        sharedWithEmail: emailList || null,
        description: description || null,
      };

      // Insert main shared link
      const [newSharedLink] = await db
        .insert(sharedLinks)
        .values({
          ...baseValues,
          linkId: id,
          linkType: type,
        })
        .returning();

      // If it's a collection, create shared links for all external links
      if (type === 'collection' && externalLinksToShare.length > 0) {
        // Filter out any null links before creating shared links
        const validLinks = externalLinksToShare.filter(
          (link) => link && link.id
        );

        if (validLinks.length > 0) {
          await db.insert(sharedLinks).values(
            validLinks.map((link) => ({
              ...baseValues,
              linkId: link.id,
              linkType: 'external_link',
              parentSharedLinkId: newSharedLink.id,
            }))
          );
        }
      }

      return {
        ...newSharedLink,
        shareUrl: `${process.env.FRONTEND_URL}/shared/${newSharedLink.id}?token=${accessToken}`,
      };
    } catch (error) {
      console.error('Error creating shared link:', error);
      throw new Error(`Failed to create shared link: ${error.message}`);
    }
  },

  // Validate email access for a shared link
  validateEmailAccess: async (linkId, userEmail, token = null) => {
    try {
      if (!userEmail) {
        throw new Error('Email is required to access this content');
      }

      // First, try direct lookup
      const sharedLink = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.id, linkId),
            eq(sharedLinks.isActive, true),
            gt(sharedLinks.expiresAt, new Date())
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (sharedLink) {
        // Direct match found
        const hasEmailAccess = isEmailAllowed(
          userEmail,
          sharedLink.sharedWithEmail
        );

        return {
          hasAccess: hasEmailAccess,
          sharedLink,
          accessLevel: hasEmailAccess ? 'email_authorized' : 'public_only',
        };
      }

      // If no direct match and token provided, try auto-resolution
      if (token) {
        // First, try to find collections containing this linkId as an external link
        const collectionsContainingLink = await db.execute(sql`
          SELECT c.id, c.name, c.type, c.user_id
          FROM collections c
          JOIN collection_external_links cel ON c.id = cel.collection_id
          WHERE cel.external_link_id = ${linkId}
        `);

        if (
          collectionsContainingLink.rows &&
          collectionsContainingLink.rows.length > 0
        ) {
          // Try to find a valid collection shared link that matches the token
          for (const collection of collectionsContainingLink.rows) {
            const collectionSharedLink = await db
              .select()
              .from(sharedLinks)
              .where(
                and(
                  eq(sharedLinks.linkType, 'collection'),
                  eq(sharedLinks.linkId, collection.id),
                  eq(sharedLinks.accessToken, token),
                  eq(sharedLinks.isActive, true),
                  gt(sharedLinks.expiresAt, new Date())
                )
              )
              .limit(1)
              .then((results) => results[0]);

            if (collectionSharedLink) {
              // Found a valid collection shared link
              const hasEmailAccess = isEmailAllowed(
                userEmail,
                collectionSharedLink.sharedWithEmail
              );

              return {
                hasAccess: hasEmailAccess,
                sharedLink: collectionSharedLink,
                accessLevel: hasEmailAccess
                  ? 'email_authorized'
                  : 'public_only',
                resolvedVia: 'collection_shared_link',
                parentCollection: {
                  id: collection.id,
                  name: collection.name,
                },
              };
            }
          }
        }
      }

      throw new Error('Shared link not found or has expired');
    } catch (error) {
      console.error('Error validating email access:', error);
      throw new Error(`Failed to validate email access: ${error.message}`);
    }
  },

  // Validate a shared link and retrieve the content
  validateAndGetContent: async (linkId, token, userEmail) => {
    try {
      // Verify token validity
      let decodedToken;
      try {
        decodedToken = jwt.verify(token, JWT_SECRET);
      } catch (error) {
        throw new Error('Invalid or expired token');
      }

      // First, try direct lookup for the linkId
      const directMatch = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.id, linkId),
            eq(sharedLinks.accessToken, token),
            eq(sharedLinks.isActive, true),
            gt(sharedLinks.expiresAt, new Date())
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (directMatch) {
        // DIRECT MATCH FLOW - existing logic
        // Validate email access
        const emailValidation = await sharedLinkService.validateEmailAccess(
          linkId,
          userEmail,
          token
        );
        const hasEmailAccess = emailValidation.hasAccess;

        // Get the user ID from the shared link
        const userId = directMatch.createdByUserId;

        // Increment the view count and update last viewed timestamp
        await db
          .update(sharedLinks)
          .set({
            viewCount: sql`COALESCE(${sharedLinks.viewCount}, 0) + 1`,
            lastViewedAt: new Date(),
          })
          .where(eq(sharedLinks.id, directMatch.id));

        // Retrieve the actual content based on type
        let content;
        switch (directMatch.linkType) {
          case 'collection':
            // First get basic collection info to check type
            const basicCollection = await getCollectionByIdServiceSharedLink(
              directMatch.linkId,
              userId
            );

            if (!basicCollection) {
              throw new Error('Collection not found');
            }

            if (basicCollection.type === 'external') {
              // For external collections, get the external links without user-based filtering
              // We'll apply shared link filtering rules instead
              const collectionData = await db.execute(sql`
                SELECT
                  c.id,
                  c.name,
                  c.type,
                  c.visibility,
                  c.color,
                  c.icon,
                  c.description,
                  c.created_at,
                  c.updated_at,
                  c.start_date,
                  c.end_date,
                  c.event_id,
                  c.status,
                  c.tenant_id,
                  c.hashtags,
                  jsonb_agg(
                    CASE WHEN el.id IS NOT NULL THEN
                      jsonb_build_object(
                        'id', el.id,
                        'url', el.url,
                        'name', el.name,
                        'description', el.description,
                        'notes', el.notes,
                        'dateAdded', el.date_added,
                        'date', COALESCE(cel.start_date, cel.date),
                        'startDate', COALESCE(cel.start_date, cel.date),
                        'endDate', COALESCE(cel.end_date, cel.start_date, cel.date),
                        'visibility', el.visibility,
                        'type', el.type,
                        'imageUrl', el.image_url,
                        'imageMetadata', el.image_metadata,
                        'addedByUserId', el.added_by_user_id,
                        'createdAt', el.created_at,
                        'updatedAt', el.updated_at,
                        'startTime', el.start_time,
                        'endTime', el.end_time,
                        'timezone', el.timezone,
                        'tenantId', el.tenant_id,
                        'notations', (
                          SELECT COALESCE(
                            jsonb_agg(
                              jsonb_build_object(
                                'id', celn.id,
                                'title', celn.title,
                                'description', celn.description,
                                'notes', celn.notes,
                                'category', celn.category,
                                'status', celn.status,
                                'highlighted', celn.highlighted,
                                'createdAt', celn.created_at,
                                'updatedAt', celn.updated_at,
                                'listOrder', celn.list_order,
                                'date', COALESCE(celn.start_date, celn.date),
                                'startDate', COALESCE(celn.start_date, celn.date),
                                'endDate', COALESCE(celn.end_date, celn.start_date, celn.date),
                                'visibility', celn.visibility,
                                'startTime', celn.start_time,
                                'endTime', celn.end_time,
                                'timezone', celn.timezone,
                                'userId', celn.user_id
                              ) ORDER BY celn.list_order
                            ),
                            '[]'::jsonb
                          )
                          FROM collection_external_links_notations celn
                          WHERE celn.collection_external_link_id = cel.id
                        )
                      )
                    END
                  ) FILTER (WHERE el.id IS NOT NULL) AS external_links
                FROM collections c
                LEFT JOIN collection_external_links cel ON c.id = cel.collection_id
                LEFT JOIN external_links el ON cel.external_link_id = el.id
                WHERE c.type = 'external' AND c.id = ${basicCollection.id}
                GROUP BY c.id, c.name, c.type, c.visibility, c.color, c.icon, c.description, c.created_at, c.updated_at, c.start_date, c.end_date, c.event_id, c.status, c.tenant_id, c.hashtags
              `);

              const collectionResult = collectionData.rows[0];

              if (!collectionResult) {
                throw new Error('Collection not found');
              }

              // Filter out null links and process attachments safely
              const validLinks = (collectionResult.external_links || []).filter(
                (link) => link !== null
              );

              const attachments = await Promise.all(
                validLinks.map(async (link) => {
                  if (!link.attachments || !Array.isArray(link.attachments)) {
                    return [];
                  }
                  return Promise.all(
                    link.attachments.map(async (attachment) => ({
                      ...attachment,
                      presignedUrl: generatePresignedCloudFrontUrl(
                        attachment.imageKey,
                        3600
                      ),
                    }))
                  );
                })
              );

              content = {
                ...collectionResult,
                external_links: validLinks.map((link) => ({
                  ...link,
                  timestamps: isYoutubeUrl(link.url)
                    ? parseTimestamps(link.description)
                    : null,
                })),
                attachments: attachments.flat(),
              };
            } else {
              // For regular collections, get the resources
              content = await getResourcesForCollectionByIdService(
                basicCollection.id
              );
            }
            break;
          case 'resource':
            const [sharedResource] = await db
              .select({
                tenantId: resources.tenantId,
              })
              .from(resources)
              .where(eq(resources.id, directMatch.linkId))
              .limit(1);

            if (!sharedResource?.tenantId) {
              throw new Error('Resource not found');
            }

            content = await getResourceByIdService(
              directMatch.linkId,
              userId,
              [sharedResource.tenantId],
              {
                accessMode: RESOURCE_ACCESS_MODES.SHARED,
                includeChildren: true,
                bypassAccessCheck: true,
                childAccessMode: RESOURCE_ACCESS_MODES.SHARED,
                childViewerUserId: null,
              }
            );
            break;
          case 'external_link':
            const externalLink = await getExternalLinkByIdService(
              directMatch.linkId,
              userId
            );

            if (!externalLink) {
              throw new Error('External link not found');
            }

            const linkGroups = await getLinkGroupByIdServiceShared(
              externalLink.id
            );

            // Process YouTube timestamps similar to the controller
            content = {
              ...externalLink,
              linkGroups: linkGroups,
              timestamps: isYoutubeUrl(externalLink.url)
                ? parseTimestamps(externalLink.description)
                : null,
            };

            // Handle attachments with presigned URLs
            if (
              content.attachments &&
              Array.isArray(content.attachments) &&
              content.attachments.length > 0
            ) {
              content.attachments = await Promise.all(
                content.attachments.map(async (attachment) => {
                  if (attachment && attachment.imageKey) {
                    attachment.presignedUrl = generatePresignedCloudFrontUrl(
                      attachment.imageKey,
                      3600
                    );
                  }
                  return attachment;
                })
              );
            }
            break;
        }

        // Filter content based on email access
        const filteredContent = filterContentByVisibility(
          content,
          hasEmailAccess
        );
        const hydratedContent = await hydrateSharedLinkNotationMedia(
          filteredContent
        );
        const formattedContent = snakeToCamelCase(hydratedContent);

        return {
          content: formattedContent,
          metadata: {
            type: directMatch.linkType,
            createdAt: directMatch.createdAt,
            expiresAt: directMatch.expiresAt,
            viewCount: directMatch.viewCount + 1,
            linkId: linkId,
            accessLevel: hasEmailAccess ? 'email_authorized' : 'public_only',
            userEmail: userEmail,
          },
        };
      } else {
        // AUTO-RESOLUTION FLOW - handle external links accessed via collection tokens

        // First, try to find collections containing this linkId as an external link
        const collectionsContainingLink = await db.execute(sql`
          SELECT c.id, c.name, c.type, c.user_id
          FROM collections c
          JOIN collection_external_links cel ON c.id = cel.collection_id
          WHERE cel.external_link_id = ${linkId}
        `);

        if (
          collectionsContainingLink.rows &&
          collectionsContainingLink.rows.length > 0
        ) {
          // AUTO-RESOLUTION: External link exists in collections, find valid shared link
          let validCollectionLink = null;
          let parentCollection = null;

          for (const collection of collectionsContainingLink.rows) {
            const collectionSharedLink = await db
              .select()
              .from(sharedLinks)
              .where(
                and(
                  eq(sharedLinks.linkType, 'collection'),
                  eq(sharedLinks.linkId, collection.id),
                  eq(sharedLinks.accessToken, token),
                  eq(sharedLinks.isActive, true),
                  gt(sharedLinks.expiresAt, new Date())
                )
              )
              .limit(1)
              .then((results) => results[0]);

            if (collectionSharedLink) {
              validCollectionLink = collectionSharedLink;
              parentCollection = collection;
              break;
            }
          }

          if (!validCollectionLink) {
            throw new Error(
              'No valid shared collection found for this external link'
            );
          }

          // Validate email access using the collection's shared link
          const hasEmailAccess = isEmailAllowed(
            userEmail,
            validCollectionLink.sharedWithEmail
          );

          // Get the external link with proper user context
          const userId = validCollectionLink.createdByUserId;
          const fullExternalLink = await getExternalLinkByIdService(
            linkId,
            userId
          );

          if (!fullExternalLink) {
            throw new Error('External link not found');
          }

          // Check visibility access
          if (fullExternalLink.visibility === 'private' && !hasEmailAccess) {
            throw new Error(
              'Access denied: This content is private and requires email authorization'
            );
          }

          // Get link groups
          const linkGroups = await getLinkGroupByIdServiceShared(
            fullExternalLink.id
          );

          // Process the content
          let content = {
            ...fullExternalLink,
            linkGroups: linkGroups,
            timestamps: isYoutubeUrl(fullExternalLink.url)
              ? parseTimestamps(fullExternalLink.description)
              : null,
          };

          // Handle attachments with presigned URLs
          if (
            content.attachments &&
            Array.isArray(content.attachments) &&
            content.attachments.length > 0
          ) {
            content.attachments = await Promise.all(
              content.attachments.map(async (attachment) => {
                if (attachment && attachment.imageKey) {
                  attachment.presignedUrl = generatePresignedCloudFrontUrl(
                    attachment.imageKey,
                    3600
                  );
                }
                return attachment;
              })
            );
          }

          // Filter content based on email access
          const filteredContent = filterContentByVisibility(
            content,
            hasEmailAccess
          );
          const hydratedContent = await hydrateSharedLinkNotationMedia(
            filteredContent
          );
          const formattedContent = snakeToCamelCase(hydratedContent);

          // Increment view count for the collection shared link
          await db
            .update(sharedLinks)
            .set({
              viewCount: sql`COALESCE(${sharedLinks.viewCount}, 0) + 1`,
              lastViewedAt: new Date(),
            })
            .where(eq(sharedLinks.id, validCollectionLink.id));

          return {
            content: formattedContent,
            metadata: {
              type: 'external_link',
              parentCollection: {
                id: parentCollection.id,
                name: parentCollection.name,
              },
              accessLevel: hasEmailAccess ? 'email_authorized' : 'public_only',
              expiresAt: validCollectionLink.expiresAt,
              createdAt: validCollectionLink.createdAt,
              viewCount: validCollectionLink.viewCount + 1,
              linkId: validCollectionLink.id,
              userEmail: userEmail,
              resolvedVia: 'collection_shared_link',
            },
          };
        }

        // If not found in collections, try the original collection → external link flow
        if (decodedToken.type !== 'collection') {
          throw new Error('Shared link not found or has expired');
        }

        const collectionId = decodedToken.id;

        // Verify the collection token is valid
        const collectionLink = await db
          .select()
          .from(sharedLinks)
          .where(
            and(
              eq(sharedLinks.linkId, collectionId),
              eq(sharedLinks.accessToken, token),
              eq(sharedLinks.isActive, true),
              gt(sharedLinks.expiresAt, new Date())
            )
          )
          .limit(1)
          .then((results) => results[0]);

        if (!collectionLink) {
          throw new Error('Collection access has expired or been revoked');
        }

        // Validate email access for collection
        const collectionEmailValidation =
          await sharedLinkService.validateEmailAccess(
            collectionLink.id,
            userEmail
          );
        const hasCollectionEmailAccess = collectionEmailValidation.hasAccess;

        const userId = collectionLink.createdByUserId;

        // Get the external link content
        const externalLinkContent = await getExternalLinkByIdService(
          linkId,
          userId
        );
        if (!externalLinkContent) {
          throw new Error('External link not found');
        }

        // Verify the external link belongs to the collection
        const collectionCheck = await db.execute(sql`
          SELECT 1 
          FROM collection_external_links cel
          WHERE cel.collection_id = ${collectionId} 
          AND cel.external_link_id = ${linkId}
          LIMIT 1
        `);

        if (!collectionCheck.rows || collectionCheck.rows.length === 0) {
          throw new Error(
            'Access denied: External link is not part of the shared collection'
          );
        }

        // Check visibility access
        if (
          externalLinkContent.visibility === 'private' &&
          !hasCollectionEmailAccess
        ) {
          throw new Error(
            'Access denied: This content is private and requires email authorization'
          );
        }

        // Return the external link content
        let content = {
          ...externalLinkContent,
          timestamps: isYoutubeUrl(externalLinkContent.url)
            ? parseTimestamps(externalLinkContent.description)
            : null,
        };

        // Process attachments if any
        if (
          content.attachments &&
          Array.isArray(content.attachments) &&
          content.attachments.length > 0
        ) {
          content.attachments = await Promise.all(
            content.attachments.map(async (attachment) => {
              if (attachment && attachment.imageKey) {
                attachment.presignedUrl = generatePresignedCloudFrontUrl(
                  attachment.imageKey,
                  3600
                );
              }
              return attachment;
            })
          );
        }

        // Filter content based on email access
        const filteredContent = filterContentByVisibility(
          content,
          hasCollectionEmailAccess
        );
        const hydratedContent = await hydrateSharedLinkNotationMedia(
          filteredContent
        );
        const formattedContent = snakeToCamelCase(hydratedContent);

        return {
          content: formattedContent,
          metadata: {
            type: 'external_link',
            accessedViaCollection: true,
            collectionId: collectionId,
            linkId: collectionLink.id,
            createdAt: collectionLink.createdAt,
            expiresAt: collectionLink.expiresAt,
            viewCount: collectionLink.viewCount + 1,
            accessLevel: hasCollectionEmailAccess
              ? 'email_authorized'
              : 'public_only',
            userEmail: userEmail,
            resolvedVia: 'collection_shared_link',
          },
        };
      }
    } catch (error) {
      console.error('Error validating shared link:', error);
      throw new Error(`Failed to validate shared link: ${error.message}`);
    }
  },

  // Get all shared links created by a user
  getUserSharedLinks: async (userId) => {
    try {
      const links = await db
        .select()
        .from(sharedLinks)
        .where(eq(sharedLinks.createdByUserId, userId))
        .orderBy(sql`${sharedLinks.createdAt} DESC`);

      return links.map((link) => ({
        ...link,
        shareUrl: `${process.env.FRONTEND_URL}/shared/${link.id}?token=${link.accessToken}`,
        isExpired: new Date(link.expiresAt) < new Date(),
      }));
    } catch (error) {
      console.error('Error fetching user shared links:', error);
      throw new Error('Failed to fetch shared links');
    }
  },

  // Revoke (deactivate) a shared link
  revokeSharedLink: async (linkId, userId) => {
    try {
      // First, get the shared link to check its type
      const sharedLink = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.id, linkId),
            eq(sharedLinks.createdByUserId, userId)
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (!sharedLink) {
        throw new Error(
          "Shared link not found or you don't have permission to revoke it"
        );
      }

      // If it's a collection, find and revoke any related external link shares
      if (sharedLink.linkType === 'collection') {
        // Get all external links for this collection
        const externalLinks = await getExternalLinksForCollectionByIdService(
          sharedLink.linkId,
          userId
        );

        if (externalLinks && externalLinks.external_links?.length > 0) {
          // Get all external link IDs
          const externalLinkIds = externalLinks.external_links.map(
            (link) => link.id
          );

          // Find and revoke any shared links for these external links created by the same user
          // with the same expiry date and access token (indicating they were created together)

          // Process each external link ID individually to avoid SQL syntax issues
          for (const linkId of externalLinkIds) {
            await db
              .update(sharedLinks)
              .set({
                isActive: false,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(sharedLinks.createdByUserId, userId),
                  eq(sharedLinks.linkType, 'external_link'),
                  eq(sharedLinks.expiresAt, sharedLink.expiresAt),
                  eq(sharedLinks.accessToken, sharedLink.accessToken),
                  eq(sharedLinks.linkId, linkId)
                )
              );
          }
        }
      }

      // Then revoke the main shared link
      const [revokedLink] = await db
        .update(sharedLinks)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(sharedLinks.id, linkId))
        .returning();

      return revokedLink;
    } catch (error) {
      console.error('Error revoking shared link:', error);
      throw new Error(`Failed to revoke shared link: ${error.message}`);
    }
  },

  // Update a shared link (e.g., change expiry date)
  updateSharedLink: async (linkId, userId, updates) => {
    try {
      const allowedUpdates = ['expiresAt', 'isActive'];
      const validUpdates = Object.keys(updates)
        .filter((key) => allowedUpdates.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        }, {});

      validUpdates.updatedAt = new Date();

      if (Object.keys(validUpdates).length <= 1) {
        throw new Error('No valid update fields provided');
      }

      const [updatedLink] = await db
        .update(sharedLinks)
        .set(validUpdates)
        .where(
          and(
            eq(sharedLinks.id, linkId),
            eq(sharedLinks.createdByUserId, userId)
          )
        )
        .returning();

      if (!updatedLink) {
        throw new Error(
          "Shared link not found or you don't have permission to update it"
        );
      }

      return {
        ...updatedLink,
        shareUrl: `${process.env.FRONTEND_URL}/shared/${updatedLink.id}?token=${updatedLink.accessToken}`,
      };
    } catch (error) {
      console.error('Error updating shared link:', error);
      throw new Error(`Failed to update shared link: ${error.message}`);
    }
  },

  // Get shared link by ID
  getSharedLinkById: async (linkId) => {
    try {
      const link = await db
        .select()
        .from(sharedLinks)
        .where(eq(sharedLinks.id, linkId))
        .limit(1)
        .then((results) => results[0]);

      if (!link) {
        throw new Error('Shared link not found');
      }

      return {
        ...link,
        shareUrl: `${process.env.FRONTEND_URL}/shared/${link.id}?token=${link.accessToken}`,
        isExpired: new Date(link.expiresAt) < new Date(),
      };
    } catch (error) {
      console.error('Error fetching shared link by ID:', error);
      throw new Error(`Failed to fetch shared link: ${error.message}`);
    }
  },

  // Get shared links by type and ID
  getSharedLinksByTypeAndId: async (type, id, userId) => {
    try {
      const links = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.linkType, type),
            eq(sharedLinks.linkId, id),
            eq(sharedLinks.createdByUserId, userId)
          )
        )
        .orderBy(sql`${sharedLinks.createdAt} DESC`);

      return links.map((link) => ({
        ...link,
        shareUrl: `${process.env.FRONTEND_URL}/shared/${link.id}?token=${link.accessToken}`,
        isExpired: new Date(link.expiresAt) < new Date(),
      }));
    } catch (error) {
      console.error('Error fetching shared links by type and ID:', error);
      throw new Error(`Failed to fetch shared links: ${error.message}`);
    }
  },

  // Add reviewer for a shared link
  addReviewer: async (linkId, token, firstName, lastName, email) => {
    try {
      // First check if the shared link exists and is active
      const sharedLink = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.id, linkId),
            eq(sharedLinks.isActive, true),
            gt(sharedLinks.expiresAt, new Date())
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (!sharedLink) {
        throw new Error('Shared link not found or has expired');
      }

      // Verify token if provided
      if (token && token !== sharedLink.accessToken) {
        try {
          jwt.verify(token, JWT_SECRET);
        } catch (error) {
          throw new Error('Invalid or expired token');
        }
      }

      // Check if reviewer with this email already exists
      let reviewer = await db
        .select()
        .from(reviewers)
        .where(eq(reviewers.email, email))
        .limit(1)
        .then((results) => results[0]);

      // If reviewer doesn't exist, create one
      if (!reviewer) {
        // Validate required fields
        if (!firstName || !lastName || !email) {
          console.error('Missing required fields:', {
            firstName,
            lastName,
            email,
          });
          throw new Error(
            'First name, last name, and email are required for creating a reviewer'
          );
        }

        try {
          [reviewer] = await db
            .insert(reviewers)
            .values({
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim(),
            })
            .returning();
        } catch (error) {
          console.error('Failed to create reviewer:', {
            input: { firstName, lastName, email },
            error,
          });
          throw error;
        }
      }

      // Check if this reviewer is already associated with this shared link
      const existingReview = await db
        .select()
        .from(sharedLinkReviews)
        .where(
          and(
            eq(sharedLinkReviews.sharedLinkId, linkId),
            eq(sharedLinkReviews.reviewerId, reviewer.id),
            eq(sharedLinkReviews.type, 'reviewer_info')
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (existingReview) {
        return {
          userInfo: {
            id: existingReview.id,
            reviewerId: reviewer.id,
            firstName: reviewer.firstName,
            lastName: reviewer.lastName,
            email: reviewer.email,
          },
          reviewStatus: existingReview.metadata.reviewStatus || 'in_progress',
        };
      }

      // Create new reviewer record for this shared link
      const [reviewRecord] = await db
        .insert(sharedLinkReviews)
        .values({
          sharedLinkId: linkId,
          reviewerId: reviewer.id,
          firstName: firstName,
          lastName: lastName,
          email: email,
          type: 'reviewer_info',
          metadata: {
            reviewStatus: 'in_progress',
          },
        })
        .returning();

      return {
        id: reviewRecord.id,
        reviewerId: reviewer.id,
        firstName: reviewer.firstName,
        lastName: reviewer.lastName,
        email: reviewer.email,
        reviewStatus: 'in_progress',
      };
    } catch (error) {
      console.error('Error adding reviewer:', error);
      throw new Error(`Failed to add reviewer: ${error.message}`);
    }
  },

  // Add feedback for a shared link item
  addFeedback: async (linkId, itemId, reviewerId, action, note) => {
    try {
      // Check if the shared link exists and is active
      const sharedLink = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.id, linkId),
            eq(sharedLinks.isActive, true),
            gt(sharedLinks.expiresAt, new Date())
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (!sharedLink) {
        throw new Error('Shared link not found or has expired');
      }

      // Check if reviewer exists
      const reviewer = await db
        .select()
        .from(reviewers)
        .where(eq(reviewers.id, reviewerId))
        .limit(1)
        .then((results) => results[0]);

      if (!reviewer) {
        throw new Error('Reviewer not found');
      }

      // Check if reviewer is associated with this shared link
      const reviewerAssociation = await db
        .select()
        .from(sharedLinkReviews)
        .where(
          and(
            eq(sharedLinkReviews.sharedLinkId, linkId),
            eq(sharedLinkReviews.reviewerId, reviewerId),
            eq(sharedLinkReviews.type, 'reviewer_info')
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (!reviewerAssociation) {
        throw new Error('Reviewer is not associated with this shared link');
      }

      // Add the feedback
      const [feedback] = await db
        .insert(sharedLinkReviews)
        .values({
          sharedLinkId: linkId,
          reviewerId: reviewerId,
          type: 'feedback',
          itemId: itemId,
          metadata: {
            action,
            note: note || null,
            timestamp: new Date().toISOString(),
          },
        })
        .returning();

      return {
        id: feedback.id,
        reviewerId,
        action: feedback.metadata.action,
        note: feedback.metadata.note,
        timestamp: feedback.metadata.timestamp,
        reviewerName: `${reviewer.first_name} ${reviewer.last_name}`,
        email: reviewer.email,
        itemId,
      };
    } catch (error) {
      console.error('Error adding feedback:', error);
      throw new Error(`Failed to add feedback: ${error.message}`);
    }
  },

  // Submit a review for a shared link
  submitReview: async (linkId, userId, feedbackData) => {
    try {
      // Check if the shared link exists and is active
      const sharedLink = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.id, linkId),
            eq(sharedLinks.isActive, true),
            gt(sharedLinks.expiresAt, new Date())
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (!sharedLink) {
        throw new Error('Shared link not found or has expired');
      }

      // Check if user is approved for this shared link
      const isApproved = await db
        .select()
        .from(sharedLinkApprovedUsers)
        .where(
          and(
            eq(sharedLinkApprovedUsers.sharedLinkId, linkId),
            eq(sharedLinkApprovedUsers.userId, userId)
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (!isApproved) {
        throw new Error('User is not approved for this shared link');
      }

      // Process any new feedback items if provided
      if (feedbackData && Object.keys(feedbackData).length > 0) {
        for (const itemId in feedbackData) {
          const feedbackItems = feedbackData[itemId];
          if (Array.isArray(feedbackItems) && feedbackItems.length > 0) {
            // Just use the latest feedback item for each item
            const latestFeedback = feedbackItems[feedbackItems.length - 1];

            await db.insert(sharedLinkReviews).values({
              sharedLinkId: linkId,
              userId: userId,
              type: 'feedback',
              itemId: itemId,
              metadata: {
                action: latestFeedback.action,
                note: latestFeedback.note || null,
                timestamp: new Date().toISOString(),
              },
            });
          }
        }
      }

      // Update the shared link last_viewed_at
      await db
        .update(sharedLinks)
        .set({
          lastViewedAt: new Date(),
        })
        .where(eq(sharedLinks.id, linkId));

      return {
        id: submission.id,
        userId,
      };
    } catch (error) {
      console.error('Error submitting review:', error);
      throw new Error(`Failed to submit review: ${error.message}`);
    }
  },

  // Get review status for a shared link
  getReviewStatus: async (linkId, token) => {
    try {
      // Verify the shared link is valid
      let decodedToken;
      let collectionLink = null;

      if (token) {
        try {
          decodedToken = jwt.verify(token, JWT_SECRET);
        } catch (error) {
          throw new Error('Invalid or expired token');
        }

        // Handle collection → external link flow
        if (decodedToken.type === 'collection') {
          // Find the collection shared link first
          collectionLink = await db
            .select()
            .from(sharedLinks)
            .where(
              and(
                eq(sharedLinks.linkId, decodedToken.id),
                eq(sharedLinks.accessToken, token),
                eq(sharedLinks.isActive, true),
                gt(sharedLinks.expiresAt, new Date())
              )
            )
            .limit(1)
            .then((results) => results[0]);

          if (!collectionLink) {
            throw new Error('Collection access has expired or been revoked');
          }

          // Now find the related external link shared link
          const relatedLink = await db
            .select()
            .from(sharedLinks)
            .where(
              and(
                eq(sharedLinks.linkId, linkId),
                eq(sharedLinks.linkType, 'external_link'),
                eq(sharedLinks.createdByUserId, collectionLink.createdByUserId),
                eq(sharedLinks.accessToken, collectionLink.accessToken),
                eq(sharedLinks.expiresAt, collectionLink.expiresAt),
                eq(sharedLinks.isActive, true)
              )
            )
            .limit(1)
            .then((results) => results[0]);

          // Use the collection's shared link if we can't find a specific external link share
          const sharedLink = relatedLink || collectionLink;
          linkId = sharedLink.id;
        }
      }

      // Find the shared link
      const sharedLink = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.id, linkId),
            eq(sharedLinks.isActive, true),
            gt(sharedLinks.expiresAt, new Date())
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (!sharedLink) {
        throw new Error('Shared link not found or has expired');
      }

      // Get all reviewer associations for this link
      const reviewerAssociations = await db
        .select({
          id: sharedLinkReviews.id,
          userId: sharedLinkReviews.userId,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          metadata: sharedLinkReviews.metadata,
        })
        .from(sharedLinkReviews)
        .leftJoin(users, eq(sharedLinkReviews.userId, users.id))
        .where(
          and(
            eq(sharedLinkReviews.sharedLinkId, linkId),
            eq(sharedLinkReviews.type, 'reviewer_info')
          )
        );

      // Get reviewer details
      const reviewerIds = reviewerAssociations.map((r) => r.userId);
      const reviewerDetails = await db
        .select()
        .from(users)
        .where(inArray(users.id, reviewerIds));

      // Map reviewer details for quick lookup
      const reviewerMap = reviewerDetails.reduce((map, r) => {
        map[r.id] = r;
        return map;
      }, {});

      // Get all feedback for this link
      const feedback = await db
        .select()
        .from(sharedLinkReviews)
        .where(
          and(
            eq(sharedLinkReviews.sharedLinkId, linkId),
            eq(sharedLinkReviews.type, 'feedback')
          )
        );

      // Get all review submissions
      const submissions = await db
        .select()
        .from(sharedLinkReviews)
        .where(
          and(
            eq(sharedLinkReviews.sharedLinkId, linkId),
            eq(sharedLinkReviews.type, 'review_submission')
          )
        );

      // Organize feedback by reviewer and item
      const organizedFeedback = {};
      reviewerIds.forEach((userId) => {
        organizedFeedback[userId] = {};

        // Filter feedback for this reviewer
        const reviewerFeedback = feedback.filter((f) => f.userId === userId);

        // Group by itemId
        reviewerFeedback.forEach((fb) => {
          if (!organizedFeedback[userId][fb.itemId]) {
            organizedFeedback[userId][fb.itemId] = [];
          }

          const reviewer = reviewerMap[userId];
          organizedFeedback[userId][fb.itemId].push({
            id: fb.id,
            action: fb.metadata.action,
            note: fb.metadata.note,
            timestamp: fb.metadata.timestamp,
            from: `${reviewer.firstName} ${reviewer.lastName}`,
            email: reviewer.email,
          });
        });
      });

      // Prepare response
      return {
        linkId,
        linkType: sharedLink.linkType,
        status: {
          totalReviewers: reviewerAssociations.length,
          completedReviews: submissions.length,
          reviewers: reviewerAssociations.map((association) => {
            const userId = association.userId;
            const reviewer = reviewerMap[userId];

            return {
              id: userId,
              firstName: reviewer.firstName,
              lastName: reviewer.lastName,
              email: reviewer.email,
              status: association.metadata.reviewStatus || 'not_started',
              completedAt:
                association.metadata.reviewStatus === 'completed'
                  ? submissions.find((s) => s.userId === userId)?.metadata
                      .completedAt
                  : null,
              feedback: organizedFeedback[userId] || {},
            };
          }),
        },
      };
    } catch (error) {
      console.error('Error getting review status:', error);
      throw new Error(`Failed to get review status: ${error.message}`);
    }
  },

  // Get all link groups for a shared link that are public or unlisted
  getAllSharedLinkGroups: async (linkId, token, userEmail) => {
    try {
      // Verify token validity
      let decodedToken;
      try {
        decodedToken = jwt.verify(token, JWT_SECRET);
      } catch (error) {
        throw new Error('Invalid or expired token');
      }

      // Find the shared link
      const sharedLink = await db
        .select()
        .from(sharedLinks)
        .where(
          and(
            eq(sharedLinks.linkId, linkId),
            eq(sharedLinks.accessToken, token),
            eq(sharedLinks.isActive, true),
            gt(sharedLinks.expiresAt, new Date())
          )
        )
        .limit(1)
        .then((results) => results[0]);

      if (!sharedLink) {
        throw new Error('Link is invalid or has expired');
      }

      // Validate email access
      const hasEmailAccess = isEmailAllowed(
        userEmail,
        sharedLink.sharedWithEmail
      );

      // Check if the link is for an external link
      if (sharedLink.linkType !== 'external_link') {
        throw new Error('Link groups are only available for external links');
      }

      // Get all link groups for this external link
      const linkGroups = await getLinkGroupByIdServiceShared(sharedLink.linkId);

      // Filter link groups based on visibility and email access
      if (!linkGroups) return [];

      const filteredGroups = filterGroupedLinkGroupsByVisibility(
        linkGroups,
        hasEmailAccess
      );

      return filteredGroups;
    } catch (error) {
      console.error('Error getting shared link groups:', error);
      throw new Error(`Failed to get link groups: ${error.message}`);
    }
  },
};
