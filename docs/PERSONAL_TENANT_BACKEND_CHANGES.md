# Personal Tenant Backend Implementation

## Overview
This document outlines the backend changes made to support personal tenant functionality alongside the existing kidney cancer tenant.

## Changes Made

### 1. Webhook Controller (src/controllers/webhookController.js)
- ✅ Updated to check for tenant preference in Clerk metadata
- ✅ Uses both `unsafe_metadata` and `public_metadata` to determine tenant
- ✅ Assigns appropriate roles based on tenant type:
  - Personal tenant: `['personal']`
  - Kidney tenant: `['patient']`
- ✅ Sets tenant information in Clerk's public metadata after user creation

### 2. User Service (src/services/userService.js)
- ✅ Updated `createUserService` to handle tenant-specific role assignment
- ✅ Personal tenant users only get 'personal' role
- ✅ Kidney tenant users only get 'patient' role
- ✅ Proper tenant assignment in `users_tenants` table

### 3. Tenant Helpers (src/utils/tenantHelpers.js)
- ✅ Created utility functions for tenant determination
- ✅ `determineTenantAndRoles`: Determines tenant and default roles
- ✅ `hasAccessToTenantType`: Checks user access to specific tenant
- ✅ `getPrimaryTenantType`: Gets user's primary tenant

## How It Works

### Signup Flow
1. User clicks signup on frontend with `?tenant=personal` parameter
2. After Clerk signup, user is redirected to `/dashboard?tenant=personal`
3. Dashboard opens UserProfileModal with tenant context
4. When profile is submitted, user is properly assigned to the tenant

### Webhook Flow
1. Clerk sends `user.created` event to webhook
2. Webhook checks for tenant preference (defaults to kidney for backward compatibility)
3. User is created with appropriate tenant and roles
4. Clerk metadata is updated with tenant information

### Role Assignment Logic
```javascript
if (primaryTenantId === process.env.COMMUNITY_TENANT) {
  // Personal tenant - only assign 'personal' role
} else if (primaryTenantId === process.env.KIDNEY_TENANT_ID) {
  // Kidney tenant - assign 'patient' role
}
```

## Environment Variables Required
- `KIDNEY_TENANT_ID`: UUID for kidney cancer tenant
- `COMMUNITY_TENANT`: UUID for personal/community tenant

## Database Impact
- No schema changes required
- Uses existing tables: `users`, `user_roles`, `users_tenants`
- Personal tenant users are distinguished by:
  - Entry in `users_tenants` with `COMMUNITY_TENANT` ID
  - 'personal' role in `user_roles` table

## Backward Compatibility
- ✅ Existing users continue to work as before
- ✅ Default behavior is kidney tenant if no preference specified
- ✅ No breaking changes to existing API endpoints

## Testing Considerations
1. Test new user signup with personal tenant
2. Test new user signup with kidney tenant (default)
3. Verify role assignment is correct
4. Ensure kidney cancer collection is only pinned for kidney users
5. Test that existing users are not affected

## Future Enhancements
1. Allow users to belong to multiple tenants simultaneously
2. Add tenant switching in the UI
3. Tenant-specific features and permissions
4. Bulk migration tools for existing users