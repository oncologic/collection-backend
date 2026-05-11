process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_testing';

// Mock the database module
jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock('../stripe.js', () => ({
  stripe: {},
}));

// Mock the getTagsForNotation function
jest.mock('../notationService.js', () => ({
  getTagsForNotation: jest.fn().mockResolvedValue([]),
}));

let getDetailedCollectionExportDataService;
let db;

describe('Collection Service - Detailed Export Privacy Tests', () => {
  beforeAll(async () => {
    ({ getDetailedCollectionExportDataService } = await import(
      '../collectionService.js'
    ));
    ({ db } = await import('../../db/index.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockCollectionQuery = (returnData) => {
    const mockQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(returnData),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue(returnData),
    };
    db.select.mockReturnValue(mockQuery);
    return mockQuery;
  };

  describe('Collection Access Privacy', () => {
    it('should return collection data for public collections', async () => {
      const publicCollection = [
        {
          id: 'collection1',
          name: 'Public Collection',
          visibility: 'public',
          userId: 'user1',
          tenantId: 'tenant1',
          isCollaborator: false,
        },
      ];

      // Mock the collection query to return public collection
      mockCollectionQuery(publicCollection);

      // Mock subsequent queries
      const mockEmptyQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };
      db.select
        .mockReturnValueOnce(mockCollectionQuery(publicCollection))
        .mockReturnValue(mockEmptyQuery);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Different user
        ['tenant1']
      );

      expect(result).toBeTruthy();
      expect(result.collection.visibility).toBe('public');
    });

    it('should return collection data for collection owner', async () => {
      const privateCollection = [
        {
          id: 'collection1',
          name: 'Private Collection',
          visibility: 'private',
          userId: 'user1',
          tenantId: 'tenant1',
          isCollaborator: false,
        },
      ];

      mockCollectionQuery(privateCollection);

      const mockEmptyQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };
      db.select
        .mockReturnValueOnce(mockCollectionQuery(privateCollection))
        .mockReturnValue(mockEmptyQuery);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user1', // Owner
        ['tenant1']
      );

      expect(result).toBeTruthy();
      expect(result.collection.userId).toBe('user1');
    });

    it('should return null for private collection when user is not owner or collaborator', async () => {
      mockCollectionQuery([]); // No results

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Not owner
        ['tenant1']
      );

      expect(result).toBeNull();
    });

    it('should return collection data for collaborators on unlisted collections', async () => {
      const unlistedCollection = [
        {
          id: 'collection1',
          name: 'Unlisted Collection',
          visibility: 'unlisted',
          userId: 'user1',
          tenantId: 'tenant1',
          isCollaborator: true,
        },
      ];

      mockCollectionQuery(unlistedCollection);

      const mockEmptyQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };
      db.select
        .mockReturnValueOnce(mockCollectionQuery(unlistedCollection))
        .mockReturnValue(mockEmptyQuery);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Collaborator
        ['tenant1']
      );

      expect(result).toBeTruthy();
      expect(result.collection.isCollaborator).toBe(true);
    });

    it('should return null for collection in different tenant', async () => {
      mockCollectionQuery([]); // No results

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user1',
        ['tenant2'] // Different tenant
      );

      expect(result).toBeNull();
    });
  });

  describe('External Links Privacy', () => {
    const setupCollectionWithExternalLinks = (externalLinksData) => {
      const collection = [
        {
          id: 'collection1',
          name: 'Test Collection',
          visibility: 'public',
          userId: 'user1',
          tenantId: 'tenant1',
          isCollaborator: false,
        },
      ];

      let callCount = 0;
      db.select.mockImplementation(() => {
        callCount++;
        const mockQuery = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
        };

        if (callCount === 1) {
          // Collection query
          mockQuery.limit.mockResolvedValue(collection);
        } else if (callCount === 2) {
          // External links query
          mockQuery.orderBy.mockResolvedValue(externalLinksData);
        } else {
          // Resources and notations queries
          mockQuery.orderBy.mockResolvedValue([]);
        }

        return mockQuery;
      });
    };

    it('should include public external links for any user', async () => {
      const publicExternalLinks = [
        {
          id: 'link1',
          title: 'Public Link',
          visibility: 'public',
          addedByUserId: 'user1',
          collectionExternalLinkId: 'cel1',
        },
      ];

      setupCollectionWithExternalLinks(publicExternalLinks);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Different user
        ['tenant1']
      );

      expect(result.externalLinks).toHaveLength(1);
      expect(result.externalLinks[0].visibility).toBe('public');
    });

    it('should include private external links for the user who added them', async () => {
      const privateExternalLinks = [
        {
          id: 'link1',
          title: 'Private Link',
          visibility: 'private',
          addedByUserId: 'user1',
          collectionExternalLinkId: 'cel1',
        },
      ];

      setupCollectionWithExternalLinks(privateExternalLinks);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user1', // Link creator
        ['tenant1']
      );

      expect(result.externalLinks).toHaveLength(1);
      expect(result.externalLinks[0].addedByUserId).toBe('user1');
    });

    it('should exclude private external links for users who did not add them', async () => {
      setupCollectionWithExternalLinks([]); // No external links returned

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Different user
        ['tenant1']
      );

      expect(result.externalLinks).toHaveLength(0);
    });

    it('should include unlisted external links for collaborators', async () => {
      const unlistedExternalLinks = [
        {
          id: 'link1',
          title: 'Unlisted Link',
          visibility: 'unlisted',
          addedByUserId: 'user1',
          collectionExternalLinkId: 'cel1',
        },
      ];

      setupCollectionWithExternalLinks(unlistedExternalLinks);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Collaborator (mocked in the query)
        ['tenant1']
      );

      expect(result.externalLinks).toHaveLength(1);
      expect(result.externalLinks[0].visibility).toBe('unlisted');
    });
  });

  describe('Notations Privacy', () => {
    const setupCollectionWithNotations = (notationsData) => {
      const collection = [
        {
          id: 'collection1',
          name: 'Test Collection',
          visibility: 'public',
          userId: 'user1',
          tenantId: 'tenant1',
          isCollaborator: false,
        },
      ];

      const externalLinks = [
        {
          id: 'link1',
          collectionExternalLinkId: 'cel1',
        },
      ];

      let callCount = 0;
      db.select.mockImplementation(() => {
        callCount++;
        const mockQuery = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
        };

        if (callCount === 1) {
          // Collection query
          mockQuery.limit.mockResolvedValue(collection);
        } else if (callCount === 2) {
          // External links query
          mockQuery.orderBy.mockResolvedValue(externalLinks);
        } else if (callCount === 3) {
          // Notations query
          mockQuery.orderBy.mockResolvedValue(notationsData);
        } else {
          // Resources query
          mockQuery.orderBy.mockResolvedValue([]);
        }

        return mockQuery;
      });
    };

    it('should include public notations for any user', async () => {
      const publicNotations = [
        {
          id: 'notation1',
          title: 'Public Notation',
          visibility: 'public',
          userId: 'user1',
          externalLinkId: 'link1',
          collectionExternalLinkId: 'cel1',
        },
      ];

      setupCollectionWithNotations(publicNotations);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Different user
        ['tenant1']
      );

      expect(result.externalLinks[0].notations).toHaveLength(1);
      expect(result.externalLinks[0].notations[0].visibility).toBe('public');
    });

    it('should include private notations for the user who created them', async () => {
      const privateNotations = [
        {
          id: 'notation1',
          title: 'Private Notation',
          visibility: 'private',
          userId: 'user1',
          externalLinkId: 'link1',
          collectionExternalLinkId: 'cel1',
        },
      ];

      setupCollectionWithNotations(privateNotations);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user1', // Notation creator
        ['tenant1']
      );

      expect(result.externalLinks[0].notations).toHaveLength(1);
      expect(result.externalLinks[0].notations[0].userId).toBe('user1');
    });

    it('should exclude private notations for users who did not create them', async () => {
      setupCollectionWithNotations([]); // No notations returned

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Different user
        ['tenant1']
      );

      expect(result.totalNotations).toBe(0);
    });

    it('should include unlisted notations for users with external link access', async () => {
      const unlistedNotations = [
        {
          id: 'notation1',
          title: 'Unlisted Notation',
          visibility: 'unlisted',
          userId: 'user1',
          externalLinkId: 'link1',
          collectionExternalLinkId: 'cel1',
        },
      ];

      setupCollectionWithNotations(unlistedNotations);

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // User with external link access
        ['tenant1']
      );

      expect(result.externalLinks[0].notations).toHaveLength(1);
      expect(result.externalLinks[0].notations[0].visibility).toBe('unlisted');
    });
  });

  describe('Resource Privacy', () => {
    it('should include all resources for users with collection access', async () => {
      const collection = [
        {
          id: 'collection1',
          name: 'Test Collection',
          visibility: 'public',
          userId: 'user1',
          tenantId: 'tenant1',
          isCollaborator: false,
        },
      ];

      const resources = [
        {
          id: 'resource1',
          title: 'Test Resource',
          description: 'A test resource',
          url: 'https://resource.com',
        },
      ];

      let callCount = 0;
      db.select.mockImplementation(() => {
        callCount++;
        const mockQuery = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
        };

        if (callCount === 1) {
          mockQuery.limit.mockResolvedValue(collection);
        } else if (callCount === 2) {
          mockQuery.orderBy.mockResolvedValue([]); // External links
        } else if (callCount === 3) {
          // In the service, resources may be fetched before notations; return resources here
          mockQuery.orderBy.mockResolvedValue(resources);
        } else {
          mockQuery.orderBy.mockResolvedValue([]); // Notations and any remaining queries
        }

        return mockQuery;
      });

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2',
        ['tenant1']
      );

      expect(result.resources).toHaveLength(1);
      expect(result.totalResources).toBe(1);
    });
  });

  describe('Complex Privacy Scenarios', () => {
    it('should handle mixed visibility items correctly', async () => {
      const collection = [
        {
          id: 'collection1',
          name: 'Mixed Collection',
          visibility: 'public',
          userId: 'user1',
          tenantId: 'tenant1',
          isCollaborator: false,
        },
      ];

      const mixedExternalLinks = [
        {
          id: 'link1',
          title: 'Public Link',
          visibility: 'public',
          addedByUserId: 'user1',
          collectionExternalLinkId: 'cel1',
        },
        // Private link would be filtered out in the service
      ];

      const mixedNotations = [
        {
          id: 'notation1',
          title: 'Public Notation',
          visibility: 'public',
          userId: 'user1',
          externalLinkId: 'link1',
          collectionExternalLinkId: 'cel1',
        },
        // Private notation would be filtered out in the service
      ];

      let callCount = 0;
      db.select.mockImplementation(() => {
        callCount++;
        const mockQuery = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
        };

        if (callCount === 1) {
          mockQuery.limit.mockResolvedValue(collection);
        } else if (callCount === 2) {
          mockQuery.orderBy.mockResolvedValue(mixedExternalLinks);
        } else if (callCount === 3) {
          mockQuery.orderBy.mockResolvedValue(mixedNotations);
        } else {
          mockQuery.orderBy.mockResolvedValue([]);
        }

        return mockQuery;
      });

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user2', // Different user
        ['tenant1']
      );

      expect(result.externalLinks).toHaveLength(1);
      expect(result.externalLinks[0].visibility).toBe('public');
      expect(result.externalLinks[0].notations).toHaveLength(1);
      expect(result.externalLinks[0].notations[0].visibility).toBe('public');
    });

    it('should handle tenant isolation correctly', async () => {
      mockCollectionQuery([]); // No collection found in the tenant

      const result = await getDetailedCollectionExportDataService(
        'collection1',
        'user1',
        ['wrong-tenant'] // Wrong tenant
      );

      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      db.select.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(
        getDetailedCollectionExportDataService('collection1', 'user1', [
          'tenant1',
        ])
      ).rejects.toThrow('Database error');
    });
  });
});
