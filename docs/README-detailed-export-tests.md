# Detailed Export Endpoint Privacy Tests

This directory contains comprehensive tests for the `/api/collections/:id/detailed-export-data` endpoint, ensuring proper privacy controls are enforced.

## Test Coverage

### 1. Route-Level Tests (`collectionRoutes.detailed-export.test.js`)
Tests the HTTP endpoint behavior:
- ✅ Authentication validation
- ✅ Request/response handling
- ✅ Error responses (401, 404, 500)
- ✅ Multi-tenant support
- ✅ Controller integration

### 2. Service-Level Tests (`../services/__tests__/collectionService.detailed-export.privacy.test.js`)
Tests the privacy logic in the service layer:
- ✅ Collection visibility enforcement (public, unlisted, private)
- ✅ Owner vs non-owner access
- ✅ Collaborator access controls
- ✅ External link privacy filtering
- ✅ Notation privacy filtering
- ✅ Tenant isolation
- ✅ Cross-user privacy boundaries

### 3. Integration Tests (`../__tests__/integration/detailed-export-privacy.integration.test.js`)
End-to-end tests with real database interactions:
- ✅ Complete privacy workflow testing
- ✅ Real collaborator relationships
- ✅ Complex privacy scenarios
- ✅ Database constraint validation

## Privacy Model Tested

### Collection Visibility
- **Public**: Accessible by anyone in the tenant
- **Unlisted**: Accessible by owner and collaborators
- **Private**: Accessible only by owner

### External Link Visibility
- **Public**: Included for any user with collection access
- **Unlisted**: Included for collaborators and link creator
- **Private**: Included only for link creator

### Notation Visibility
- **Public**: Included for any user with external link access
- **Unlisted**: Included for any user with external link access
- **Private**: Included only for notation creator

### Tenant Isolation
- Users can only access collections within their assigned tenants
- Cross-tenant access is strictly forbidden

## Running the Tests

```bash
# Run all detailed export tests
npm run test:detailed-export

# Run only the integration tests (requires test database)
npm run test:integration

# Run specific test file
npm test src/routes/__tests__/collectionRoutes.detailed-export.test.js
```

## Test Scenarios Covered

### Basic Access Control
- ✅ Owner can access all their collections regardless of visibility
- ✅ Public collections accessible by anyone in tenant
- ✅ Unlisted collections accessible by collaborators
- ✅ Private collections accessible only by owner
- ✅ Cross-tenant access denied

### Collaborator Access
- ✅ Collection collaborators can access unlisted collections
- ✅ External link collaborators can access unlisted external links
- ✅ Non-collaborators cannot access unlisted content

### Content Filtering
- ✅ Private external links filtered for non-creators
- ✅ Private notations filtered for non-creators
- ✅ Public content always included when user has collection access
- ✅ Mixed visibility items handled correctly

### Edge Cases
- ✅ Non-existent collections return 404
- ✅ Malformed collection IDs handled gracefully
- ✅ Database errors propagated correctly
- ✅ Empty collections handled properly

## Privacy Security Checklist

When modifying the detailed export endpoint, ensure:

- [ ] Collection visibility checks are maintained
- [ ] External link privacy is enforced
- [ ] Notation privacy is respected
- [ ] Tenant isolation is preserved
- [ ] Collaborator relationships are honored
- [ ] No data leakage across users/tenants
- [ ] Proper error handling for access denied scenarios

## Test Data Structure

The tests use a consistent data structure:

```javascript
// Test users
user1: Collection owner
user2: Collaborator 
user3: Unauthorized user

// Test collections
publicCollection: visibility='public'
unlistedCollection: visibility='unlisted' 
privateCollection: visibility='private'

// Test external links
publicLink: visibility='public'
unlistedLink: visibility='unlisted'
privateLink: visibility='private'

// Test notations
publicNotation: visibility='public'
unlistedNotation: visibility='unlisted'
privateNotation: visibility='private'
```

## Adding New Privacy Tests

When adding new privacy features:

1. Add route-level tests for new endpoints
2. Add service-level tests for new privacy logic
3. Add integration tests for complex scenarios
4. Update this documentation
5. Verify all existing tests still pass

## Security Notes

This endpoint handles sensitive data and must maintain strict privacy controls:

- Always use parameterized queries to prevent SQL injection
- Validate user permissions before data access
- Filter data at the database level, not in application code
- Log security violations for monitoring
- Never expose internal IDs or sensitive metadata