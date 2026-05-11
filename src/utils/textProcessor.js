/**
 * Text processing utilities for clinical trial content
 * Handles ID mentions, formatting, and cleanup for frontend display
 */

/**
 * Configuration for different types of clinical trial IDs and how to format them
 */
const ID_PATTERNS = {
  // NCT (ClinicalTrials.gov) IDs
  nct: {
    pattern: /\b(NCT\d{8})\b/gi,
    format: (match) => `[Clinical Trial ${match}]`,
    link: (match) => `https://clinicaltrials.gov/study/${match}`,
  },

  // Phase trial patterns
  phase: {
    pattern: /\b(Phase\s+[IVX1-4]+)\b/gi,
    format: (match) => match, // Keep as-is, just normalize spacing
  },

  // Drug/compound IDs (common patterns)
  compound: {
    pattern: /\b([A-Z]{2,4}\d{3,6})\b/g,
    format: (match) => `compound ${match}`,
  },

  // Medical abbreviations that should be preserved
  medical: {
    pattern: /\b(RCC|chRCC|ccRCC|tRCC|HLRCC|RMC|mTOR|PD-L1|ORR)\b/g,
    format: (match) => match, // Keep medical abbreviations as-is
  },
};

/**
 * Clean and format clinical trial text for frontend display
 * @param {string} text - Raw clinical trial text
 * @param {Object} options - Processing options
 * @returns {string} - Cleaned and formatted text
 */
