import {
  generateDescriptionWithClaude,
  generateDescriptionWithOCRService,
  generateResourceChatServiceWithClaudeAndSummaries,
  generateItemSummaries,
  searchAllContentService,
  processImageService,
  generateChatWithAiAgents,
  makeAiAgentRequest,
  generateStructuredNotationsService,
  generateBulkNotationUpdatesService,
  generateStructuredEventsService,
  generateStructuredEventsWithOrganizationsService,
  generateStructuredSocialMediaAccountsService,
  generateStructuredExternalLinksService,
} from '../services/aiService.js';
import { selectClaudeModel } from '../utils/modelSelector.js';
import {
  getBasicResourcesByIdsService,
  getResourcesByIdsService,
} from '../services/resourceService.js';
import {
  getBasicCollectionsByIdsService,
  getBasicExternalLinksByIdsService,
  getCollectionByIdsServiceWithResources,
  getExternalLinksByIdsService,
  addMultipleNotationsToExternalLinkService,
  getCollectionExternalLinkIdService,
  updateMultipleNotationsService,
  getExternalLinkByIdService,
} from '../services/collectionService.js';
import {
  CREDIT_COST_PER_QUESTION,
  creditService,
} from '../services/creditService.js';
import {
  getBasicEventsByIdsService,
  getEventsByIdsService,
} from '../services/eventService.js';
import {
  getAttachmentsByIds,
  getBasicAttachmentsByIdsService,
} from '../services/attachmentService.js';
import {
  getBasicNotationsByIdsService,
  getNotationsByIdsService,
} from '../services/notationService.js';
import {
  getBasicLinkGroupsByIdsService,
  getLinkGroupsByIdsService,
} from '../services/metadataService.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { getOrganizationsByIdsService } from '../services/organizationService.js';
import {
  createOrGetTagService,
  getTagIdsByNamesService,
} from '../services/collectionExternalLinkTagsService.js';
import { getSocialMediaAccountsByIdsService } from '../services/socialMediaService.js';
import { db } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { collectionExternalLinks } from '../models/external_links.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) =>
  typeof value === 'string' && UUID_REGEX.test(value.trim());

const collectReferenceIds = (value, ids = new Set()) => {
  if (!value) return ids;

  if (isUuid(value)) {
    ids.add(value.trim());
    return ids;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectReferenceIds(item, ids));
    return ids;
  }

  if (typeof value === 'object') {
    if (isUuid(value.id)) ids.add(value.id.trim());
    Object.values(value).forEach((item) => collectReferenceIds(item, ids));
  }

  return ids;
};

const normalizeTagName = (value) => String(value || '').trim();

const resolveStructuredExternalLinkTagIds = async (
  rawTags,
  userId,
  tenantIds
) => {
  if (!Array.isArray(rawTags) || rawTags.length === 0) {
    return [];
  }

  const resolvedTagIds = new Set();
  const tagNamesByKey = new Map();
  const primaryTenantId = tenantIds?.[0] || process.env.COMMUNITY_TENANT || null;

  rawTags.forEach((rawTag) => {
    if (!rawTag) {
      return;
    }

    if (typeof rawTag === 'string') {
      const trimmedValue = rawTag.trim();
      if (!trimmedValue) {
        return;
      }

      if (isUuid(trimmedValue)) {
        resolvedTagIds.add(trimmedValue);
        return;
      }

      tagNamesByKey.set(trimmedValue.toLowerCase(), {
        name: trimmedValue,
      });
      return;
    }

    if (typeof rawTag === 'object') {
      const rawId =
        typeof rawTag.id === 'string' ? rawTag.id.trim() : rawTag.id;
      if (isUuid(rawId)) {
        resolvedTagIds.add(rawId);
      }

      const tagName = normalizeTagName(
        rawTag.name || rawTag.label || rawTag.value
      );
      if (!tagName) {
        return;
      }

      tagNamesByKey.set(tagName.toLowerCase(), {
        name: tagName,
        color: rawTag.color || null,
        description: rawTag.description || null,
      });
    }
  });

  if (tagNamesByKey.size === 0) {
    return Array.from(resolvedTagIds);
  }

  const tagNames = Array.from(tagNamesByKey.values()).map((tag) => tag.name);
  const existingTagMap = await getTagIdsByNamesService([tagNames], userId, tenantIds);

  for (const tagMeta of tagNamesByKey.values()) {
    const matchedTag = existingTagMap.get(tagMeta.name.toLowerCase());
    if (matchedTag?.id) {
      resolvedTagIds.add(matchedTag.id);
      continue;
    }

    if (!primaryTenantId) {
      continue;
    }

    const createdTag = await createOrGetTagService(
      {
        name: tagMeta.name,
        color: tagMeta.color,
        description: tagMeta.description,
      },
      userId,
      primaryTenantId
    );

    if (createdTag?.id) {
      resolvedTagIds.add(createdTag.id);
    }
  }

  return Array.from(resolvedTagIds);
};

