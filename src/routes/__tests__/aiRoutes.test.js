// Mock the middleware
jest.mock('../../middleware/authMiddleware.js', () => ({
  requireAdmin: () => (req, res, next) => next(),
  requireUser: () => (req, res, next) => next(),
  requireUserAndTenants: () => (req, res, next) => next(),
}));

jest.mock('../../db/index.js', () => ({
  db: {},
  pool: {
    connect: jest.fn().mockResolvedValue({
      release: jest.fn(),
    }),
  },
}));

// Mock the AI controller with all required methods
jest.mock('../../controllers/aiController.js', () => ({
  aiController: {
    generateDescription: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    generateResourceChat: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    searchContent: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    generateSummaries: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    processItems: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    processImage: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    generateStructuredNotations: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    previewStructuredNotations: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    confirmStructuredNotations: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    previewBulkNotationUpdates: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    confirmBulkNotationUpdates: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    // Add any endpoints referenced by aiRoutes so router initialization succeeds
    previewStructuredEvents: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    confirmStructuredEvents: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    previewStructuredResources: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    confirmStructuredResources: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    previewStructuredSocialMedia: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    confirmStructuredSocialMedia: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    previewStructuredExternalLinks: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
    confirmStructuredExternalLinks: jest.fn((req, res) =>
      res.status(200).json({ message: 'Success' })
    ),
  },
}));

jest.mock('../../controllers/opportunityAIController.js', () => ({
  opportunityAIController: {
    previewStructuredOpportunities: jest.fn(),
    confirmStructuredOpportunities: jest.fn(),
  },
}));

let aiRoutes;
let aiController;

const getRoute = (path, method) =>
  aiRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method]
  )?.route;

describe('AI Routes', () => {
  beforeAll(async () => {
    ({ aiController } = await import('../../controllers/aiController.js'));
    ({ default: aiRoutes } = await import('../aiRoutes.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /ai/generate-description', () => {
    it('should register generateDescription as the terminal handler', () => {
      const route = getRoute('/generate-description', 'post');

      expect(route).toBeDefined();
      expect(route.stack.at(-1).handle).toBe(aiController.generateDescription);
    });
  });

  describe('POST /ai/generate-resource-chat', () => {
    it('should register generateResourceChat behind auth and rate limiting middleware', () => {
      const route = getRoute('/generate-resource-chat', 'post');

      expect(route).toBeDefined();
      expect(route.stack).toHaveLength(3);
      expect(route.stack.at(-1).handle).toBe(aiController.generateResourceChat);
    });
  });

  describe('POST /ai/search', () => {
    it('should register searchContent behind auth and rate limiting middleware', () => {
      const route = getRoute('/search', 'post');

      expect(route).toBeDefined();
      expect(route.stack).toHaveLength(3);
      expect(route.stack.at(-1).handle).toBe(aiController.searchContent);
    });
  });

  describe('POST /ai/generate-summaries', () => {
    it('should register generateSummaries behind auth and rate limiting middleware', () => {
      const route = getRoute('/generate-summaries', 'post');

      expect(route).toBeDefined();
      expect(route.stack).toHaveLength(3);
      expect(route.stack.at(-1).handle).toBe(aiController.generateSummaries);
    });
  });
});
