import { db } from '../db/index.js';
import { organizations, organizationTags, organizationResources } from '../models/organizations.js';
import { resources, resourceTags } from '../models/resources.js';
import { tags } from '../models/tags.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  createResourceService,
  deleteResourcesService,
} from './resourceService.js';
import { createOrganizationService } from './organizationService.js';
import { resourceTypes, sensitivityLevels, expertiseLevels, targetAudiences } from '../models/metadata.js';

/**
 * Parse TSV content into structured data
 */
export const parseTSVContent = (tsvContent) => {
  const lines = tsvContent.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('Invalid TSV file - must contain headers and at least one data row');
  }

  const headers = lines[0].split('\t').map(h => h.trim());
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row = {};
    
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || '';
    });
    
    data.push(row);
  }

  return data;
};

/**
 * Transform parsed TSV data into organizations and resources
 */
export const transformTSVData = async (parsedData, tenantId) => {
  const transformedData = {
    organizations: [],
    resources: [],
    tags: new Set(),
  };

  // Get metadata for resources
  const [resourceTypesData, sensitivityLevelsData, expertiseLevelsData, targetAudiencesData] = await Promise.all([
    db.select().from(resourceTypes),
    db.select().from(sensitivityLevels),
    db.select().from(expertiseLevels),
    db.select().from(targetAudiences)
  ]);

  // Default IDs (you may want to adjust these based on your data)
  const defaultResourceTypeId = resourceTypesData.find(rt => rt.name === 'Website')?.id || resourceTypesData[0]?.id;
  const defaultSensitivityLevelId = sensitivityLevelsData.find(sl => sl.name === 'Low')?.id || sensitivityLevelsData[0]?.id;
  const defaultExpertiseLevelId = expertiseLevelsData.find(el => el.name === 'Beginner')?.id || expertiseLevelsData[0]?.id;
  const defaultTargetAudienceId = targetAudiencesData.find(ta => ta.name === 'Patients')?.id || targetAudiencesData[0]?.id;

  for (const row of parsedData) {
    const organizationName = row['Organization']?.trim() || '';
    const resourceName =
      row['Resource Name']?.trim() || row['Name']?.trim() || organizationName;

    // Extract service tags (filter out N/A)
    const services = row['Service']?.split(',')
      .map(s => s.trim())
      .filter(s => s && s !== 'N/A' && s.toLowerCase() !== 'n/a') || [];
    services.forEach(service => transformedData.tags.add(service));

    // Extract accessibility tags (filter out N/A)
    const accessibilityTags = row['Accessibility']?.split(',')
      .map(a => a.trim())
      .filter(a => a && a !== 'N/A' && a.toLowerCase() !== 'n/a') || [];
    accessibilityTags.forEach(tag => transformedData.tags.add(tag));

    // Create organization object only when a resource is explicitly assigned
    if (organizationName) {
      const org = {
        name: organizationName,
        email: row['Email'] !== 'N/A' ? row['Email'] : null,
        phone: row['Phone number'] !== 'N/A' ? row['Phone number'] : null,
        website: row['Link'] !== 'N/A' ? row['Link'] : null,
        description: row['Description'] || '',
        tenantId: tenantId,
        professional: true,
        tags: [...services], // Services will be tags for the organization
      };

      transformedData.organizations.push(org);
    }

    // Create resource object
    const resource = {
      name: resourceName,
      url: row['Link'] !== 'N/A' ? row['Link'] : null,
      description: row['Description'] || '',
      typeId: defaultResourceTypeId,
      sensitivityLevelId: defaultSensitivityLevelId,
      expertiseLevelId: defaultExpertiseLevelId,
      targetAudienceId: defaultTargetAudienceId,
      tenantId: tenantId,
      resourceDate: new Date(), // Set to today's date (import date)
      demographics: row['Demographics'] !== 'N/A' ? `Demographics: ${row['Demographics']}` : '',
      accessibility: row['Accessibility'] !== 'N/A' ? `Accessibility: ${row['Accessibility']}` : '',
      tags: [...services, ...accessibilityTags], // Both services and accessibility as tags
      organizationName: organizationName || null, // Link to organization by name when provided
    };

    // Append demographics and accessibility to description if they exist
    if (resource.demographics || resource.accessibility) {
      resource.description = `${resource.description}\n\n${resource.demographics}\n${resource.accessibility}`.trim();
    }

    transformedData.resources.push(resource);
  }

  return {
    organizations: transformedData.organizations,
    resources: transformedData.resources,
    tags: Array.from(transformedData.tags),
  };
};

