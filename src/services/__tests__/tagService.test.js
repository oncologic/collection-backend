import { db } from '../../db/index.js';
import * as tagService from '../tagService.js';
import { tags } from '../../models/tags.js';
import { inArray } from 'drizzle-orm';

// Mock drizzle-orm
jest.mock('drizzle-orm', () => {
  const original = jest.requireActual('drizzle-orm');
  return {
    ...original,
    inArray: jest.fn(),
  };
});

// Mock the database connection
jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    }),
  },
}));

describe('Tag Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getAllTagsService', () => {
    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should return tags for given tenant IDs', async () => {
      const mockTags = [
        { id: 1, name: 'tag1', tenantId: 'tenant1' },
        { id: 2, name: 'tag2', tenantId: 'tenant1' },
      ];

      const mockQueryChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockTags),
      };

      db.select.mockReturnValue(mockQueryChain);

      const tenantIds = ['tenant1'];
      const result = await tagService.getAllTagsService(tenantIds);

      expect(db.select).toHaveBeenCalled();
      expect(mockQueryChain.from).toHaveBeenCalledWith(tags);
      expect(mockQueryChain.where).toHaveBeenCalled();
      expect(result).toEqual(mockTags);
    });

    it('should handle empty tenant IDs array', async () => {
      const mockQueryChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };

      db.select.mockReturnValue(mockQueryChain);

      const result = await tagService.getAllTagsService([]);

      expect(result).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      const errorQueryChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockRejectedValue(new Error('DB error')),
      };

      db.select.mockReturnValue(errorQueryChain);

      const tenantIds = ['tenant1'];
      await expect(tagService.getAllTagsService(tenantIds)).rejects.toThrow();
    });
  });
});
