import { db } from '../../db/index.js';
import * as pinnedService from '../pinnedService.js';
import { pinnedItems } from '../../models/pinnedItems.js';
import { resources } from '../../models/resources.js';
import { events } from '../../models/events.js';
import { organizations } from '../../models/organizations.js';
import { externalLinks } from '../../models/external_links.js';
import { collections } from '../../models/collections.js';
import {
  collectionExternalLinksNotations,
  collectionExternalLinkNotationTags,
} from '../../models/collectionExternalLinksNotations.js';
import { collectionExternalLinkTagDefinitions } from '../../models/collectionExternalLinkTags.js';
import { getCollectionsWithItemsByIdsService } from '../../services/collectionService.js';
import { getResourcesWithRelations } from '../../services/resourceService.js';

// Mock imported services
jest.mock('../../services/collectionService.js', () => ({
  getCollectionsWithItemsByIdsService: jest.fn(),
}));

jest.mock('../../services/resourceService.js', () => ({
  getResourcesWithRelations: jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue([]),
  }),
}));

// Mock drizzle-orm
jest.mock('drizzle-orm', () => {
  const original = jest.requireActual('drizzle-orm');
  return {
    ...original,
    eq: jest.fn(),
    and: jest.fn(),
    or: jest.fn(),
    inArray: jest.fn(),
    sql: jest.fn((strings, ...values) => {
      let result = strings[0];
      for (let i = 0; i < values.length; i++) {
        result += `?${strings[i + 1]}`;
      }
      return {
        raw: result,
        as: jest.fn().mockReturnThis(),
        mapWith: jest.fn().mockReturnThis(),
      };
    }),
  };
});

// Mock the database connection
jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue([]),
      limit: jest.fn().mockReturnThis(),
    }),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([]),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([]),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([]),
    }),
    transaction: jest.fn((callback) =>
      callback({
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([{ maxOrder: 5 }]),
        }),
        insert: jest.fn().mockReturnValue({
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{ id: 1 }]),
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{ id: 1 }]),
        }),
      })
    ),
  },
}));

