# Personal Tenant Signup Fix

## Problem
Users signing up through the personal tenant are incorrectly being assigned to the kidney tenant and shown the onboarding modal.

## Root Cause
The Clerk webhook handler (`webhookController.js`) was hardcoded to always create users with the kidney tenant, regardless of where they signed up from.

## Solution

### 1. Backend Fix (Already Applied)
Updated the webhook handler to check for personal tenant signups by looking for `signup_tenant` in the user's metadata.

### 2. Frontend Changes Required

In your frontend (chrcc-registry), you need to:

#### A. Set Metadata During Signup
When users sign up through the personal tenant flow, set the signup tenant in Clerk's metadata:

```javascript
// During signup on personal tenant
await clerk.signUp.create({
  emailAddress: email,
  password: password,
  unsafeMetadata: {
    signup_tenant: 'personal'
  }
});
```

#### B. Skip Onboarding Modal
Check the user's metadata to determine if they should see the onboarding modal:

```javascript
// In your onboarding component
const { user } = useUser();
const isPersonalTenant = user?.publicMetadata?.tenant === 'personal';
const onboardingComplete = user?.publicMetadata?.onboardingComplete;

// Skip modal for personal tenant users
if (isPersonalTenant || onboardingComplete) {
  // Don't show onboarding modal
  return null;
}
```

### 3. Testing the Fix

1. **Test Personal Tenant Signup**:
   - Sign up through personal tenant URL
   - Verify no kidney tenant assignment
   - Verify no onboarding modal

2. **Test Community Tenant Signup**:
   - Sign up through community/kidney tenant
   - Verify kidney tenant assignment
   - Verify onboarding modal appears

### 4. Session vs User Creation

The session webhook (`session.created`) doesn't help here because:
- Sessions are created after user creation
- Session parameters aren't passed to the user creation webhook
- The tenant assignment needs to happen during user creation

### 5. Alternative Approach (If Metadata Doesn't Work)

If setting metadata during signup doesn't work with your Clerk setup, you could:

1. Use different Clerk applications for different tenants
2. Use a custom claim in the JWT
3. Check the signup URL/referrer in the frontend and make an API call to update the user

## Environment Variables Needed

Make sure these are set in your `.env`:
```
KIDNEY_TENANT_ID=your_kidney_tenant_id
PERSONAL_TENANT_PREFIX=personal_ # If using dynamic personal tenants
```

## Key Points

- Personal tenant users should NOT be assigned to kidney tenant
- Personal tenant users should NOT see onboarding modal
- Personal tenant users don't need roles
- The personal tenant itself may be created dynamically when first accessed