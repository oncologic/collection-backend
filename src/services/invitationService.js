import { db } from '../db/index.js';
import { eq, and, or } from 'drizzle-orm';
import crypto from 'crypto';
import { pendingInvitations } from '../models/pendingInvitations.js';
import { users } from '../models/users.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import { collectionExternalLinks } from '../models/external_links.js';
import { collections } from '../models/collections.js';
import { externalLinks } from '../models/external_links.js';
import {
  sendCollaborationInviteEmail,
  sendPendingInviteEmail,
  sendCollectionCollaborationInviteEmail,
  sendPendingCollectionInviteEmail,
} from './emailService.js';
import { tenants } from '../models/tenants.js';
import { collectionCollaborators } from '../models/collectionCollaborators.js';
import {
  addCollectionCollaboratorWithCascade,
  cascadeCollaboratorToExternalLinks,
} from './collaborationService.js';

/**
 * Generate a secure invitation token
 */
const generateInviteToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Invite a collaborator to an external link collection
 * Handles both existing users and creates pending invitations for new users
 */
export const inviteCollaboratorService = async (
  externalLinkId,
  collaboratorData,
  invitedByUserId
) => {
  try {
    return await db.transaction(async (tx) => {
      // Get external link and collection details including tenant info
      const linkData = await tx
        .select({
          externalLinkId: externalLinks.id,
          externalLinkName: externalLinks.name,
          externalLinkUrl: externalLinks.url,
          externalLinkDescription: externalLinks.description,
          externalLinkVisibility: externalLinks.visibility,
          collectionExternalLinkId: collectionExternalLinks.id,
          collectionId: collections.id,
          collectionName: collections.name,
          collectionDescription: collections.description,
          collectionVisibility: collections.visibility,
          collectionTenantId: collections.tenantId,
          tenantName: tenants.name,
          tenantDomain: tenants.domain,
        })
        .from(externalLinks)
        .innerJoin(
          collectionExternalLinks,
          eq(collectionExternalLinks.externalLinkId, externalLinks.id)
        )
        .innerJoin(
          collections,
          eq(collections.id, collectionExternalLinks.collectionId)
        )
        .leftJoin(tenants, eq(tenants.id, collections.tenantId))
        .where(eq(externalLinks.id, externalLinkId))
        .limit(1);

      if (!linkData[0]) {
        throw new Error(
          'External link not found or not associated with a collection'
        );
      }

      const {
        externalLinkName,
        externalLinkUrl,
        externalLinkDescription,
        externalLinkVisibility,
        collectionExternalLinkId,
        collectionId,
        collectionName,
        collectionDescription,
        collectionVisibility,
        collectionTenantId,
        tenantName,
        tenantDomain,
      } = linkData[0];

      // Check if external link is private
      if (externalLinkVisibility === 'private') {
        throw new Error('Cannot add collaborators to private external links');
      }

      // Get inviter details
      const inviter = await tx
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, invitedByUserId))
        .limit(1);

      if (!inviter[0]) {
        throw new Error('Inviter not found');
      }

      // Check if user already exists
      const existingUser = await tx
        .select()
        .from(users)
        .where(eq(users.email, collaboratorData.email))
        .limit(1);

      if (existingUser[0]) {
        // User exists - check if already a collaborator
        const existingCollaborator = await tx
          .select()
          .from(collectionExternalLinkCollaborators)
          .where(
            and(
              eq(
                collectionExternalLinkCollaborators.collectionExternalLinkId,
                collectionExternalLinkId
              ),
              eq(collectionExternalLinkCollaborators.userId, existingUser[0].id)
            )
          )
          .limit(1);

        if (existingCollaborator[0]) {
          throw new Error(
            'User is already a collaborator for this external link'
          );
        }

        // Add as collaborator immediately
        const newCollaborator = await tx
          .insert(collectionExternalLinkCollaborators)
          .values({
            collectionExternalLinkId,
            userId: existingUser[0].id,
            role: collaboratorData.role,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        // Send collaboration email
        await sendCollaborationInviteEmail({
          inviteeEmail: collaboratorData.email,
          inviteeName: collaboratorData.name || existingUser[0].firstName || '',
          inviter: inviter[0],
          externalLink: {
            id: externalLinkId,
            name: externalLinkName,
            url: externalLinkUrl,
            description: externalLinkDescription,
          },
          collection: {
            id: collectionId,
            name: collectionName,
            description: collectionDescription,
          },
          tenant: {
            id: collectionTenantId,
            name: tenantName,
            domain: tenantDomain,
          },
          message: collaboratorData.message,
          role: collaboratorData.role,
        });

        return {
          type: 'immediate',
          collaborator: newCollaborator[0],
          user: existingUser[0],
          message: 'User added as collaborator immediately',
        };
      } else {
        // User doesn't exist - create pending invitation

        // Check if there's already a pending invitation
        const existingInvitation = await tx
          .select()
          .from(pendingInvitations)
          .where(
            and(
              eq(pendingInvitations.email, collaboratorData.email),
              eq(
                pendingInvitations.collectionExternalLinkId,
                collectionExternalLinkId
              ),
              eq(pendingInvitations.status, 'pending')
            )
          )
          .limit(1);

        if (existingInvitation[0]) {
          throw new Error(
            'A pending invitation already exists for this email and external link'
          );
        }

        // Create pending invitation
        const inviteToken = generateInviteToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

        const pendingInvite = await tx
          .insert(pendingInvitations)
          .values({
            email: collaboratorData.email,
            inviteeName: collaboratorData.name,
            inviterUserId: invitedByUserId,
            collectionId,
            collectionExternalLinkId,
            role: collaboratorData.role,
            message: collaboratorData.message,
            inviteToken,
            expiresAt,
            status: 'pending',
          })
          .returning();

        // Send pending invitation email
        await sendPendingInviteEmail({
          inviteeEmail: collaboratorData.email,
          inviteeName: collaboratorData.name || 'there',
          inviter: inviter[0],
          externalLink: {
            id: externalLinkId,
            name: externalLinkName,
            url: externalLinkUrl,
            description: externalLinkDescription,
          },
          collection: {
            id: collectionId,
            name: collectionName,
            description: collectionDescription,
          },
          tenant: {
            id: collectionTenantId,
            name: tenantName,
            domain: tenantDomain,
          },
          message: collaboratorData.message,
          role: collaboratorData.role,
          inviteToken,
        });

        return {
          type: 'pending',
          invitation: pendingInvite[0],
          message:
            'Invitation sent. User will be added as collaborator when they create an account.',
        };
      }
    });
  } catch (error) {
    console.error('Error in inviteCollaboratorService:', error);
    throw error;
  }
};

