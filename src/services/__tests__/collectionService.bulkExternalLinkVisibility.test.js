import { db } from '../../db/index.js';
import { collections } from '../../models/collections.js';
import {
  collectionExternalLinks,
  externalLinks,
} from '../../models/external_links.js';
import { collectionExternalLinksNotations } from '../../models/collectionExternalLinksNotations.js';
import { externalLinkAttachments } from '../../models/externalLinkAttachments.js';
import { linkGroups } from '../../models/linkGroup.js';
import { syncCollaboratorsToNewExternalLink } from '../collaborationService.js';
import { autoUpdateExternalLinkEmbedding } from '../vectorService.js';

jest.mock('../../db/index.js', () => ({
  db: {
    transaction: jest.fn(),
  },
}));

jest.mock('../vectorService.js', () => ({
  autoUpdateCollectionEmbedding: jest.fn(),
  autoUpdateExternalLinkEmbedding: jest.fn().mockResolvedValue(undefined),
  autoUpdateLinkGroupEmbedding: jest.fn(),
  updateNotationEmbeddings: jest.fn(),
}));

jest.mock('../notationService.js', () => ({
  addTagsToNotationService: jest.fn(),
  getTagsForNotation: jest.fn(),
  updateNotationTagsService: jest.fn(),
}));

jest.mock('../notationAttachmentService.js', () => ({
  syncNotationAttachmentVisibility: jest.fn(),
}));

jest.mock('../collaborationService.js', () => ({
  syncCollaboratorsToNewExternalLink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../slackNotificationHelper.js', () => ({
  triggerNewExternalLinkNotification: jest.fn(),
  triggerNewNotationNotification: jest.fn(),
  triggerNotationUpdateNotification: jest.fn(),
}));

let updateExternalLinkInCollectionService;

describe('Collection Service bulk external link visibility updates', () => {
  beforeAll(async () => {
    ({ updateExternalLinkInCollectionService } = await import(
      '../collectionService.js'
    ));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates only the parent external link records for visibility-only changes', async () => {
    const updateCalls = [];
    const updateQueries = new Map();

    const tx = {
      select: jest.fn(() => ({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            visibility: 'private',
            publicJsonEnabled: true,
          },
        ]),
      })),
      update: jest.fn((table) => {
        const query = {
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([
            {
              id: 'external-link-1',
              visibility: 'unlisted',
            },
          ]),
        };

        updateCalls.push(table);
        updateQueries.set(table, query);

        return query;
      }),
    };

    db.transaction.mockImplementation(async (callback) => callback(tx));

    const result = await updateExternalLinkInCollectionService(
      'collection-1',
      'external-link-1',
      {
        visibility: 'unlisted',
      }
    );

    expect(result).toEqual({
      id: 'external-link-1',
      visibility: 'unlisted',
    });

    expect(tx.update).toHaveBeenCalledTimes(3);
    expect(updateCalls).toEqual([
      collections,
      externalLinks,
      collectionExternalLinks,
    ]);

    expect(tx.update).not.toHaveBeenCalledWith(
      collectionExternalLinksNotations
    );
    expect(tx.update).not.toHaveBeenCalledWith(externalLinkAttachments);
    expect(tx.update).not.toHaveBeenCalledWith(linkGroups);

    expect(
      updateQueries.get(externalLinks).set
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: 'unlisted',
      })
    );

    expect(syncCollaboratorsToNewExternalLink).toHaveBeenCalledWith(
      'collection-1',
      'external-link-1',
      tx
    );
    expect(autoUpdateExternalLinkEmbedding).toHaveBeenCalledWith(
      'external-link-1'
    );
  });
});
