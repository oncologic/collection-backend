import { db } from '../../db/index.js';
import * as eventService from '../eventService.js';
import { events } from '../../models/events.js';
import { eventTypes } from '../../models/metadata.js';
import { expertiseLevels } from '../../models/metadata.js';

// --- Mock drizzle-orm ---
jest.mock('drizzle-orm', () => {
  const original = jest.requireActual('drizzle-orm');
  return {
    ...original,
    sql: jest.fn((strings, ...values) => {
      let result = strings[0];
      for (let i = 0; i < values.length; i++) {
        result += `?${strings[i + 1]}`;
      }
      return { raw: result, as: jest.fn().mockReturnThis() };
    }),
    inArray: jest.fn(),
    eq: jest.fn(),
    and: jest.fn(),
  };
});

// --- Mock the models ---
jest.mock('../../models/events.js', () => ({
  events: {
    id: 'id',
    title: 'title',
    description: 'description',
    tenantId: 'tenantId',
    // Add other fields as needed
  },
  eventTags: {
    eventId: 'eventId',
    tagId: 'tagId',
  },
}));

jest.mock('../../models/metadata.js', () => ({
  eventTypes: {
    id: 'id',
    name: 'name',
  },
  expertiseLevels: {
    id: 'id',
    name: 'name',
  },
}));

jest.mock('../../models/tags.js', () => ({
  tags: {
    id: 'id',
    name: 'name',
  },
}));

// --- Mock the database connection ---
jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    }),
    transaction: jest.fn((callback) =>
      callback({
        delete: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      })
    ),
  },
}));

describe('Event Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('deleteEventService', () => {
    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => {});

      // Mock the query chain for both queries
      const mockQueryChain = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };

      // Setup the db.select mock to handle both queries
      db.select.mockImplementation(() => mockQueryChain);
    });

    it('deleteEventService works', async () => {
      const result = await eventService.deleteEventService(1);
      expect(result).toEqual({ id: 1 });
    });
  });
});