/**
 * Invite a collaborator to a collection with optional cascade to external links
 * Handles both existing users and creates pending invitations for new users
 */
export const inviteCollectionCollaboratorService = async (
  collectionId,
  collaboratorData,
  invitedByUserId,
  cascadeToExternalLinks = false
) => {
  try {
    return await db.transaction(async (tx) => {
      // Get collection details including tenant info
      const collectionData = await tx
        .select({
          id: collections.id,
          name: collections.name,
          description: collections.description,
          visibility: collections.visibility,
          tenantId: collections.tenantId,
          userId: collections.userId,
          tenantName: tenants.name,
          tenantDomain: tenants.domain,
        })
        .from(collections)
        .leftJoin(tenants, eq(tenants.id, collections.tenantId))
        .where(eq(collections.id, collectionId))
        .limit(1);

      if (!collectionData[0]) {
        throw new Error('Collection not found');
      }

      const collection = collectionData[0];

      // Check if collection is private
      if (collection.visibility === 'private') {
        throw new Error('Cannot add collaborators to private collections');
      }

      // Get inviter details
      const inviter = await tx
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, invitedByUserId))
        .limit(1);

      if (!inviter[0]) {
        throw new Error('Inviter not found');
      }

      // Check if email belongs to an existing user
      const existingUser = await tx
        .select()
        .from(users)
        .where(eq(users.email, collaboratorData.email))
        .limit(1);

      if (existingUser[0]) {
        // User exists, add them directly as collaborator
        const isAlreadyCollaborator = await tx
          .select()
          .from(collectionCollaborators)
          .where(
            and(
              eq(collectionCollaborators.collectionId, collectionId),
              eq(collectionCollaborators.userId, existingUser[0].id)
            )
          )
          .limit(1);

        if (isAlreadyCollaborator[0]) {
          return {
            type: 'existing',
            collaborator: isAlreadyCollaborator[0],
            message: 'User is already a collaborator',
            alreadyCollaborator: true,
          };
        }

        // Add collaborator with cascade option
        const newCollaborator = await addCollectionCollaboratorWithCascade(
          collectionId,
          {
            userId: existingUser[0].id,
            role: collaboratorData.role || 'editor',
          },
          cascadeToExternalLinks
        );

        // Send collection collaboration invite email
        await sendCollectionCollaborationInviteEmail({
          inviteeEmail: existingUser[0].email,
          inviteeName: collaboratorData.name || existingUser[0].firstName || '',
          inviter: inviter[0],
          collection: {
            id: collection.id,
            name: collection.name,
            description: collection.description,
          },
          tenant: collection.tenantId
            ? {
                id: collection.tenantId,
                name: collection.tenantName,
                domain: collection.tenantDomain,
              }
            : null,
          message: collaboratorData.message,
          role: collaboratorData.role || 'editor',
          cascadeToExternalLinks,
        });

        return {
          type: 'existing',
          collaborator: newCollaborator,
          message: 'Collaborator added successfully',
        };
      }

      // User doesn't exist, create pending invitation
      const inviteToken = generateInviteToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

      const pendingInvite = await tx
        .insert(pendingInvitations)
        .values({
          email: collaboratorData.email,
          inviteeName: collaboratorData.name,
          inviterUserId: invitedByUserId,
          collectionId,
          role: collaboratorData.role || 'editor',
          message: collaboratorData.message,
          inviteToken,
          expiresAt,
          status: 'pending',
          metadata: { cascadeToExternalLinks },
        })
        .returning();

      // Send pending collection invitation email
      await sendPendingCollectionInviteEmail({
        inviteeEmail: collaboratorData.email,
        inviteeName: collaboratorData.name || 'there',
        inviter: inviter[0],
        collection: {
          id: collection.id,
          name: collection.name,
          description: collection.description,
        },
        tenant: collection.tenantId
          ? {
              id: collection.tenantId,
              name: collection.tenantName,
              domain: collection.tenantDomain,
            }
          : null,
        message: collaboratorData.message,
        role: collaboratorData.role || 'editor',
        inviteToken,
        cascadeToExternalLinks,
      });

      return {
        type: 'pending',
        invitation: pendingInvite[0],
        message:
          'Invitation sent. User will be added as collaborator when they create an account.',
      };
    });
  } catch (error) {
    console.error('Error in inviteCollectionCollaboratorService:', error);
    throw error;
  }
};

