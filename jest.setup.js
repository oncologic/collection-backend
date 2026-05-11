// Jest setup file
import { stopMemoryMonitoring } from './src/services/vectorService.js';

// Mock import.meta for Node.js compatibility
global.importMeta = { url: 'file://' + process.cwd() + '/test.js' };

// Stop memory monitoring and other cleanup after all tests
afterAll(async () => {
  try {
    stopMemoryMonitoring();
  } catch (error) {
    // Ignore errors when stopping monitoring
  }

  // Close any open database connections with timeout (non-blocking)
  // Don't await - let it close in background, timeout after 2 seconds
  try {
    const { pool } = await import('./src/db/index.js');
    if (pool && typeof pool.end === 'function') {
      // Fire and forget - don't wait for it to complete
      Promise.race([
        pool.end(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]).catch(() => {
        // Ignore errors - pool will close when process exits
      });
    }
  } catch (error) {
    // Ignore errors when closing connections
  }

  // Force clear any remaining timers
  if (global.gc) {
    global.gc();
  }
}, 5000); // 5 second timeout for the entire afterAll hook

// Set up global test environment
global.console = {
  ...console,
  // Suppress certain console logs during tests
  warn: jest.fn(),
  error: console.error, // Keep error logs for debugging
  log: console.log, // Keep log for debugging
  info: jest.fn(), // Suppress info logs like DB connection success
};