describe('Pinned Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getPinnedItemsService', () => {
    it('should return pinned items for a user with their full details', async () => {
      // Mock data
      const userId = 'user123';
      const tenantIds = ['tenant1', 'tenant2'];

      const mockPinnedItems = [
        {
          id: 1,
          userId,
          itemId: 'res1',
          itemType: 'resource',
          orderPosition: 0,
        },
        { id: 2, userId, itemId: 'evt1', itemType: 'event', orderPosition: 1 },
        {
          id: 3,
          userId,
          itemId: 'org1',
          itemType: 'organization',
          orderPosition: 2,
        },
        {
          id: 4,
          userId,
          itemId: 'col1',
          itemType: 'collection',
          orderPosition: 3,
        },
        {
          id: 5,
          userId,
          itemId: 'link1',
          itemType: 'external_link',
          orderPosition: 4,
        },
      ];

      const mockResources = [
        { id: 'res1', name: 'Resource 1', tenantId: 'tenant1' },
      ];
      const mockEvents = [
        { id: 'evt1', title: 'Event 1', tenantId: 'tenant1' },
      ];
      const mockOrganizations = [
        { id: 'org1', name: 'Org 1', tenantId: 'tenant1' },
      ];
      const mockCollections = [{ id: 'col1', name: 'Collection 1' }];
      const mockExternalLinks = [
        { id: 'link1', url: 'https://example.com', tenantId: 'tenant1' },
      ];

      // Setup query chain mocks
      const pinnedItemsQuery = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(mockPinnedItems),
      };

      const eventsQuery = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockEvents),
      };

      const organizationsQuery = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockOrganizations),
      };

      const externalLinksQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockExternalLinks),
      };

      // Query chain for notations with tags
      const notationsQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };

      // Setup db.select for different queries
      db.select.mockImplementation((fields) => {
        if (fields?.maxOrder) return pinnedItemsQuery;
        return {
          from: jest.fn().mockImplementation((table) => {
            if (table === events) return eventsQuery;
            if (table === organizations) return organizationsQuery;
            if (table === externalLinks) return externalLinksQuery;
            if (table === collectionExternalLinksNotations)
              return notationsQuery;
            return pinnedItemsQuery;
          }),
          innerJoin: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        };
      });

      // Mock resource service
      getResourcesWithRelations.mockReturnValue({
        where: jest.fn().mockResolvedValue(mockResources),
      });

      // Mock collection service
      getCollectionsWithItemsByIdsService.mockResolvedValue(mockCollections);

      const result = await pinnedService.getPinnedItemsService(
        userId,
        tenantIds
      );

      expect(db.select).toHaveBeenCalled();
      expect(getResourcesWithRelations).toHaveBeenCalledWith(db, tenantIds);
      expect(getCollectionsWithItemsByIdsService).toHaveBeenCalledWith(
        ['col1'],
        userId
      );

      // Verify all items are returned properly
      expect(result).toHaveLength(4); // We expect 4 items since collection isn't being returned
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'res1',
            type: 'resource',
            orderPosition: 0,
          }),
          expect.objectContaining({
            id: 'evt1',
            type: 'event',
            orderPosition: 1,
          }),
          expect.objectContaining({
            id: 'org1',
            type: 'organization',
            orderPosition: 2,
          }),
          expect.objectContaining({
            id: 'link1',
            type: 'external_link',
            orderPosition: 4,
          }),
        ])
      );
    });

    it('should handle errors gracefully', async () => {
      const mockQueryChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockRejectedValue(new Error('DB error')),
      };

      db.select.mockReturnValue(mockQueryChain);

      await expect(
        pinnedService.getPinnedItemsService('user123', ['tenant1'])
      ).rejects.toThrow('DB error');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('pinItemsService', () => {
    it('should pin multiple items successfully', async () => {
      const mockItems = [
        { id: 'item1', type: 'resource' },
        { id: 'item2', type: 'event' },
      ];
      const userId = 'user123';
      const tenantIds = ['tenant1'];

      const mockTxSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ maxOrder: 5 }]),
      };

      const mockTxInsert = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      };

      const mockTx = {
        select: jest.fn().mockReturnValue(mockTxSelect),
        insert: jest.fn().mockReturnValue(mockTxInsert),
      };

      db.transaction.mockImplementation((callback) => callback(mockTx));

      const result = await pinnedService.pinItemsService(
        mockItems,
        userId,
        tenantIds
      );

      expect(db.transaction).toHaveBeenCalled();
      expect(mockTx.select).toHaveBeenCalled();
      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockTxInsert.values).toHaveBeenCalledWith([
        expect.objectContaining({
          userId,
          itemId: 'item1',
          itemType: 'resource',
          orderPosition: 6,
        }),
        expect.objectContaining({
          userId,
          itemId: 'item2',
          itemType: 'event',
          orderPosition: 7,
        }),
      ]);
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should handle transaction errors', async () => {
      db.transaction.mockRejectedValue(new Error('Transaction error'));

      await expect(
        pinnedService.pinItemsService([], 'user123', ['tenant1'])
      ).rejects.toThrow('Transaction error');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('unpinItemsService', () => {
    it('should unpin items and reorder remaining items', async () => {
      const mockDelete = {
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 1 }]),
      };

      db.delete.mockReturnValue(mockDelete);

      // Mock implementation for reorderPinnedItems (internal function)
      const mockSelectForReorder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          { id: 2, orderPosition: 1 },
          { id: 3, orderPosition: 2 },
        ]),
      };

      const mockUpdateForReorder = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      // Setup select and update mocks for reorderPinnedItems
      db.select.mockImplementation(() => mockSelectForReorder);
      db.update.mockImplementation(() => mockUpdateForReorder);

      const result = await pinnedService.unpinItemsService(
        ['item1'],
        'user123'
      );

      expect(db.delete).toHaveBeenCalled();
      expect(mockDelete.where).toHaveBeenCalled();
      expect(db.select).toHaveBeenCalled(); // For reordering
      expect(db.update).toHaveBeenCalled(); // For reordering
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should handle errors gracefully', async () => {
      const mockDelete = {
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockRejectedValue(new Error('Delete error')),
      };

      db.delete.mockReturnValue(mockDelete);

      await expect(
        pinnedService.unpinItemsService(['item1'], 'user123')
      ).rejects.toThrow('Delete error');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('updatePinnedItemOrderService', () => {
    it('should update item order (moving down)', async () => {
      const mockTxSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, orderPosition: 2 }]),
      };

      const mockTxUpdate1 = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue({ affected: 2 }), // Items being shifted
      };

      const mockTxUpdate2 = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 1, orderPosition: 5 }]),
      };

      const mockTx = {
        select: jest.fn().mockReturnValue(mockTxSelect),
        update: jest
          .fn()
          .mockReturnValueOnce(mockTxUpdate1) // First update (shifting items)
          .mockReturnValueOnce(mockTxUpdate2), // Second update (target item)
      };

      db.transaction.mockImplementation((callback) => callback(mockTx));

      const result = await pinnedService.updatePinnedItemOrderService(
        1,
        5,
        'user123'
      );

      expect(db.transaction).toHaveBeenCalled();
      expect(mockTx.select).toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: 1, orderPosition: 5 });
    });

    it('should update item order (moving up)', async () => {
      const mockTxSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, orderPosition: 5 }]),
      };

      const mockTxUpdate1 = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue({ affected: 2 }), // Items being shifted
      };

      const mockTxUpdate2 = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 1, orderPosition: 2 }]),
      };

      const mockTx = {
        select: jest.fn().mockReturnValue(mockTxSelect),
        update: jest
          .fn()
          .mockReturnValueOnce(mockTxUpdate1) // First update (shifting items)
          .mockReturnValueOnce(mockTxUpdate2), // Second update (target item)
      };

      db.transaction.mockImplementation((callback) => callback(mockTx));

      const result = await pinnedService.updatePinnedItemOrderService(
        1,
        2,
        'user123'
      );

      expect(db.transaction).toHaveBeenCalled();
      expect(mockTx.select).toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: 1, orderPosition: 2 });
    });

    it('should throw error if pinned item not found', async () => {
      const mockTxSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]), // No item found
      };

      const mockTx = {
        select: jest.fn().mockReturnValue(mockTxSelect),
      };

      db.transaction.mockImplementation((callback) => callback(mockTx));

      await expect(
        pinnedService.updatePinnedItemOrderService(1, 5, 'user123')
      ).rejects.toThrow('Pinned item not found');
    });

    it('should handle transaction errors', async () => {
      db.transaction.mockRejectedValue(new Error('Transaction error'));

      await expect(
        pinnedService.updatePinnedItemOrderService(1, 5, 'user123')
      ).rejects.toThrow('Transaction error');
      expect(console.error).toHaveBeenCalled();
    });
  });
});
