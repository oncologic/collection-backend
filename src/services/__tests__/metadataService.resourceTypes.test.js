import OpenAI from 'openai';
import { db } from '../../db/index.js';
import {
  createResourceTypeService,
  updateResourceTypeService,
} from '../metadataService.js';

jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }))
);

jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('metadataService resource types', () => {
  const buildLimitedSelectChain = (result) => ({
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a tenant-scoped resource type when the tenant is authorized', async () => {
    db.select.mockReturnValueOnce(buildLimitedSelectChain([]));
    db.insert.mockReturnValueOnce({
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([
        {
          id: 7,
          name: 'Patient Story',
          tenantId: 'tenant-1',
          visibility: 'tenant',
        },
      ]),
    });

    const result = await createResourceTypeService(
      {
        name: 'Patient Story',
        tenantId: 'tenant-1',
        visibility: 'tenant',
      },
      ['tenant-1'],
      'user-1'
    );

    expect(result).toEqual({
      id: 7,
      name: 'Patient Story',
      tenantId: 'tenant-1',
      visibility: 'tenant',
    });
  });

  it('rejects creating a resource type for an unauthorized tenant', async () => {
    await expect(
      createResourceTypeService(
        {
          name: 'Patient Story',
          tenantId: 'tenant-2',
        },
        ['tenant-1'],
        'user-1'
      )
    ).rejects.toThrow('Unauthorized to create a resource type for this tenant');
  });

  it('rejects duplicate resource type names in the same tenant scope', async () => {
    db.select.mockReturnValueOnce(
      buildLimitedSelectChain([{ id: 8, name: 'Patient Story' }])
    );

    await expect(
      createResourceTypeService(
        {
          name: 'Patient Story',
          tenantId: 'tenant-1',
        },
        ['tenant-1'],
        'user-1'
      )
    ).rejects.toThrow('A resource type with this name already exists');
  });

  it('updates an authorized tenant-scoped resource type', async () => {
    db.select
      .mockReturnValueOnce(
        buildLimitedSelectChain([
          { id: 9, tenantId: 'tenant-1', visibility: 'tenant' },
        ])
      )
      .mockReturnValueOnce(buildLimitedSelectChain([]));

    db.update.mockReturnValueOnce({
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([
        {
          id: 9,
          name: 'Expert Webinar',
          tenantId: 'tenant-1',
          visibility: 'public',
        },
      ]),
    });

    const result = await updateResourceTypeService(
      9,
      {
        name: 'Expert Webinar',
        visibility: 'public',
      },
      ['tenant-1']
    );

    expect(result).toEqual({
      id: 9,
      name: 'Expert Webinar',
      tenantId: 'tenant-1',
      visibility: 'public',
    });
  });
});