/**
 * Preview import data without saving
 */
export const previewImportService = async (tsvContent, tenantId) => {
  try {
    const parsedData = parseTSVContent(tsvContent);
    const transformedData = await transformTSVData(parsedData, tenantId);
    
    return {
      success: true,
      data: transformedData,
      summary: {
        organizationsCount: transformedData.organizations.length,
        resourcesCount: transformedData.resources.length,
        uniqueTagsCount: transformedData.tags.length,
      }
    };
  } catch (error) {
    console.error('Error previewing import:', error);
    throw new Error(`Failed to preview import: ${error.message}`);
  }
};

/**
 * Create or get tags for the import
 */
const ensureTagsExist = async (tagNames, tenantId, userId) => {
  const existingTags = await db
    .select()
    .from(tags)
    .where(
      and(
        inArray(tags.name, tagNames),
        eq(tags.tenantId, tenantId)
      )
    );

  // Mark existing tags
  const markedExistingTags = existingTags.map(tag => ({ ...tag, existing: true }));

  const existingTagNames = new Set(existingTags.map(t => t.name));
  const newTagNames = tagNames.filter(name => !existingTagNames.has(name));

  const newTags = [];
  for (const name of newTagNames) {
    const [tag] = await db
      .insert(tags)
      .values({
        name,
        tenantId,
        addedByUserId: userId,
        visibility: 'public',
        color: generateTagColor(name), // Helper function to generate colors
      })
      .returning();
    newTags.push({ ...tag, existing: false });
  }

  return [...markedExistingTags, ...newTags];
};

/**
 * Helper to generate a color for tags
 */
const generateTagColor = (name) => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
  const index = name.length % colors.length;
  return colors[index];
};

const normalizeImportOrganizationName = (name) =>
  name?.trim().toLowerCase() || '';

/**
 * Check if organization exists by name and tenant
 */
const findExistingOrganization = async (name, tenantId) => {
  const existing = await db
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.name, name),
        eq(organizations.tenantId, tenantId)
      )
    )
    .limit(1);
  
  return existing[0] || null;
};

/**
 * Check if resource exists by name and tenant
 */
const findExistingResource = async (name, url, tenantId) => {
  const conditions = [
    eq(resources.name, name),
    eq(resources.tenantId, tenantId)
  ];
  
  if (url) {
    conditions.push(eq(resources.url, url));
  }
  
  const existing = await db
    .select()
    .from(resources)
    .where(and(...conditions))
    .limit(1);
  
  return existing[0] || null;
};

/**
 * Execute the import with the transformed data
 */