export const aiController = {
  async generateDescription(req, res) {
    try {
      const {
        prompt,
        currentContent,
        contextDetails,
        externalContent,
        provider,
      } = req.body;

      let description;
      if (provider === 'ocr') {
        // Use OCR service connector
        description = await generateDescriptionWithOCRService(
          prompt,
          contextDetails,
          externalContent,
          'anthropic', // Using anthropic through OCR service
          'claude-haiku-4-5'
        );
      } else {
        // Default to Claude (direct Anthropic SDK)
        description = await generateDescriptionWithClaude(
          prompt,
          contextDetails,
          externalContent
        );
      }

      // Return the description (could be an object or string)
      // The frontend will handle parsing if needed
      res.json({ content: description });
    } catch (error) {
      res.status(500).json({
        message: 'Error generating description',
        error: error.message,
      });
    }
  },

  // New dedicated endpoint for generating summaries
  generateSummaries: async (req, res) => {
    try {
      const { type, collectionResourceType } = req.body;
      const userId = req.auth.dbUserId;

      // Check available credits first
      const creditCost = CREDIT_COST_PER_QUESTION;
      const hasEnoughCredits = await creditService.checkCredits(
        userId,
        creditCost
      );

      if (!hasEnoughCredits) {
        return res.status(402).json({
          message:
            'Please purchase more credits to continue using AI summaries',
        });
      }

      // Proceed with deducting credits and processing
      await creditService.deductCredits(userId, creditCost);

      // Generate summaries
      const summaries = await generateItemSummaries(
        type,
        collectionResourceType,
        userId,
        req.tenantIds
      );

      // Process summaries
      let processedSummaries = summaries;
      if (typeof summaries === 'string') {
        // Find the first colon and only keep what comes after it
        const colonIndex = summaries.indexOf(':');
        processedSummaries =
          colonIndex !== -1
            ? summaries.substring(colonIndex + 1).trim()
            : summaries.trim();
      } else if (Array.isArray(summaries)) {
        // For backward compatibility, if it's an array, process it as before
        processedSummaries = summaries.map((summary) => {
          const colonIndex = summary.indexOf(':');
          return colonIndex !== -1
            ? summary.substring(colonIndex + 1).trim()
            : summary;
        });
      }

      const balance = await creditService.getCreditBalance(userId);

      return res.json({
        content: {
          balance,
          summaries: processedSummaries,
        },
      });
    } catch (error) {
      console.error('Error generating summaries', error);
      return res.status(500).json({
        message: 'Error generating summaries',
        error: error.message,
      });
    }
  },

  // Updated method: no need to pass resourceData in, as we fetch it internally.
  generateResourceChat: async (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const {
        prompt,
        type,
        collectionResourceType,
        duration,
        history,
        collectionData,
        data,
      } = req.body;
      const userId = req.auth.dbUserId;
      let result = [];

      // Helper function to send updates
      const sendUpdate = (event, data) => {
        // Format the data as JSON string
        const dataString = JSON.stringify(data);
        // Ensure each event is properly formatted with data field and double newline at the end
        res.write(`event: ${event}\ndata: ${dataString}\n\n`);
        // Flush the response to ensure it's sent immediately
        if (res.flush) res.flush();
      };

      if (data) {
        // Send model selection update
        sendUpdate('modelSelection', { status: 'Analyzing question type...' });

        const modelForQuestion = selectClaudeModel(prompt, {
          expectedResponseLength: data.mentionedItems?.length > 5 ? 500 : 200,
        });
        sendUpdate('modelSelected', {
          status: `Using ${modelForQuestion.recommended} for processing... because ${modelForQuestion.reason}`,
        });
        // Send processing update
        sendUpdate('processing', { status: 'Processing data...' });

        // Check if RAG should be disabled - support both disableRAG and useRag flags
        const useRagMode = req.body.useRag !== false && !req.body.disableRAG;
        const hasMentionedItems =
          data.mentionedItems && data.mentionedItems.length > 0;

        result = await aiController.processItems(
          req,
          data.collections,
          data.externalLinks,
          data.resources,
          data.events,
          data.attachments,
          data.linkGroups,
          data.notations,
          data.timeframe,
          data.organizations,
          data.socialMediaAccounts,
          prompt,
          history,
          data,
          modelForQuestion.recommended,
          useRagMode // Pass the RAG mode setting
        );
      } else {
        result = await generateResourceChatServiceWithClaudeAndSummaries(
          prompt,
          type,
          collectionResourceType,
          userId,
          duration,
          history,
          result
        );
      }

      // Check if the response indicates insufficient credits
      if (
        (result.answer || result.response) &&
        (result.answer?.includes('Insufficient credits') ||
          result.response?.includes('Insufficient credits'))
      ) {
        sendUpdate('complete', {
          content: {
            answer: result.answer || result.response,
            data: {},
            prompt,
            timestamp: new Date().toISOString(),
          },
        });

        return res.end();
      }

      // Send final response
      sendUpdate('complete', {
        content: {
          answer: result.answer || result.response,
          data: result.data,
          prompt,
          timestamp: new Date().toISOString(),
        },
      });

      res.end();
    } catch (error) {
      console.error('Error generating resource conversation', error);
      res.end();
    }
  },

  async processItems(
    req,
    collections,
    externalLinks,
    resources,
    events,
    attachments,
    linkGroups,
    notations,
    timeframe,
    organizations,
    socialMediaAccounts,
    prompt,
    history,
    data,
    model,
    useRagOnly = true
  ) {
    try {
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Define sendUpdate function if it doesn't exist in this scope
      const sendUpdate = (event, data) => {
        const dataString = JSON.stringify(data);
        req.res.write(`event: ${event}\ndata: ${dataString}\n\n`);
        if (req.res.flush) req.res.flush();
      };

      let collectionData = [];
      let externalLinkData = [];
      let resourceData = [];
      let eventData = [];
      let attachmentData = [];
      let linkGroupData = [];
      let notationData = [];
      let organizationData = [];
      let socialMediaAccountData = [];

      // Check if we have mentioned items and RAG is disabled
      const hasMentionedItems =
        data.mentionedItems && data.mentionedItems.length > 0;
      // Also check if we have any specific items selected via IDs
      const hasSelectedItems = [
        collections,
        externalLinks,
        resources,
        events,
        attachments,
        linkGroups,
        notations,
        organizations,
        socialMediaAccounts,
      ].some((arr) => arr && arr.length > 0);
      const shouldUseDirectData =
        !useRagOnly || hasMentionedItems || hasSelectedItems;

      if (useRagOnly && !hasMentionedItems && !hasSelectedItems) {
        // RAG-only mode: Skip loading full context, let RAG handle resource discovery
        sendUpdate('processing', {
          status: 'Using RAG mode - searching for relevant resources...',
        });

        // In RAG mode, we don't load any specific data - let the AI service handle discovery
        // The vector search in generateChatWithAiAgents will find relevant resources
      } else {
        // Traditional mode or mentioned items mode: Fetch all the requested data
        sendUpdate('processing', {
          status: hasMentionedItems
            ? 'Loading mentioned items and requested data...'
            : hasSelectedItems
              ? 'Loading selected items...'
              : 'Loading requested data...',
        });

        // If we have mentioned items, prioritize them but also load any specific IDs requested
        const collectionsToFetch = collections?.length > 0 ? collections : [];
        const externalLinksToFetch =
          externalLinks?.length > 0 ? externalLinks : [];
        const resourcesToFetch = resources?.length > 0 ? resources : [];
        const eventsToFetch = events?.length > 0 ? events : [];
        const attachmentsToFetch = attachments?.length > 0 ? attachments : [];
        const linkGroupsToFetch = linkGroups?.length > 0 ? linkGroups : [];
        const notationsToFetch = notations?.length > 0 ? notations : [];
        const organizationsToFetch =
          organizations?.length > 0 ? organizations : [];
        const socialMediaAccountsToFetch =
          socialMediaAccounts?.length > 0 ? socialMediaAccounts : [];

        // Add mentioned items IDs to the appropriate arrays
        if (hasMentionedItems) {
          data.mentionedItems.forEach((item) => {
            switch (item.type) {
              case 'collection':
                if (!collectionsToFetch.includes(item.id)) {
                  collectionsToFetch.push(item.id);
                }
                break;
              case 'external_link':
                if (!externalLinksToFetch.includes(item.id)) {
                  externalLinksToFetch.push(item.id);
                }
                break;
              case 'resource':
                if (!resourcesToFetch.includes(item.id)) {
                  resourcesToFetch.push(item.id);
                }
                break;
              case 'event':
                if (!eventsToFetch.includes(item.id)) {
                  eventsToFetch.push(item.id);
                }
                break;
              case 'attachment':
                if (!attachmentsToFetch.includes(item.id)) {
                  attachmentsToFetch.push(item.id);
                }
                break;
              case 'link_group':
                if (!linkGroupsToFetch.includes(item.id)) {
                  linkGroupsToFetch.push(item.id);
                }
                break;
              case 'notation':
                if (!notationsToFetch.includes(item.id)) {
                  notationsToFetch.push(item.id);
                }
                break;
              case 'organization':
                if (!organizationsToFetch.includes(item.id)) {
                  organizationsToFetch.push(item.id);
                }
                break;
              case 'social_media_account':
                if (!socialMediaAccountsToFetch.includes(item.id)) {
                  socialMediaAccountsToFetch.push(item.id);
                }
                break;
            }
          });
        }

        [
          collectionData,
          externalLinkData,
          resourceData,
          eventData,
          attachmentData,
          linkGroupData,
          notationData,
          organizationData,
          socialMediaAccountData,
        ] = await Promise.all([
          collectionsToFetch.length > 0
            ? getCollectionByIdsServiceWithResources(
                collectionsToFetch,
                userId,
                tenantIds
              )
            : [],
          externalLinksToFetch.length > 0
            ? getExternalLinksByIdsService(
                externalLinksToFetch,
                userId,
                tenantIds
              )
            : [],
          resourcesToFetch.length > 0
            ? getResourcesByIdsService(resourcesToFetch, userId, tenantIds)
            : [],
          eventsToFetch.length > 0
            ? getEventsByIdsService(eventsToFetch, userId, tenantIds)
            : [],
          attachmentsToFetch.length > 0
            ? getAttachmentsByIds(attachmentsToFetch, userId, tenantIds)
            : [],
          linkGroupsToFetch.length > 0
            ? getLinkGroupsByIdsService(linkGroupsToFetch, userId, tenantIds)
            : [],
          notationsToFetch.length > 0
            ? getNotationsByIdsService(notationsToFetch, userId, tenantIds)
            : [],
          organizationsToFetch.length > 0
            ? getOrganizationsByIdsService(organizationsToFetch, tenantIds)
            : [],
          socialMediaAccountsToFetch.length > 0
            ? getSocialMediaAccountsByIdsService(
                socialMediaAccountsToFetch,
                userId,
                tenantIds
              )
            : [],
        ]);
      }

      // Remove embeddings when RAG is disabled - do this BEFORE model selection
      const shouldDisableRAG =
        !useRagOnly || hasMentionedItems || hasSelectedItems;

      const cleanDataForAI = (dataArray) => {
        if (!shouldDisableRAG) return dataArray; // Keep embeddings if RAG is enabled

        return dataArray.map((item) => {
          const cleanItem = { ...item };

          // Remove ALL embedding fields (comprehensive list)
          delete cleanItem.nameEmbedding;
          delete cleanItem.descriptionEmbedding;
          delete cleanItem.contentEmbedding;
          delete cleanItem.embedding;
          delete cleanItem.embeddings;
          delete cleanItem.combinedEmbedding;
          delete cleanItem.hashtagsEmbedding;
          delete cleanItem.vectorUpdatedAt;
          delete cleanItem.vectorStatus;

          // Clean nested items if they exist
          if (cleanItem.resources) {
            cleanItem.resources = cleanItem.resources.map((resource) => {
              const cleanResource = { ...resource };
              delete cleanResource.nameEmbedding;
              delete cleanResource.descriptionEmbedding;
              delete cleanResource.contentEmbedding;
              delete cleanResource.embedding;
              delete cleanResource.embeddings;
              delete cleanResource.combinedEmbedding;
              delete cleanResource.hashtagsEmbedding;
              delete cleanResource.vectorUpdatedAt;
              delete cleanResource.vectorStatus;
              return cleanResource;
            });
          }

          if (cleanItem.externalLinks) {
            cleanItem.externalLinks = cleanItem.externalLinks.map((link) => {
              const cleanLink = { ...link };
              delete cleanLink.nameEmbedding;
              delete cleanLink.descriptionEmbedding;
              delete cleanLink.contentEmbedding;
              delete cleanLink.embedding;
              delete cleanLink.embeddings;
              delete cleanLink.combinedEmbedding;
              delete cleanLink.hashtagsEmbedding;
              delete cleanLink.vectorUpdatedAt;
              delete cleanLink.vectorStatus;

              // Clean notations within external links
              if (cleanLink.notations) {
                cleanLink.notations = cleanLink.notations.map((notation) => {
                  const cleanNotation = { ...notation };
                  delete cleanNotation.nameEmbedding;
                  delete cleanNotation.descriptionEmbedding;
                  delete cleanNotation.contentEmbedding;
                  delete cleanNotation.embedding;
                  delete cleanNotation.embeddings;
                  delete cleanNotation.combinedEmbedding;
                  delete cleanNotation.notesEmbedding;
                  delete cleanNotation.vectorUpdatedAt;
                  delete cleanNotation.vectorStatus;
                  return cleanNotation;
                });
              }

              return cleanLink;
            });
          }

          return cleanItem;
        });
      };

      // Clean all data arrays BEFORE model selection
      const cleanCollectionData = cleanDataForAI(collectionData);
      const cleanExternalLinkData = cleanDataForAI(externalLinkData);
      const cleanResourceData = cleanDataForAI(resourceData);
      const cleanEventData = cleanDataForAI(eventData);
      const cleanAttachmentData = cleanDataForAI(attachmentData);
      const cleanLinkGroupData = cleanDataForAI(linkGroupData);
      const cleanNotationData = cleanDataForAI(notationData);
      const cleanOrganizationData = cleanDataForAI(organizationData);
      const cleanSocialMediaAccountData = cleanDataForAI(
        socialMediaAccountData
      );

      // Now determine the best model based on CLEANED data
      const dataForModelSelection = {
        collections: cleanCollectionData,
        externalLinks: cleanExternalLinkData,
        resources: cleanResourceData,
        events: cleanEventData,
        attachments: cleanAttachmentData,
        linkGroups: cleanLinkGroupData,
        notations: cleanNotationData,
        organizations: cleanOrganizationData,
        socialMediaAccounts: cleanSocialMediaAccountData,
      };

      const finalModel = await determineBestModel(dataForModelSelection, model);

      sendUpdate('modelSelected', {
        model: finalModel,
        status: `Using ${finalModel} for processing...`,
      });

      // Process the data with AI using processed data with routes
      const processedData = await generateChatWithAiAgents(
        prompt,
        userId,
        timeframe,
        history,
        {
          collections: cleanCollectionData,
          externalLinks: cleanExternalLinkData,
          resources: cleanResourceData,
          events: cleanEventData,
          attachments: cleanAttachmentData,
          linkGroups: cleanLinkGroupData,
          notations: cleanNotationData,
          organizations: cleanOrganizationData,
          socialMediaAccounts: cleanSocialMediaAccountData,
          other: data,
          mentionedItems: data.mentionedItems || [], // Pass mentioned items to AI service
        },
        finalModel,
        'patient',
        tenantIds, // Pass tenantIds for RAG filtering - this is the 8th parameter 'tenants'
        shouldDisableRAG // Pass whether to disable RAG
      );

      // Check if the response indicates insufficient credits
      if (
        (processedData.answer || processedData.response) &&
        (processedData?.answer?.includes('Insufficient credits') ||
          processedData?.response?.includes('Insufficient credits'))
      ) {
        return {
          answer: processedData.answer || processedData.response,
          data: {},
        };
      }

      const idsToFind = collectReferenceIds(processedData.references);

      const basicCollectionData = await getBasicCollectionsByIdsService(
        Array.from(idsToFind),
        userId,
        tenantIds
      );
      const basicExternalLinkData = await getBasicExternalLinksByIdsService(
        Array.from(idsToFind),
        userId,
        tenantIds
      );
      const basicResourceData = await getBasicResourcesByIdsService(
        Array.from(idsToFind),
        userId,
        tenantIds
      );

      const basicEventData = await getBasicEventsByIdsService(
        Array.from(idsToFind),
        userId,
        tenantIds
      );

      const basicAttachmentData = await getBasicAttachmentsByIdsService(
        Array.from(idsToFind),
        userId,
        tenantIds
      );

      const basicLinkGroupData = await getBasicLinkGroupsByIdsService(
        Array.from(idsToFind),
        userId,
        tenantIds
      );

      const basicNotationData = await getBasicNotationsByIdsService(
        Array.from(idsToFind),
        userId,
        tenantIds
      );

      const basicOrganizationData = await getOrganizationsByIdsService(
        Array.from(idsToFind),
        tenantIds
      );

      const basicSocialMediaAccountData =
        await getSocialMediaAccountsByIdsService(
          Array.from(idsToFind),
          userId,
          tenantIds
        );

      return {
        answer: processedData.response || processedData.answer,
        data: {
          collections: basicCollectionData,
          externalLinks: basicExternalLinkData,
          resources: basicResourceData,
          events: basicEventData,
          attachments: basicAttachmentData,
          linkGroups: basicLinkGroupData,
          notations: basicNotationData,
          organizations: basicOrganizationData,
          socialMediaAccounts: basicSocialMediaAccountData,
        },
      };
    } catch (error) {
      console.error('Error processing collections:', error);
      return {
        answer:
          error?.message ||
          'Failed to process the AI response. Please try again.',
        data: {},
      };
    }
  },

  searchContent: async (req, res) => {
    try {
      const { searchQuery } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (!searchQuery || searchQuery.length < 2) {
        return res.status(400).json({
          message: 'Search query must be at least 2 characters long',
        });
      }

      const results = await searchAllContentService(
        searchQuery,
        userId,
        tenantIds
      );

      return res.json({
        content: results,
      });
    } catch (error) {
      console.error('Error in search content:', error);
      return res.status(500).json({
        message: 'Error searching content',
        error: error.message,
      });
    }
  },

  processImage: async (req, res) => {
    try {
      const { imageUrl, prompt } = req.body;

      if (!imageUrl) {
        return res.status(400).json({
          message: 'Image URL is required',
        });
      }

      const result = await processImageService(imageUrl, prompt);

      return res.json({
        content: result,
      });
    } catch (error) {
      console.error('Error processing image:', error);
      return res.status(500).json({
        message: 'Error processing image',
        error: error.message,
      });
    }
  },

  // generateStructuredNotations: async (req, res) => {
  //   try {
  //     const { prompt, externalLinkId, separateListItems = false } = req.body;
  //     const userId = req.auth.dbUserId;

  //     // Validate required fields
  //     if (!prompt) {
  //       return res.status(400).json({
  //         message: 'Prompt is required',
  //       });
  //     }

  //     if (!externalLinkId) {
  //       return res.status(400).json({
  //         message: 'External link ID is required',
  //       });
  //     }

  //     // Generate structured notations using AI
  //     const structuredResult = await generateStructuredNotationsService(
  //       prompt,
  //       separateListItems
  //     );

  //     // Check if we got valid notation data
  //     if (!structuredResult.data || !Array.isArray(structuredResult.data)) {
  //       return res.status(400).json({
  //         message: 'Invalid notation data generated',
  //         result: structuredResult,
  //       });
  //     }

  //     // Get the collection external link ID
  //     const collectionExternalLinkId =
  //       await getCollectionExternalLinkIdService(externalLinkId);

  //     if (!collectionExternalLinkId) {
  //       return res.status(404).json({
  //         message:
  //           'External link not found or not associated with a collection',
  //       });
  //     }

  //     // Create all the notations
  //     const createdNotations = await addMultipleNotationsToExternalLinkService(
  //       collectionExternalLinkId,
  //       structuredResult.data,
  //       userId
  //     );

  //     return res.json({
  //       message: structuredResult.answer || 'Notations created successfully',
  //       notations: createdNotations,
  //       count: createdNotations.length,
  //     });
  //   } catch (error) {
  //     console.error('Error generating structured notations:', error);
  //     return res.status(500).json({
  //       message: 'Error generating structured notations',
  //       error: error.message,
  //     });
  //   }
  // },

  // New method for previewing structured notations without saving
  previewStructuredNotations: async (req, res) => {
    try {
      const { prompt, separateListItems = false } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          message: 'Prompt is required',
        });
      }

      // Generate structured notations using AI (no database save)
      const structuredResult = await generateStructuredNotationsService(
        prompt,
        separateListItems,
        userId,
        tenantIds
      );

      // Check if we got valid notation data
      if (!structuredResult.data || !Array.isArray(structuredResult.data)) {
        return res.status(400).json({
          message: 'Invalid notation data generated',
          result: structuredResult,
        });
      }

      // if data object includes a description key combine it with the notes key
      structuredResult.data.forEach((item) => {
        const description = item.description
          ? String(item.description).trim()
          : '';
        const notes = item.notes ? String(item.notes).trim() : '';

        if (description && notes) {
          item.notes = description + ' ' + notes;
        } else if (description) {
          item.notes = description;
        } else if (notes) {
          item.notes = notes;
        } else {
          item.notes = '';
        }

        // Always remove description since we've moved it to notes
        delete item.description;
      });

      // Process tags - find matching tag IDs for AI-suggested tags
      const tags = structuredResult.data
        .map((item) => item.tags)
        .filter((tagArray) => tagArray && Array.isArray(tagArray));

      const tagMap = await getTagIdsByNamesService(tags, userId, tenantIds);

      // Structure tags for each notation item - replace original tags with structured data
      structuredResult.data.forEach((item) => {
        if (item.tags && Array.isArray(item.tags)) {
          // Store original AI suggested tag names for reference
          item.originalTags = [...item.tags];

          // Replace tags with structured tag objects (only matched tags)
          item.tags = item.tags
            .map((tagName) => {
              if (typeof tagName === 'string') {
                const matchedTag = tagMap.get(tagName.toLowerCase());
                if (matchedTag) {
                  return {
                    id: matchedTag.id,
                    name: matchedTag.name,
                    color: matchedTag.color,
                    description: matchedTag.description,
                  };
                }
              }
              return null;
            })
            .filter((tag) => tag !== null);
        } else {
          item.tags = [];
          item.originalTags = [];
        }
      });

      // Return preview data for frontend confirmation
      return res.json({
        message:
          structuredResult.answer ||
          structuredResult.response ||
          'Preview generated successfully',
        preview: structuredResult.data,
        count: structuredResult.data.length,
        originalPrompt: prompt,
        separateListItems,
      });
    } catch (error) {
      console.error('Error previewing structured notations:', error);
      return res.status(500).json({
        message: 'Error generating notation preview',
        error: error.message,
      });
    }
  },

  // New method for confirming and creating multiple notations
  confirmStructuredNotations: async (req, res) => {
    try {
      const { externalLinkId, notations } = req.body;
      const userId = req.auth.dbUserId;

      // Validate required fields
      if (!externalLinkId) {
        return res.status(400).json({
          message: 'External link ID is required',
        });
      }

      if (!notations || !Array.isArray(notations) || notations.length === 0) {
        return res.status(400).json({
          message: 'Notations array is required and must not be empty',
        });
      }

      // Validate each notation has required fields
      for (const notation of notations) {
        if (!notation.title) {
          return res.status(400).json({
            message: 'All notations must have a title',
          });
        }
      }

      // Get the collection external link ID to verify the external link exists and is associated with a collection
      const collectionExternalLinkId =
        await getCollectionExternalLinkIdService(externalLinkId);

      if (!collectionExternalLinkId) {
        return res.status(404).json({
          message:
            'External link not found or not associated with a collection',
        });
      }

      // Create all the notations - pass the collectionExternalLinkId correctly
      const createdNotations = await addMultipleNotationsToExternalLinkService(
        collectionExternalLinkId,
        notations,
        userId
      );

      return res.json({
        message: 'Notations created successfully',
        notations: createdNotations,
        count: createdNotations.length,
      });
    } catch (error) {
      console.error('Error confirming structured notations:', error);
      return res.status(500).json({
        message: 'Error creating notations',
        error: error.message,
      });
    }
  },

  // New method for previewing bulk notation updates without saving
  previewBulkNotationUpdates: async (req, res) => {
    try {
      const { prompt, existingNotations } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          message: 'Prompt is required',
        });
      }

      if (
        !existingNotations ||
        !Array.isArray(existingNotations) ||
        existingNotations.length === 0
      ) {
        return res.status(400).json({
          message: 'Existing notations array is required and must not be empty',
        });
      }

      // Generate bulk notation updates using AI (no database save)
      const updateResult = await generateBulkNotationUpdatesService(
        prompt,
        existingNotations,
        userId,
        tenantIds
      );

      // Check if we got valid update data
      if (!updateResult.data || !Array.isArray(updateResult.data)) {
        return res.status(400).json({
          message: 'Invalid update data generated',
          result: updateResult,
        });
      }

      // Process tags - find matching tag IDs for AI-suggested tags
      const tags = updateResult.data
        .map((item) => item.tags)
        .filter((tagArray) => tagArray && Array.isArray(tagArray));

      const tagMap = await getTagIdsByNamesService(tags, userId, tenantIds);

      // Structure tags for each update item - replace original tags with structured data
      updateResult.data.forEach((item) => {
        if (item.tags && Array.isArray(item.tags)) {
          // Store original AI suggested tag names for reference
          item.originalTags = [...item.tags];

          // Replace tags with structured tag objects (only matched tags)
          item.tags = item.tags
            .map((tagName) => {
              if (typeof tagName === 'string') {
                const matchedTag = tagMap.get(tagName.toLowerCase());
                if (matchedTag) {
                  return {
                    id: matchedTag.id,
                    name: matchedTag.name,
                    color: matchedTag.color,
                    description: matchedTag.description,
                  };
                }
              }
              return null;
            })
            .filter((tag) => tag !== null);
        } else {
          item.tags = [];
          item.originalTags = [];
        }
      });

      // Return preview data for frontend confirmation
      return res.json({
        message:
          updateResult.answer ||
          updateResult.response ||
          'Bulk update preview generated successfully',
        preview: updateResult.data,
        count: updateResult.data.length,
        originalPrompt: prompt,
        totalNotationsProvided: existingNotations.length,
      });
    } catch (error) {
      console.error('Error previewing bulk notation updates:', error);
      return res.status(500).json({
        message: 'Error generating bulk update preview',
        error: error.message,
      });
    }
  },

  // New method for confirming and applying bulk notation updates
  confirmBulkNotationUpdates: async (req, res) => {
    try {
      const { updates, externalLinkId, collectionId } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate required fields
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          message: 'Updates array is required and must not be empty',
        });
      }

      if (!externalLinkId) {
        return res.status(400).json({
          message: 'External link ID is required',
        });
      }

      // Validate each update has required fields
      for (const update of updates) {
        if (!update.id || !update.after) {
          return res.status(400).json({
            message: 'All updates must have id and after fields',
          });
        }
        if (!update.after.title) {
          return res.status(400).json({
            message: 'All updated notations must have a title',
          });
        }
      }

      // Check permissions on the external link
      const externalLink = await getExternalLinkByIdService(
        externalLinkId,
        userId,
        tenantIds
      );

      if (!externalLink) {
        return res.status(403).json({
          message: 'Access denied to external link',
        });
      }

      // Check if user can edit notations on this external link
      const isExternalLinkOwner = externalLink.addedByUserId === userId;
      let canEditAsCollaborator = false;

      if (!isExternalLinkOwner) {
        // Only allow collaborator edits on public/unlisted external links
        if (['public', 'unlisted'].includes(externalLink.visibility)) {
          // Get the collection external link ID
          const collectionExternalLinkResult = await db
            .select({
              id: collectionExternalLinks.id,
            })
            .from(collectionExternalLinks)
            .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
            .limit(1);

          if (collectionExternalLinkResult[0]) {
            const userCollaborator = await db
              .select()
              .from(collectionExternalLinkCollaborators)
              .where(
                and(
                  eq(
                    collectionExternalLinkCollaborators.collectionExternalLinkId,
                    collectionExternalLinkResult[0].id
                  ),
                  eq(collectionExternalLinkCollaborators.userId, userId)
                )
              )
              .limit(1);

            if (
              userCollaborator[0] &&
              ['editor', 'admin'].includes(userCollaborator[0].role)
            ) {
              canEditAsCollaborator = true;
            }
          }
        }
      }

      if (!isExternalLinkOwner && !canEditAsCollaborator) {
        return res.status(403).json({
          message:
            'Unauthorized: You do not have permission to edit notations on this external link',
        });
      }

      // Apply all the notation updates
      const updatedNotations = await updateMultipleNotationsService(
        updates,
        externalLinkId,
        userId
      );

      return res.json({
        message: 'Notations updated successfully',
        notations: updatedNotations,
        count: updatedNotations.length,
        totalUpdatesRequested: updates.length,
      });
    } catch (error) {
      console.error('Error confirming bulk notation updates:', error);
      return res.status(500).json({
        message: 'Error applying bulk notation updates',
        error: error.message,
      });
    }
  },

  // Preview structured events without saving to database
  previewStructuredEvents: async (req, res) => {
    try {
      const {
        prompt,
        metadata = {},
        organizationId,
        organizationIds = [],
      } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          message: 'Prompt is required',
        });
      }

      // Extract metadata
      const { eventTypes = [], organizations = [], tags = [] } = metadata;

      // Generate structured events using AI with organization extraction (no database save)
      const structuredResult =
        await generateStructuredEventsWithOrganizationsService(
          prompt,
          eventTypes,
          organizations,
          tags,
          userId,
          tenantIds,
          organizationId,
          organizationIds
        );

      // Check if we got valid event data
      if (!structuredResult.data || !Array.isArray(structuredResult.data)) {
        return res.status(400).json({
          message: 'Invalid event data generated',
          result: structuredResult,
        });
      }

      // Process and validate events
      structuredResult.data.forEach((event) => {
        // Ensure tenant ID
        if (!event.tenantId) {
          event.tenantId = tenantIds[0] || process.env.COMMUNITY_TENANT;
        }

        // Validate eventTypeId
        if (event.eventTypeId && eventTypes.length > 0) {
          const validType = eventTypes.find((t) => t.id === event.eventTypeId);
          if (!validType) {
            // Default to first event type if invalid
            event.eventTypeId = eventTypes[0]?.id || null;
          }
        }

        // Validate organization IDs
        if (
          event.organizations &&
          Array.isArray(event.organizations) &&
          organizations.length > 0
        ) {
          event.organizations = event.organizations.filter((orgId) =>
            organizations.some((org) => org.id === orgId)
          );
        }

        // Validate tag IDs
        if (event.tags && Array.isArray(event.tags) && tags.length > 0) {
          event.tags = event.tags.filter((tagId) =>
            tags.some((tag) => tag.id === tagId)
          );
        }
      });

      // Return preview data for frontend confirmation
      return res.json({
        message:
          structuredResult.answer ||
          structuredResult.response ||
          'Preview generated successfully',
        preview: structuredResult.data,
        organizations: structuredResult.organizations || null, // Include organization matching/extraction results
        count: structuredResult.data.length,
        originalPrompt: prompt,
        metadata,
      });
    } catch (error) {
      console.error('Error previewing structured events:', error);
      return res.status(500).json({
        message: 'Error generating preview',
        error: error.message,
      });
    }
  },

  // Confirm and create multiple events in bulk
  confirmStructuredEvents: async (req, res) => {
    try {
      const { events, newOrganizations = [] } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate that we have either events or organizations to create
      if (
        (!events || !Array.isArray(events) || events.length === 0) &&
        (!newOrganizations ||
          !Array.isArray(newOrganizations) ||
          newOrganizations.length === 0)
      ) {
        return res.status(400).json({
          message: 'Either events or organizations must be provided',
        });
      }

      // Import necessary services
      const { createEventService } = await import(
        '../services/eventService.js'
      );
      const { createOrganizationService } = await import(
        '../services/organizationService.js'
      );

      // Create a mapping for new organizations
      const organizationMapping = new Map();

      // First, create any new organizations
      if (newOrganizations.length > 0) {
        for (const org of newOrganizations) {
          try {
            // Prepare organization data with minimal required fields
            const orgData = {
              name: org.name,
              acronym: org.acronym || '',
              description: org.description || '',
              website: org.website || '',
              city: org.city || '',
              state: org.state || '',
              category: org.category || '',
              tenantId: tenantIds[0] || process.env.COMMUNITY_TENANT,
              userId: userId,
            };

            // Create the organization
            const createdOrg = await createOrganizationService(
              orgData,
              userId,
              tenantIds
            );

            // Map the temporary ID to the real ID
            if (org.tempId) {
              organizationMapping.set(org.tempId, createdOrg.id);
            }
          } catch (error) {
            console.error('Error creating organization:', error);
            // Continue with other organizations even if one fails
          }
        }
      }

      // Process each event
      const results = {
        successful: 0,
        failed: 0,
        errors: [],
        createdEvents: [],
        createdOrganizations: Array.from(organizationMapping.values()),
      };

      // If no events to create, return early with just organization results
      if (!events || events.length === 0) {
        return res.json({
          message: `Created ${results.createdOrganizations.length} organization${results.createdOrganizations.length > 1 ? 's' : ''} successfully`,
          results,
        });
      }

      for (let i = 0; i < events.length; i++) {
        const event = events[i];

        try {
          // Ensure required fields
          if (!event.title) {
            throw new Error('Event title is required');
          }

          // Update organization IDs with newly created ones
          if (event.organizations && Array.isArray(event.organizations)) {
            event.organizations = event.organizations
              .map((orgId) => {
                // Check if this is a temporary ID that needs mapping
                if (typeof orgId === 'string' && orgId.startsWith('temp-')) {
                  const realId = organizationMapping.get(orgId);
                  return realId || orgId;
                }
                return orgId;
              })
              .filter((id) => id); // Remove any undefined values
          }

          // Add user ID and ensure tenant ID
          event.addedByUserId = userId;
          if (!event.tenantId) {
            event.tenantId = tenantIds[0] || process.env.COMMUNITY_TENANT;
          }

          // Create the event
          const createdEvent = await createEventService(
            event,
            userId,
            tenantIds
          );

          results.successful++;
          results.createdEvents.push({
            id: createdEvent.id,
            title: createdEvent.title,
          });
        } catch (error) {
          console.error(`Error creating event ${i + 1}:`, error);
          results.failed++;
          results.errors.push({
            index: i,
            title: event.title,
            error: error.message,
          });
        }
      }

      return res.json({
        message: `Created ${results.successful} events successfully${results.createdOrganizations.length > 0 ? ` and ${results.createdOrganizations.length} organizations` : ''}`,
        results,
      });
    } catch (error) {
      console.error('Error creating structured events:', error);
      return res.status(500).json({
        message: 'Error creating events',
        error: error.message,
      });
    }
  },

  // Preview structured resources without saving to database
  previewStructuredResources: async (req, res) => {
    try {
      const {
        prompt,
        metadata = {},
        organizationId = null,
        organizationIds = [],
        tenantId: requestTenantId = null,
      } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          message: 'Prompt is required',
        });
      }

      // Extract metadata
      const {
        resourceTypes = [],
        organizations = [],
        tags = [],
        sensitivityLevels = [],
        expertiseLevels = [],
        selectedTenant = null,
      } = metadata;

      // Import the service
      const { generateStructuredResourcesWithOrganizationsService } =
        await import('../services/aiService.js');

      // Determine organization parameters - prioritize explicit organizationIds
      const effectiveOrganizationId =
        organizationId ||
        (organizationIds.length === 1 ? organizationIds[0] : null) ||
        (organizations.length === 1 ? organizations[0].id : null);

      const tenantId = requestTenantId || selectedTenant?.id || null;

      // Generate structured resources using AI with organization extraction (no database save)
      const structuredResult =
        await generateStructuredResourcesWithOrganizationsService(
          prompt,
          resourceTypes,
          organizations,
          tags,
          sensitivityLevels,
          expertiseLevels,
          userId,
          tenantIds,
          effectiveOrganizationId, // Force single organization if only one provided
          tenantId // Use selected tenant ID
        );

      // Check if we got valid resource data
      if (!structuredResult.data || !Array.isArray(structuredResult.data)) {
        return res.status(400).json({
          message: 'Invalid resource data generated',
          result: structuredResult,
        });
      }

      // Process and validate resources
      structuredResult.data.forEach((resource) => {
        // Ensure tenant ID
        if (!resource.tenantId) {
          resource.tenantId = tenantIds[0] || process.env.COMMUNITY_TENANT;
        }

        // Validate resourceTypeId
        if (resource.resourceTypeId && resourceTypes.length > 0) {
          const validType = resourceTypes.find(
            (t) => t.id === resource.resourceTypeId
          );
          if (!validType) {
            // Default to first resource type if invalid
            resource.resourceTypeId = resourceTypes[0]?.id || null;
          }
        }

        // Validate organization IDs
        if (
          resource.organizations &&
          Array.isArray(resource.organizations) &&
          organizations.length > 0
        ) {
          resource.organizations = resource.organizations.filter((orgId) =>
            organizations.some((org) => org.id === orgId)
          );
        }

        // Validate tag IDs
        if (resource.tags && Array.isArray(resource.tags) && tags.length > 0) {
          resource.tags = resource.tags.filter((tagId) =>
            tags.some((tag) => tag.id === tagId)
          );
        }

        // Validate sensitivity level
        if (resource.sensitivityLevelId && sensitivityLevels.length > 0) {
          const validLevel = sensitivityLevels.find(
            (sl) => sl.id === resource.sensitivityLevelId
          );
          if (!validLevel) {
            resource.sensitivityLevelId = sensitivityLevels[0]?.id || null;
          }
        }

        // Validate expertise level
        if (resource.expertiseLevelId && expertiseLevels.length > 0) {
          const validLevel = expertiseLevels.find(
            (el) => el.id === resource.expertiseLevelId
          );
          if (!validLevel) {
            resource.expertiseLevelId = expertiseLevels[0]?.id || null;
          }
        }
      });

      // Return preview data for frontend confirmation
      return res.json({
        message:
          structuredResult.answer ||
          structuredResult.response ||
          'Preview generated successfully',
        preview: structuredResult.data,
        organizations: structuredResult.organizations || null, // Include organization matching/extraction results
        count: structuredResult.data.length,
        originalPrompt: prompt,
        metadata,
      });
    } catch (error) {
      console.error('Error previewing structured resources:', error);
      return res.status(500).json({
        message: 'Error generating preview',
        error: error.message,
      });
    }
  },

  // Confirm and create multiple resources in bulk
  confirmStructuredResources: async (req, res) => {
    try {
      const { resources, newOrganizations = [] } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate that we have either resources or organizations to create
      if (
        (!resources || !Array.isArray(resources) || resources.length === 0) &&
        (!newOrganizations ||
          !Array.isArray(newOrganizations) ||
          newOrganizations.length === 0)
      ) {
        return res.status(400).json({
          message: 'Either resources or organizations must be provided',
        });
      }

      // Import necessary services
      const { createResourceService } = await import(
        '../services/resourceService.js'
      );
      const { createOrganizationService } = await import(
        '../services/organizationService.js'
      );

      // Create a mapping for new organizations
      const organizationMapping = new Map();

      // First, create any new organizations
      if (newOrganizations.length > 0) {
        for (const org of newOrganizations) {
          try {
            // Prepare organization data with minimal required fields
            const orgData = {
              name: org.name,
              acronym: org.acronym || '',
              description: org.description || '',
              website: org.website || '',
              city: org.city || '',
              state: org.state || '',
              category: org.category || '',
              tenantId: tenantIds[0] || process.env.COMMUNITY_TENANT,
              userId: userId,
            };

            // Create the organization
            const createdOrg = await createOrganizationService(
              orgData,
              userId,
              tenantIds
            );

            // Map the temporary ID to the real ID
            if (org.tempId) {
              organizationMapping.set(org.tempId, createdOrg.id);
            }
          } catch (error) {
            console.error('Error creating organization:', error);
            // Continue with other organizations even if one fails
          }
        }
      }

      // Process each resource
      const results = {
        successful: 0,
        failed: 0,
        errors: [],
        createdResources: [],
        createdOrganizations: Array.from(organizationMapping.values()),
      };

      // If no resources to create, return early with just organization results
      if (!resources || resources.length === 0) {
        return res.json({
          message: `Created ${results.createdOrganizations.length} organization${results.createdOrganizations.length > 1 ? 's' : ''} successfully`,
          results,
        });
      }

      for (let i = 0; i < resources.length; i++) {
        const resource = resources[i];

        try {
          // Ensure required fields
          if (!resource.name || !resource.url) {
            throw new Error('Resource name and URL are required');
          }

          // Update organization IDs with newly created ones
          if (resource.organizations && Array.isArray(resource.organizations)) {
            resource.organizations = resource.organizations
              .map((orgId) => {
                // Check if this is a temporary ID that needs mapping
                if (typeof orgId === 'string' && orgId.startsWith('temp-')) {
                  const realId = organizationMapping.get(orgId);

                  return realId || orgId;
                }
                return orgId;
              })
              .filter((id) => id); // Remove any undefined values
          }

          // Add user ID and ensure tenant ID
          resource.addedByUserId = userId;
          if (!resource.tenantId) {
            resource.tenantId = tenantIds[0] || process.env.COMMUNITY_TENANT;
          }

          // Create the resource
          const createdResource = await createResourceService(
            resource,
            userId,
            tenantIds
          );

          results.successful++;
          results.createdResources.push({
            id: createdResource.id,
            name: createdResource.name,
          });
        } catch (error) {
          console.error(`Error creating resource ${i + 1}:`, error);
          results.failed++;
          results.errors.push({
            index: i,
            name: resource.name,
            error: error.message,
          });
        }
      }

      return res.json({
        message: `Created ${results.successful} resources successfully${results.createdOrganizations.length > 0 ? ` and ${results.createdOrganizations.length} organizations` : ''}`,
        results,
      });
    } catch (error) {
      console.error('Error creating structured resources:', error);
      return res.status(500).json({
        message: 'Error creating resources',
        error: error.message,
      });
    }
  },

  // Preview structured social media accounts without saving to database
  previewStructuredSocialMedia: async (req, res) => {
    try {
      const { prompt, metadata = {} } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          message: 'Prompt is required',
        });
      }

      // Extract metadata
      const {
        platforms = [],
        organizations = [],
        collections = [],
        externalLinks = [],
        mentionedItems = [],
      } = metadata;

      // Generate structured social media accounts using AI (no database save)
      const structuredResult =
        await generateStructuredSocialMediaAccountsService(
          prompt,
          platforms,
          organizations,
          collections,
          externalLinks,
          mentionedItems,
          userId,
          tenantIds
        );

      // Check if we got valid account data
      if (
        !structuredResult.accounts ||
        !Array.isArray(structuredResult.accounts)
      ) {
        return res.status(400).json({
          message: 'Invalid social media account data generated',
          result: structuredResult,
        });
      }

      // Process and validate accounts
      structuredResult.accounts.forEach((account) => {
        // Ensure platform ID
        if (account.platformId && platforms.length > 0) {
          const validPlatform = platforms.find(
            (p) => p.id === account.platformId
          );
          if (!validPlatform) {
            // Try to match by name
            const platformByName = platforms.find(
              (p) =>
                p.name.toLowerCase() === account.platformName?.toLowerCase() ||
                (account.platformName?.toLowerCase() === 'twitter' &&
                  p.name.toLowerCase() === 'x') ||
                (account.platformName?.toLowerCase() === 'x' &&
                  p.name.toLowerCase() === 'twitter')
            );
            if (platformByName) {
              account.platformId = platformByName.id;
            } else {
              // Default to first platform if no match
              account.platformId = platforms[0]?.id || null;
            }
          }
        }

        // Set default values
        account.visibility = account.visibility || 'private';
        account.accountType = account.accountType || 'personal';
      });

      // Process associations
      const associations = [];
      if (
        structuredResult.associations &&
        Array.isArray(structuredResult.associations)
      ) {
        associations.push(...structuredResult.associations);
      } else if (mentionedItems.length > 0) {
        // If no associations from AI, create default associations based on mentioned items
        structuredResult.accounts.forEach((account, index) => {
          associations[index] = {
            organizations: mentionedItems
              .filter((item) => item.type === 'organization')
              .map((item) => item.id),
            collections: mentionedItems
              .filter((item) => item.type === 'collection')
              .map((item) => item.id),
            external_links: mentionedItems
              .filter((item) => item.type === 'external_link')
              .map((item) => item.id),
          };
        });
      }

      // Return preview data for frontend confirmation
      return res.json({
        message:
          structuredResult.answer ||
          structuredResult.response ||
          'Preview generated successfully',
        accounts: structuredResult.accounts,
        associations: associations,
        count: structuredResult.accounts.length,
        originalPrompt: prompt,
        metadata,
      });
    } catch (error) {
      console.error(
        'Error previewing structured social media accounts:',
        error
      );
      return res.status(500).json({
        message: 'Error generating preview',
        error: error.message,
      });
    }
  },

  // Confirm and create social media accounts using bulk endpoint
  confirmStructuredSocialMedia: async (req, res) => {
    try {
      const { accounts, associations } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate that we have accounts to create
      if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({
          message: 'Accounts array is required and must not be empty',
        });
      }

      // Import the social media controller to use bulk create
      const { socialMediaController } = await import(
        './socialMediaController.js'
      );

      // Prepare the request object for bulk create
      const bulkReq = {
        body: {
          accounts: accounts,
          associations: associations || [],
        },
        auth: req.auth,
        tenantIds: tenantIds,
      };

      // Create a promise to capture the response
      let responseData = null;
      let responseError = null;

      // Mock response object that captures the response
      const bulkRes = {
        status: (code) => ({
          json: (data) => {
            if (code >= 400) {
              responseError = data;
            } else {
              responseData = data;
            }
            return data;
          },
        }),
        json: (data) => {
          responseData = data;
          return data;
        },
      };

      // Call the bulk create method
      await socialMediaController.bulkCreateAccounts(bulkReq, bulkRes);

      // Check if there was an error
      if (responseError) {
        throw new Error(
          responseError.error || responseError.message || 'Bulk create failed'
        );
      }

      // Return the captured response
      if (responseData) {
        return res.json({
          message:
            responseData.message ||
            `Created ${responseData.results?.successful || 0} social media accounts successfully`,
          created: responseData.results?.created || [],
          results: responseData.results,
        });
      } else {
        throw new Error('No response from bulk create');
      }
    } catch (error) {
      console.error('Error creating structured social media accounts:', error);
      return res.status(500).json({
        message: 'Error creating social media accounts',
        error: error.message,
      });
    }
  },

  // Preview structured external links without saving to database
  previewStructuredExternalLinks: async (req, res) => {
    try {
      const { prompt, metadata = {} } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Validate required fields
      if (!prompt) {
        return res.status(400).json({
          message: 'Prompt is required',
        });
      }

      // Extract metadata
      const { tags = [] } = metadata;

      // Import the service
      const { generateStructuredExternalLinksService } = await import(
        '../services/aiService.js'
      );

      // Generate structured external links using AI (no database save)
      const structuredResult = await generateStructuredExternalLinksService(
        prompt,
        tags,
        userId,
        tenantIds
      );

      // Check if we got valid external link data
      if (!structuredResult.data || !Array.isArray(structuredResult.data)) {
        return res.status(400).json({
          message: 'Invalid external link data generated',
          result: structuredResult,
        });
      }

      // Process tags - find matching tag IDs for AI-suggested tags
      const allTags = structuredResult.data
        .map((item) => item.tags)
        .filter((tagArray) => tagArray && Array.isArray(tagArray));

      const tagMap = await getTagIdsByNamesService(allTags, userId, tenantIds);

      // Process and validate external links
      structuredResult.data.forEach((link) => {
        // Ensure type defaults to 'external'
        if (!link.type) {
          link.type = 'external';
        }

        // Set default visibility to 'private' if not specified
        if (!link.visibility) {
          link.visibility = 'private';
        }

        // Process tags - replace original tags with structured data
        if (link.tags && Array.isArray(link.tags)) {
          // Store original AI suggested tag names for reference
          link.originalTags = [...link.tags];

          // Replace tags with structured tag objects (only matched tags)
          link.tags = link.tags
            .map((tagName) => {
              if (typeof tagName === 'string') {
                const matchedTag = tagMap.get(tagName.toLowerCase());
                if (matchedTag) {
                  return {
                    id: matchedTag.id,
                    name: matchedTag.name,
                    color: matchedTag.color,
                    description: matchedTag.description,
                  };
                }
              }
              return null;
            })
            .filter((tag) => tag !== null);
        } else {
          link.tags = [];
          link.originalTags = [];
        }
      });

      // Return preview data for frontend confirmation
      return res.json({
        message:
          structuredResult.answer ||
          structuredResult.response ||
          'Preview generated successfully',
        preview: structuredResult.data,
        count: structuredResult.data.length,
        originalPrompt: prompt,
        metadata,
      });
    } catch (error) {
      console.error('Error previewing structured external links:', error);
      return res.status(500).json({
        message: 'Error generating preview',
        error: error.message,
      });
    }
  },

  // Confirm and create multiple external links in bulk
  confirmStructuredExternalLinks: async (req, res) => {
    try {
      const { externalLinks } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (
        !externalLinks ||
        !Array.isArray(externalLinks) ||
        externalLinks.length === 0
      ) {
        return res.status(400).json({
          message: 'External links array is required and must not be empty',
        });
      }

      // Validate each external link has required fields including collectionId
      for (const link of externalLinks) {
        if (!link.name) {
          return res.status(400).json({
            message: 'All external links must have a name',
          });
        }
        if (!link.collectionId) {
          return res.status(400).json({
            message: 'All external links must have a collectionId',
          });
        }
      }

      // Import necessary services
      const {
        addExternalLinkToCollectionService,
        getCollectionByIdService,
        getCollectionCollaboratorsService,
      } = await import('../services/collectionService.js');
      const {
        addTagsToCollectionExternalLinkService,
        getCollectionExternalLinkIdService,
      } = await import('../services/collectionExternalLinkTagsService.js');

      // First, validate access to all collections
      const collectionAccessMap = new Map();

      for (const link of externalLinks) {
        if (!collectionAccessMap.has(link.collectionId)) {
          try {
            // Check if the collection exists and user has access
            const collection = await getCollectionByIdService(
              link.collectionId,
              userId,
              tenantIds
            );

            if (!collection) {
              collectionAccessMap.set(link.collectionId, {
                hasAccess: false,
                error: 'Collection not found',
              });
              continue;
            }

            // Check if user owns the collection or is a collaborator with permission
            const isOwner = collection.userId === userId;
            let isCollaboratorWithPermission = false;

            if (!isOwner) {
              // Check if user is a collaborator with canAddLinks permission
              const collaborators = await getCollectionCollaboratorsService(
                link.collectionId
              );
              const userCollaboration = collaborators.find(
                (c) => c.userId === userId
              );
              isCollaboratorWithPermission =
                userCollaboration && userCollaboration.canAddLinks;
            }

            if (!isOwner && !isCollaboratorWithPermission) {
              collectionAccessMap.set(link.collectionId, {
                hasAccess: false,
                error:
                  'You do not have permission to add links to this collection',
              });
            } else {
              collectionAccessMap.set(link.collectionId, { hasAccess: true });
            }
          } catch (error) {
            collectionAccessMap.set(link.collectionId, {
              hasAccess: false,
              error: error.message,
            });
          }
        }
      }

      // Process each external link
      const results = {
        successful: 0,
        failed: 0,
        errors: [],
        createdLinks: [],
      };

      for (let i = 0; i < externalLinks.length; i++) {
        const link = externalLinks[i];

        try {
          // Check if user has access to this collection
          const accessInfo = collectionAccessMap.get(link.collectionId);
          if (!accessInfo || !accessInfo.hasAccess) {
            throw new Error(accessInfo?.error || 'Access denied to collection');
          }
          // Prepare external link data (without tags - we'll add them separately)
          const mergedDescription = [link.description, link.notes]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .filter((value, index, values) => values.indexOf(value) === index)
            .join('\n\n');

          const externalLinkData = {
            url: String(link.url || '').trim() || null,
            name: String(link.name || '').trim(),
            description: mergedDescription,
            notes: '',
            date: link.startDate || link.date || null,
            startDate: link.startDate || link.date || null,
            endDate: link.endDate || link.startDate || link.date || null,
            visibility: link.visibility || 'private',
            type: link.type || 'external',
            userId: userId,
            tenantId: tenantIds[0] || process.env.COMMUNITY_TENANT,
          };

          // Create the external link and add to the specific collection for this link
          const createdLink = await addExternalLinkToCollectionService(
            link.collectionId,
            externalLinkData
          );

          // Add tags if provided
          if (link.tags && link.tags.length > 0) {
            try {
              // Get the collection external link ID
              const collectionExternalLinkId =
                await getCollectionExternalLinkIdService(createdLink.id);

              const tagIds = await resolveStructuredExternalLinkTagIds(
                link.tags,
                userId,
                tenantIds
              );

              if (tagIds.length > 0) {
                await addTagsToCollectionExternalLinkService(
                  collectionExternalLinkId,
                  tagIds
                );
              }
            } catch (tagError) {
              console.error(
                `Error adding tags to external link ${createdLink.id}:`,
                tagError
              );
              // Continue even if tags fail - the link was created successfully
            }
          }

          results.successful++;
          results.createdLinks.push({
            id: createdLink.id,
            name: createdLink.name,
            url: createdLink.url,
            collectionId: link.collectionId,
          });
        } catch (error) {
          console.error(`Error creating external link ${i + 1}:`, error);
          results.failed++;
          results.errors.push({
            index: i,
            name: link.name,
            collectionId: link.collectionId,
            error: error.message,
          });
        }
      }

      return res.json({
        message: `Created ${results.successful} external links successfully`,
        results,
      });
    } catch (error) {
      console.error('Error creating structured external links:', error);
      return res.status(500).json({
        message: 'Error creating external links',
        error: error.message,
      });
    }
  },
};

