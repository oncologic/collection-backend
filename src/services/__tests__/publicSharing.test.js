import { db } from '../../db/index.js';

jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../vectorService.js', () => ({
  autoUpdateCollectionEmbedding: jest.fn(),
  autoUpdateExternalLinkEmbedding: jest.fn(),
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
  syncCollaboratorsToNewExternalLink: jest.fn(),
}));

jest.mock('../slackNotificationHelper.js', () => ({
  triggerNewExternalLinkNotification: jest.fn(),
  triggerNewNotationNotification: jest.fn(),
  triggerNotationUpdateNotification: jest.fn(),
}));

let toggleCollectionPublicJsonSharingService;
let toggleExternalLinkPublicJsonSharingService;

const mockSelectQuery = (rows) => {
  const query = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(rows),
  };

  db.select.mockReturnValue(query);

  return query;
};

const mockUpdateQuery = (rows) => {
  const query = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(rows),
  };

  db.update.mockReturnValue(query);

  return query;
};

describe('Public sharing guards', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    ({
      toggleCollectionPublicJsonSharingService,
      toggleExternalLinkPublicJsonSharingService,
    } = await import('../collectionService.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks enabling public sharing for private collections', async () => {
    mockSelectQuery([
      {
        id: 'collection-1',
        type: 'external',
        visibility: 'private',
      },
    ]);

    await expect(
      toggleCollectionPublicJsonSharingService(
        'collection-1',
        true,
        'user-1',
        ['tenant-1'],
        false
      )
    ).rejects.toThrow(
      'Only public or unlisted resource and external collections can enable public sharing'
    );

    expect(db.update).not.toHaveBeenCalled();
  });

  it('allows enabling public sharing for unlisted external collections', async () => {
    mockSelectQuery([
      {
        id: 'collection-1',
        type: 'external',
        visibility: 'unlisted',
      },
    ]);
    mockUpdateQuery([
      {
        id: 'collection-1',
        name: 'Shared collection',
        publicJsonEnabled: true,
      },
    ]);

    const result = await toggleCollectionPublicJsonSharingService(
      'collection-1',
      true,
      'user-1',
      ['tenant-1'],
      false
    );

    expect(db.update).toHaveBeenCalled();
    expect(result.publicJsonEnabled).toBe(true);
  });

  it('blocks enabling public sharing for private external links', async () => {
    mockSelectQuery([
      {
        id: 'external-link-1',
        visibility: 'private',
      },
    ]);

    await expect(
      toggleExternalLinkPublicJsonSharingService(
        'external-link-1',
        true,
        'user-1',
        ['tenant-1'],
        false
      )
    ).rejects.toThrow(
      'Only public or unlisted external links can enable public sharing'
    );

    expect(db.update).not.toHaveBeenCalled();
  });

  it('allows enabling public sharing for unlisted external links', async () => {
    mockSelectQuery([
      {
        id: 'external-link-1',
        visibility: 'unlisted',
      },
    ]);
    mockUpdateQuery([
      {
        id: 'external-link-1',
        name: 'Shared external link',
        publicJsonEnabled: true,
      },
    ]);

    const result = await toggleExternalLinkPublicJsonSharingService(
      'external-link-1',
      true,
      'user-1',
      ['tenant-1'],
      false
    );

    expect(db.update).toHaveBeenCalled();
    expect(result.publicJsonEnabled).toBe(true);
  });
});
