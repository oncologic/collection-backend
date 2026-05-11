import { db } from '../db/index.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { collections, collectionResources } from '../models/collections.js';
import { resources } from '../models/resources.js';
import {
  externalLinks,
  collectionExternalLinks,
  collectionTypeOrdering,
} from '../models/external_links.js';
import { attachments } from '../models/attachments.js';
import { externalLinkAttachments } from '../models/externalLinkAttachments.js';
import { linkGroups } from '../models/linkGroup.js';
import { collectionExternalLinksNotations } from '../models/collectionExternalLinksNotations.js';
import {
  collectionExternalLinkTagDefinitions,
  collectionExternalLinkTags,
} from '../models/collectionExternalLinkTags.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import {
  expertiseLevels,
  resourceTypes,
  sensitivityLevels,
  targetAudiences,
} from '../models/metadata.js';
import { collectionExternalLinkResources } from '../models/collectionExternalLinkResources.js';
import { socialMediaAssociations, socialMediaAccounts, socialMediaPlatforms } from '../models/socialMedia.js';
import { socialMediaAccountTypes } from '../models/socialMediaAccountTypes.js';
import { organizations } from '../models/organizations.js';
import { collectionExternalLinkNotationTags } from '../models/collectionExternalLinksNotations.js';
import { hydrateNotationMediaService } from './notationService.js';

const PUBLIC_SHAREABLE_VISIBILITIES = ['public', 'unlisted'];

/**
 * Get public collection data by ID
 * Only returns data if collection has publicJsonEnabled=true
 */
