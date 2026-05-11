# Events Pagination Implementation Guide

## Backend Changes Completed

1. **New Service Function**: `getAllEventsPaginated` in `eventService.js`
   - Supports pagination with `page` and `limit` parameters
   - Returns paginated data with metadata
   - Optimizes tag fetching for only the current page

2. **New Controller Method**: `getAllEventsPaginated` in `eventController.js`
   - Accepts query parameters: `page`, `limit`, `sortBy`, `sortOrder`, `filterDate`
   - Validates pagination parameters
   - Returns formatted response with pagination metadata

3. **New Route**: `GET /api/events/paginated`
   - Protected endpoint requiring authentication
   - Query parameters:
     - `page` (default: 1)
     - `limit` (default: 20, max: 100)
     - `sortBy` (default: 'startDate', options: 'startDate', 'createdAt')
     - `sortOrder` (default: 'desc', options: 'asc', 'desc')
     - `filterDate` (optional)

## Frontend Changes Completed

1. **New API Function**: `fetchEventsPaginated` in `eventsApi.js`
   - Handles query parameter construction
   - Proper error handling

2. **New Hook**: `useEventsPaginated` in `useEvents.js`
   - React Query hook with pagination support
   - Keeps previous data while fetching new pages
   - Automatic sorting if no sortBy specified

## Dashboard Implementation Example

Replace the current `useEvents` hook in your dashboard with pagination:

```javascript
// In your dashboard component
import { useEventsPaginated } from "../hooks/useEvents";
import { useState } from "react";

function Dashboard() {
  const [page, setPage] = useState(1);
  const limit = 20; // Events per page

  const { data: eventsData, isLoading } = useEventsPaginated({
    page,
    limit,
    sortBy: 'startDate',
    sortOrder: 'desc'
  });

  const events = eventsData?.data || [];
  const pagination = eventsData?.pagination || {};

  // Pagination controls
  const handleNextPage = () => {
    if (pagination.hasMore) {
      setPage(page + 1);
    }
  };

  const handlePrevPage = () => {
    if (page > 1) {
      setPage(page - 1);
    }
  };

  if (isLoading && !events.length) {
    return <LoadingSkeleton />;
  }

  return (
    <div>
      {/* Your events list */}
      {events.map(event => (
        <EventCard key={event.id} event={event} />
      ))}
      
      {/* Pagination controls */}
      <div className="flex justify-between items-center mt-4">
        <button 
          onClick={handlePrevPage} 
          disabled={page === 1}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Previous
        </button>
        
        <span>
          Page {page} of {pagination.totalPages || 1}
        </span>
        
        <button 
          onClick={handleNextPage} 
          disabled={!pagination.hasMore}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

## Response Format

The paginated endpoint returns:
```json
{
  "data": [...events],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalCount": 150,
    "totalPages": 8,
    "hasMore": true
  }
}
```

## Benefits
- Significantly improved page load performance
- Reduced memory usage on client
- Better user experience with faster initial loads
- Scalable solution as event count grows