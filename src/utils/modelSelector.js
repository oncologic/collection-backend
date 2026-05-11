/**
 * Selects the appropriate Claude model based on the prompt and context
 * Returns an object with the recommended model and reasoning
 */
export const selectClaudeModel = (prompt, context = {}) => {
  // Model constants
  const SONNET_MODEL = 'claude-3-5-sonnet-20241022';
  const HAIKU_MODEL = 'claude-haiku-4-5';

  // Helper function to estimate word count
  const estimateWordCount = (text) => {
    if (!text || typeof text !== 'string') return 0;
    return text.trim().split(/\s+/).length;
  };

  // Extract prompt length
  const promptWords = estimateWordCount(prompt);

  // Check for structured data requests (JSON, code blocks)
  const isStructuredRequest = /```|json|JSON|{\s*"|code|format|structure/i.test(
    prompt
  );

  // Check for complex analysis keywords
  const isComplexAnalysis =
    /analyze|analysis|explain|detailed|complex|reasoning|multi-step|comprehensive|in-depth|thoroughly/i.test(
      prompt
    );

  // Check for creative tasks
  const isCreativeTask =
    /write|writing|essay|create|creative|story|article|blog|content/i.test(
      prompt
    );

  // Check for technical/code tasks
  const isTechnicalTask =
    /code|programming|technical|documentation|implement|function|algorithm|debug/i.test(
      prompt
    );

  // Check for simple queries
  const isSimpleQuery =
    /what is|how to|quick|brief|simple|basic|define|list|fact/i.test(prompt);

  // Decision logic based on the rules
  if (isStructuredRequest && !isComplexAnalysis) {
    return {
      recommended: HAIKU_MODEL,
      reason:
        'Structured request detected - Haiku excels at JSON and code blocks',
    };
  }

  if (isSimpleQuery || promptWords < 50) {
    return {
      recommended: HAIKU_MODEL,
      reason:
        'Simple query or brief request - Haiku is optimal for quick responses',
    };
  }

  if (isCreativeTask && promptWords > 100) {
    return {
      recommended: SONNET_MODEL,
      reason:
        'Creative writing task - Sonnet provides better quality for longer content',
    };
  }

  if (isComplexAnalysis || isTechnicalTask) {
    return {
      recommended: SONNET_MODEL,
      reason:
        'Complex analysis or technical task - Sonnet offers deeper reasoning capabilities',
    };
  }

  // Check expected response length (if context provides hints)
  if (context.expectedResponseLength) {
    if (context.expectedResponseLength > 300) {
      return {
        recommended: SONNET_MODEL,
        reason:
          'Expected long response - Sonnet is better for detailed outputs',
      };
    }
  }

  // Default decision based on prompt length
  if (promptWords > 150) {
    return {
      recommended: SONNET_MODEL,
      reason: 'Longer prompt suggests complex task - Sonnet recommended',
    };
  }

  // Default to Haiku for all other cases
  return {
    recommended: HAIKU_MODEL,
    reason: 'Standard request - Haiku provides fast, efficient responses',
  };
};

/**
 * Maps model names to their providers for backward compatibility
 */
export const getModelProvider = (modelName) => {
  if (modelName.includes('claude')) {
    return 'anthropic';
  }
  if (modelName.includes('gemini')) {
    return 'google';
  }
  // Default to anthropic for Claude models
  return 'anthropic';
};
