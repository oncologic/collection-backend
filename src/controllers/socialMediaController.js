import {
  getAllPlatformsService,
  getPlatformCatalogService,
  getPlatformByIdService,
  createOrReusePlatformService,
  updatePlatformService,
  deletePlatformService,
  getAllAccountsService,
  getAccountsByTypeService,
  getAccountByIdService,
  createAccountService,
  updateAccountService,
  deleteAccountService,
  formatSocialMediaAccountsResponse,
  getAssociationsByEntityService,
  getAssociationsBySocialMediaAccountService,
  createAssociationService,
  deleteAssociationService,
} from '../services/socialMediaService.js';
import {
  createCollectionService,
  updateCollectionService,
} from '../services/collectionService.js';
import { pinItemsService } from '../services/pinnedService.js';

const canManagePlatformsInTenant = (req, tenantIds = []) => {
  if (req.auth?.isSuperuser || req.auth?.isAdmin) {
    return true;
  }

  return tenantIds.some((tenantId) =>
    req.auth?.tenantRoles?.[tenantId]?.roles?.includes('admin')
  );
};

export const socialMediaController = {
  // Platform controllers
  async getAllPlatforms(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const platforms = await getAllPlatformsService(tenantIds);
      res.status(200).json(platforms);
    } catch (error) {
      console.error('Error fetching platforms:', error);
      res.status(500).json({ error: 'Failed to fetch platforms' });
    }
  },

  async getPlatformCatalog(req, res) {
    try {
      const tenantIds = req.tenantIds || [];

      if (!canManagePlatformsInTenant(req, tenantIds)) {
        return res.status(403).json({
          error: 'Forbidden',
          message:
            'Only tenant admins or superusers can manage social media platforms',
        });
      }

      const platforms = await getPlatformCatalogService(tenantIds);
      res.status(200).json(platforms);
    } catch (error) {
      console.error('Error fetching platform catalog:', error);
      res.status(500).json({ error: 'Failed to fetch platform catalog' });
    }
  },

  async getPlatformById(req, res) {
    try {
      const platform = await getPlatformByIdService(req.params.id);
      if (!platform) {
        return res.status(404).json({ error: 'Platform not found' });
      }
      res.status(200).json(platform);
    } catch (error) {
      console.error('Error fetching platform:', error);
      res.status(500).json({ error: 'Failed to fetch platform' });
    }
  },

  async createPlatform(req, res) {
    try {
      const { name, icon, urlPattern, existingPlatformId } = req.body;
      const tenantId = req.tenantIds[0]; // Using the first tenant ID

      if (!canManagePlatformsInTenant(req, req.tenantIds || [])) {
        return res.status(403).json({
          error: 'Forbidden',
          message:
            'Only tenant admins or superusers can manage social media platforms',
        });
      }

      if (!tenantId) {
        return res.status(400).json({ error: 'A tenant is required' });
      }

      if (!existingPlatformId && (!name || !icon)) {
        return res.status(400).json({ error: 'Name and icon are required' });
      }

      const platform = await createOrReusePlatformService({
        existingPlatformId,
        name,
        icon,
        urlPattern,
        tenantId,
      });

      res.status(201).json(platform);
    } catch (error) {
      console.error('Error creating platform:', error);
      res.status(500).json({ error: 'Failed to create platform' });
    }
  },

  async updatePlatform(req, res) {
    try {
      const { name, icon, urlPattern } = req.body;
      const existingPlatform = await getPlatformByIdService(req.params.id);

      if (!existingPlatform) {
        return res.status(404).json({ error: 'Platform not found' });
      }

      const canManagePlatform =
        existingPlatform.tenantId === null
          ? req.auth?.isSuperuser || req.auth?.isAdmin
          : canManagePlatformsInTenant(req, [existingPlatform.tenantId]);

      if (!canManagePlatform) {
        return res.status(403).json({
          error: 'Forbidden',
          message:
            'Only tenant admins or superusers can manage social media platforms',
        });
      }

      if (!name && !icon && !urlPattern) {
        return res
          .status(400)
          .json({ error: 'At least one field is required for update' });
      }

      const updatedPlatform = await updatePlatformService(req.params.id, {
        ...(name && { name }),
        ...(icon && { icon }),
        ...(urlPattern && { urlPattern }),
      });

      res.status(200).json(updatedPlatform);
    } catch (error) {
      console.error('Error updating platform:', error);
      res.status(500).json({ error: 'Failed to update platform' });
    }
  },

  async deletePlatform(req, res) {
    try {
      const existingPlatform = await getPlatformByIdService(req.params.id);

      if (!existingPlatform) {
        return res.status(404).json({ error: 'Platform not found' });
      }

      const canManagePlatform =
        existingPlatform.tenantId === null
          ? req.auth?.isSuperuser || req.auth?.isAdmin
          : canManagePlatformsInTenant(req, [existingPlatform.tenantId]);

      if (!canManagePlatform) {
        return res.status(403).json({
          error: 'Forbidden',
          message:
            'Only tenant admins or superusers can manage social media platforms',
        });
      }

      const deletedPlatform = await deletePlatformService(req.params.id);

      res.status(200).json({ message: 'Platform deleted successfully' });
    } catch (error) {
      console.error('Error deleting platform:', error);
      res.status(500).json({ error: 'Failed to delete platform' });
    }
  },

  // Social Media Account controllers
  async getAllAccounts(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const { platformId, formatted } = req.query;

      const accounts = await getAllAccountsService(
        tenantIds,
        platformId,
        req.auth?.dbUserId
      );

      // Return formatted response if requested
      if (formatted === 'true') {
        const formattedAccounts = formatSocialMediaAccountsResponse(accounts);
        return res.status(200).json(formattedAccounts);
      }

      res.status(200).json(accounts);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      res.status(500).json({ error: 'Failed to fetch accounts' });
    }
  },

  async getAccountsByType(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const { platformId, accountType } = req.params;

      if (!platformId || !accountType) {
        return res
          .status(400)
          .json({ error: 'Platform ID and account type are required' });
      }

      const accounts = await getAccountsByTypeService(
        tenantIds,
        platformId,
        accountType,
        req.auth?.dbUserId
      );
      res.status(200).json(accounts);
    } catch (error) {
      console.error('Error fetching accounts by type:', error);
      res.status(500).json({ error: 'Failed to fetch accounts' });
    }
  },

  async getAccountById(req, res) {
    try {
      const account = await getAccountByIdService(
        req.params.id,
        req.auth?.dbUserId,
        req.tenantIds
      );

      if (!account) {
        return res.status(404).json({ error: 'Account not found' });
      }

      res.status(200).json(account);
    } catch (error) {
      console.error('Error fetching account:', error);
      res.status(500).json({ error: 'Failed to fetch account' });
    }
  },

  async createAccount(req, res) {
    try {
      const {
        platformId,
        name,
        handle,
        url,
        description,
        accountTypeId,
        title,
        organizationId,
        visibility,
        hashtags,
        createCollection = false, // Flag to create collection
      } = req.body;

      const tenantId = req.tenantIds[0]; // Using the first tenant ID
      const userId = req.auth?.dbUserId;

      if (!platformId || !name || !url || !accountTypeId) {
        return res.status(400).json({
          error: 'Platform ID, name, URL, and account type are required',
        });
      }

      // Enforce visibility defaults: private unless admin
      const finalVisibility = visibility || (req.auth?.isAdmin ? 'public' : 'private');
      
      const account = await createAccountService({
        platformId,
        name,
        handle,
        url,
        description,
        accountTypeId,
        title,
        organizationId,
        userId,
        visibility: finalVisibility,
        tenantId,
      }, req.auth?.isAdmin);

      // If createCollection flag is true, create a collection for this account
      let collection = null;
      if (createCollection) {
        collection = await createCollectionService(
          {
            name,
            description,
            visibility: finalVisibility,
            type: 'social_media',
            userId,
            tenantId,
            hashtags: hashtags || [],
            collection_type: 'user',
            createdByUserId: userId,
          },
          userId
        );

        // Automatically pin the created collection
        try {
          await pinItemsService(
            [{ id: collection.id, type: 'collection' }],
            userId,
            req.tenantIds
          );
        } catch (pinningError) {
          // Log the error but don't fail collection creation
          console.error('Error pinning created collection:', pinningError);
        }
      }

      res.status(201).json({
        account,
        collection,
      });
    } catch (error) {
      console.error('Error creating account:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  },

  async updateAccount(req, res) {
    try {
      const {
        platformId,
        name,
        handle,
        url,
        description,
        accountTypeId,
        title,
        organizationId,
        visibility,
        collectionId,
        hashtags,
      } = req.body;

      if (Object.keys(req.body).length === 0) {
        return res
          .status(400)
          .json({ error: 'At least one field is required for update' });
      }

      // Update account
      const updatedAccount = await updateAccountService(req.params.id, {
        ...(platformId && { platformId }),
        ...(name && { name }),
        ...(handle !== undefined && { handle }),
        ...(url && { url }),
        ...(description !== undefined && { description }),
        ...(accountTypeId && { accountTypeId }),
        ...(title !== undefined && { title }),
        ...(organizationId !== undefined && { organizationId }),
        ...(visibility && { visibility }),
      }, req.auth?.dbUserId, req.auth?.isAdmin, req.tenantIds);

      if (!updatedAccount) {
        return res.status(404).json({ error: 'Account not found' });
      }

      // Update associated collection if collectionId is provided
      let updatedCollection = null;
      if (collectionId) {
        const userId = req.auth?.dbUserId;
        updatedCollection = await updateCollectionService(
          collectionId,
          {
            name: name || updatedAccount.name,
            description: description || updatedAccount.description,
            visibility: visibility || updatedAccount.visibility,
            hashtags: hashtags || [],
          },
          userId,
          req.tenantIds,
          req.auth.isAdmin
        );
      }

      res.status(200).json({
        account: updatedAccount,
        collection: updatedCollection,
      });
    } catch (error) {
      console.error('Error updating account:', error);
      res.status(500).json({ error: 'Failed to update account' });
    }
  },

  async deleteAccount(req, res) {
    try {
      const deletedAccount = await deleteAccountService(req.params.id);

      if (!deletedAccount) {
        return res.status(404).json({ error: 'Account not found' });
      }

      res.status(200).json({ message: 'Account deleted successfully' });
    } catch (error) {
      console.error('Error deleting account:', error);
      res.status(500).json({ error: 'Failed to delete account' });
    }
  },

  async bulkCreateAccounts(req, res) {
    try {
      const { accounts, associations } = req.body;
      const tenantId = req.tenantIds[0];
      const userId = req.auth?.dbUserId;

      if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({ error: 'Accounts array is required' });
      }

      if (accounts.length > 100) {
        return res
          .status(400)
          .json({ error: 'Maximum 100 accounts can be imported at once' });
      }

      const results = {
        successful: 0,
        failed: 0,
        errors: [],
        created: [],
        associations: {
          successful: 0,
          failed: 0,
          errors: [],
        },
      };

      // Process accounts sequentially
      for (let i = 0; i < accounts.length; i++) {
        try {
          const accountData = {
            ...accounts[i],
            userId,
            tenantId: accounts[i].tenantId || tenantId,
            visibility: accounts[i].visibility || 'private',
          };

          // Validate visibility permissions
          if (accountData.visibility === 'public' && !req.auth.isAdmin) {
            throw new Error(
              'Only administrators can make accounts public'
            );
          }

          const createdAccount = await createAccountService(accountData, req.auth?.isAdmin);
          results.successful++;
          results.created.push(createdAccount);

          // Process associations for this account if provided
          if (associations && associations[i]) {
            const accountAssociations = associations[i];

            // Process each association type
            for (const assocType of [
              'organizations',
              'collections',
              'external_links',
            ]) {
              if (
                accountAssociations[assocType] &&
                Array.isArray(accountAssociations[assocType])
              ) {
                for (const associatedId of accountAssociations[assocType]) {
                  try {
                    // Convert plural type to singular for associatedType
                    let associatedType = assocType.slice(0, -1); // Remove 's'
                    if (assocType === 'external_links') {
                      associatedType = 'collection_external_link';
                    }

                    await createAssociationService({
                      socialMediaAccountId: createdAccount.id,
                      associatedId,
                      associatedType,
                      tenantId,
                    });
                    results.associations.successful++;
                  } catch (assocError) {
                    results.associations.failed++;
                    results.associations.errors.push({
                      accountRow: i + 1,
                      accountName: createdAccount.name,
                      associationType: assocType,
                      associatedId,
                      error: assocError.message,
                    });
                  }
                }
              }
            }
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            row: i + 1,
            error: error.message || 'Unknown error',
            account: accounts[i],
          });
        }
      }

      res.status(200).json({
        message: `Bulk import completed. Successfully created ${results.successful} accounts.`,
        results,
      });
    } catch (error) {
      console.error('Error in bulk account creation:', error);
      res.status(500).json({ error: 'Failed to process bulk account import' });
    }
  },

  async getAssociations(req, res) {
    try {
      const { associatedId, associatedType, socialMediaAccountId } = req.query;

      // Handle fetching by social media account ID
      if (socialMediaAccountId) {
        const associations =
          await getAssociationsBySocialMediaAccountService(
            socialMediaAccountId
          );
        return res.status(200).json(associations);
      }

      // Handle fetching by associated entity
      if (!associatedId || !associatedType) {
        return res.status(400).json({
          error:
            'Either socialMediaAccountId OR both associatedId and associatedType are required',
        });
      }

      const associations = await getAssociationsByEntityService(
        associatedId,
        associatedType,
        req.auth?.dbUserId,
        req.tenantIds
      );

      res.status(200).json(associations);
    } catch (error) {
      console.error('Error fetching associations:', error);
      res.status(500).json({ error: 'Failed to fetch associations' });
    }
  },

  async createAssociation(req, res) {
    try {
      const { socialMediaAccountId, associatedId, associatedType } = req.body;

      if (!socialMediaAccountId || !associatedId || !associatedType) {
        return res.status(400).json({
          error:
            'socialMediaAccountId, associatedId, and associatedType are required',
        });
      }

      // Validate associatedType
      const validTypes = [
        'organization',
        'resource',
        'collection',
        'collection_external_link',
      ];
      if (!validTypes.includes(associatedType)) {
        return res.status(400).json({
          error: `Invalid associatedType. Must be one of: ${validTypes.join(', ')}`,
        });
      }

      const association = await createAssociationService({
        socialMediaAccountId,
        associatedId,
        associatedType,
        tenantId: req.tenantIds?.[0], // Use the first tenant ID
      });

      res.status(201).json(association);
    } catch (error) {
      console.error('Error creating association:', error);
      res.status(500).json({
        error: 'Failed to create association',
        details: error.message,
      });
    }
  },

  async deleteAssociation(req, res) {
    try {
      const { socialMediaAccountId, associatedId, associatedType } = req.body;

      if (!socialMediaAccountId || !associatedId || !associatedType) {
        return res.status(400).json({
          error:
            'socialMediaAccountId, associatedId, and associatedType are required',
        });
      }

      const result = await deleteAssociationService({
        socialMediaAccountId,
        associatedId,
        associatedType,
      });

      if (!result) {
        return res.status(404).json({ error: 'Association not found' });
      }

      res.status(200).json({ message: 'Association deleted successfully' });
    } catch (error) {
      console.error('Error deleting association:', error);
      res.status(500).json({ error: 'Failed to delete association' });
    }
  },
};
