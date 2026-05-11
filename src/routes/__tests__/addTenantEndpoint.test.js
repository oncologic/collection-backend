/**
 * Add Tenant to User Endpoint Documentation
 *
 * Endpoint: POST /api/users/add-tenant
 *
 * Description: Allows an authenticated user to add a tenant (personal or kidney) to their account
 *
 * Authentication: Required (requireUser middleware)
 *
 * Request Body:
 * {
 *   "tenantType": "personal" | "kidney"
 * }
 *
 * Responses:
 *
 * 200 - Success
 * {
 *   "message": "Successfully added [tenantType] tenant to user",
 *   "user": { ...updated user object with new tenant... }
 * }
 *
 * 400 - Bad Request
 * - Invalid tenant type (not "personal" or "kidney")
 * - User already has the requested tenant
 *
 * 500 - Server Error
 * - Tenant ID not configured in environment
 * - Database or Clerk update errors
 *
 * Side Effects:
 * 1. Adds user to the tenant in users_tenants table
 * 2. If adding personal tenant, also adds "personal" role to user_roles
 * 3. Updates Clerk public metadata with updated tenant list
 *
 * Example Usage:
 *
 * // Add personal tenant to current user
 * fetch('/api/users/add-tenant', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer [token]'
 *   },
 *   body: JSON.stringify({
 *     tenantType: 'personal'
 *   })
 * });
 */

// This file serves as documentation for the add-tenant endpoint
export const addTenantEndpointDoc = {
  path: '/api/users/add-tenant',
  method: 'POST',
  auth: 'requireUser',
  body: {
    tenantType: 'personal | kidney',
  },
};

// Minimal placeholder test to satisfy Jest
describe('addTenantEndpoint documentation', () => {
  it('should define endpoint documentation', () => {
    expect(addTenantEndpointDoc).toBeDefined();
    expect(addTenantEndpointDoc.path).toBe('/api/users/add-tenant');
  });
});