export const executeImportService = async (importData, userId, tenantId) => {
  try {
    const results = {
      organizations: [],
      organizationsSkipped: [],
      resources: [],
      resourcesSkipped: [],
      tags: [],
      errors: [],
    };

    await db.transaction(async (tx) => {
      // First, ensure all tags exist (this already handles duplicates)
      const allTags = await ensureTagsExist(importData.tags, tenantId, userId);
      results.tags = allTags;

      // Create tag lookup map
      const tagMap = new Map(allTags.map(tag => [tag.name, tag.id]));

      // Import organizations - check for duplicates first
      const orgMap = new Map();
      const referencedOrganizationNames = new Set(
        (importData.resources || [])
          .map((resource) => normalizeImportOrganizationName(resource.organizationName))
          .filter(Boolean)
      );

      const resolveOrganizationId = async (organizationName) => {
        if (!organizationName?.trim()) {
          return null;
        }

        const normalizedName = normalizeImportOrganizationName(organizationName);

        if (orgMap.has(normalizedName)) {
          return orgMap.get(normalizedName);
        }

        const existingOrg = await findExistingOrganization(organizationName.trim(), tenantId);

        if (existingOrg) {
          orgMap.set(normalizedName, existingOrg.id);
          return existingOrg.id;
        }

        return null;
      };
      
      // First, get ALL existing organizations from the import data
      const organizationsToProcess = [];
      const queuedOrganizationNames = new Set();

      for (const orgData of importData.organizations || []) {
        const normalizedName = normalizeImportOrganizationName(orgData?.name);

        if (
          !normalizedName ||
          !referencedOrganizationNames.has(normalizedName) ||
          queuedOrganizationNames.has(normalizedName)
        ) {
          continue;
        }

        queuedOrganizationNames.add(normalizedName);
        organizationsToProcess.push({
          ...orgData,
          name: orgData.name.trim(),
        });
      }

      console.log('Processing organizations:', organizationsToProcess.length);
      
      for (const orgData of organizationsToProcess) {
        if (!orgData.name?.trim()) {
          continue;
        }

        try {
          // Check if organization already exists
          const existingOrg = await findExistingOrganization(orgData.name, tenantId);
          const normalizedName = normalizeImportOrganizationName(orgData.name);
          
          if (existingOrg) {
            // Organization exists, skip creation but add to map for resource linking
            console.log(`Organization "${orgData.name}" already exists with ID: ${existingOrg.id}`);
            orgMap.set(normalizedName, existingOrg.id);
            results.organizationsSkipped.push({
              name: orgData.name,
              id: existingOrg.id,
              reason: 'Already exists'
            });
            
            // Optionally update tags if they don't exist on the existing org
            const tagIds = orgData.tags
              ?.map(tagName => tagMap.get(tagName))
              .filter(Boolean) || [];
            
            if (tagIds.length > 0) {
              // Add missing tags to existing organization
              const existingOrgTags = await db
                .select()
                .from(organizationTags)
                .where(eq(organizationTags.organizationId, existingOrg.id));
              
              const existingTagIds = new Set(existingOrgTags.map(t => t.tagId));
              const newTagIds = tagIds.filter(id => !existingTagIds.has(id));
              
              if (newTagIds.length > 0) {
                await db.insert(organizationTags).values(
                  newTagIds.map(tagId => ({
                    organizationId: existingOrg.id,
                    tagId,
                  }))
                );
              }
            }
          } else {
            // Create new organization
            const tagIds = orgData.tags
              ?.map(tagName => tagMap.get(tagName))
              .filter(Boolean) || [];

            console.log(`Creating new organization: "${orgData.name}"`);
            
            const org = await createOrganizationService({
              ...orgData,
              tags: tagIds.length > 0 ? tagIds.join(',') : null,
              userId,
            });

            console.log(`Created organization "${orgData.name}" with ID: ${org.id}`);
            orgMap.set(normalizedName, org.id);
            results.organizations.push(org);
          }
        } catch (error) {
          console.error('Error processing organization:', error);
          results.errors.push({
            type: 'organization',
            name: orgData.name,
            error: error.message,
          });
        }
      }

      // Import resources - check for duplicates first
      console.log('Processing resources:', importData.resources.length);
      console.log('Organization map has', orgMap.size, 'organizations');
      
      for (const resourceData of importData.resources) {
        try {
          // Check if resource already exists
          const existingResource = await findExistingResource(
            resourceData.name, 
            resourceData.url,
            tenantId
          );
          
          if (existingResource) {
            // Resource exists, skip creation
            console.log(`Resource "${resourceData.name}" already exists with ID: ${existingResource.id}`);
            results.resourcesSkipped.push({
              name: resourceData.name,
              id: existingResource.id,
              reason: 'Already exists'
            });
            
            // Optionally update tags if they don't exist on the existing resource
            const tagIds = resourceData.tags
              ?.map(tagName => tagMap.get(tagName))
              .filter(Boolean) || [];
            
            if (tagIds.length > 0) {
              // Add missing tags to existing resource
              const existingResourceTags = await db
                .select()
                .from(resourceTags)
                .where(eq(resourceTags.resourceId, existingResource.id));
              
              const existingTagIds = new Set(existingResourceTags.map(t => t.tagId));
              const newTagIds = tagIds.filter(id => !existingTagIds.has(id));
              
              if (newTagIds.length > 0) {
                await db.insert(resourceTags).values(
                  newTagIds.map(tagId => ({
                    resourceId: existingResource.id,
                    tagId,
                  }))
                );
              }
            }
            
            // Link to organization if not already linked
            const organizationId = await resolveOrganizationId(
              resourceData.organizationName
            );
            console.log(`Linking resource "${resourceData.name}" to organization "${resourceData.organizationName}" (ID: ${organizationId})`);
            
            if (organizationId) {
              const existingLink = await db
                .select()
                .from(organizationResources)
                .where(
                  and(
                    eq(organizationResources.organizationId, organizationId),
                    eq(organizationResources.resourceId, existingResource.id)
                  )
                )
                .limit(1);
              
              if (!existingLink[0]) {
                console.log(`Creating new link between resource ${existingResource.id} and organization ${organizationId}`);
                await db.insert(organizationResources).values({
                  organizationId,
                  resourceId: existingResource.id,
                });
              } else {
                console.log(`Link already exists between resource ${existingResource.id} and organization ${organizationId}`);
              }
            } else if (resourceData.organizationName) {
              console.log(`WARNING: Could not find organization "${resourceData.organizationName}" in map`);
            }
          } else {
            // Create new resource
            const tagIds = resourceData.tags
              ?.map(tagName => tagMap.get(tagName))
              .filter(Boolean) || [];

            const organizationId = await resolveOrganizationId(
              resourceData.organizationName
            );
            
            // Debug logging
            console.log('Creating resource:', {
              name: resourceData.name,
              organizationName: resourceData.organizationName,
              organizationId: organizationId,
              orgMapSize: orgMap.size,
              orgMapKeys: Array.from(orgMap.keys())
            });
            
            const organizationIds = organizationId ? [organizationId] : [];

            const resource = await createResourceService({
              ...resourceData,
              tags: tagIds,
              organizations: organizationIds,
              addedByUserId: userId,
            });

            results.resources.push(resource);
          }
        } catch (error) {
          console.error('Error processing resource:', error);
          results.errors.push({
            type: 'resource',
            name: resourceData.name,
            error: error.message,
          });
        }
      }
    });

    return {
      success: true,
      results,
      summary: {
        organizationsCreated: results.organizations.length,
        organizationsSkipped: results.organizationsSkipped.length,
        resourcesCreated: results.resources.length,
        resourcesSkipped: results.resourcesSkipped.length,
        tagsCreated: results.tags.filter(tag => !tag.existing).length,
        tagsReused: results.tags.filter(tag => tag.existing).length,
        errors: results.errors.length,
      }
    };
  } catch (error) {
    console.error('Error executing import:', error);
    throw new Error(`Failed to execute import: ${error.message}`);
  }
};

