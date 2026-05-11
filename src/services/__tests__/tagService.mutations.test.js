import { db } from '../../db/index.js';
import {
  createTagService,
  updateTagService,
} from '../tagService.js';

jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));

describe('tagService mutations', () => {
  const buildLimitedSelectChain = (result) => ({
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a tenant-scoped tag for an authorized tenant', async () => {
    db.select.mockReturnValueOnce(buildLimitedSelectChain([]));
    db.insert.mockReturnValueOnce({
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([
        {
          id: 4,
          name: 'Advocacy',
          tenantId: 'tenant-1',
          visibility: 'tenant',
        },
      ]),
    });

    const result = await createTagService(
      {
        name: 'Advocacy',
        tenantId: 'tenant-1',
        color: '#3B82F6',
      },
      ['tenant-1'],
      'user-1'
    );

    expect(result).toEqual({
      id: 4,
      name: 'Advocacy',
      tenantId: 'tenant-1',
      visibility: 'tenant',
    });
  });

  it('rejects duplicate tenant tag names', async () => {
    db.select.mockReturnValueOnce(
      buildLimitedSelectChain([{ id: 5, name: 'Advocacy' }])
    );

    await expect(
      createTagService(
        {
          name: 'Advocacy',
          tenantId: 'tenant-1',
          color: '#3B82F6',
        },
        ['tenant-1'],
        'user-1'
      )
    ).rejects.toThrow('A tag with this name already exists for this tenant');
  });

  it('updates an authorized tag when no duplicate exists', async () => {
    db.select
      .mockReturnValueOnce(
        buildLimitedSelectChain([
          {
            id: 6,
            tenantId: 'tenant-1',
            visibility: 'tenant',
          },
        ])
      )
      .mockReturnValueOnce(buildLimitedSelectChain([]));

    db.update.mockReturnValueOnce({
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([
        {
          id: 6,
          name: 'Research',
          tenantId: 'tenant-1',
          visibility: 'public',
        },
      ]),
    });

    const result = await updateTagService(
      6,
      {
        name: 'Research',
        visibility: 'public',
      },
      ['tenant-1']
    );

    expect(result).toEqual({
      id: 6,
      name: 'Research',
      tenantId: 'tenant-1',
      visibility: 'public',
    });
  });
});
