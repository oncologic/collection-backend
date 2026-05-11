# Cron Job Setup for Embedding Processing

## Overview
The embedding processing job updates vector embeddings for resources and notations that are missing embeddings or have been updated since their last embedding generation.

## Running the Job

### Manual Execution
```bash
npm run process-embeddings
```

### Cron Job Setup

To run the embeddings job every hour, add this to your crontab:

```bash
# Edit crontab
crontab -e

# Add this line to run every hour
0 * * * * cd /path/to/kidney-cancer-backend && npm run process-embeddings >> /var/log/embeddings.log 2>&1
```

### Alternative Scheduling Options

#### Every 30 minutes
```bash
*/30 * * * * cd /path/to/kidney-cancer-backend && npm run process-embeddings >> /var/log/embeddings.log 2>&1
```

#### Every 2 hours
```bash
0 */2 * * * cd /path/to/kidney-cancer-backend && npm run process-embeddings >> /var/log/embeddings.log 2>&1
```

#### Daily at 2 AM
```bash
0 2 * * * cd /path/to/kidney-cancer-backend && npm run process-embeddings >> /var/log/embeddings.log 2>&1
```

## Cloud Deployment Options

### AWS EventBridge / CloudWatch Events
```json
{
  "ScheduleExpression": "rate(1 hour)",
  "Target": {
    "Arn": "arn:aws:lambda:region:account:function:processEmbeddings"
  }
}
```

### Heroku Scheduler
Add the following command to Heroku Scheduler:
```
npm run process-embeddings
```

### GitHub Actions
```yaml
name: Process Embeddings
on:
  schedule:
    - cron: '0 * * * *'  # Every hour
jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install
      - run: npm run process-embeddings
```

## Monitoring

The job logs to console with timestamps and status messages:
- 🚀 Job start time
- 📚 Resource embedding processing
- 📝 Notation embedding processing  
- ✅ Success messages
- ❌ Error messages with details
- ⏰ Completion time

## Performance Notes

- Processes up to 50 items per batch
- Includes 100ms delay between items to avoid API rate limits
- Continues processing even if individual items fail
- Automatically skips items that already have up-to-date embeddings