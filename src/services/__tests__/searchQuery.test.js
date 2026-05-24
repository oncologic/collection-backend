import { db } from '../../db/index.js';

// Mock drizzle-orm
jest.mock('drizzle-orm', () => {
  const original = jest.requireActual('drizzle-orm');
  return {
    ...original,
    sql: jest.fn((strings, ...values) => {
      let result = strings[0];
      for (let i = 0; i < values.length; i++) {
        result += `${values[i]}${strings[i + 1]}`;
      }
      return { raw: result };
    }),
  };
});

// Mock all the service dependencies to prevent issues
jest.mock('../../services/collectionService.js', () => ({
  getCollectionByIdsServiceWithResources: jest.fn().mockResolvedValue([]),
  getBasicCollectionsByIdsService: jest.fn().mockResolvedValue([]),
  getBasicExternalLinksByIdsService: jest.fn().mockResolvedValue([]),
  getExternalLinksByIdsService: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/resourceService.js', () => ({
  getBasicResourcesByIdsService: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/eventService.js', () => ({
  getBasicEventsByIdsService: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/attachmentService.js', () => ({
  getBasicAttachmentsByIdsService: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/notationService.js', () => ({
  getBasicNotationsByIdsService: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/organizationService.js', () => ({
  getOrganizationsByIdsService: jest.fn().mockResolvedValue([]),
}));

// Mock the database connection
jest.mock('../../db/index.js', () => ({
  db: {
    execute: jest.fn(),
  },
}));

