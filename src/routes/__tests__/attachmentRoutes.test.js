const mockRequireUserMiddleware = jest.fn((req, res, next) => next());
const mockRequireUserAndTenantsMiddleware = jest.fn((req, res, next) => next());
const mockUploadArrayMiddleware = jest.fn((req, res, next) => next());

jest.mock('../../middleware/authMiddleware.js', () => ({
  requireUser: () => mockRequireUserMiddleware,
  requireUserAndTenants: () => mockRequireUserAndTenantsMiddleware,
}));

jest.mock('../../middleware/upload.js', () => ({
  __esModule: true,
  default: {
    array: jest.fn(() => mockUploadArrayMiddleware),
  },
}));

jest.mock('../../controllers/attachmentController.js', () => ({
  attachmentController: {
    createAttachment: jest.fn(),
    searchAttachments: jest.fn(),
    updateAttachment: jest.fn(),
    deleteAttachment: jest.fn(),
    viewImage: jest.fn(),
    downloadImage: jest.fn(),
    refreshImageUrl: jest.fn(),
  },
}));

let attachmentRoutes;
let attachmentController;

const getRoute = (path, method) =>
  attachmentRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method]
  )?.route;

describe('attachmentRoutes', () => {
  beforeAll(async () => {
    ({ default: attachmentRoutes } = await import('../attachmentRoutes.js'));
    ({ attachmentController } = await import(
      '../../controllers/attachmentController.js'
    ));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers POST / behind tenant-aware auth before upload handling', () => {
    const route = getRoute('/', 'post');

    expect(route).toBeDefined();
    expect(route.stack).toHaveLength(3);
    expect(route.stack[0].handle).toBe(mockRequireUserAndTenantsMiddleware);
    expect(route.stack[1].handle).toBe(mockUploadArrayMiddleware);
    expect(route.stack[2].handle).toBe(attachmentController.createAttachment);
  });

  it('registers GET /search behind tenant-aware auth', () => {
    const route = getRoute('/search', 'get');

    expect(route).toBeDefined();
    expect(route.stack).toHaveLength(2);
    expect(route.stack[0].handle).toBe(mockRequireUserAndTenantsMiddleware);
    expect(route.stack[1].handle).toBe(attachmentController.searchAttachments);
  });
});