/**
 * Update import data before final import
 */
export const updateImportDataService = async (importData) => {
  // This service allows editing the preview data before final import
  // The frontend will send modified data back
  return {
    success: true,
    data: importData,
  };
};

const toInteger = (value) => Number(value || 0);

const compareDuplicateResourcesForKeep = (resourceA, resourceB) => {
  const totalUsageDiff =
    resourceB.counts.totalLinkedItems - resourceA.counts.totalLinkedItems;
  if (totalUsageDiff !== 0) {
    return totalUsageDiff;
  }

  const externalLinkDiff =
    resourceB.counts.externalLinkCount - resourceA.counts.externalLinkCount;
  if (externalLinkDiff !== 0) {
    return externalLinkDiff;
  }

  const collectionDiff =
    resourceB.counts.collectionCount - resourceA.counts.collectionCount;
  if (collectionDiff !== 0) {
    return collectionDiff;
  }

  const ratingDiff =
    resourceB.counts.ratingCount - resourceA.counts.ratingCount;
  if (ratingDiff !== 0) {
    return ratingDiff;
  }

  const organizationDiff =
    resourceB.counts.organizationCount - resourceA.counts.organizationCount;
  if (organizationDiff !== 0) {
    return organizationDiff;
  }

  const createdAtA = resourceA.createdAt
    ? new Date(resourceA.createdAt).getTime()
    : Number.MAX_SAFE_INTEGER;
  const createdAtB = resourceB.createdAt
    ? new Date(resourceB.createdAt).getTime()
    : Number.MAX_SAFE_INTEGER;

  if (createdAtA !== createdAtB) {
    return createdAtA - createdAtB;
  }

  return resourceA.id.localeCompare(resourceB.id);
};