// Helper function to parse JSON response
const parseJsonResponse = (responseContent) => {
  // Use a regex to extract the JSON block from the response.
  const jsonRegex = /{[\s\S]*}/;
  const matchResult = responseContent.match(jsonRegex);

  if (!matchResult) {
    // If no JSON part is found, return an object with the raw response.
    return { answer: responseContent };
  }

  const jsonString = matchResult[0];

  // Try to parse the extracted JSON. If it fails because of control characters,
  // attempt to fix newlines within string literals.
  try {
    return JSON.parse(jsonString);
  } catch (parseError) {
    console.error(
      'Initial JSON parse failed, attempting to escape newlines:',
      parseError
    );
    // This function replaces newlines and carriage returns inside any double-quoted string.
    const escapeNewlinesInJsonString = (str) =>
      str.replace(/("(?:\\.|[^"\\])*")/g, (match) => {
        return match.replace(/\n/g, '\\n').replace(/\r/g, '\\n');
      });
    const fixedJsonString = escapeNewlinesInJsonString(jsonString);
    return JSON.parse(fixedJsonString);
  }
};

const determineBestModel = async (data, recommendedModel) => {
  try {
    // Ensure recommendedModel is a string
    const modelName = String(recommendedModel);

    // If we already have a Claude model recommendation, check if we need to adjust based on data size
    if (modelName.includes('claude')) {
      // Estimate token count based on data size
      const estimatedTokens = calculateEstimatedTokens(data);

      // If data is very large (>80k tokens), always use Haiku for efficiency
      if (estimatedTokens > 80000) {
        return 'claude-3-5-haiku-20241022';
      }

      // Otherwise, use the recommended model
      return modelName;
    }

    // For backward compatibility with Gemini models
    if (modelName.includes('gemini')) {
      // Estimate token count based on data size
      const estimatedTokens = calculateEstimatedTokens(data);

      // If token count exceeds threshold, use a more efficient model
      if (estimatedTokens > 80000) {
        return 'gemini-2.5-flash';
      }

      return modelName;
    }

    // Default to Haiku if no valid model provided
    return 'claude-3-5-haiku-20241022';
  } catch (error) {
    console.error('Error determining best model:', error);
    // Default to Haiku if there's an error
    return 'claude-3-5-haiku-20241022';
  }
};

const calculateEstimatedTokens = (data) => {
  try {
    // Convert data to string and count characters
    const dataString = JSON.stringify(data);
    // Rough estimation: 1 token ≈ 4 characters
    const estimatedTokens = Math.ceil(dataString.length / 4);

    return estimatedTokens;
  } catch (error) {
    console.error('Error calculating estimated tokens:', error);
    return 0;
  }
};
