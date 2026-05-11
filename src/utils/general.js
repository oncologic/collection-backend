export const snakeToCamelCase = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamelCase);
  }

  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key.charAt(0).toLowerCase() +
          key
            .slice(1)
            .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
        snakeToCamelCase(value),
      ])
    );
  }

  return obj;
};

/**
 * Generates a UUID v4 string
 * @returns {string} UUID v4 string
 */
export const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Add these utility functions at the top of the file, before the controller object
export const isYoutubeUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return ['youtube.com', 'youtu.be', 'www.youtube.com'].includes(
      urlObj.hostname
    );
  } catch {
    return false;
  }
};
export const parseTimestamps = (description) => {
  // Return empty array if no description
  if (!description) {
    return [];
  }

  // Strip HTML tags from description
  const strippedDescription = description.replace(/<[^>]*>/g, '');

  // Return empty array if no timestamps section
  if (!strippedDescription.toLowerCase().includes('timestamps')) {
    return [];
  }

  // Get the content after "Timestamps" (case insensitive)
  const timestampSection = strippedDescription.split(/timestamps/i)[1]?.trim();

  if (!timestampSection) return [];

  // Match patterns like "Something at: 11:30" or "Something at 11:30"
  const timestampRegex = /(.+?)(?:at:?\s+)(\d+):(\d+)/gi;
  const matches = [...timestampSection.matchAll(timestampRegex)];

  return matches.map((match) => {
    const [_, title, minutes, seconds] = match;

    // Convert to seconds for YouTube (e.g., 11:30 becomes 690)
    const totalSeconds = parseInt(minutes) * 60 + parseInt(seconds);

    return {
      title: title.trim(),
      timestamp: totalSeconds,
      formattedTime: `${minutes}:${seconds.padStart(2, '0')}`, // Keep original format for display
    };
  });
};
