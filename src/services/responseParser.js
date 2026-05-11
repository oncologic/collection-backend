import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { parseTimestamps } from '../utils/general.js';

// Function to correct IDs in the Claude response
export const correctCollectionIds = (parsedResponse, details) => {
  if (!parsedResponse?.data || !Array.isArray(parsedResponse.data)) {
    return parsedResponse;
  }

  const correctedData = parsedResponse.data.map((item) => {
    // Check if collectionId is actually a collection ID
    const matchingCollection = details.collections.find(
      (collection) =>
        collection.id === item.id || collection.id === item.collectionId
    );

    if (matchingCollection) {
      //   matchingCollection.timestamps = parseTimestamps(
      //     matchingCollection.description
      //   );
      // Return the full collection details instead of the original item
      return {
        ...matchingCollection,
        type: 'collection',
      };
    }
    // }

    // Check if the item is a notation
    const matchingNotation = details.notations.find(
      (notation) => notation.id === item.id
    );

    if (matchingNotation) {
      //   matchingNotation.timestamps = parseTimestamps(
      //     matchingNotation.description
      //   );
      return {
        ...matchingNotation,
        type: 'notation',
      };
    }

    // Check if the item is an event
    const matchingEvent = details.events.find((event) => event.id === item.id);

    if (matchingEvent) {
      // matchingEvent.timestamps = parseTimestamps(matchingEvent.description);
      return {
        ...matchingEvent,
        type: 'event',
      };
    }

    // Check if the item is an attachment
    const attachmentFromMain = details.attachments.find(
      (attachment) => attachment.id === item.id
    );
    const attachmentFromLinks = details.collections
      .flatMap((collection) => collection.externalLinks || [])
      .find((link) =>
        (link.attachments || []).some((attachment) => attachment.id === item.id)
      );
    const matchingAttachment =
      attachmentFromMain ||
      (attachmentFromLinks?.attachments || []).find(
        (attachment) => attachment.id === item.id
      );

    if (matchingAttachment) {
      // matchingAttachment.timestamps = parseTimestamps(
      //   matchingAttachment.description
      // );
      return {
        ...matchingAttachment,
        externalLinkId: attachmentFromLinks?.id || null,
        presignedUrl:
          matchingAttachment.type === 'image' &&
          matchingAttachment.imageKey &&
          generatePresignedCloudFrontUrl(matchingAttachment.imageKey, 3600),
        type: matchingAttachment.type === 'image' ? 'image' : 'attachment',
      };
    }

    // Check if the item is a resource
    const matchingResource =
      details.resources.find((resource) => resource.id === item.id) ||
      details.collections
        .flatMap((collection) => collection.resources || [])
        .find((resource) => resource.id === item.id);

    if (matchingResource) {
      // matchingResource.timestamps = parseTimestamps(
      //   matchingResource.description
      // );
      return {
        ...matchingResource,
        type: 'resource',
      };
    }

    // Check if the item is an external link
    const matchingExternalLink =
      details.externalLinks.find((link) => link.id === item.id) ||
      details.collections
        .flatMap((collection) => collection.externalLinks || [])
        .find((link) => link.id === item.id);

    if (matchingExternalLink) {
      matchingExternalLink.timestamps = parseTimestamps(
        matchingExternalLink.description
      );
      return {
        ...matchingExternalLink,
        type: 'notation',
      };
    }
    return item;
  });

  return {
    ...parsedResponse,
    data: correctedData,
  };
};

// You can add more parsing functions here as needed
