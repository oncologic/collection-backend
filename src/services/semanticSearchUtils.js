export const getSemanticResultSimilarity = (result) => {
  const rawSimilarity = result?.similarity ?? result?.similarity_score;
  const numericSimilarity = Number.parseFloat(rawSimilarity);

  return Number.isFinite(numericSimilarity) ? numericSimilarity : null;
};

export const normalizeSemanticSearchResult = (result, overrides = {}) => {
  const similarity = getSemanticResultSimilarity(result);

  return {
    ...result,
    ...overrides,
    ...(similarity === null ? {} : { similarity: similarity.toFixed(4) }),
  };
};

export const dedupeAndRankSemanticSearchResults = (
  results,
  { threshold = 0, limit = results.length } = {}
) => {
  const uniqueResults = results.reduce((acc, current) => {
    const existingIndex = acc.findIndex(
      (item) => item.id === current.id && item.type === current.type
    );

    if (existingIndex === -1) {
      acc.push(current);
      return acc;
    }

    const currentSimilarity = getSemanticResultSimilarity(current);
    const existingSimilarity = getSemanticResultSimilarity(acc[existingIndex]);

    if (
      (currentSimilarity ?? Number.NEGATIVE_INFINITY) >
      (existingSimilarity ?? Number.NEGATIVE_INFINITY)
    ) {
      acc[existingIndex] = current;
    }

    return acc;
  }, []);

  return uniqueResults
    .filter((result) => {
      const similarity = getSemanticResultSimilarity(result);
      return similarity !== null && similarity >= threshold;
    })
    .sort((a, b) => {
      const aSimilarity =
        getSemanticResultSimilarity(a) ?? Number.NEGATIVE_INFINITY;
      const bSimilarity =
        getSemanticResultSimilarity(b) ?? Number.NEGATIVE_INFINITY;

      return bSimilarity - aSimilarity;
    })
    .slice(0, limit);
};
