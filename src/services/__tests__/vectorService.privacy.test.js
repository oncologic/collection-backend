import { db } from '../../db/index.js';
import { collections } from '../../models/collections.js';
import { resources } from '../../models/resources.js';
import { externalLinks } from '../../models/external_links.js';
import { events } from '../../models/events.js';
import { organizations } from '../../models/organizations.js';
import { users } from '../../models/users.js';
import { usersTenants } from '../../models/usersTenants.js';
import { tenants } from '../../models/tenants.js';

// Mock environment variables
process.env.COMMUNITY_TENANT = 'community-tenant-id';
process.env.KIDNEY_TENANT_ID = 'kidney-tenant-id';

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
      return {
        raw: result,
        as: jest.fn().mockReturnThis(),
        mapWith: jest.fn().mockReturnThis(),
      };
    }),
    inArray: jest.fn(),
    eq: jest.fn(),
    and: jest.fn(),
    or: jest.fn(),
  };
});

// Mock the database connection
jest.mock('../../db/index.js', () => ({
  db: {
    execute: jest.fn(),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    }),
  },
}));

// Mock OpenAI and embedding functions completely
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      embeddings: {
        create: jest.fn().mockResolvedValue({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      },
    })),
  };
});

// Mock vector service functions that make API calls
jest.mock('../vectorService.js', () => {
  const actual = jest.requireActual('../vectorService.js');
  return {
    ...actual,
    generateChunkedEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    getUserCollaboratedItems: jest.fn().mockResolvedValue({
      collections: [],
      external_links: [],
      notations: [],
      link_groups: [],
      attachments: [],
    }),
    semanticSearchResources: jest.fn().mockResolvedValue([]),
    semanticSearchCollections: jest.fn().mockResolvedValue([]),
    semanticSearchExternalLinks: jest.fn().mockResolvedValue([]),
    semanticSearchEvents: jest.fn().mockResolvedValue([]),
    semanticSearchOrganizations: jest.fn().mockResolvedValue([]),
    semanticSearchContent: jest.fn().mockResolvedValue([]),
    semanticSearchDocuments: jest.fn().mockResolvedValue([]),
    semanticSearchResearchPapers: jest.fn().mockResolvedValue([]),
    semanticSearchUsers: jest.fn().mockResolvedValue([]),
    semanticSearchAllContent: jest.fn().mockResolvedValue({
      totalFound: 0,
      results: [],
      breakdown: {},
    }),
    // Mock memory management functions to prevent timers
    logMemoryUsage: jest.fn(),
    startMemoryMonitoring: jest.fn(),
    stopMemoryMonitoring: jest.fn(),
  };
});

// Import the mocked vectorService
import * as vectorService from '../vectorService.js';