/**
 * Accept a pending invitation when a user signs up or logs in
 */
export const acceptPendingInvitationsService = async (
  userEmail,
  userId,
  tenantIds = []
) => {
  try {
    return await db.transaction(async (tx) => {
      // Find all pending invitations for this email
      const pendingInvites = await tx
        .select()
        .from(pendingInvitations)
        .where(
          and(
            eq(pendingInvitations.email, userEmail),
            eq(pendingInvitations.status, 'pending')
          )
        );

      const acceptedInvitations = [];
      const itemsToPin = [];

      for (const invite of pendingInvites) {
        // Check if invitation hasn't expired
        if (new Date() > new Date(invite.expiresAt)) {
          // Mark as expired
          await tx
            .update(pendingInvitations)
            .set({
              status: 'expired',
              updatedAt: new Date(),
            })
            .where(eq(pendingInvitations.id, invite.id));
          continue;
        }

        // Check if user is already a collaborator (edge case)
        const existingCollaborator = await tx
          .select()
          .from(collectionExternalLinkCollaborators)
          .where(
            and(
              eq(
                collectionExternalLinkCollaborators.collectionExternalLinkId,
                invite.collectionExternalLinkId
              ),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          )
          .limit(1);

        if (!existingCollaborator[0]) {
          // Add as collaborator
          const newCollaborator = await tx
            .insert(collectionExternalLinkCollaborators)
            .values({
              collectionExternalLinkId: invite.collectionExternalLinkId,
              userId,
              role: invite.role,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          acceptedInvitations.push({
            invitation: invite,
            collaborator: newCollaborator[0],
          });

          // Add collection to items to pin if it exists
          if (invite.collectionId) {
            itemsToPin.push({
              id: invite.collectionId,
              type: 'collection',
            });
          }

          // Get external link ID to add to items to pin
          if (invite.collectionExternalLinkId) {
            const externalLinkData = await tx
              .select({
                externalLinkId: collectionExternalLinks.externalLinkId,
              })
              .from(collectionExternalLinks)
              .where(
                eq(collectionExternalLinks.id, invite.collectionExternalLinkId)
              )
              .limit(1);

            if (externalLinkData[0]) {
              itemsToPin.push({
                id: externalLinkData[0].externalLinkId,
                type: 'external_link',
              });
            }
          }
        }
        // Mark invitation as accepted
        await tx
          .update(pendingInvitations)
          .set({
            status: 'accepted',
            acceptedAt: new Date(),
            acceptedByUserId: userId,
            updatedAt: new Date(),
          })
          .where(eq(pendingInvitations.id, invite.id));
      }

      // Return both accepted invitations and items to pin
      return {
        acceptedInvitations,
        itemsToPin: itemsToPin.filter(
          (item, index, self) =>
            index ===
            self.findIndex((i) => i.id === item.id && i.type === item.type)
        ), // Remove duplicates
      };
    });
  } catch (error) {
    console.error('Error accepting pending invitations:', error);
    throw error;
  }
};

/**
 * Get pending invitations for a user by email
 */
export const getPendingInvitationsService = async (email) => {
  try {
    const invitations = await db
      .select({
        id: pendingInvitations.id,
        email: pendingInvitations.email,
        inviteeName: pendingInvitations.inviteeName,
        role: pendingInvitations.role,
        message: pendingInvitations.message,
        status: pendingInvitations.status,
        expiresAt: pendingInvitations.expiresAt,
        createdAt: pendingInvitations.createdAt,
        inviterFirstName: users.firstName,
        inviterLastName: users.lastName,
        inviterEmail: users.email,
        collectionName: collections.name,
        externalLinkName: externalLinks.name,
      })
      .from(pendingInvitations)
      .leftJoin(users, eq(pendingInvitations.inviterUserId, users.id))
      .leftJoin(
        collections,
        eq(pendingInvitations.collectionId, collections.id)
      )
      .leftJoin(
        collectionExternalLinks,
        eq(
          pendingInvitations.collectionExternalLinkId,
          collectionExternalLinks.id
        )
      )
      .leftJoin(
        externalLinks,
        eq(collectionExternalLinks.externalLinkId, externalLinks.id)
      )
      .where(
        and(
          eq(pendingInvitations.email, email),
          eq(pendingInvitations.status, 'pending')
        )
      );

    return invitations;
  } catch (error) {
    console.error('Error getting pending invitations:', error);
    throw error;
  }
};

/**
 * Accept invitation by token (for direct links)
 */
export const acceptInvitationByTokenService = async (
  token,
  userId,
  tenantIds = []
) => {
  try {
    return await db.transaction(async (tx) => {
      // Find the invitation
      const invitation = await tx
        .select()
        .from(pendingInvitations)
        .where(
          and(
            eq(pendingInvitations.inviteToken, token),
            eq(pendingInvitations.status, 'pending')
          )
        )
        .limit(1);

      if (!invitation[0]) {
        throw new Error('Invalid or expired invitation token');
      }

      // Check if expired
      if (new Date() > new Date(invitation[0].expiresAt)) {
        await tx
          .update(pendingInvitations)
          .set({
            status: 'expired',
            updatedAt: new Date(),
          })
          .where(eq(pendingInvitations.id, invitation[0].id));
        throw new Error('Invitation has expired');
      }

      // Get user details to verify email match
      const user = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user[0] || user[0].email !== invitation[0].email) {
        throw new Error('Invitation email does not match your account email');
      }

      // Handle based on invitation type
      let newCollaborator;
      let existingCollaborator;

      if (invitation[0].collectionExternalLinkId) {
        // External link invitation
        existingCollaborator = await tx
          .select()
          .from(collectionExternalLinkCollaborators)
          .where(
            and(
              eq(
                collectionExternalLinkCollaborators.collectionExternalLinkId,
                invitation[0].collectionExternalLinkId
              ),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          )
          .limit(1);

        if (existingCollaborator[0]) {
          // Mark as accepted even though they're already a collaborator
          await tx
            .update(pendingInvitations)
            .set({
              status: 'accepted',
              acceptedAt: new Date(),
              acceptedByUserId: userId,
              updatedAt: new Date(),
            })
            .where(eq(pendingInvitations.id, invitation[0].id));

          return {
            message: 'You are already a collaborator for this external link',
            alreadyCollaborator: true,
          };
        }

        // Add as external link collaborator
        newCollaborator = await tx
          .insert(collectionExternalLinkCollaborators)
          .values({
            collectionExternalLinkId: invitation[0].collectionExternalLinkId,
            userId,
            role: invitation[0].role,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
      } else if (
        invitation[0].collectionId &&
        !invitation[0].collectionExternalLinkId
      ) {
        // Collection invitation
        existingCollaborator = await tx
          .select()
          .from(collectionCollaborators)
          .where(
            and(
              eq(
                collectionCollaborators.collectionId,
                invitation[0].collectionId
              ),
              eq(collectionCollaborators.userId, userId)
            )
          )
          .limit(1);

        if (existingCollaborator[0]) {
          // Mark as accepted even though they're already a collaborator
          await tx
            .update(pendingInvitations)
            .set({
              status: 'accepted',
              acceptedAt: new Date(),
              acceptedByUserId: userId,
              updatedAt: new Date(),
            })
            .where(eq(pendingInvitations.id, invitation[0].id));

          return {
            message: 'You are already a collaborator for this collection',
            alreadyCollaborator: true,
          };
        }

        // Add as collection collaborator with cascade if needed
        const cascadeToExternalLinks =
          invitation[0].metadata?.cascadeToExternalLinks || false;
        newCollaborator = [
          await addCollectionCollaboratorWithCascade(
            invitation[0].collectionId,
            {
              userId,
              role: invitation[0].role,
            },
            cascadeToExternalLinks
          ),
        ];
      } else {
        throw new Error(
          'Invalid invitation - no collection or external link specified'
        );
      }

      // Mark invitation as accepted
      await tx
        .update(pendingInvitations)
        .set({
          status: 'accepted',
          acceptedAt: new Date(),
          acceptedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(eq(pendingInvitations.id, invitation[0].id));

      // Automatically pin the collection and external link
      const itemsToPin = [];

      // Add collection to items to pin if it exists
      if (invitation[0].collectionId) {
        itemsToPin.push({
          id: invitation[0].collectionId,
          type: 'collection',
        });
      }

      // Get external link ID to add to items to pin
      if (invitation[0].collectionExternalLinkId) {
        const externalLinkData = await tx
          .select({ externalLinkId: collectionExternalLinks.externalLinkId })
          .from(collectionExternalLinks)
          .where(
            eq(
              collectionExternalLinks.id,
              invitation[0].collectionExternalLinkId
            )
          )
          .limit(1);

        if (externalLinkData[0]) {
          itemsToPin.push({
            id: externalLinkData[0].externalLinkId,
            type: 'external_link',
          });
        }
      }

      return {
        message: 'Invitation accepted successfully',
        collaborator: newCollaborator[0],
        invitation: invitation[0],
        itemsToPin,
      };
    });
  } catch (error) {
    console.error('Error accepting invitation by token:', error);
    throw error;
  }
};

/**
 * Remove a collaborator from an external link
 */
export const removeCollaboratorService = async (
  externalLinkId,
  collaboratorUserId,
  requestingUserId
) => {
  try {
    return await db.transaction(async (tx) => {
      // Get external link and collection details
      const linkData = await tx
        .select({
          externalLinkId: externalLinks.id,
          externalLinkName: externalLinks.name,
          externalLinkVisibility: externalLinks.visibility,
          collectionExternalLinkId: collectionExternalLinks.id,
          collectionId: collections.id,
          collectionName: collections.name,
          collectionUserId: collections.userId,
          addedByUserId: externalLinks.addedByUserId,
        })
        .from(externalLinks)
        .innerJoin(
          collectionExternalLinks,
          eq(collectionExternalLinks.externalLinkId, externalLinks.id)
        )
        .innerJoin(
          collections,
          eq(collections.id, collectionExternalLinks.collectionId)
        )
        .where(eq(externalLinks.id, externalLinkId))
        .limit(1);

      if (!linkData[0]) {
        throw new Error(
          'External link not found or not associated with a collection'
        );
      }

      const { collectionExternalLinkId, collectionUserId, addedByUserId } =
        linkData[0];

      // Check permissions - only owners and admin collaborators can remove others
      let canRemove = false;

      // Collection owner can remove anyone
      if (collectionUserId === requestingUserId) {
        canRemove = true;
      }
      // External link creator can remove anyone
      else if (addedByUserId === requestingUserId) {
        canRemove = true;
      }
      // Admin collaborators can remove others (but not the owner)
      else {
        const requestingUserCollaboration = await tx
          .select()
          .from(collectionExternalLinkCollaborators)
          .where(
            and(
              eq(
                collectionExternalLinkCollaborators.collectionExternalLinkId,
                collectionExternalLinkId
              ),
              eq(collectionExternalLinkCollaborators.userId, requestingUserId),
              eq(collectionExternalLinkCollaborators.role, 'admin')
            )
          )
          .limit(1);

        if (requestingUserCollaboration[0]) {
          // Admin collaborators cannot remove the collection owner or external link creator
          if (
            collaboratorUserId !== collectionUserId &&
            collaboratorUserId !== addedByUserId
          ) {
            canRemove = true;
          }
        }
      }

      // Users can always remove themselves
      if (requestingUserId === collaboratorUserId) {
        canRemove = true;
      }

      if (!canRemove) {
        throw new Error(
          'You do not have permission to remove this collaborator'
        );
      }

      // Check if the user is actually a collaborator
      const existingCollaborator = await tx
        .select()
        .from(collectionExternalLinkCollaborators)
        .where(
          and(
            eq(
              collectionExternalLinkCollaborators.collectionExternalLinkId,
              collectionExternalLinkId
            ),
            eq(collectionExternalLinkCollaborators.userId, collaboratorUserId)
          )
        )
        .limit(1);

      if (!existingCollaborator[0]) {
        throw new Error('User is not a collaborator for this external link');
      }

      // Remove the collaborator
      const removedCollaborator = await tx
        .delete(collectionExternalLinkCollaborators)
        .where(
          and(
            eq(
              collectionExternalLinkCollaborators.collectionExternalLinkId,
              collectionExternalLinkId
            ),
            eq(collectionExternalLinkCollaborators.userId, collaboratorUserId)
          )
        )
        .returning();

      // Get user details for the response
      const userDetails = await tx
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, collaboratorUserId))
        .limit(1);

      return {
        message: 'Collaborator removed successfully',
        removedCollaborator: removedCollaborator[0],
        user: userDetails[0],
      };
    });
  } catch (error) {
    console.error('Error in removeCollaboratorService:', error);
    throw error;
  }
};