describe('Search Query SQL Structure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('SQL query with externalLinkId field', () => {
    it('should include externalLinkId field in all UNION queries with proper type casting', async () => {
      // Import the function here to ensure mocks are applied
      const { searchAllContentService } = await import('../aiService.js');

      // Mock a simple search result with no additional processing
      const mockSearchResults = {
        rows: [
          {
            type: 'notation',
            id: '555f98fb-1138-408a-8d9b-9c5d10436c2b',
            title: 'Pet the Cat',
            description: 'Spend time petting the cat',
            createdAt: '2025-06-28 16:22:51.41',
            updatedAt: '2025-06-28 16:24:23.484',
            externalLinkId: 'external-link-123',
          },
        ],
      };

      // Set up the mock to return our test data only for the main search query
      db.execute.mockImplementation((query) => {
        if (query.raw && query.raw.includes('UNION ALL')) {
          return Promise.resolve(mockSearchResults);
        }
        // For any additional queries, return empty results
        return Promise.resolve({ rows: [] });
      });

      const result = await searchAllContentService('Pet', 'user123', [
        'tenant1',
      ]);

      // Verify the main search query was called
      expect(db.execute).toHaveBeenCalled();

      // Get the first call (main search query)
      const mainSearchCall = db.execute.mock.calls.find(
        (call) => call[0].raw && call[0].raw.includes('UNION ALL')
      );

      expect(mainSearchCall).toBeDefined();

      // Verify the query includes externalLinkId with proper type casting
      const queryRaw = mainSearchCall[0].raw;

      // Check that all SELECT statements include externalLinkId field
      expect(queryRaw).toContain('NULL::text as "externalLinkId"'); // For collections, events, resources, etc.
      expect(queryRaw).toContain('el.id::text as "externalLinkId"'); // For external_links (self-referencing)
      expect(queryRaw).toContain(
        'cel.external_link_id::text as "externalLinkId"'
      ); // For notations

      // Check that all id fields are cast to text for type consistency
      expect(queryRaw).toContain('id::text'); // All id fields should be cast to text

      // Verify the result includes the externalLinkId
      expect(result).toEqual([
        {
          type: 'notation',
          id: '555f98fb-1138-408a-8d9b-9c5d10436c2b',
          title: 'Pet the Cat',
          description: 'Spend time petting the cat',
          createdAt: '2025-06-28 16:22:51.41',
          updatedAt: '2025-06-28 16:24:23.484',
          externalLinkId: 'external-link-123',
        },
      ]);
    });

    it('should handle external_link results with self-referencing externalLinkId', async () => {
      const { searchAllContentService } = await import('../aiService.js');

      const mockSearchResults = {
        rows: [
          {
            type: 'external_link',
            id: 'external-link-456',
            title: 'Medical Article',
            description: 'Important medical research',
            createdAt: '2025-06-28 10:00:00',
            updatedAt: '2025-06-28 11:00:00',
            externalLinkId: 'external-link-456', // Self-referencing
          },
        ],
      };

      db.execute.mockImplementation((query) => {
        if (query.raw && query.raw.includes('UNION ALL')) {
          return Promise.resolve(mockSearchResults);
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await searchAllContentService('Medical', 'user123', [
        'tenant1',
      ]);

      expect(result[0].externalLinkId).toBe('external-link-456');
      expect(result[0].id).toBe(result[0].externalLinkId);
    });

    it('should handle collection results with null externalLinkId', async () => {
      const { searchAllContentService } = await import('../aiService.js');

      const mockSearchResults = {
        rows: [
          {
            type: 'collection',
            id: 'collection-789',
            title: 'My Collection',
            description: 'A test collection',
            createdAt: '2025-06-28 10:00:00',
            updatedAt: '2025-06-28 11:00:00',
            externalLinkId: null,
          },
        ],
      };

      db.execute.mockImplementation((query) => {
        if (query.raw && query.raw.includes('UNION ALL')) {
          return Promise.resolve(mockSearchResults);
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await searchAllContentService('Collection', 'user123', [
        'tenant1',
      ]);

      expect(result[0].externalLinkId).toBeNull();
    });

    it('should synthesize a resource result when a resource attachment matches search', async () => {
      const { searchAllContentService } = await import('../aiService.js');

      db.execute.mockImplementation((query) => {
        if (query.raw && query.raw.includes('UNION ALL')) {
          return Promise.resolve({
            rows: [
              {
                type: 'attachment',
                id: 'attachment-1',
                title: 'Attachment Match',
                description: 'Matched from attachment text',
                createdAt: '2025-06-28 10:00:00',
                updatedAt: '2025-06-28 11:00:00',
                externalLinkId: null,
                resourceId: 'resource-1',
                resourceTitle: 'Parent Resource',
                resourceDescription: 'Parent description',
                resourceCreatedAt: '2025-06-28 09:00:00',
                resourceUpdatedAt: '2025-06-28 09:30:00',
                matchedVia: 'attachment',
              },
            ],
          });
        }

        return Promise.resolve({ rows: [] });
      });

      const result = await searchAllContentService('Attachment', 'user123', [
        'tenant1',
      ]);

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'resource',
            id: 'resource-1',
            title: 'Parent Resource',
            matchedVia: 'attachment',
            matchedChildren: {
              attachments: [
                expect.objectContaining({
                  id: 'attachment-1',
                  title: 'Attachment Match',
                }),
              ],
              linkGroups: [],
            },
          }),
          expect.objectContaining({
            type: 'attachment',
            id: 'attachment-1',
          }),
        ])
      );
    });

    it('should synthesize a resource result when a resource link group matches search', async () => {
      const { searchAllContentService } = await import('../aiService.js');

      db.execute.mockImplementation((query) => {
        if (query.raw && query.raw.includes('UNION ALL')) {
          return Promise.resolve({
            rows: [
              {
                type: 'link_group',
                id: 'link-group-1',
                title: 'Resource Link Group',
                description: 'Matched from related links',
                createdAt: '2025-06-28 12:00:00',
                updatedAt: '2025-06-28 13:00:00',
                externalLinkId: null,
                resourceId: 'resource-2',
                resourceTitle: 'Resource With Links',
                resourceDescription: 'Resource description',
                resourceCreatedAt: '2025-06-28 08:00:00',
                resourceUpdatedAt: '2025-06-28 08:30:00',
                matchedVia: 'link_group',
              },
            ],
          });
        }

        return Promise.resolve({ rows: [] });
      });

      const result = await searchAllContentService('Links', 'user123', [
        'tenant1',
      ]);

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'resource',
            id: 'resource-2',
            title: 'Resource With Links',
            matchedVia: 'link_group',
            matchedChildren: {
              attachments: [],
              linkGroups: [
                expect.objectContaining({
                  id: 'link-group-1',
                  title: 'Resource Link Group',
                }),
              ],
            },
          }),
          expect.objectContaining({
            type: 'link_group',
            id: 'link-group-1',
          }),
        ])
      );
    });

    it('should pass correct search parameters to database', async () => {
      const { searchAllContentService } = await import('../aiService.js');

      db.execute.mockImplementation(() => Promise.resolve({ rows: [] }));

      await searchAllContentService('test query', 'user-456', [
        'tenant1',
        'tenant2',
      ]);

      // Verify database was called
      expect(db.execute).toHaveBeenCalled();

      // Get the main search query call
      const mainSearchCall = db.execute.mock.calls.find(
        (call) => call[0].raw && call[0].raw.includes('UNION ALL')
      );

      expect(mainSearchCall).toBeDefined();

      const queryRaw = mainSearchCall[0].raw;

      // Verify search term is included
      expect(queryRaw).toContain('%test query%');

      // Verify user ID is included
      expect(queryRaw).toContain('user-456');

      // Verify tenant IDs are included
      expect(queryRaw).toContain('tenant1');
      expect(queryRaw).toContain('tenant2');
    });
  });
});
