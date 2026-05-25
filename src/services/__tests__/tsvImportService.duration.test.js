import {
  buildRelatedResourceImportPreview,
  normalizeImportDurationFields,
  normalizeImportRelatedResourceFields,
} from '../tsvImportService.js';

jest.mock('../../db/index.js', () => ({
  db: {},
}));

describe('tsvImportService duration normalization', () => {
  it('returns null duration fields when duration is omitted', () => {
    expect(normalizeImportDurationFields({ name: 'Resource' })).toEqual({
      durationValue: null,
      durationUnit: null,
    });
  });

  it('normalizes duration aliases from canonical import columns', () => {
    expect(
      normalizeImportDurationFields({
        durationValue: '1.5',
        durationUnit: 'week',
      })
    ).toEqual({
      durationValue: 1.5,
      durationUnit: 'weeks',
    });
  });

  it('normalizes duration aliases from LLM-friendly import columns', () => {
    expect(
      normalizeImportDurationFields({
        'Estimated Duration Value': '2',
        'Estimated Duration Unit': 'hrs',
      })
    ).toEqual({
      durationValue: 2,
      durationUnit: 'hours',
    });
  });

  it('normalizes year duration aliases', () => {
    expect(
      normalizeImportDurationFields({
        durationValue: '3',
        durationUnit: 'yrs',
      })
    ).toEqual({
      durationValue: 3,
      durationUnit: 'years',
    });
  });

  it('rejects missing units when a duration value is provided', () => {
    expect(() =>
      normalizeImportDurationFields({
        durationValue: '2',
      })
    ).toThrow('Invalid duration unit');
  });

  it('rejects non-positive duration values', () => {
    expect(() =>
      normalizeImportDurationFields({
        durationValue: '0',
        durationUnit: 'days',
      })
    ).toThrow('Invalid duration value');
  });
});

describe('tsvImportService related resource normalization', () => {
  it('normalizes related resource columns with defaults', () => {
    expect(
      normalizeImportRelatedResourceFields({
        resourceKey: 'step_one',
        relatedResourceKeys: 'step_two; step_three',
        relatedResourceNames: 'Project Plan, Launch Checklist',
        relatedResourceUrls: 'https://example.com/a; https://example.com/b',
      })
    ).toEqual({
      resourceKey: 'step_one',
      relatedResourceKeys: ['step_two', 'step_three'],
      relatedResourceNames: ['Project Plan', 'Launch Checklist'],
      relatedResourceUrls: ['https://example.com/a', 'https://example.com/b'],
      relatedLinkCategory: 'resource',
      relatedLinkDescription: null,
      relatedLinkVisibility: 'private',
    });
  });

  it('normalizes LLM-friendly related link metadata aliases', () => {
    expect(
      normalizeImportRelatedResourceFields({
        'Resource Key': 'phase_1',
        'Related Resource Keys': 'phase_2',
        'Related Link Category': 'Website',
        'Related Link Description': 'Use this after phase 1.',
        'Related Link Visibility': 'Unlisted',
      })
    ).toMatchObject({
      resourceKey: 'phase_1',
      relatedResourceKeys: ['phase_2'],
      relatedLinkCategory: 'website',
      relatedLinkDescription: 'Use this after phase 1.',
      relatedLinkVisibility: 'unlisted',
    });
  });
});

describe('tsvImportService related resource diagnostics', () => {
  it('resolves imported related resources by resourceKey', () => {
    const preview = buildRelatedResourceImportPreview([
      {
        name: 'Step one',
        url: 'https://example.com/one',
        resourceKey: 'step_one',
        relatedResourceKeys: ['step_two'],
      },
      {
        name: 'Step two',
        url: 'https://example.com/two',
        resourceKey: 'step_two',
      },
    ]);

    expect(preview.summary).toMatchObject({
      totalReferences: 1,
      resolvedImported: 1,
      unresolved: 0,
    });
    expect(preview.items[0]).toMatchObject({
      sourceName: 'Step one',
      reference: 'step_two',
      status: 'resolved_imported',
      targetName: 'Step two',
    });
  });

  it('reports unresolved and self-referencing related resources for strict mode', () => {
    const preview = buildRelatedResourceImportPreview([
      {
        name: 'Step one',
        url: 'https://example.com/one',
        resourceKey: 'step_one',
        relatedResourceKeys: ['step_one', 'missing_step'],
      },
    ]);

    expect(preview.summary).toMatchObject({
      totalReferences: 2,
      selfReferences: 1,
      unresolved: 1,
    });
    expect(preview.items.map((item) => item.status)).toEqual([
      'self_reference',
      'unresolved',
    ]);
  });
});
