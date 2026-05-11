import React from 'react';
import PropTypes from 'prop-types';

/**
 * Clinical Trial Text Component
 * Renders clinical trial text with proper formatting and ID handling
 */
const ClinicalTrialText = ({
  text,
  context = 'card',
  showIds = true,
  enableLinks = false,
  className = '',
  maxLength = null,
  ...props
}) => {
  // Process text on the client side if needed
  const processText = (rawText) => {
    if (!rawText) return '';

    let processedText = rawText;

    // Handle different contexts
    if (context === 'summary' && maxLength) {
      // Truncate text intelligently for summary context
      if (processedText.length > maxLength) {
        const words = processedText.split(' ');
        let truncated = '';

        for (const word of words) {
          if ((truncated + ' ' + word).length <= maxLength) {
            truncated += (truncated ? ' ' : '') + word;
          } else {
            break;
          }
        }

        processedText =
          truncated + (truncated.length < rawText.length ? '...' : '');
      }
    }

    // Format clinical trial IDs if enabled
    if (showIds && enableLinks) {
      // Convert NCT IDs to clickable links
      processedText = processedText.replace(
        /\[Clinical Trial (NCT\d{8})\]/gi,
        '<a href="https://clinicaltrials.gov/study/$1" target="_blank" rel="noopener noreferrer" class="clinical-trial-link">$1</a>'
      );
    } else if (showIds) {
      // Just clean up the formatting of NCT IDs
      processedText = processedText.replace(
        /\[Clinical Trial (NCT\d{8})\]/gi,
        '<span class="clinical-trial-id">$1</span>'
      );
    } else {
      // Remove ID mentions entirely
      processedText = processedText.replace(
        /\[Clinical Trial NCT\d{8}\]/gi,
        ''
      );
    }

    // Clean up any extra spacing
    processedText = processedText.replace(/\s+/g, ' ').trim();

    return processedText;
  };

  const processedText = processText(text);

  // Determine appropriate styling based on context
  const getContextClass = () => {
    switch (context) {
      case 'card':
        return 'clinical-text-card';
      case 'detail':
        return 'clinical-text-detail';
      case 'summary':
        return 'clinical-text-summary';
      default:
        return 'clinical-text-default';
    }
  };

  const combinedClassName =
    `clinical-trial-text ${getContextClass()} ${className}`.trim();

  return (
    <div
      className={combinedClassName}
      dangerouslySetInnerHTML={{ __html: processedText }}
      {...props}
    />
  );
};

ClinicalTrialText.propTypes = {
  text: PropTypes.string,
  context: PropTypes.oneOf(['card', 'detail', 'summary', 'default']),
  showIds: PropTypes.bool,
  enableLinks: PropTypes.bool,
  className: PropTypes.string,
  maxLength: PropTypes.number,
};

export default ClinicalTrialText;

/**
 * Specialized components for different contexts
 */

export const ClinicalTrialCard = ({ children, ...props }) => (
  <ClinicalTrialText
    text={children}
    context="card"
    showIds={true}
    enableLinks={false}
    {...props}
  />
);

export const ClinicalTrialDetail = ({ children, ...props }) => (
  <ClinicalTrialText
    text={children}
    context="detail"
    showIds={true}
    enableLinks={true}
    {...props}
  />
);

export const ClinicalTrialSummary = ({
  children,
  maxLength = 200,
  ...props
}) => (
  <ClinicalTrialText
    text={children}
    context="summary"
    showIds={false}
    enableLinks={false}
    maxLength={maxLength}
    {...props}
  />
);

/**
 * Hook for processing clinical trial text in functional components
 */
export const useClinicalTrialText = (text, options = {}) => {
  const {
    context = 'card',
    showIds = true,
    enableLinks = false,
    maxLength = null,
  } = options;

  return React.useMemo(() => {
    if (!text) return '';

    let processedText = text;

    // Apply processing based on context
    if (context === 'summary' && maxLength) {
      if (processedText.length > maxLength) {
        const sentences = processedText.match(/[^.!?]*[.!?]/g) || [];
        let truncated = '';

        for (const sentence of sentences) {
          if ((truncated + sentence).length <= maxLength) {
            truncated += sentence;
          } else {
            break;
          }
        }

        if (truncated.length === 0) {
          const words = processedText.split(' ');
          while (words.length > 0 && words.join(' ').length > maxLength) {
            words.pop();
          }
          truncated = words.join(' ') + '...';
        }

        processedText = truncated;
      }
    }

    // Handle ID formatting
    if (showIds && enableLinks) {
      processedText = processedText.replace(
        /\[Clinical Trial (NCT\d{8})\]/gi,
        '<a href="https://clinicaltrials.gov/study/$1" target="_blank" rel="noopener noreferrer">$1</a>'
      );
    } else if (showIds) {
      processedText = processedText.replace(
        /\[Clinical Trial (NCT\d{8})\]/gi,
        '$1'
      );
    } else {
      processedText = processedText.replace(
        /\[Clinical Trial NCT\d{8}\]/gi,
        ''
      );
    }

    return processedText.replace(/\s+/g, ' ').trim();
  }, [text, context, showIds, enableLinks, maxLength]);
};
