import { db } from '../../db/index.js';
import { createOrReusePlatformService } from '../socialMediaService.js';

jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  },
}));

describe('Social Media Service - Platform reuse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses an existing shared platform by normalized name', async () => {
    const existingPlatform = {
      id: 'platform-instagram',
      name: 'Instagram',
      icon: 'instagram',
      urlPattern: 'https://instagram.com/{handle}',
      tenantId: null,
    };
    const mockSelectQuery = {
      from: jest.fn().mockResolvedValue([existingPlatform]),
    };

    db.select.mockReturnValue(mockSelectQuery);

    const result = await createOrReusePlatformService({
      tenantId: 'tenant-1',
      name: '  instagram  ',
      icon: 'globe',
    });

    expect(result).toBe(existingPlatform);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
