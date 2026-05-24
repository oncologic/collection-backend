const mockRequireUserMiddleware = jest.fn((req, res, next) => next());
const mockRequireUserAndTenantsMiddleware = jest.fn((req, res, next) => next());
const mockOptionalAuthAndTenantsMiddleware = jest.fn((req, res, next) =>
  next()
);
const mockPublicApiRateLimit = jest.fn((req, res, next) => next());

jest.mock('../../middleware/authMiddleware.js', () => ({
  requireUser: () => mockRequireUserMiddleware,
  requireUserAndTenants: () => mockRequireUserAndTenantsMiddleware,
  optionalAuthAndTenants: () => mockOptionalAuthAndTenantsMiddleware,
}));

jest.mock('../../middleware/rateLimitMiddleware.js', () => ({
  publicApiRateLimit: mockPublicApiRateLimit,
}));

jest.mock('../../controllers/metadataController.js', () => ({
  metadataController: {
    getAllResourceTypes: jest.fn(),
    createResourceType: jest.fn(),
    updateResourceType: jest.fn(),
    deleteResourceType: jest.fn(),
    getAllEventTypes: jest.fn(),
    createEventType: jest.fn(),
    updateEventType: jest.fn(),
    deleteEventType: jest.fn(),
    getAllSensitivityLevels: jest.fn(),
    getAllExpertiseLevels: jest.fn(),
    getAllLinkGroups: jest.fn(),
    getLinkGroupById: jest.fn(),
    createLinkGroup: jest.fn(),
    updateLinkGroup: jest.fn(),
    deleteLinkGroup: jest.fn(),
    patchLinkGroup: jest.fn(),
  },
}));

let metadataRoutes;
let metadataController;

const getRoute = (path, method) =>
  metadataRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method]
  )?.route;

describe('metadataRoutes', () => {
  beforeAll(async () => {
    ({ default: metadataRoutes } = await import('../metadataRoutes.js'));
    ({ metadataController } = await import(
      '../../controllers/metadataController.js'
    ));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers link group create behind tenant-aware auth', () => {
    const route = getRoute('/link-groups', 'post');

    expect(route).toBeDefined();
    expect(route.stack).toHaveLength(2);
    expect(route.stack[0].handle).toBe(mockRequireUserAndTenantsMiddleware);
    expect(route.stack[1].handle).toBe(metadataController.createLinkGroup);
  });

  it('registers link group reads behind tenant-aware auth', () => {
    const listRoute = getRoute('/link-groups', 'get');
    const detailRoute = getRoute('/link-groups/:id', 'get');

    expect(listRoute).toBeDefined();
    expect(listRoute.stack[0].handle).toBe(mockRequireUserAndTenantsMiddleware);
    expect(listRoute.stack[1].handle).toBe(metadataController.getAllLinkGroups);

    expect(detailRoute).toBeDefined();
    expect(detailRoute.stack[0].handle).toBe(
      mockRequireUserAndTenantsMiddleware
    );
    expect(detailRoute.stack[1].handle).toBe(metadataController.getLinkGroupById);
  });
});
