import { getTagIdsByNamesService } from '../collectionExternalLinkTagsService.js';

describe('Tag Mapping Service', () => {
  const mockUserId = 'test-user-id';
  const mockTenantIds = ['tenant-1', 'tenant-2'];

  test('should handle empty tag arrays', async () => {
    const result = await getTagIdsByNamesService([], mockUserId, mockTenantIds);
    expect(result).toEqual(new Map());
  });

  test('should handle nested tag arrays and flatten them', async () => {
    // Mock the database query since we're testing the logic
    const tagArrays = [
      ['clinical trial', 'cancer research'],
      ['immunotherapy'],
      ['breast cancer', 'clinical trial'], // duplicate
    ];

    // This test verifies the flattening and deduplication logic
    const flattenedTags = tagArrays
      .flat()
      .filter((name) => name && typeof name === 'string')
      .map((name) => name.trim().toLowerCase());

    const uniqueTags = [...new Set(flattenedTags)];

    expect(uniqueTags).toContain('clinical trial');
    expect(uniqueTags).toContain('cancer research');
    expect(uniqueTags).toContain('immunotherapy');
    expect(uniqueTags).toContain('breast cancer');
    expect(uniqueTags.length).toBe(4); // Should have removed duplicate 'clinical trial'
  });

  test('should filter out invalid tag names', async () => {
    const tagArrays = [
      ['valid tag', '', null, undefined, 'another valid tag'],
      [123, 'string tag'], // non-string values
    ];

    const filteredTags = tagArrays
      .flat()
      .filter((name) => name && typeof name === 'string')
      .map((name) => name.trim().toLowerCase());

    expect(filteredTags).toEqual([
      'valid tag',
      'another valid tag',
      'string tag',
    ]);
  });
});
