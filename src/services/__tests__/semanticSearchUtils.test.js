import {
  dedupeAndRankSemanticSearchResults,
  getSemanticResultSimilarity,
  normalizeSemanticSearchResult,
} from '../semanticSearchUtils.js';

describe('semanticSearchUtils', () => {
  it('normalizes similarity_score into similarity for result shapes used by external links', () => {
    const normalized = normalizeSemanticSearchResult(
      {
        id: 'link-1',
        name: 'New external link',
        similarity_score: '0.82341',
      },
      { type: 'external_link' }
    );

    expect(normalized).toMatchObject({
      id: 'link-1',
      type: 'external_link',
      similarity: '0.8234',
    });
    expect(getSemanticResultSimilarity(normalized)).toBeCloseTo(0.8234, 4);
  });

  it('dedupes and ranks mixed semantic search results that use similarity_score or similarity', () => {
    const ranked = dedupeAndRankSemanticSearchResults(
      [
        {
          id: 'collection-1',
          type: 'collection',
          similarity_score: '0.7200',
        },
        {
          id: 'link-1',
          type: 'external_link',
          similarity_score: '0.9100',
        },
        {
          id: 'link-1',
          type: 'external_link',
          similarity: '0.8100',
        },
        {
          id: 'resource-1',
          type: 'resource',
          similarity: '0.1900',
        },
      ],
      {
        threshold: 0.2,
        limit: 10,
      }
    );

    expect(ranked).toHaveLength(2);
    expect(ranked.map((result) => result.id)).toEqual([
      'link-1',
      'collection-1',
    ]);
    expect(ranked[0].similarity_score).toBe('0.9100');
  });
});
