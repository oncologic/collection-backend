// Mock Stripe so controllers/services that import it do not require live keys.
jest.mock('../../services/stripe.js', () => ({
  stripe: {},
}));

// Mock the middleware used by the collection router.
jest.mock('../../middleware/authMiddleware.js', () => ({
  requireAdmin: () => (req, res, next) => next(),
  requireAdvocate: () => (req, res, next) => next(),
  requireUser: () => (req, res, next) => next(),
  requireUserAndTenants: () => (req, res, next) => next(),
  optionalAuthAndTenants: () => (req, res, next) => next(),
}));

// Mock the collection service consumed by the controller.
jest.mock('../../services/collectionService.js', () => ({
  getDetailedCollectionExportDataService: jest.fn(),
}));

let collectionRoutes;
let collectionController;
let getDetailedCollectionExportDataService;

const getRoute = (path, method) =>
  collectionRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method]
  )?.route;

const createMockResponse = () => {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  };
  return res;
};

describe('Collection Routes - Detailed Export Data', () => {
  beforeAll(async () => {
    ({ collectionController } = await import(
      '../../controllers/collectionController.js'
    ));
    ({ getDetailedCollectionExportDataService } = await import(
      '../../services/collectionService.js'
    ));
    ({ default: collectionRoutes } = await import('../collectionRoutes.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /collections/:id/detailed-export-data', () => {
    const mockCollectionData = {
      collection: {
        id: 'collection1',
        name: 'Test Collection',
        description: 'A test collection',
        visibility: 'public',
        userId: 'user1',
        tenantId: 'tenant1',
      },
      externalLinks: [
        {
          id: 'link1',
          title: 'Test Link',
          url: 'https://example.com',
          description: 'A test link',
          notations: [
            {
              id: 'notation1',
              title: 'Test Notation',
              notes: 'Test notes',
              visibility: 'public',
              userId: 'user1',
            },
          ],
        },
      ],
      resources: [
        {
          id: 'resource1',
          title: 'Test Resource',
          description: 'A test resource',
          url: 'https://resource.com',
        },
      ],
      totalExternalLinks: 1,
      totalResources: 1,
      totalNotations: 1,
    };

    it('should register the detailed export route behind auth middleware', () => {
      const route = getRoute('/:id/detailed-export-data', 'get');

      expect(route).toBeDefined();
      expect(route.stack).toHaveLength(2);
      expect(route.stack.at(-1).handle).toBe(
        collectionController.getDetailedCollectionExportData
      );
    });

    it('should return detailed collection data for an authorized user', async () => {
      getDetailedCollectionExportDataService.mockResolvedValue(
        mockCollectionData
      );

      const req = {
        params: { id: 'collection1' },
        auth: { dbUserId: 'user1' },
        tenantIds: ['tenant1'],
      };
      const res = createMockResponse();

      await collectionController.getDetailedCollectionExportData(req, res);

      expect(getDetailedCollectionExportDataService).toHaveBeenCalledWith(
        'collection1',
        'user1',
        ['tenant1']
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockCollectionData,
      });
    });

    it('should return 404 when service denies access', async () => {
      getDetailedCollectionExportDataService.mockResolvedValue(null);

      const req = {
        params: { id: 'collection1' },
        auth: { dbUserId: 'user2' },
        tenantIds: ['tenant1'],
      };
      const res = createMockResponse();

      await collectionController.getDetailedCollectionExportData(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Collection not found or access denied',
      });
    });

    it('should return 401 when user is not authenticated', async () => {
      const req = {
        params: { id: 'collection1' },
        auth: { dbUserId: null },
        tenantIds: ['tenant1'],
      };
      const res = createMockResponse();

      await collectionController.getDetailedCollectionExportData(req, res);

      expect(getDetailedCollectionExportDataService).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized: User authentication required',
      });
    });

    it('should forward multiple tenant ids to the service', async () => {
      getDetailedCollectionExportDataService.mockResolvedValue(
        mockCollectionData
      );

      const req = {
        params: { id: 'collection1' },
        auth: { dbUserId: 'user1' },
        tenantIds: ['tenant1', 'tenant2', 'tenant3'],
      };
      const res = createMockResponse();

      await collectionController.getDetailedCollectionExportData(req, res);

      expect(getDetailedCollectionExportDataService).toHaveBeenCalledWith(
        'collection1',
        'user1',
        ['tenant1', 'tenant2', 'tenant3']
      );
    });

    it('should handle service errors gracefully', async () => {
      getDetailedCollectionExportDataService.mockRejectedValue(
        new Error('Database connection failed')
      );

      const req = {
        params: { id: 'collection1' },
        auth: { dbUserId: 'user1' },
        tenantIds: ['tenant1'],
      };
      const res = createMockResponse();

      await collectionController.getDetailedCollectionExportData(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to fetch detailed collection export data',
        message: 'Database connection failed',
      });
    });

    it('should preserve filtered privacy-safe export payloads returned by the service', async () => {
      const filteredCollectionData = {
        ...mockCollectionData,
        externalLinks: [],
        totalExternalLinks: 0,
        totalNotations: 0,
      };

      getDetailedCollectionExportDataService.mockResolvedValue(
        filteredCollectionData
      );

      const req = {
        params: { id: 'collection1' },
        auth: { dbUserId: 'user2' },
        tenantIds: ['tenant1'],
      };
      const res = createMockResponse();

      await collectionController.getDetailedCollectionExportData(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: filteredCollectionData,
      });
    });
  });
});