export const getResourceDuplicateGroupsService = async (tenantId) => {
  try {
    const result = await db.execute(sql`
      SELECT
        r.id,
        r.name,
        r.url,
        r.status,
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        LOWER(BTRIM(r.name)) AS "normalizedTitle",
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'name', o.name
              )
              ORDER BY o.name
            )
            FROM organization_resources or_link
            JOIN organizations o ON o.id = or_link.organization_id
            WHERE or_link.resource_id = r.id
          ),
          '[]'::jsonb
        ) AS organizations,
        COALESCE(
          (
            SELECT COUNT(DISTINCT cr.collection_id)::integer
            FROM collection_resources cr
            WHERE cr.resource_id = r.id
          ),
          0
        ) AS "collectionCount",
        COALESCE(
          (
            SELECT COUNT(*)::integer
            FROM collection_external_link_resources celr
            WHERE celr.resource_id = r.id
          ),
          0
        ) AS "externalLinkCount",
        COALESCE(
          (
            SELECT COUNT(*)::integer
            FROM resource_ratings rr
            WHERE rr.resource_id = r.id
          ),
          0
        ) AS "ratingCount",
        COALESCE(
          (
            SELECT COUNT(DISTINCT or_count.organization_id)::integer
            FROM organization_resources or_count
            WHERE or_count.resource_id = r.id
          ),
          0
        ) AS "organizationCount"
      FROM resources r
      WHERE r.tenant_id = ${tenantId}
        AND NULLIF(BTRIM(COALESCE(r.name, '')), '') IS NOT NULL
        AND LOWER(BTRIM(r.name)) IN (
          SELECT LOWER(BTRIM(name))
          FROM resources
          WHERE tenant_id = ${tenantId}
            AND NULLIF(BTRIM(COALESCE(name, '')), '') IS NOT NULL
          GROUP BY LOWER(BTRIM(name))
          HAVING COUNT(*) > 1
        )
      ORDER BY LOWER(BTRIM(r.name)), r.created_at ASC, r.id ASC
    `);

    const groupedResources = new Map();

    for (const row of result.rows) {
      const collectionCount = toInteger(row.collectionCount);
      const externalLinkCount = toInteger(row.externalLinkCount);
      const ratingCount = toInteger(row.ratingCount);
      const organizationCount = toInteger(row.organizationCount);
      const totalLinkedItems =
        collectionCount +
        externalLinkCount +
        ratingCount +
        organizationCount;

      const resource = {
        id: row.id,
        name: row.name,
        url: row.url,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        organizations: Array.isArray(row.organizations) ? row.organizations : [],
        counts: {
          collectionCount,
          externalLinkCount,
          ratingCount,
          organizationCount,
          totalLinkedItems,
        },
      };

      if (!groupedResources.has(row.normalizedTitle)) {
        groupedResources.set(row.normalizedTitle, {
          normalizedTitle: row.normalizedTitle,
          title: row.name?.trim() || 'Untitled Resource',
          resources: [],
        });
      }

      groupedResources.get(row.normalizedTitle).resources.push(resource);
    }

    const duplicateGroups = Array.from(groupedResources.values())
      .map((group) => {
        const resourcesForGroup = [...group.resources].sort(
          compareDuplicateResourcesForKeep
        );
        const suggestedKeepResourceId = resourcesForGroup[0]?.id || null;

        return {
          ...group,
          resourceCount: resourcesForGroup.length,
          suggestedKeepResourceId,
          suggestedDeleteResourceIds: resourcesForGroup
            .filter((resource) => resource.id !== suggestedKeepResourceId)
            .map((resource) => resource.id),
          resources: resourcesForGroup,
        };
      })
      .sort((groupA, groupB) => {
        if (groupB.resourceCount !== groupA.resourceCount) {
          return groupB.resourceCount - groupA.resourceCount;
        }

        return groupA.title.localeCompare(groupB.title);
      });

    const duplicateResources = duplicateGroups.reduce(
      (total, group) => total + group.resourceCount,
      0
    );
    const duplicateCandidates = duplicateGroups.reduce(
      (total, group) => total + Math.max(group.resourceCount - 1, 0),
      0
    );

    return {
      success: true,
      data: {
        duplicateGroups,
        summary: {
          duplicateGroups: duplicateGroups.length,
          duplicateResources,
          duplicateCandidates,
        },
      },
    };
  } catch (error) {
    console.error('Error loading resource duplicates:', error);
    throw new Error(`Failed to load duplicate resources: ${error.message}`);
  }
};

export const deleteDuplicateResourcesService = async (resourceIds, tenantId) => {
  try {
    const requestedIds = [...new Set((resourceIds || []).filter(Boolean))];

    if (requestedIds.length === 0) {
      return {
        success: true,
        deletedResources: [],
        deletedCount: 0,
        requestedCount: 0,
        skippedResourceIds: [],
      };
    }

    const deletedResources = await deleteResourcesService(requestedIds, {
      tenantId,
    });
    const deletedIds = new Set(deletedResources.map((resource) => resource.id));
    const skippedResourceIds = requestedIds.filter((id) => !deletedIds.has(id));

    return {
      success: true,
      deletedResources,
      deletedCount: deletedResources.length,
      requestedCount: requestedIds.length,
      skippedResourceIds,
    };
  } catch (error) {
    console.error('Error deleting duplicate resources:', error);
    throw new Error(`Failed to delete duplicate resources: ${error.message}`);
  }
};
