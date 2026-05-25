import { db } from '../db/index.js';
import { organizations, organizationTags, organizationResources } from '../models/organizations.js';
import { resources, resourceTags } from '../models/resources.js';
import { tags } from '../models/tags.js';
import { linkGroups } from '../models/linkGroup.js';
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

const getRowValue = (row, aliases = []) => {
  for (const alias of aliases) {
    const value = row?.[alias];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
};

const splitImportList = (value) =>
  String(value || '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== 'n/a');

const normalizeLookup = (value) => String(value || '').trim().toLowerCase();

const findMetadataByName = (items, name) => {
  const normalizedName = normalizeLookup(name);
  if (!normalizedName) return null;

  return items.find((item) => normalizeLookup(item.name) === normalizedName) || null;
};

const normalizeBoolean = (value) => {
  const normalized = normalizeLookup(value);
  if (!normalized) return undefined;
  return ['true', 'yes', '1', 'y'].includes(normalized);
};

const normalizeImportVisibility = (value) => {
  const normalized = normalizeLookup(value);
  return ['private', 'unlisted', 'public'].includes(normalized)
    ? normalized
    : 'private';
};

const normalizeImportCategory = (value) => normalizeLookup(value) || 'resource';

const DURATION_UNIT_ALIASES = {
  minute: 'minutes',
  minutes: 'minutes',
  min: 'minutes',
  mins: 'minutes',
  hour: 'hours',
  hours: 'hours',
  hr: 'hours',
  hrs: 'hours',
  day: 'days',
  days: 'days',
  week: 'weeks',
  weeks: 'weeks',
  month: 'months',
  months: 'months',
  year: 'years',
  years: 'years',
  yr: 'years',
  yrs: 'years',
};

export const normalizeImportDurationFields = (row = {}) => {
  const rawValue = getRowValue(row, [
    'durationValue',
    'Duration Value',
    'Estimated Duration Value',
    'estimatedDurationValue',
  ]);
  const rawUnit = getRowValue(row, [
    'durationUnit',
    'Duration Unit',
    'Estimated Duration Unit',
    'estimatedDurationUnit',
  ]);

  if (!rawValue && !rawUnit) {
    return {
      durationValue: null,
      durationUnit: null,
    };
  }

  const durationValue = Number(rawValue);
  const durationUnit = DURATION_UNIT_ALIASES[normalizeLookup(rawUnit)];

  if (!Number.isFinite(durationValue) || durationValue <= 0) {
    throw new Error(`Invalid duration value: ${rawValue || '(blank)'}`);
  }

  if (!durationUnit) {
    throw new Error(`Invalid duration unit: ${rawUnit || '(blank)'}`);
  }

  return {
    durationValue,
    durationUnit,
  };
};

export const normalizeImportRelatedResourceFields = (row = {}) => ({
  resourceKey: getRowValue(row, [
    'resourceKey',
    'Resource Key',
    'resource_key',
  ]) || null,
  relatedResourceKeys: splitImportList(
    getRowValue(row, [
      'relatedResourceKeys',
      'Related Resource Keys',
      'Related Resources',
      'related_resource_keys',
    ])
  ),
  relatedResourceNames: splitImportList(
    getRowValue(row, [
      'relatedResourceNames',
      'Related Resource Names',
      'related_resource_names',
    ])
  ),
  relatedResourceUrls: splitImportList(
    getRowValue(row, [
      'relatedResourceUrls',
      'Related Resource URLs',
      'related_resource_urls',
    ])
  ),
  relatedLinkCategory: normalizeImportCategory(
    getRowValue(row, [
      'relatedLinkCategory',
      'Related Link Category',
      'related_link_category',
    ])
  ),
  relatedLinkDescription:
    getRowValue(row, [
      'relatedLinkDescription',
      'Related Link Description',
      'related_link_description',
    ]) || null,
  relatedLinkVisibility: normalizeImportVisibility(
    getRowValue(row, [
      'relatedLinkVisibility',
      'Related Link Visibility',
      'related_link_visibility',
    ])
  ),
});

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
    const organizationName = getBusinessUnitNameFromRow(row);
    const resourceName =
      getRowValue(row, ['Resource Name', 'name', 'Name']) || organizationName;
    const resourceUrl = getRowValue(row, ['url', 'URL', 'Resource URL', 'Link']);
    const description = getRowValue(row, ['description', 'Description']);
    const resourceDate =
      getRowValue(row, ['resourceDate', 'Resource Date']) ||
      new Date().toISOString().slice(0, 10);
    const resourceUpdatedDate = getRowValue(row, [
      'resourceUpdatedDate',
      'Resource Updated Date',
      'updatedDate',
    ]);
    const resourceTypeName = getRowValue(row, [
      'resourceType',
      'Resource Type',
      'Type',
    ]);
    const sensitivityLevelName = getRowValue(row, [
      'sensitivityLevel',
      'Sensitivity',
      'Sensitivity Level',
    ]);
    const expertiseLevelName = getRowValue(row, [
      'expertiseLevel',
      'Expertise',
      'Expertise Level',
    ]);
    const targetAudienceName = getRowValue(row, [
      'targetAudience',
      'Target Audience',
    ]);
    const durationFields = normalizeImportDurationFields(row);
    const relatedResourceFields = normalizeImportRelatedResourceFields(row);

    // Extract service tags (filter out N/A)
    const services = splitImportList(getRowValue(row, ['Service', 'service', 'Services']));
    services.forEach(service => transformedData.tags.add(service));

    // Extract accessibility tags (filter out N/A)
    const accessibilityTags = splitImportList(getRowValue(row, ['Accessibility', 'accessibility']));
    accessibilityTags.forEach(tag => transformedData.tags.add(tag));

    const explicitTags = splitImportList(getRowValue(row, ['tags', 'Tags']));
    explicitTags.forEach(tag => transformedData.tags.add(tag));

    const resourceType =
      findMetadataByName(resourceTypesData, resourceTypeName) ||
      (resourceTypeName ? null : null);
    const sensitivityLevel =
      findMetadataByName(sensitivityLevelsData, sensitivityLevelName) ||
      (sensitivityLevelName ? null : null);
    const expertiseLevel =
      findMetadataByName(expertiseLevelsData, expertiseLevelName) ||
      (expertiseLevelName ? null : null);
    const targetAudience =
      findMetadataByName(targetAudiencesData, targetAudienceName) ||
      (targetAudienceName ? null : null);

    // Create organization object only when a resource is explicitly assigned
    if (organizationName) {
      const org = {
        name: organizationName,
        email: getRowValue(row, ['Email', 'email']) || null,
        phone: getRowValue(row, ['Phone number', 'phone']) || null,
        website: resourceUrl || null,
        description,
        tenantId: tenantId,
        professional: true,
        tags: [...services], // Services will be tags for the organization
      };

      transformedData.organizations.push(org);
    }

    // Create resource object
    const resource = {
      name: resourceName,
      url: resourceUrl || null,
      description,
      typeId: resourceType?.id || defaultResourceTypeId,
      sensitivityLevelId: sensitivityLevel?.id || defaultSensitivityLevelId,
      expertiseLevelId: expertiseLevel?.id || defaultExpertiseLevelId,
      targetAudienceId: targetAudience?.id || defaultTargetAudienceId,
      tenantId: tenantId,
      resourceDate,
      resourceUpdatedDate: resourceUpdatedDate || null,
      demographics: getRowValue(row, ['Demographics', 'demographics'])
        ? `Demographics: ${getRowValue(row, ['Demographics', 'demographics'])}`
        : '',
      accessibility: getRowValue(row, ['Accessibility', 'accessibility'])
        ? `Accessibility: ${getRowValue(row, ['Accessibility', 'accessibility'])}`
        : '',
      tags: [...services, ...accessibilityTags, ...explicitTags],
      organizationName: organizationName || null, // Link to organization by name when provided
      videoUrl: getRowValue(row, ['videoUrl', 'Video URL']) || null,
      timestamps: getRowValue(row, ['timestamps', 'Timestamps']) || null,
      fullText: getRowValue(row, ['fullText', 'Full Text']) || null,
      featured: normalizeBoolean(getRowValue(row, ['featured', 'Featured'])),
      ...durationFields,
      ...relatedResourceFields,
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
export const previewImportService = async (importInput, tenantId) => {
  try {
    const parsedData = Array.isArray(importInput)
      ? importInput
      : parseTSVContent(importInput);
    const transformedData = await transformTSVData(parsedData, tenantId);
    const relatedLinkPreview = buildRelatedResourceImportPreview(
      transformedData.resources
    );
    
    return {
      success: true,
      data: {
        ...transformedData,
        relatedLinkPreview,
      },
      summary: {
        organizationsCount: transformedData.organizations.length,
        resourcesCount: transformedData.resources.length,
        uniqueTagsCount: transformedData.tags.length,
        relatedLinkReferencesCount:
          relatedLinkPreview.summary.totalReferences,
        unresolvedRelatedLinkReferences:
          relatedLinkPreview.summary.unresolved,
        selfRelatedLinkReferences:
          relatedLinkPreview.summary.selfReferences,
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

function getBusinessUnitNameFromRow(row) {
  return getRowValue(row, [
    'Business Unit',
    'businessUnit',
    'Organization',
    'organizations',
    'Organizations',
  ]);
}

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

const getFrontendBaseUrl = () =>
  (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

const buildResourceUrl = (resourceId) => `${getFrontendBaseUrl()}/resources/${resourceId}`;

const normalizeResourceUrlLookup = (value) =>
  String(value || '').trim().replace(/\/+$/, '').toLowerCase();

const createImportedResourceLookup = () => ({
  byKey: new Map(),
  byName: new Map(),
  byUrl: new Map(),
  records: [],
});

const setLookupIfPresent = (map, key, entry, normalizer = normalizeLookup) => {
  const normalizedKey = normalizer(key);
  if (normalizedKey && !map.has(normalizedKey)) {
    map.set(normalizedKey, entry);
  }
};

const registerImportedResource = (lookup, resourceData, resourceRecord) => {
  if (!resourceRecord?.id) return;

  const entry = {
    resourceData,
    resource: resourceRecord,
  };

  lookup.records.push(entry);
  setLookupIfPresent(lookup.byKey, resourceData.resourceKey, entry);
  setLookupIfPresent(lookup.byName, resourceData.name || resourceRecord.name, entry);
  setLookupIfPresent(
    lookup.byUrl,
    resourceData.url || resourceRecord.url,
    entry,
    normalizeResourceUrlLookup
  );
  setLookupIfPresent(
    lookup.byUrl,
    buildResourceUrl(resourceRecord.id),
    entry,
    normalizeResourceUrlLookup
  );
};

const getRelatedResourceReferences = (resourceData = {}) => [
  ...(resourceData.relatedResourceKeys || []).map((value) => ({
    type: 'key',
    value,
  })),
  ...(resourceData.relatedResourceNames || []).map((value) => ({
    type: 'name',
    value,
  })),
  ...(resourceData.relatedResourceUrls || []).map((value) => ({
    type: 'url',
    value,
  })),
];

const resolveRelatedResourceReference = (lookup, reference) => {
  if (!reference?.value) return null;

  if (reference.type === 'key') {
    return lookup.byKey.get(normalizeLookup(reference.value)) || null;
  }

  if (reference.type === 'name') {
    return lookup.byName.get(normalizeLookup(reference.value)) || null;
  }

  if (reference.type === 'url') {
    const matchedResource = lookup.byUrl.get(
      normalizeResourceUrlLookup(reference.value)
    );

    if (matchedResource) {
      return matchedResource;
    }

    return {
      externalUrl: reference.value,
      externalName: reference.value,
    };
  }

  return null;
};

export const buildRelatedResourceImportPreview = (resourcesToPreview = []) => {
  const lookup = createImportedResourceLookup();

  resourcesToPreview.forEach((resourceData, index) => {
    registerImportedResource(lookup, resourceData, {
      id: `preview-${index}`,
      name: resourceData.name,
      url: resourceData.url,
    });
  });

  const items = [];
  const summary = {
    totalReferences: 0,
    resolvedImported: 0,
    resolvedExternalUrl: 0,
    duplicateReferences: 0,
    selfReferences: 0,
    unresolved: 0,
  };

  for (const sourceEntry of lookup.records) {
    const sourceResource = sourceEntry.resource;
    const sourceData = sourceEntry.resourceData;
    const references = getRelatedResourceReferences(sourceData);
    const seenTargets = new Set();

    for (const reference of references) {
      summary.totalReferences += 1;

      const targetEntry = resolveRelatedResourceReference(lookup, reference);
      const diagnostic = {
        sourceName: sourceData.name,
        sourceResourceKey: sourceData.resourceKey || null,
        referenceType: reference.type,
        reference: reference.value,
        status: 'unresolved',
        targetName: null,
        targetResourceKey: null,
        targetUrl: null,
        reason: null,
      };

      if (!targetEntry) {
        diagnostic.reason = `No imported resource matched related resource ${reference.type}`;
        summary.unresolved += 1;
        items.push(diagnostic);
        continue;
      }

      const targetResource = targetEntry.resource;
      const targetUrl = targetResource?.url || targetEntry.externalUrl || null;
      const dedupeKey = targetResource
        ? `resource:${targetResource.id}`
        : `url:${normalizeResourceUrlLookup(targetUrl)}`;

      diagnostic.targetName =
        targetEntry.resourceData?.name ||
        targetResource?.name ||
        targetEntry.externalName ||
        targetUrl;
      diagnostic.targetResourceKey = targetEntry.resourceData?.resourceKey || null;
      diagnostic.targetUrl = targetUrl;

      if (targetResource?.id === sourceResource.id) {
        diagnostic.status = 'self_reference';
        diagnostic.reason = 'Related resource matched the source resource';
        summary.selfReferences += 1;
        items.push(diagnostic);
        continue;
      }

      if (seenTargets.has(dedupeKey)) {
        diagnostic.status = 'duplicate_reference';
        diagnostic.reason = 'Duplicate related-resource reference in this row';
        summary.duplicateReferences += 1;
        items.push(diagnostic);
        continue;
      }

      seenTargets.add(dedupeKey);

      if (targetResource) {
        diagnostic.status = 'resolved_imported';
        summary.resolvedImported += 1;
      } else {
        diagnostic.status = 'resolved_external_url';
        summary.resolvedExternalUrl += 1;
      }

      items.push(diagnostic);
    }
  }

  return {
    items,
    summary,
  };
};

const getStrictRelatedLinkBlockers = (relatedLinkPreview) =>
  (relatedLinkPreview?.items || []).filter((item) =>
    ['unresolved', 'self_reference'].includes(item.status)
  );

const createImportValidationError = (message, details = {}) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.details = details;
  return error;
};

const createRelatedResourceLinksForImport = async ({
  tx,
  lookup,
  tenantId,
  userId,
  results,
}) => {
  for (const sourceEntry of lookup.records) {
    const sourceResource = sourceEntry.resource;
    const sourceData = sourceEntry.resourceData;
    const references = getRelatedResourceReferences(sourceData);

    if (references.length === 0) {
      continue;
    }

    const createdTargets = new Set();

    for (const reference of references) {
      const targetEntry = resolveRelatedResourceReference(lookup, reference);

      if (!targetEntry) {
        results.relatedLinksSkipped.push({
          source: sourceData.name,
          reference: reference.value,
          status: 'unresolved',
          reason: `No imported resource matched related resource ${reference.type}`,
        });
        continue;
      }

      const targetResource = targetEntry.resource;
      const targetUrl = targetResource
        ? buildResourceUrl(targetResource.id)
        : targetEntry.externalUrl;
      const dedupeKey = targetResource
        ? `resource:${targetResource.id}`
        : `url:${normalizeResourceUrlLookup(targetUrl)}`;

      if (!targetUrl) {
        results.relatedLinksSkipped.push({
          source: sourceData.name,
          reference: reference.value,
          status: 'missing_target_url',
          reason: 'Related resource target did not have a URL',
        });
        continue;
      }

      if (createdTargets.has(dedupeKey)) {
        results.relatedLinksSkipped.push({
          source: sourceData.name,
          reference: reference.value,
          status: 'duplicate_reference',
          reason: 'Duplicate related-resource reference in this row',
        });
        continue;
      }

      if (targetResource?.id === sourceResource.id) {
        results.relatedLinksSkipped.push({
          source: sourceData.name,
          reference: reference.value,
          status: 'self_reference',
          reason: 'Related resource matched the source resource',
        });
        continue;
      }

      createdTargets.add(dedupeKey);

      const [existingLink] = await tx
        .select({ id: linkGroups.id })
        .from(linkGroups)
        .where(
          and(
            eq(linkGroups.linkingId, sourceResource.id),
            eq(linkGroups.linkingType, 'resource'),
            eq(linkGroups.url, targetUrl),
            eq(linkGroups.tenantId, tenantId)
          )
        )
        .limit(1);

      if (existingLink) {
        results.relatedLinksSkipped.push({
          source: sourceData.name,
          reference: reference.value,
          status: 'duplicate',
          reason: 'Related link already exists',
        });
        continue;
      }

      const [relatedLink] = await tx
        .insert(linkGroups)
        .values({
          name:
            targetEntry.resourceData?.name ||
            targetResource?.name ||
            targetEntry.externalName ||
            targetUrl,
          description: sourceData.relatedLinkDescription || null,
          url: targetUrl,
          category: sourceData.relatedLinkCategory || 'resource',
          linkingId: sourceResource.id,
          linkingType: 'resource',
          visibility: sourceData.relatedLinkVisibility || 'private',
          userId,
          tenantId,
        })
        .returning();

      results.relatedLinks.push(relatedLink);
    }
  }
};

/**
 * Execute the import with the transformed data
 */
export const executeImportService = async (
  importData,
  userId,
  tenantId,
  options = {}
) => {
  try {
    const relatedLinkPreview = buildRelatedResourceImportPreview(
      importData.resources || []
    );
    const strictRelatedLinks = Boolean(options.strictRelatedLinks);
    const strictBlockers = getStrictRelatedLinkBlockers(relatedLinkPreview);

    if (strictRelatedLinks && strictBlockers.length > 0) {
      throw createImportValidationError(
        `Strict related-link validation failed for ${strictBlockers.length} reference${strictBlockers.length === 1 ? '' : 's'}`,
        {
          relatedLinkPreview,
          strictBlockers,
        }
      );
    }

    const results = {
      organizations: [],
      organizationsSkipped: [],
      resources: [],
      resourcesSkipped: [],
      relatedLinks: [],
      relatedLinksSkipped: [],
      tags: [],
      errors: [],
      diagnostics: {
        strictRelatedLinks,
        relatedLinkPreview,
      },
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
      const importedResourceLookup = createImportedResourceLookup();
      
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
            registerImportedResource(
              importedResourceLookup,
              resourceData,
              existingResource
            );
            
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
            registerImportedResource(
              importedResourceLookup,
              resourceData,
              resource
            );
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

      await createRelatedResourceLinksForImport({
        tx,
        lookup: importedResourceLookup,
        tenantId,
        userId,
        results,
      });
    });

    return {
      success: true,
      results,
      summary: {
        organizationsCreated: results.organizations.length,
        organizationsSkipped: results.organizationsSkipped.length,
        resourcesCreated: results.resources.length,
        resourcesSkipped: results.resourcesSkipped.length,
        relatedLinksCreated: results.relatedLinks.length,
        relatedLinksSkipped: results.relatedLinksSkipped.length,
        relatedLinksUnresolved: results.relatedLinksSkipped.filter(
          (item) => item.status === 'unresolved'
        ).length,
        relatedLinksSelfReferences: results.relatedLinksSkipped.filter(
          (item) => item.status === 'self_reference'
        ).length,
        tagsCreated: results.tags.filter(tag => !tag.existing).length,
        tagsReused: results.tags.filter(tag => tag.existing).length,
        errors: results.errors.length,
        strictRelatedLinks,
      }
    };
  } catch (error) {
    console.error('Error executing import:', error);
    if (error.statusCode) {
      throw error;
    }
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