export const processClinicaTrialText = (text, options = {}) => {
  if (!text || typeof text !== 'string') return '';

  const {
    preserveIds = true,
    createLinks = false,
    normalizeSpacing = true,
    removeHtmlTags = true,
  } = options;

  let processedText = text;

  // First, remove HTML tags if requested
  if (removeHtmlTags) {
    processedText = processedText.replace(/<[^>]*>/g, '');
  }

  // Normalize spacing - collapse multiple spaces/newlines
  if (normalizeSpacing) {
    processedText = processedText
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  // Process different types of IDs
  if (preserveIds) {
    // Process NCT IDs with special formatting
    processedText = processedText.replace(ID_PATTERNS.nct.pattern, (match) => {
      if (createLinks) {
        return `[${match}](${ID_PATTERNS.nct.link(match)})`;
      }
      return ID_PATTERNS.nct.format(match);
    });

    // Preserve medical abbreviations (do this before compound processing)
    const medicalMatches = [];
    processedText = processedText.replace(
      ID_PATTERNS.medical.pattern,
      (match, offset) => {
        const placeholder = `__MEDICAL_${medicalMatches.length}__`;
        medicalMatches.push(match);
        return placeholder;
      }
    );

    // Process compound IDs (but be careful not to affect medical terms)
    processedText = processedText.replace(
      ID_PATTERNS.compound.pattern,
      (match) => {
        // Skip if it looks like a medical abbreviation we already preserved
        if (match.length <= 4 && /^[A-Z]+$/.test(match)) {
          return match;
        }
        return ID_PATTERNS.compound.format(match);
      }
    );

    // Restore medical abbreviations
    medicalMatches.forEach((match, index) => {
      processedText = processedText.replace(`__MEDICAL_${index}__`, match);
    });

    // Normalize Phase mentions
    processedText = processedText.replace(
      ID_PATTERNS.phase.pattern,
      (match) => {
        return match.replace(/\s+/g, ' '); // Normalize spacing in phase mentions
      }
    );
  } else {
    // If not preserving IDs, remove them more intelligently
    processedText = removeIdsIntelligently(processedText);
  }

  // Clean up any remaining formatting issues
  processedText = cleanupFormattingIssues(processedText);

  return processedText;
};

/**
 * Remove IDs intelligently to avoid jumbled text
 * @param {string} text - Text containing IDs
 * @returns {string} - Text with IDs removed cleanly
 */
const removeIdsIntelligently = (text) => {
  let cleanedText = text;

  // Remove NCT IDs but preserve sentence flow
  cleanedText = cleanedText.replace(/\s*\(NCT\d{8}\)\s*/g, ' ');

  // Remove standalone NCT mentions
  cleanedText = cleanedText.replace(/\bNCT\d{8}\b\s*/g, '');

  // Remove compound IDs that are clearly not medical terms
  cleanedText = cleanedText.replace(/\b[A-Z]{2,4}\d{3,6}\b/g, (match) => {
    // Keep short, likely medical abbreviations
    if (match.length <= 4 && /^[A-Z]+$/.test(match)) {
      return match;
    }
    return '';
  });

  return cleanedText;
};

/**
 * Clean up formatting issues that might arise from ID processing
 * @param {string} text - Text to clean up
 * @returns {string} - Cleaned text
 */
const cleanupFormattingIssues = (text) => {
  return (
    text
      // Fix multiple spaces
      .replace(/\s{2,}/g, ' ')
      // Fix space before punctuation
      .replace(/\s+([.,;:!?])/g, '$1')
      // Fix missing space after punctuation
      .replace(/([.,;:!?])([A-Za-z])/g, '$1 $2')
      // Fix parentheses spacing
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      // Remove leading/trailing spaces
      .trim()
  );
};

/**
 * Extract all clinical trial IDs from text
 * @param {string} text - Text to extract IDs from
 * @returns {Object} - Object containing arrays of different ID types
 */
export const extractClinicalTrialIds = (text) => {
  if (!text || typeof text !== 'string') {
    return { nct: [], compounds: [], phases: [] };
  }

  const ids = {
    nct: [],
    compounds: [],
    phases: [],
  };

  // Extract NCT IDs
  const nctMatches = text.match(ID_PATTERNS.nct.pattern);
  if (nctMatches) {
    ids.nct = [...new Set(nctMatches.map((id) => id.toUpperCase()))];
  }

  // Extract compound IDs (excluding likely medical abbreviations)
  const compoundMatches = text.match(ID_PATTERNS.compound.pattern);
  if (compoundMatches) {
    ids.compounds = [
      ...new Set(
        compoundMatches.filter((match) => {
          // Filter out likely medical abbreviations
          return !(match.length <= 4 && /^[A-Z]+$/.test(match));
        })
      ),
    ];
  }

  // Extract phase information
  const phaseMatches = text.match(ID_PATTERNS.phase.pattern);
  if (phaseMatches) {
    ids.phases = [
      ...new Set(phaseMatches.map((phase) => phase.replace(/\s+/g, ' '))),
    ];
  }

  return ids;
};

/**
 * Create a summary of clinical trial text with key information highlighted
 * @param {string} text - Original text
 * @param {Object} options - Summary options
 * @returns {Object} - Summary object with formatted text and extracted data
 */
export const summarizeClinicalTrialText = (text, options = {}) => {
  const { maxLength = 500, preserveKeyTerms = true } = options;

  const processedText = processClinicaTrialText(text, { preserveIds: true });
  const extractedIds = extractClinicalTrialIds(text);

  let summary = processedText;

  // If text is too long, intelligently truncate
  if (summary.length > maxLength) {
    // Find the best place to cut (end of sentence, then end of phrase)
    const sentences = summary.match(/[^.!?]*[.!?]/g) || [];
    let truncated = '';

    for (const sentence of sentences) {
      if ((truncated + sentence).length <= maxLength) {
        truncated += sentence;
      } else {
        break;
      }
    }

    if (truncated.length === 0) {
      // If no complete sentences fit, cut at word boundary
      const words = summary.split(' ');
      while (words.length > 0 && words.join(' ').length > maxLength) {
        words.pop();
      }
      truncated = words.join(' ') + '...';
    }

    summary = truncated;
  }

  return {
    summary,
    originalLength: text.length,
    processedLength: summary.length,
    extractedIds,
    keyTerms: preserveKeyTerms ? extractKeyMedicalTerms(text) : [],
  };
};

/**
 * Extract key medical terms from clinical trial text
 * @param {string} text - Text to analyze
 * @returns {string[]} - Array of key medical terms
 */
const extractKeyMedicalTerms = (text) => {
  const medicalTerms = [
    'renal cell carcinoma',
    'RCC',
    'chromophobe',
    'chRCC',
    'ccRCC',
    'tRCC',
    'HLRCC',
    'sarcomatoid',
    'metastatic',
    'advanced',
    'immunotherapy',
    'targeted therapy',
    'mTOR',
    'PD-L1',
    'nivolumab',
    'ipilimumab',
    'sunitinib',
    'sorafenib',
    'everolimus',
    'recruitment',
    'recruiting',
    'Phase I',
    'Phase II',
    'Phase III',
  ];

  const foundTerms = [];
  const lowerText = text.toLowerCase();

  medicalTerms.forEach((term) => {
    if (lowerText.includes(term.toLowerCase())) {
      foundTerms.push(term);
    }
  });

  return [...new Set(foundTerms)];
};

/**
 * Format clinical trial text for different display contexts
 * @param {string} text - Original text
 * @param {string} context - Display context ('card', 'detail', 'summary')
 * @returns {string} - Formatted text appropriate for the context
 */
export const formatForContext = (text, context = 'card') => {
  const baseOptions = {
    removeHtmlTags: true,
    normalizeSpacing: true,
  };

  switch (context) {
    case 'card':
      return processClinicaTrialText(text, {
        ...baseOptions,
        preserveIds: true,
        createLinks: false,
      });

    case 'detail':
      return processClinicaTrialText(text, {
        ...baseOptions,
        preserveIds: true,
        createLinks: true,
      });

    case 'summary':
      const summary = summarizeClinicalTrialText(text, { maxLength: 200 });
      return summary.summary;

    default:
      return processClinicaTrialText(text, baseOptions);
  }
};
