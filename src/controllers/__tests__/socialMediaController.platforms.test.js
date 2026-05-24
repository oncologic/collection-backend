jest.mock('../../services/socialMediaService.js', () => ({
  getAllPlatformsService: jest.fn(),
  getPlatformCatalogService: jest.fn(),
  getPlatformByIdService: jest.fn(),
  createOrReusePlatformService: jest.fn(),
  updatePlatformService: jest.fn(),
  deletePlatformService: jest.fn(),
  getAllAccountsService: jest.fn(),
  getAccountsByTypeService: jest.fn(),
  getAccountByIdService: jest.fn(),
  createAccountService: jest.fn(),
  updateAccountService: jest.fn(),
  deleteAccountService: jest.fn(),
  formatSocialMediaAccountsResponse: jest.fn(),
  getAssociationsByEntityService: jest.fn(),
  getAssociationsBySocialMediaAccountService: jest.fn(),
  createAssociationService: jest.fn(),
  deleteAssociationService: jest.fn(),
}));

jest.mock('../../services/collectionService.js', () => ({
  createCollectionService: jest.fn(),
  updateCollectionService: jest.fn(),
}));

jest.mock('../../services/pinnedService.js', () => ({
  pinItemsService: jest.fn(),
}));

let socialMediaController;
let createOrReusePlatformService;

const createResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('socialMediaController platform creation', () => {
  beforeAll(async () => {
    ({ socialMediaController } = await import('../socialMediaController.js'));
    ({ createOrReusePlatformService } =
      await import('../../services/socialMediaService.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows a signed-in tenant user to create or reuse a platform for account setup', async () => {
    const platform = {
      id: 'platform-instagram',
      name: 'Instagram',
      icon: 'instagram',
      tenantId: null,
    };

    createOrReusePlatformService.mockResolvedValue(platform);

    const req = {
      body: {
        name: 'Instagram',
        icon: 'instagram',
      },
      tenantIds: ['tenant-1'],
      auth: {
        dbUserId: 'user-1',
        isAdmin: false,
        isSuperuser: false,
        tenantRoles: {
          'tenant-1': { roles: ['member'] },
        },
      },
    };
    const res = createResponse();

    await socialMediaController.createPlatform(req, res);

    expect(createOrReusePlatformService).toHaveBeenCalledWith({
      existingPlatformId: undefined,
      name: 'Instagram',
      icon: 'instagram',
      urlPattern: undefined,
      tenantId: 'tenant-1',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(platform);
  });
});