export const getPublicCollectionService = async (collectionId) => {
  try {
    // First check if collection exists and is publicly shareable
    const collection = await db
      .select({
        id: collections.id,
        name: collections.name,
        description: collections.description,
        visibility: collections.visibility,
        status: collections.status,
        icon: collections.icon,
        color: collections.color,
        type: collections.type,
        startDate: collections.startDate,
        endDate: collections.endDate,
        hashtags: collections.hashtags,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        publicJsonEnabled: collections.publicJsonEnabled,
      })
      .from(collections)
      .where(
        and(
          eq(collections.id, collectionId),
          eq(collections.publicJsonEnabled, true),
          inArray(collections.visibility, PUBLIC_SHAREABLE_VISIBILITIES)
        )
      )
      .limit(1);

    if (!collection.length) {
      return null;
    }

    const collectionData = collection[0];

    // For resource collections, fetch resources instead of external links
    if (collectionData.type === 'resource') {
      // Get all resources for this collection
      const resourcesData = await db
        .select({
          id: resources.id,
          url: resources.url,
          name: resources.name,
          description: resources.description,
          resourceDate: resources.resourceDate,
          resourceUpdatedDate: resources.resourceUpdatedDate,
          buttonName: resources.buttonName,
          requiresRegistration: resources.requiresRegistration,
          videoUrl: resources.videoUrl,
          videoKey: resources.videoKey,
          videoMetadata: resources.videoMetadata,
          imageKey: resources.imageKey,
          imageMetadata: resources.imageMetadata,
          timestamps: resources.timestamps,
          fullText: resources.fullText,
          createdAt: resources.createdAt,
          updatedAt: resources.updatedAt,
          featured: resources.featured,
          listOrder: resources.listOrder,
          typeId: resources.typeId,
          sensitivityLevelId: resources.sensitivityLevelId,
          expertiseLevelId: resources.expertiseLevelId,
          targetAudienceId: resources.targetAudienceId,
          collectionNotes: collectionResources.notes,
          collectionStatus: collectionResources.status,
          collectionOrderPosition: collectionResources.orderPosition,
        })
        .from(resources)
        .innerJoin(
          collectionResources,
          eq(resources.id, collectionResources.resourceId)
        )
        .leftJoin(resourceTypes, eq(resources.typeId, resourceTypes.id))
        .leftJoin(
          sensitivityLevels,
          eq(resources.sensitivityLevelId, sensitivityLevels.id)
        )
        .leftJoin(
          expertiseLevels,
          eq(resources.expertiseLevelId, expertiseLevels.id)
        )
        .leftJoin(
          targetAudiences,
          eq(resources.targetAudienceId, targetAudiences.id)
        )
        .where(
          and(
            eq(collectionResources.collectionId, collectionId),
            eq(resources.status, 'approved')
          )
        )
        .orderBy(collectionResources.orderPosition);

      // Generate presigned URLs for resources
      const resourcesWithPresignedUrls = await Promise.all(
        resourcesData.map(async (resource) => {
          const resourceData = { ...resource };

          // Generate presigned URL for resource image
          if (resourceData.imageKey) {
            resourceData.presignedImageUrl = generatePresignedCloudFrontUrl(
              resourceData.imageKey,
              3600
            );
          }

          // Generate presigned URL for resource video
          if (resourceData.videoKey) {
            resourceData.presignedVideoUrl = generatePresignedCloudFrontUrl(
              resourceData.videoKey,
              3600
            );
          }

          return resourceData;
        })
      );

      return {
        ...collectionData,
        resources: resourcesWithPresignedUrls,
        externalLinks: [], // Empty for resource collections
        typeOrdering: {},
      };
    }

    // For external link collections, use the existing logic
    // Get all external links for this collection that are not private
    const externalLinksData = await db
      .select({
        id: externalLinks.id,
        url: externalLinks.url,
        name: externalLinks.name,
        description: externalLinks.description,
        notes: externalLinks.notes,
        dateAdded: externalLinks.dateAdded,
        visibility: externalLinks.visibility,
        type: externalLinks.type,
        imageKey: externalLinks.imageKey,
        imageMetadata: externalLinks.imageMetadata,
        imageUrl: externalLinks.imageUrl,
        timestamps: externalLinks.timestamps,
        startTime: externalLinks.startTime,
        endTime: externalLinks.endTime,
        timezone: externalLinks.timezone,
        fullText: externalLinks.fullText,
        createdAt: externalLinks.createdAt,
        updatedAt: externalLinks.updatedAt,
        collectionNotes: collectionExternalLinks.notes,
        date: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        collectionDate: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        startDate: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        endDate: sql`COALESCE(${collectionExternalLinks.endDate}, ${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        status: collectionExternalLinks.status,
        collectionStatus: collectionExternalLinks.status,
        collectionExternalLinkId: collectionExternalLinks.id,
        sortOrder: collectionExternalLinks.sortOrder,
        allowPublicNotations: externalLinks.allowPublicNotations,
      })
      .from(externalLinks)
      .innerJoin(
        collectionExternalLinks,
        eq(externalLinks.id, collectionExternalLinks.externalLinkId)
      )
      .where(
        and(
          eq(collectionExternalLinks.collectionId, collectionId),
          inArray(externalLinks.visibility, PUBLIC_SHAREABLE_VISIBILITIES)
        )
      );

    // Get type ordering for this collection
    const typeOrderingData = await db
      .select({
        type: collectionTypeOrdering.type,
        sortOrder: collectionTypeOrdering.sortOrder,
      })
      .from(collectionTypeOrdering)
      .where(eq(collectionTypeOrdering.collectionId, collectionId));

    // Convert type ordering to object
    const typeOrdering = {};
    typeOrderingData.forEach((item) => {
      typeOrdering[item.type] = item.sortOrder;
    });

    // Get attachments for all external links
    const allAttachments = {};
    const allNotations = {};
    const allLinkGroups = {};
    const allTags = {};
    const allResources = {};

    for (const link of externalLinksData) {
      // Get attachments that are not private
      const linkAttachments = await db
        .select({
          id: attachments.id,
          title: attachments.title,
          description: attachments.description,
          type: attachments.type,
          imageKey: attachments.imageKey,
          listOrder: attachments.listOrder,
          visibility: attachments.visibility,
          createdAt: attachments.createdAt,
          updatedAt: attachments.updatedAt,
        })
        .from(attachments)
        .innerJoin(
          externalLinkAttachments,
          eq(attachments.id, externalLinkAttachments.attachmentId)
        )
        .where(
          and(
            eq(externalLinkAttachments.externalLinkId, link.id),
            inArray(attachments.visibility, PUBLIC_SHAREABLE_VISIBILITIES)
          )
        );

      allAttachments[link.id] = linkAttachments;

      // Get notations that are not private
      const linkNotations = await db
        .select({
          id: collectionExternalLinksNotations.id,
          title: collectionExternalLinksNotations.title,
          description: collectionExternalLinksNotations.description,
          notes: collectionExternalLinksNotations.notes,
          category: collectionExternalLinksNotations.category,
          status: collectionExternalLinksNotations.status,
          highlighted: collectionExternalLinksNotations.highlighted,
          listOrder: collectionExternalLinksNotations.listOrder,
          visibility: collectionExternalLinksNotations.visibility,
          date: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
          startDate: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
          endDate: sql`COALESCE(${collectionExternalLinksNotations.endDate}, ${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
          startTime: collectionExternalLinksNotations.startTime,
          endTime: collectionExternalLinksNotations.endTime,
          timezone: collectionExternalLinksNotations.timezone,
          type: collectionExternalLinksNotations.type,
          customFields: collectionExternalLinksNotations.customFields,
          createdAt: collectionExternalLinksNotations.createdAt,
          updatedAt: collectionExternalLinksNotations.updatedAt,
        })
        .from(collectionExternalLinksNotations)
        .where(
          and(
            eq(
              collectionExternalLinksNotations.collectionExternalLinkId,
              link.collectionExternalLinkId
            ),
            inArray(
              collectionExternalLinksNotations.visibility,
              PUBLIC_SHAREABLE_VISIBILITIES
            )
          )
        );

      allNotations[link.id] = await hydrateNotationMediaService(
        linkNotations,
        {
          accessMode: 'signed',
          expiresInSeconds: 3600,
          allowedAttachmentVisibilities: ['public', 'unlisted'],
        }
      );

      // Get link groups for this external link that are not private
      const linkGroupsData = await db
        .select({
          id: linkGroups.id,
          date: linkGroups.date,
          name: linkGroups.name,
          description: linkGroups.description,
          url: linkGroups.url,
          category: linkGroups.category,
          linkingId: linkGroups.linkingId,
          linkingType: linkGroups.linkingType,
          visibility: linkGroups.visibility,
          createdAt: linkGroups.createdAt,
          updatedAt: linkGroups.updatedAt,
        })
        .from(linkGroups)
        .where(
          and(
            eq(linkGroups.linkingId, link.id),
            eq(linkGroups.linkingType, 'external_link'),
            inArray(linkGroups.visibility, PUBLIC_SHAREABLE_VISIBILITIES)
          )
        );

      allLinkGroups[link.id] = linkGroupsData;

      // Get tags for this external link
      const linkTags = await db
        .select({
          id: collectionExternalLinkTagDefinitions.id,
          name: collectionExternalLinkTagDefinitions.name,
          description: collectionExternalLinkTagDefinitions.description,
          color: collectionExternalLinkTagDefinitions.color,
        })
        .from(collectionExternalLinkTags)
        .innerJoin(
          collectionExternalLinkTagDefinitions,
          eq(
            collectionExternalLinkTags.tagId,
            collectionExternalLinkTagDefinitions.id
          )
        )
        .where(
          eq(
            collectionExternalLinkTags.collectionExternalLinkId,
            link.collectionExternalLinkId
          )
        )
        .orderBy(collectionExternalLinkTagDefinitions.name);

      allTags[link.id] = linkTags;

      const resourcesData = await db
        .select({
          id: resources.id,
          url: resources.url,
          name: resources.name,
          description: resources.description,
          resourceDate: resources.resourceDate,
          resourceUpdatedDate: resources.resourceUpdatedDate,
          buttonName: resources.buttonName,
          requiresRegistration: resources.requiresRegistration,
          videoUrl: resources.videoUrl,
          videoKey: resources.videoKey,
          videoMetadata: resources.videoMetadata,
          imageKey: resources.imageKey,
          imageMetadata: resources.imageMetadata,
          timestamps: resources.timestamps,
          fullText: resources.fullText,
          createdAt: resources.createdAt,
          updatedAt: resources.updatedAt,
          featured: resources.featured,
          listOrder: resources.listOrder,
          typeId: resources.typeId,
          sensitivityLevelId: resources.sensitivityLevelId,
          expertiseLevelId: resources.expertiseLevelId,
          targetAudienceId: resources.targetAudienceId,
          notes: collectionExternalLinkResources.notes,
          orderPosition: collectionExternalLinkResources.orderPosition,
        })
        .from(resources)
        .innerJoin(
          collectionExternalLinkResources,
          eq(resources.id, collectionExternalLinkResources.resourceId)
        )
        .where(
          and(
            eq(collectionExternalLinkResources.externalLinkId, link.id),
            eq(resources.status, 'approved')
          )
        )
        .orderBy(collectionExternalLinkResources.orderPosition);

      allResources[link.id] = await Promise.all(
        resourcesData.map(async (resource) => {
          const resourceData = { ...resource };

          if (resourceData.imageKey) {
            resourceData.presignedImageUrl = generatePresignedCloudFrontUrl(
              resourceData.imageKey,
              3600
            );
          }

          if (resourceData.videoKey) {
            resourceData.presignedVideoUrl = generatePresignedCloudFrontUrl(
              resourceData.videoKey,
              3600
            );
          }

          return resourceData;
        })
      );
    }

    // Get tags for all notations
    const allNotationIds = [];
    for (const linkId in allNotations) {
      allNotationIds.push(...allNotations[linkId].map(n => n.id));
    }

    let notationTagsData = [];
    if (allNotationIds.length > 0) {
      notationTagsData = await db
        .select({
          notationId: collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
          tag: {
            id: collectionExternalLinkTagDefinitions.id,
            name: collectionExternalLinkTagDefinitions.name,
            description: collectionExternalLinkTagDefinitions.description,
            color: collectionExternalLinkTagDefinitions.color,
          },
        })
        .from(collectionExternalLinkNotationTags)
        .innerJoin(
          collectionExternalLinkTagDefinitions,
          eq(
            collectionExternalLinkNotationTags.tagId,
            collectionExternalLinkTagDefinitions.id
          )
        )
        .where(
          inArray(
            collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
            allNotationIds
          )
        )
        .orderBy(collectionExternalLinkTagDefinitions.name);
    }

    // Add tags to notations
    for (const linkId in allNotations) {
      allNotations[linkId] = allNotations[linkId].map((notation) => {
        const notationTags = notationTagsData
          .filter((tagData) => tagData.notationId === notation.id)
          .map(({ tag }) => tag);
        
        return {
          ...notation,
          tags: notationTags,
        };
      });
    }

    // Build the final response
    const externalLinksWithDetails = await Promise.all(
      externalLinksData.map(async (link) => {
        const linkData = {
          ...link,
          attachments: allAttachments[link.id] || [],
          notations: allNotations[link.id] || [],
          linkGroups: allLinkGroups[link.id] || [],
          tags: allTags[link.id] || [],
          resources: allResources[link.id] || [],
        };

        // Generate presigned URL for external link image
        if (linkData.imageKey) {
          linkData.presignedImageUrl = generatePresignedCloudFrontUrl(
            linkData.imageKey,
            3600
          );
        }

        // Generate presigned URLs for attachments
        if (linkData.attachments && linkData.attachments.length > 0) {
          linkData.attachments = await Promise.all(
            linkData.attachments.map(async (attachment) => {
              if (attachment.imageKey) {
                attachment.presignedUrl = generatePresignedCloudFrontUrl(
                  attachment.imageKey,
                  3600
                );
              }
              return attachment;
            })
          );
        }

        return linkData;
      })
    );

    return {
      ...collectionData,
      resources: [], // Empty for external link collections
      externalLinks: externalLinksWithDetails,
      typeOrdering: typeOrdering,
    };
  } catch (error) {
    console.error('Error fetching public collection:', error);
    throw error;
  }
};

/**
 * Get public external link data by ID
 * Only returns data if external link has publicJsonEnabled=true and visibility is not private
 */
export const getPublicExternalLinkService = async (externalLinkId) => {
  try {
    // Check if external link exists and is publicly shareable
    const externalLinkData = await db
      .select({
        id: externalLinks.id,
        url: externalLinks.url,
        name: externalLinks.name,
        description: externalLinks.description,
        notes: externalLinks.notes,
        dateAdded: externalLinks.dateAdded,
        visibility: externalLinks.visibility,
        type: externalLinks.type,
        imageKey: externalLinks.imageKey,
        imageMetadata: externalLinks.imageMetadata,
        imageUrl: externalLinks.imageUrl,
        timestamps: externalLinks.timestamps,
        startTime: externalLinks.startTime,
        endTime: externalLinks.endTime,
        timezone: externalLinks.timezone,
        date: sql`(
          SELECT COALESCE(cel.start_date, cel.date)
          FROM collection_external_links cel
          WHERE cel.external_link_id = ${externalLinks.id}
          LIMIT 1
        )`,
        startDate: sql`(
          SELECT COALESCE(cel.start_date, cel.date)
          FROM collection_external_links cel
          WHERE cel.external_link_id = ${externalLinks.id}
          LIMIT 1
        )`,
        endDate: sql`(
          SELECT COALESCE(cel.end_date, cel.start_date, cel.date)
          FROM collection_external_links cel
          WHERE cel.external_link_id = ${externalLinks.id}
          LIMIT 1
        )`,
        fullText: externalLinks.fullText,
        createdAt: externalLinks.createdAt,
        updatedAt: externalLinks.updatedAt,
        publicJsonEnabled: externalLinks.publicJsonEnabled,
        allowPublicNotations: externalLinks.allowPublicNotations,
      })
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.id, externalLinkId),
          eq(externalLinks.publicJsonEnabled, true),
          inArray(externalLinks.visibility, PUBLIC_SHAREABLE_VISIBILITIES)
        )
      )
      .limit(1);

    if (!externalLinkData.length) {
      return null;
    }

    const link = externalLinkData[0];

    // Generate presigned URL for external link image
    if (link.imageKey) {
      link.presignedImageUrl = generatePresignedCloudFrontUrl(
        link.imageKey,
        3600
      );
    }

    // Get attachments that are not private
    const attachmentsData = await db
      .select({
        id: attachments.id,
        title: attachments.title,
        description: attachments.description,
        type: attachments.type,
        imageKey: attachments.imageKey,
        listOrder: attachments.listOrder,
        visibility: attachments.visibility,
        createdAt: attachments.createdAt,
        updatedAt: attachments.updatedAt,
      })
      .from(attachments)
      .innerJoin(
        externalLinkAttachments,
        eq(attachments.id, externalLinkAttachments.attachmentId)
      )
      .where(
        and(
          eq(externalLinkAttachments.externalLinkId, externalLinkId),
          inArray(attachments.visibility, PUBLIC_SHAREABLE_VISIBILITIES)
        )
      );

    // Get link groups that are not private
    const linkGroupsData = await db
      .select({
        id: linkGroups.id,
        date: linkGroups.date,
        name: linkGroups.name,
        description: linkGroups.description,
        url: linkGroups.url,
        category: linkGroups.category,
        linkingId: linkGroups.linkingId,
        linkingType: linkGroups.linkingType,
        visibility: linkGroups.visibility,
        createdAt: linkGroups.createdAt,
        updatedAt: linkGroups.updatedAt,
      })
      .from(linkGroups)
      .where(
        and(
          eq(linkGroups.linkingId, externalLinkId),
          eq(linkGroups.linkingType, 'external_link'),
          inArray(linkGroups.visibility, PUBLIC_SHAREABLE_VISIBILITIES)
        )
      );

    // Get notations that are not private (from collections where this link appears)
    const notationsData = await db
      .select({
        id: collectionExternalLinksNotations.id,
        title: collectionExternalLinksNotations.title,
        description: collectionExternalLinksNotations.description,
        notes: collectionExternalLinksNotations.notes,
        category: collectionExternalLinksNotations.category,
        status: collectionExternalLinksNotations.status,
        highlighted: collectionExternalLinksNotations.highlighted,
        listOrder: collectionExternalLinksNotations.listOrder,
        visibility: collectionExternalLinksNotations.visibility,
        date: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        startDate: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        endDate: sql`COALESCE(${collectionExternalLinksNotations.endDate}, ${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        startTime: collectionExternalLinksNotations.startTime,
        endTime: collectionExternalLinksNotations.endTime,
        timezone: collectionExternalLinksNotations.timezone,
        type: collectionExternalLinksNotations.type,
        customFields: collectionExternalLinksNotations.customFields,
        createdAt: collectionExternalLinksNotations.createdAt,
        updatedAt: collectionExternalLinksNotations.updatedAt,
      })
      .from(collectionExternalLinksNotations)
      .innerJoin(
        collectionExternalLinks,
        eq(
          collectionExternalLinksNotations.collectionExternalLinkId,
          collectionExternalLinks.id
        )
      )
      .where(
        and(
          eq(collectionExternalLinks.externalLinkId, externalLinkId),
          inArray(
            collectionExternalLinksNotations.visibility,
            PUBLIC_SHAREABLE_VISIBILITIES
          )
        )
      );

    // Get tags for each notation
    let notationTagsData = [];
    if (notationsData.length > 0) {
      const notationIds = notationsData.map(n => n.id);
      notationTagsData = await db
        .select({
          notationId: collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
          tag: {
            id: collectionExternalLinkTagDefinitions.id,
            name: collectionExternalLinkTagDefinitions.name,
            description: collectionExternalLinkTagDefinitions.description,
            color: collectionExternalLinkTagDefinitions.color,
          },
        })
        .from(collectionExternalLinkNotationTags)
        .innerJoin(
          collectionExternalLinkTagDefinitions,
          eq(
            collectionExternalLinkNotationTags.tagId,
            collectionExternalLinkTagDefinitions.id
          )
        )
        .where(
          inArray(
            collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
            notationIds
          )
        )
        .orderBy(collectionExternalLinkTagDefinitions.name);
    }

    // Add tags to each notation
    const taggedNotations = notationsData.map((notation) => {
      const notationTags = notationTagsData
        .filter((tagData) => tagData.notationId === notation.id)
        .map(({ tag }) => tag);
      
      return {
        ...notation,
        tags: notationTags,
      };
    });

    const notationsWithTags = await hydrateNotationMediaService(
      taggedNotations,
      {
        accessMode: 'signed',
        expiresInSeconds: 3600,
        allowedAttachmentVisibilities: ['public', 'unlisted'],
      }
    );

    // Get tags for this external link (from all collections where it appears)
    const tagsData = await db
      .select({
        id: collectionExternalLinkTagDefinitions.id,
        name: collectionExternalLinkTagDefinitions.name,
        description: collectionExternalLinkTagDefinitions.description,
        color: collectionExternalLinkTagDefinitions.color,
      })
      .from(collectionExternalLinkTags)
      .innerJoin(
        collectionExternalLinkTagDefinitions,
        eq(
          collectionExternalLinkTags.tagId,
          collectionExternalLinkTagDefinitions.id
        )
      )
      .innerJoin(
        collectionExternalLinks,
        eq(
          collectionExternalLinkTags.collectionExternalLinkId,
          collectionExternalLinks.id
        )
      )
      .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
      .orderBy(collectionExternalLinkTagDefinitions.name);

    // Generate presigned URLs for attachments
    if (attachmentsData && attachmentsData.length > 0) {
      attachmentsData.forEach((attachment) => {
        if (attachment.imageKey) {
          attachment.presignedUrl = generatePresignedCloudFrontUrl(
            attachment.imageKey,
            3600
          );
        }
      });
    }

    // Get resources for this external link (from all collections where it appears)
    const resourcesData = await db
      .select({
        id: resources.id,
        url: resources.url,
        name: resources.name,
        description: resources.description,
        resourceDate: resources.resourceDate,
        resourceUpdatedDate: resources.resourceUpdatedDate,
        buttonName: resources.buttonName,
        requiresRegistration: resources.requiresRegistration,
        videoUrl: resources.videoUrl,
        videoKey: resources.videoKey,
        videoMetadata: resources.videoMetadata,
        imageKey: resources.imageKey,
        imageMetadata: resources.imageMetadata,
        timestamps: resources.timestamps,
        fullText: resources.fullText,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
        featured: resources.featured,
        listOrder: resources.listOrder,
        typeId: resources.typeId,
        sensitivityLevelId: resources.sensitivityLevelId,
        expertiseLevelId: resources.expertiseLevelId,
        targetAudienceId: resources.targetAudienceId,
        notes: collectionExternalLinkResources.notes,
        orderPosition: collectionExternalLinkResources.orderPosition,
      })
      .from(resources)
      .innerJoin(
        collectionExternalLinkResources,
        eq(resources.id, collectionExternalLinkResources.resourceId)
      )
      .where(
        and(
          eq(collectionExternalLinkResources.externalLinkId, externalLinkId),
          eq(resources.status, 'approved')
        )
      )
      .orderBy(collectionExternalLinkResources.orderPosition);

    // Generate presigned URLs for resources
    const resourcesWithPresignedUrls = await Promise.all(
      resourcesData.map(async (resource) => {
        const resourceData = { ...resource };

        // Generate presigned URL for resource image
        if (resourceData.imageKey) {
          resourceData.presignedImageUrl = generatePresignedCloudFrontUrl(
            resourceData.imageKey,
            3600
          );
        }

        // Generate presigned URL for resource video
        if (resourceData.videoKey) {
          resourceData.presignedVideoUrl = generatePresignedCloudFrontUrl(
            resourceData.videoKey,
            3600
          );
        }

        return resourceData;
      })
    );

    // Get social media accounts associated with this external link
    const socialMediaAccountsData = await db
      .select({
        id: socialMediaAssociations.id,
        socialMediaAccountId: socialMediaAssociations.socialMediaAccountId,
        associatedId: socialMediaAssociations.associatedId,
        associatedType: socialMediaAssociations.associatedType,
        createdAt: socialMediaAssociations.createdAt,
        // Account details
        accountId: socialMediaAccounts.id,
        accountName: socialMediaAccounts.name,
        accountHandle: socialMediaAccounts.handle,
        accountUrl: socialMediaAccounts.url,
        accountDescription: socialMediaAccounts.description,
        accountTypeId: socialMediaAccounts.accountTypeId,
        accountTitle: socialMediaAccounts.title,
        accountVisibility: socialMediaAccounts.visibility,
        // Account type details
        accountTypeName: socialMediaAccountTypes.name,
        accountTypeColor: socialMediaAccountTypes.color,
        accountTypeIcon: socialMediaAccountTypes.icon,
        // Platform details
        platformId: socialMediaPlatforms.id,
        platformName: socialMediaPlatforms.name,
        platformIcon: socialMediaPlatforms.icon,
        // Organization details
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationImageKey: organizations.imageKey,
      })
      .from(socialMediaAssociations)
      .innerJoin(
        socialMediaAccounts,
        eq(socialMediaAssociations.socialMediaAccountId, socialMediaAccounts.id)
      )
      .leftJoin(
        socialMediaPlatforms,
        eq(socialMediaAccounts.platformId, socialMediaPlatforms.id)
      )
      .leftJoin(
        organizations,
        eq(socialMediaAccounts.organizationId, organizations.id)
      )
      .leftJoin(
        socialMediaAccountTypes,
        eq(socialMediaAccounts.accountTypeId, socialMediaAccountTypes.id)
      )
      .where(
        and(
          eq(socialMediaAssociations.associatedId, externalLinkId),
          eq(socialMediaAssociations.associatedType, 'external_link'),
          inArray(
            socialMediaAccounts.visibility,
            PUBLIC_SHAREABLE_VISIBILITIES
          )
        )
      );

    // Format social media accounts with organization image URLs
    const formattedSocialMediaAccounts = socialMediaAccountsData.map((association) => ({
      id: association.accountId,
      name: association.accountName,
      handle: association.accountHandle,
      url: association.accountUrl,
      description: association.accountDescription,
      accountTypeId: association.accountTypeId,
      accountTypeName: association.accountTypeName,
      accountTypeColor: association.accountTypeColor,
      accountTypeIcon: association.accountTypeIcon,
      title: association.accountTitle,
      visibility: association.accountVisibility,
      platform: {
        id: association.platformId,
        name: association.platformName,
        icon: association.platformIcon,
      },
      organization: association.organizationId
        ? {
            id: association.organizationId,
            name: association.organizationName,
            imageUrl: association.organizationImageKey
              ? generatePresignedCloudFrontUrl(
                  association.organizationImageKey
                )
              : null,
          }
        : null,
    }));

    return {
      ...link,
      attachments: attachmentsData,
      linkGroups: linkGroupsData,
      notations: notationsWithTags,
      tags: tagsData,
      resources: resourcesWithPresignedUrls,
      socialMediaAccounts: formattedSocialMediaAccounts,
    };
  } catch (error) {
    console.error('Error fetching public external link:', error);
    throw error;
  }
};
