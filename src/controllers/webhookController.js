import { createUserService } from '../services/userService.js';
import { clerkClient } from '@clerk/express';
import { determineTenantAndRoles } from '../utils/tenantHelpers.js';

export const webhookController = {
  async handleClerkWebhook(req, res) {
    try {
      const evt = req.webhookEvent;
      const eventType = evt.type;

      // Handle user.created event
      if (eventType === 'user.created') {
        const {
          id,
          email_addresses,
          first_name,
          last_name,
          public_metadata,
          unsafe_metadata,
        } = evt.data;

        // Get the primary email address
        const primaryEmail = email_addresses[0]?.email_address;
        if (!primaryEmail) {
          throw new Error('No email address found for user');
        }

        // Check if this is a personal tenant signup
        // The frontend should set this in unsafe_metadata during signup
        const signupTenant =
          unsafe_metadata?.signup_tenant || public_metadata?.signup_tenant;
        const isPersonalTenantSignup = signupTenant === 'personal';

        // Determine which tenant(s) to assign
        let tenantIds = [];
        let roles = [];
        let tenantMetadata = 'kidney'; // default

        if (isPersonalTenantSignup) {
          // For personal tenant signup, create user with personal tenant
          const personalTenantId = process.env.COMMUNITY_TENANT;

          if (!personalTenantId) {
            throw new Error('Personal tenant ID not configured in environment');
          }

          tenantIds = [personalTenantId];
          roles = ['personal']; // Personal role for personal tenant
          tenantMetadata = 'personal';
        } else {
          // For kidney tenant signup
          const kidneyTenantId = process.env.KIDNEY_TENANT_ID;

          if (!kidneyTenantId) {
            throw new Error('Kidney tenant ID not configured in environment');
          }

          tenantIds = [kidneyTenantId];
          roles = ['patient']; // Default role for kidney tenant
        }

        // Create user in our database
        const newUser = await createUserService({
          clerkId: id,
          email: primaryEmail,
          firstName: first_name,
          lastName: last_name,
          roles: roles,
          tenantIds: tenantIds,
        });

        // Set metadata in Clerk
        await clerkClient.users.updateUserMetadata(id, {
          publicMetadata: {
            roles: roles,
            tenant: tenantMetadata,
            onboardingComplete: isPersonalTenantSignup, // Skip onboarding for personal tenant
          },
        });

        return res.status(200).json({
          message: 'User created successfully',
          user: newUser,
        });
      }

      // Return 200 for other event types we don't handle
      return res.status(200).json({
        message: `Unhandled event type: ${eventType}`,
      });
    } catch (error) {
      console.error('Error handling webhook:', error);
      return res.status(500).json({
        error: 'Error handling webhook',
        message: error.message,
      });
    }
  },
};
