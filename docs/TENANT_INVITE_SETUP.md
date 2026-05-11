# Tenant Invite System Setup

## Overview

This system allows you to generate shareable invite links and QR codes for
tenants. Users can join tenants via these links without the tenant needing to be
public.

## Features

- Generate invite links with QR codes
- Multi-use links (unlimited uses by default)
- Links never expire
- Specify role when creating invite (advocate or patient)
- Smooth signup/signin flow with Clerk
- Auto-accept invites after authentication
- Track invite usage

## Setup Instructions

### 1. Run Database Migration

This will create:

- `tenant_invites` table
- `tenant_invite_uses` table
- Appropriate indexes

### 2. Usage Example

In any component where you want to allow invite creation (e.g., tenant settings
page):

```jsx
import { useState } from 'react';
import TenantInviteModal from '@/app/components/modals/TenantInviteModal';

export default function TenantSettings() {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const currentTenant = { id: 'tenant-uuid', name: 'Kidney Cancer' };

  return (
    <>
      <button
        onClick={() => setShowInviteModal(true)}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        Invite People
      </button>

      <TenantInviteModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        tenant={currentTenant}
      />
    </>
  );
}
```

### 3. How It Works

**For Invite Creators:**

1. Click "Invite People" button
2. Select role (patient or advocate)
3. Click "Generate Invite Link"
4. Copy link or download QR code
5. Share with others

**For Invite Recipients:**

1. Click invite link or scan QR code
2. Lands on `/join/[token]` page
3. Sees tenant info and access level
4. If not signed in: Shows Clerk sign-in/sign-up
5. If signed in: Auto-joins tenant and redirects to app

### 4. API Endpoints

- `POST /api/tenant-invites` - Create new invite
- `GET /api/tenant-invites/tenant/:tenantId` - Get all invites for tenant
- `GET /api/tenant-invites/token/:token` - Get invite details (public)
- `POST /api/tenant-invites/accept/:token` - Accept invite (requires auth)
- `DELETE /api/tenant-invites/:inviteId` - Revoke invite
- `GET /api/tenant-invites/:inviteId/usage` - Get usage stats

### 5. Security Notes

- Only tenant members can create invites
- Invite tokens are 64-character random hex strings
- Users must authenticate via Clerk before joining
- Invites can be revoked at any time
- Usage is tracked in `tenant_invite_uses` table

### 6. Future Enhancements

You can easily add:

- Expiration dates (modify `tenantInvites.expiresAt`)
- Max use limits (modify service to check `maxUses`)
- Email-specific invites
- Custom welcome messages
- Invite analytics dashboard
