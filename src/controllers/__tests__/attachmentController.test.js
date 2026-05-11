jest.mock('../../services/attachmentService.js', () => ({
  createAttachmentService: jest.fn(),
  deleteAttachmentService: jest.fn(),
  findAttachmentByUserById: jest.fn(),
  findAccessibleAttachmentByImageKey: jest.fn(),
  attachmentService: {
    searchAttachments: jest.fn(),
    addExistingAttachmentToExternalLink: jest.fn(),
    addExistingAttachmentToResource: jest.fn(),
  },
}));

jest.mock('../../services/collectionService.js', () => ({
  getExternalLinkByIdService: jest.fn(),
}));

jest.mock('../../services/resourceService.js', () => ({
  getResourceByIdService: jest.fn(),
}));

jest.mock('../../services/subscriptionService.js', () => ({
  subscriptionService: {
    canCreateAttachment: jest.fn(),
  },
}));

jest.mock('../../utils/authHelpers.js', () => ({
  canEditOrDeleteItem: jest.fn(),
}));

jest.mock('../../utils/s3Uploader.js', () => ({
  s3Uploader: jest.fn(),
  s3Delete: jest.fn(),
}));

jest.mock('heic-convert', () => jest.fn());

jest.mock('../../db/index.js', () => ({
  db: {},
  pool: {
    connect: jest.fn().mockResolvedValue({
      release: jest.fn(),
    }),
  },
}));

let attachmentController;
let attachmentService;
let findAttachmentByUserById;
let getResourceByIdService;
let canEditOrDeleteItem;

const createResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('attachmentController', () => {
  beforeAll(async () => {
    ({ attachmentController } = await import('../attachmentController.js'));
    ({ attachmentService, findAttachmentByUserById } = await import(
      '../../services/attachmentService.js'
    ));
    ({ getResourceByIdService } = await import(
      '../../services/resourceService.js'
    ));
    ({ canEditOrDeleteItem } = await import('../../utils/authHelpers.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('searchAttachments', () => {
    it('passes tenant ids to attachment search', async () => {
      attachmentService.searchAttachments.mockResolvedValue([{ id: 'att-1' }]);

      const req = {
        query: { q: 'test' },
        auth: { dbUserId: 'user-1' },
        tenantIds: ['tenant-1'],
      };
      const res = createResponse();

      await attachmentController.searchAttachments(req, res);

      expect(attachmentService.searchAttachments).toHaveBeenCalledWith({
        q: 'test',
        userId: 'user-1',
        tenantIds: ['tenant-1'],
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        attachments: [{ id: 'att-1' }],
      });
    });
  });

  describe('createAttachment', () => {
    it('rejects linking an existing attachment from another tenant to a resource', async () => {
      getResourceByIdService.mockResolvedValue({
        id: 'resource-1',
        tenantId: 'tenant-resource',
        addedByUserId: 'user-1',
      });
      canEditOrDeleteItem.mockReturnValue(true);
      findAttachmentByUserById.mockResolvedValue({
        id: 'attachment-1',
        tenant_id: 'tenant-other',
      });

      const req = {
        body: {
          resourceId: 'resource-1',
          existingAttachmentId: 'attachment-1',
        },
        auth: { dbUserId: 'user-1' },
        tenantIds: ['tenant-resource'],
      };
      const res = createResponse();

      await attachmentController.createAttachment(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error:
          'Attachment belongs to a different tenant than the selected parent item',
      });
      expect(
        attachmentService.addExistingAttachmentToResource
      ).not.toHaveBeenCalled();
    });
  });
});
