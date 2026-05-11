# 🚀 RAG System Production Deployment Guide

## 📋 Overview

Your RAG (Retrieval-Augmented Generation) system is now fully configured and
ready for production! This guide covers frontend integration and production
deployment strategies.

## 🎯 Frontend Integration

### **No Changes Required!**

Your existing frontend code will work automatically with RAG enabled. The system
is backward compatible.

### **Current Frontend Usage:**

```javascript
// Your existing API calls work unchanged
const response = await fetch('/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'What treatment options are available?',
    // ... your existing parameters
  }),
});
```

### **Optional: RAG Control (if needed)**

```javascript
// Explicitly control RAG mode
const response = await fetch('/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'What treatment options are available?',
    useRag: true, // Enable RAG (default)
    // useRag: false, // Disable RAG for traditional mode
  }),
});
```

### **Enhanced Response Data**

The AI response now includes RAG metadata:

```javascript
const data = await response.json();
console.log(data.retrievedResources); // Array of relevant resources found
// Each resource includes: id, name, similarity_score, url, tenantId
```

## 🏭 Production Deployment Options

### **Option 1: Automatic Embeddings (Recommended)**

✅ **Already Implemented!** Embeddings are automatically generated when:

- New resources are created
- Existing resources are updated

**How it works:**

- Resource creation/update triggers `autoUpdateResourceEmbedding()`
- Runs asynchronously (non-blocking)
- Handles errors gracefully

### **Option 2: Background Job Processing**

For high-volume environments, use the background job:

```bash
# Run the background job manually
npm run process-embeddings

# Or run it as a cron job (recommended)
# Add to your crontab:
# */15 * * * * cd /path/to/your/app && npm run process-embeddings
```

**Cron Job Setup:**

```bash
# Edit crontab
crontab -e

# Add one of these lines:
# Every 15 minutes
*/15 * * * * cd /path/to/your/app && npm run process-embeddings >> /var/log/embeddings.log 2>&1

# Every hour
0 * * * * cd /path/to/your/app && npm run process-embeddings >> /var/log/embeddings.log 2>&1

# Every 6 hours (for lower volume)
0 */6 * * * cd /path/to/your/app && npm run process-embeddings >> /var/log/embeddings.log 2>&1
```

### **Option 3: Docker/Kubernetes Jobs**

**Docker Compose:**

```yaml
version: '3.8'
services:
  app:
    # Your main app service

  embedding-processor:
    build: .
    command: npm run process-embeddings
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - postgres
    # Run as a cron job or scheduled task
```

**Kubernetes CronJob:**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: embedding-processor
spec:
  schedule: '*/15 * * * *' # Every 15 minutes
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: embedding-processor
              image: your-app-image
              command: ['npm', 'run', 'process-embeddings']
              env:
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: app-secrets
                      key: database-url
                - name: OPENAI_API_KEY
                  valueFrom:
                    secretKeyRef:
                      name: app-secrets
                      key: openai-api-key
          restartPolicy: OnFailure
```

### **Option 4: Cloud Functions/Serverless**

**AWS Lambda:**

```javascript
// lambda-embedding-processor.js
import { processPendingEmbeddings } from './src/services/vectorService.js';

export const handler = async (event, context) => {
  try {
    await processPendingEmbeddings();
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Lambda embedding processing failed:', error);
    return { statusCode: 500, body: 'Error' };
  }
};
```

**Vercel Cron:**

```javascript
// api/cron/process-embeddings.js
import { processPendingEmbeddings } from '../../src/services/vectorService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await processPendingEmbeddings();
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Cron embedding processing failed:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
}
```

## 🔧 Environment Variables

Ensure these are set in production:

```bash
# Required
DATABASE_URL=postgresql://user:password@host:port/database
OPENAI_API_KEY=sk-your-openai-api-key

# Optional (with defaults)
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

## 📊 Monitoring & Logging

### **Key Logs to Monitor:**

```bash
# Successful embedding generation
✅ Successfully updated embeddings for resource: abc-123

# RAG search activity
🔍 RAG Mode: ENABLED
✅ RAG SEARCH COMPLETE: Found 3 relevant resources

# Background job activity
🚀 Starting embedding processing job...
📊 Processing 15 pending embeddings
✅ Embedding processing job completed successfully
```

### **Error Monitoring:**

```bash
# Watch for these errors
❌ Error auto-updating embeddings for resource
❌ Embedding processing job failed
❌ Error in semantic search
```

## 🚨 Production Checklist

### **Before Deployment:**

- [ ] OpenAI API key is set and has sufficient credits
- [ ] Database has pgvector extension installed
- [ ] All existing resources have embeddings generated
- [ ] RAG system tested with sample queries

### **Initial Setup:**

```bash
# 1. Generate embeddings for existing resources
npm run embeddings init

# 2. Test the RAG system
# Make a test API call to your AI endpoint

# 3. Set up background job (choose one option above)
```

### **Post-Deployment:**

- [ ] Monitor embedding generation logs
- [ ] Verify RAG responses include relevant resources
- [ ] Set up alerts for embedding failures
- [ ] Monitor OpenAI API usage and costs

## 💡 Performance Tips

### **Optimize for Scale:**

1. **Batch Processing**: The background job processes 50 resources at a time
2. **Rate Limiting**: Built-in 100ms delay between API calls
3. **Error Handling**: Non-blocking embedding generation won't break resource
   operations
4. **Tenant Isolation**: RAG searches are automatically filtered by tenant

### **Cost Optimization:**

1. **Smart Updates**: Only generates embeddings when content changes
2. **Efficient Model**: Uses `text-embedding-3-small` (cheaper than ada-002)
3. **Batch API Calls**: Processes multiple texts in single API call

## 🎉 You're Ready!

Your RAG system is production-ready with:

- ✅ Automatic embedding generation
- ✅ Tenant-based security
- ✅ Background job processing
- ✅ Comprehensive error handling
- ✅ Scalable architecture

The system will automatically enhance your AI responses with relevant resources
from your knowledge base!
