import { db } from '../../db/index.js';
import {
  assertResourceMetadataSelectionsForTenant,
} from '../resourceMetadataValidationService.js';

jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn(),
  },
}));

describe('resourceMetadataValidationService', () => {
  const buildLimitedSelectChain = (result) => ({
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  });

  const buildSelectChain = (result) => ({
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(result),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows tenant-scoped metadata selections that match the resource tenant', async () => {
    db.select
      .mockReturnValueOnce(buildLimitedSelectChain([{ id: 2 }]))
      .mockReturnValueOnce(buildSelectChain([{ id: 11 }, { id: 12 }]));

    await expect(
      assertResourceMetadataSelectionsForTenant({
        tenantId: 'tenant-1',
        typeId: 2,
        tagIds: [11, 12],
        userId: 'user-1',
      })
    ).resolves.toBeUndefined();
  });

  it('rejects resource types outside the allowed tenant scope', async () => {
    db.select.mockReturnValueOnce(buildLimitedSelectChain([]));

    await expect(
      assertResourceMetadataSelectionsForTenant({
        tenantId: 'tenant-1',
        typeId: 999,
        tagIds: [],
        userId: 'user-1',
      })
    ).rejects.toThrow(
      'Resource type must belong to the selected tenant or be a global type'
    );
  });

  it('rejects tags that do not belong to the selected tenant', async () => {
    db.select
      .mockReturnValueOnce(buildLimitedSelectChain([{ id: 2 }]))
      .mockReturnValueOnce(buildSelectChain([{ id: 11 }]));

    await expect(
      assertResourceMetadataSelectionsForTenant({
        tenantId: 'tenant-1',
        typeId: 2,
        tagIds: [11, 12],
        userId: 'user-1',
      })
    ).rejects.toThrow(
      'Tags must belong to the selected tenant and be visible to the current user'
    );
  });
});
