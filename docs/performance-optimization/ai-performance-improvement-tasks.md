# AI Performance Optimization Task List

## Overview
This document outlines high-priority performance improvements for the AI processing system. With 20 users currently on the platform, these optimizations will reduce response time from 10-20 seconds to 2-5 seconds.

## Task Priority List

### 1. Remove Model Selection API Call ⚡ (Saves 1-2 seconds)
**Time to implement:** 5 minutes  
**Impact:** Eliminates unnecessary API call on every request

**Files to modify:**
- `src/controllers/aiController.js` (lines 177-184)

**Implementation:**
```javascript
// Replace the makeAiAgentRequest call with:
const modelForQuestion = { 
  recommended: 'gemini-2.5-flash',
  reason: 'Default fast model' 
};
```

**Testing:**
- Verify chat responses still work
- Check that model selection status update still shows

---

### 2. Skip RAG for Selected Items ⚡ (Saves 3-5 seconds)
**Time to implement:** 10 minutes  
**Impact:** Avoids vector search when users click specific items

**Files to modify:**
- `src/controllers/aiController.js` (lines 290-310)

**Implementation:**
```javascript
// Add early return after line 305:
if (hasSelectedItems || hasMentionedItems) {
  sendUpdate('processing', { status: 'Loading selected items...' });
  // Skip to data fetching, set useRagOnly = false
}
```

**Testing:**
- Click on specific resource/event
- Verify it loads without "searching for relevant resources" message
- Confirm general queries still use RAG

---

### 3. Add Response Caching ⚡ (Saves 5-15 seconds on repeats)
**Time to implement:** 20 minutes  
**Impact:** Instant responses for repeated queries

**Files to modify:**
- `src/controllers/aiController.js` (add caching logic)

**Implementation:**
```javascript
// Add at top of file:
const responseCache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// In generateResourceChat, after line 160:
const cacheKey = crypto.createHash('md5')
  .update(`${prompt}-${JSON.stringify(data?.mentionedItems || [])}`)
  .digest('hex');
  
const cached = responseCache.get(cacheKey);
if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
  sendUpdate('complete', { content: cached.response });
  return res.end();
}

// After getting response (around line 240):
responseCache.set(cacheKey, { 
  response: { answer: result.answer, data: result.data }, 
  timestamp: Date.now() 
});
```

**Testing:**
- Ask same question twice
- Second response should be instant
- Verify cache expires after 1 hour

---

### 4. Disable Auto-Embeddings 🔄 (Saves 10-30 seconds on creates)
**Time to implement:** 15 minutes  
**Impact:** Removes blocking embedding generation during content creation

**Files to find and modify:**
```bash
# Find all embedding generation calls:
grep -r "generateEmbedding" src/ --include="*.js"
```

**Implementation:**
- Comment out embedding generation in create/update operations
- Move to background job queue or manual trigger
- Keep embeddings for search-critical content only

**Testing:**
- Create new resource/event
- Should save instantly without delay
- Verify content still searchable (may need manual embedding trigger)

---

### 5. Limit Vector Search Scope ⚡ (Saves 2-3 seconds)
**Time to implement:** 10 minutes  
**Impact:** Reduces unnecessary vector operations

**Files to modify:**
- `src/services/vectorService.js` (semanticSearchAllContent function)

**Implementation:**
```javascript
// Change limits and scope:
const searchConfig = {
  limit: 10, // Instead of 50
  contentTypes: ['collections', 'resources'], // Skip less relevant types
  threshold: 0.7 // Increase similarity threshold
};
```

**Testing:**
- Run general search queries
- Verify still returns relevant results
- Check response time improvement

---

## Quick Wins Checklist

- [ ] Remove model selection API call (Task 1)
- [ ] Skip RAG for selected items (Task 2)  
- [ ] Implement response caching (Task 3)
- [ ] Disable auto-embeddings (Task 4)
- [ ] Limit vector search results (Task 5)

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Model Selection | 1-2s | 0s |
| RAG Search (when not needed) | 3-5s | 0s |
| Repeated Queries | 10-20s | <100ms |
| Content Creation | 10-30s | <1s |
| Vector Search | 3-5s | 1-2s |
| **Total Response Time** | **10-20s** | **2-5s** |

## Next Steps

After implementing these quick wins:
1. Monitor actual performance improvements
2. Set up background job queue for embeddings
3. Consider implementing Redis for multi-server caching
4. Add performance monitoring/metrics

## Notes

- These optimizations are specifically for low-user-count scenarios
- As user base grows, revisit caching strategy and infrastructure
- Keep embeddings for future search capability, just generate them asynchronously