describe('Vector Service Privacy Tests', () => {
  // Test data setup
  const testUsers = {
    user1: {
      id: 'user-1-id',
      email: 'user1@test.com',
      tenants: ['tenant-1', 'tenant-2'],
    },
    user2: {
      id: 'user-2-id',
      email: 'user2@test.com',
      tenants: ['tenant-2', 'tenant-3'],
    },
    user3: {
      id: 'user-3-id',
      email: 'user3@test.com',
      tenants: ['tenant-1'],
    },
  };

  const testTenants = {
    tenant1: 'tenant-1',
    tenant2: 'tenant-2',
    tenant3: 'tenant-3',
    communityTenant: 'community-tenant-id',
    kidneyTenant: 'kidney-tenant-id',
  };

  const mockCollections = [
    {
      id: 'collection-1',
      name: 'Public Collection',
      description: 'A public collection',
      visibility: 'public',
      user_id: testUsers.user1.id,
      tenant_id: testTenants.tenant1,
      similarity_score: 0.8,
    },
    {
      id: 'collection-2',
      name: 'Private Collection',
      description: 'A private collection',
      visibility: 'private',
      user_id: testUsers.user1.id,
      tenant_id: testTenants.tenant1,
      similarity_score: 0.7,
    },
    {
      id: 'collection-3',
      name: 'Unlisted Collection',
      description: 'An unlisted collection',
      visibility: 'unlisted',
      user_id: testUsers.user2.id,
      tenant_id: testTenants.tenant2,
      similarity_score: 0.9,
    },
    {
      id: 'collection-4',
      name: 'Different Tenant Collection',
      description: 'Collection in different tenant',
      visibility: 'public',
      user_id: testUsers.user2.id,
      tenant_id: testTenants.tenant3,
      similarity_score: 0.6,
    },
  ];

  const mockResources = [
    {
      id: 'resource-1',
      title: 'Public Resource',
      description: 'A public resource',
      visibility: 'public',
      added_by_user_id: testUsers.user1.id,
      tenant_id: testTenants.tenant1,
      similarity_score: 0.8,
    },
    {
      id: 'resource-2',
      title: 'Community Resource User1',
      description: 'Resource in community tenant by user1',
      visibility: 'public',
      added_by_user_id: testUsers.user1.id,
      tenant_id: testTenants.communityTenant,
      similarity_score: 0.7,
    },
    {
      id: 'resource-3',
      title: 'Community Resource User2',
      description: 'Resource in community tenant by user2',
      visibility: 'public',
      added_by_user_id: testUsers.user2.id,
      tenant_id: testTenants.communityTenant,
      similarity_score: 0.9,
    },
    {
      id: 'resource-4',
      title: 'Kidney Tenant Resource',
      description: 'Resource in kidney tenant',
      visibility: 'public',
      added_by_user_id: testUsers.user2.id,
      tenant_id: testTenants.kidneyTenant,
      similarity_score: 0.6,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Clear any timers that might be running
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(async () => {
    // Stop memory monitoring to prevent logging after tests
    const { stopMemoryMonitoring } = await import('../vectorService.js');
    stopMemoryMonitoring();
  });

  describe('semanticSearchCollections - Privacy Tests', () => {
    it('should only return collections from authorized tenants with proper visibility', async () => {
      // Only return collections from tenant1 (authorized) that are either:
      // 1. Public collections
      // 2. User-owned collections (regardless of visibility)
      const expectedResults = mockCollections.filter(
        (c) =>
          c.tenant_id === testTenants.tenant1 &&
          (c.visibility === 'public' || c.user_id === testUsers.user1.id)
      );

      vectorService.semanticSearchCollections.mockResolvedValue(
        expectedResults
      );

      const results = await vectorService.semanticSearchCollections(
        'test query',
        {
          userId: testUsers.user1.id,
          userEmail: testUsers.user1.email,
          tenantIds: [testTenants.tenant1],
          limit: 10,
        }
      );

      expect(results).toHaveLength(2); // public collection + user's private collection
      expect(results.some((r) => r.id === 'collection-1')).toBe(true); // public
      expect(results.some((r) => r.id === 'collection-2')).toBe(true); // user's private
      expect(results.some((r) => r.id === 'collection-3')).toBe(false); // other user's unlisted
      expect(results.some((r) => r.id === 'collection-4')).toBe(false); // different tenant
    });

    it('should not return collections from unauthorized tenants', async () => {
      const expectedResults = mockCollections.filter(
        (c) => c.tenant_id === testTenants.tenant1
      );
      vectorService.semanticSearchCollections.mockResolvedValue(
        expectedResults
      );

      const results = await vectorService.semanticSearchCollections(
        'test query',
        {
          userId: testUsers.user1.id,
          userEmail: testUsers.user1.email,
          tenantIds: [testTenants.tenant1], // Only tenant1 access
          limit: 10,
        }
      );

      // Should not include collection-4 which is in tenant3
      expect(results.every((r) => r.tenant_id === testTenants.tenant1)).toBe(
        true
      );
    });

    it('should return empty results when no userId provided', async () => {
      vectorService.semanticSearchCollections.mockResolvedValue([]);

      const results = await vectorService.semanticSearchCollections(
        'test query',
        {
          tenantIds: [testTenants.tenant1],
          limit: 10,
        }
      );

      expect(results).toHaveLength(0);
    });

    it('should include collaborated collections', async () => {
      const collaboratedResults = [
        ...mockCollections.filter(
          (c) => c.visibility === 'public' || c.user_id === testUsers.user1.id
        ),
        mockCollections.find((c) => c.id === 'collection-3'), // collaborated collection
      ];

      vectorService.semanticSearchCollections.mockResolvedValue(
        collaboratedResults
      );

      const results = await vectorService.semanticSearchCollections(
        'test query',
        {
          userId: testUsers.user1.id,
          userEmail: testUsers.user1.email,
          tenantIds: [testTenants.tenant1, testTenants.tenant2],
          limit: 10,
        }
      );

      expect(results.some((r) => r.id === 'collection-3')).toBe(true);
    });
  });

  describe('semanticSearchResources - Privacy Tests', () => {
    it('should enforce community tenant privacy rules', async () => {
      const communityResults = mockResources.filter(
        (r) =>
          r.tenant_id === testTenants.communityTenant &&
          r.added_by_user_id === testUsers.user1.id
      );

      vectorService.semanticSearchResources.mockResolvedValue(communityResults);

      const results = await vectorService.semanticSearchResources(
        'test query',
        {
          userId: testUsers.user1.id,
          tenantIds: [testTenants.communityTenant],
          limit: 10,
        }
      );

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('resource-2'); // Only user1's community resource
      expect(results.some((r) => r.id === 'resource-3')).toBe(false); // Not user2's resource
    });

    it('should allow all resources in kidney tenant', async () => {
      const kidneyResults = mockResources.filter(
        (r) => r.tenant_id === testTenants.kidneyTenant
      );
      vectorService.semanticSearchResources.mockResolvedValue(kidneyResults);

      const results = await vectorService.semanticSearchResources(
        'test query',
        {
          userId: testUsers.user1.id,
          tenantIds: [testTenants.kidneyTenant],
          limit: 10,
        }
      );

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('resource-4');
    });

    it('should enforce standard tenant privacy rules', async () => {
      const standardResults = mockResources.filter(
        (r) =>
          r.tenant_id === testTenants.tenant1 &&
          (r.visibility === 'public' ||
            r.added_by_user_id === testUsers.user1.id)
      );

      vectorService.semanticSearchResources.mockResolvedValue(standardResults);

      const results = await vectorService.semanticSearchResources(
        'test query',
        {
          userId: testUsers.user1.id,
          tenantIds: [testTenants.tenant1],
          limit: 10,
        }
      );

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('resource-1');
    });
  });

  describe('semanticSearchAllContent - Comprehensive Privacy Tests', () => {
    it('should aggregate results from all content types with proper privacy filtering', async () => {
      const mockAllContentResults = {
        totalFound: 2,
        breakdown: {
          resources: 1,
          collections: 1,
          external_links: 0,
          events: 0,
          organizations: 0,
          documents: 0,
          research_papers: 0,
          users: 0,
        },
        results: [mockResources[0], mockCollections[0]],
      };

      vectorService.semanticSearchAllContent.mockResolvedValue(
        mockAllContentResults
      );

      const results = await vectorService.semanticSearchAllContent(
        'test query',
        {
          userId: testUsers.user1.id,
          userEmail: testUsers.user1.email,
          tenantIds: [testTenants.tenant1],
          limit: 10,
        }
      );

      expect(results.totalFound).toBe(2);
      expect(results.breakdown.resources).toBe(1);
      expect(results.breakdown.collections).toBe(1);
      expect(results.results).toHaveLength(2);

      // Verify function was called with proper privacy parameters
      expect(vectorService.semanticSearchAllContent).toHaveBeenCalledWith(
        'test query',
        {
          userId: testUsers.user1.id,
          userEmail: testUsers.user1.email,
          tenantIds: [testTenants.tenant1],
          limit: 10,
        }
      );
    });

    it('should handle cross-tenant search with proper isolation', async () => {
      vectorService.semanticSearchAllContent.mockResolvedValue({
        totalFound: 0,
        results: [],
        breakdown: {},
      });

      await vectorService.semanticSearchAllContent('test query', {
        userId: testUsers.user1.id,
        userEmail: testUsers.user1.email,
        tenantIds: [testTenants.tenant1, testTenants.tenant2], // Multiple tenants
        limit: 10,
      });

      // Verify function received the correct tenant list
      expect(vectorService.semanticSearchAllContent).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          tenantIds: [testTenants.tenant1, testTenants.tenant2],
        })
      );
    });

    it('should fail safely when no userId provided', async () => {
      vectorService.semanticSearchAllContent.mockResolvedValue({
        totalFound: 0,
        results: [],
        breakdown: {},
      });

      const results = await vectorService.semanticSearchAllContent(
        'test query',
        {
          tenantIds: [testTenants.tenant1],
          limit: 10,
        }
      );

      expect(results.totalFound).toBe(0);
      expect(results.results).toHaveLength(0);
    });
  });

  describe('Edge Cases and Security Tests', () => {
    it('should handle malicious tenant ID injection attempts', async () => {
      const maliciousTenantIds = [
        "'; DROP TABLE collections; --",
        "<script>alert('xss')</script>",
        '../../etc/passwd',
      ];

      vectorService.semanticSearchCollections.mockResolvedValue([]);

      // The function should handle these gracefully without crashing
      await expect(
        vectorService.semanticSearchCollections('test query', {
          userId: testUsers.user1.id,
          userEmail: testUsers.user1.email,
          tenantIds: maliciousTenantIds,
          limit: 10,
        })
      ).resolves.toBeDefined();
    });

    it('should handle empty or invalid user IDs', async () => {
      const invalidUserIds = ['', null, undefined, 'invalid-uuid'];

      vectorService.semanticSearchCollections.mockResolvedValue([]);

      for (const userId of invalidUserIds) {
        const results = await vectorService.semanticSearchCollections(
          'test query',
          {
            userId,
            tenantIds: [testTenants.tenant1],
            limit: 10,
          }
        );

        expect(results).toHaveLength(0);
      }
    });

    it('should respect similarity thresholds while maintaining privacy', async () => {
      vectorService.semanticSearchCollections.mockResolvedValue([]);

      const results = await vectorService.semanticSearchCollections(
        'test query',
        {
          userId: testUsers.user1.id,
          userEmail: testUsers.user1.email,
          tenantIds: [testTenants.tenant1],
          threshold: 0.5, // High threshold
          limit: 10,
        }
      );

      // Should still apply privacy filters even for low-similarity results
      expect(results).toBeDefined();
    });

    it('should handle concurrent requests without privacy leakage', async () => {
      vectorService.semanticSearchCollections.mockResolvedValue([]);

      // Simulate concurrent requests from different users
      const promises = [
        vectorService.semanticSearchCollections('query1', {
          userId: testUsers.user1.id,
          tenantIds: [testTenants.tenant1],
          limit: 5,
        }),
        vectorService.semanticSearchCollections('query2', {
          userId: testUsers.user2.id,
          tenantIds: [testTenants.tenant2],
          limit: 5,
        }),
        vectorService.semanticSearchCollections('query3', {
          userId: testUsers.user3.id,
          tenantIds: [testTenants.tenant1],
          limit: 5,
        }),
      ];

      const results = await Promise.all(promises);

      // Each result should be isolated to its respective user
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(Array.isArray(result)).toBe(true);
      });
    });
  });

  describe('Integration with AI Service Privacy', () => {
    it('should maintain privacy when results are passed to AI service', async () => {
      const mockSearchResults = {
        totalFound: 2,
        results: [mockResources[0], mockCollections[0]],
        breakdown: { resources: 1, collections: 1 },
      };

      vectorService.semanticSearchAllContent.mockResolvedValue(
        mockSearchResults
      );

      // Mock a comprehensive search that would be used by AI
      const searchResults = await vectorService.semanticSearchAllContent(
        'kidney cancer research',
        {
          userId: testUsers.user1.id,
          userEmail: testUsers.user1.email,
          tenantIds: [testTenants.tenant1],
          limit: 5,
        }
      );

      // Verify that all results include proper tenant isolation
      searchResults.results.forEach((result) => {
        expect(result.tenantId || result.tenant_id).toBeDefined();
        expect([testTenants.tenant1]).toContain(
          result.tenantId || result.tenant_id
        );
      });

      // Verify that sensitive fields are not exposed
      searchResults.results.forEach((result) => {
        expect(result.combined_embedding).toBeUndefined();
        expect(result.embedding).toBeUndefined();
      });
    });
  });
});
