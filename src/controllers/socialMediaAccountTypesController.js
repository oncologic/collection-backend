import {
  getAllSocialMediaAccountTypesService,
  getSocialMediaAccountTypeByIdService,
  createSocialMediaAccountTypeService,
  updateSocialMediaAccountTypeService,
  deleteSocialMediaAccountTypeService,
} from '../services/socialMediaAccountTypesService.js';

export const socialMediaAccountTypesController = {
  // Get all social media account types
  async getAllAccountTypes(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId;

      const accountTypes = await getAllSocialMediaAccountTypesService(
        tenantIds,
        userId
      );

      res.json(accountTypes);
    } catch (error) {
      console.error('Error fetching social media account types:', error);
      res.status(500).json({
        message: 'Error fetching social media account types',
        error: error.message,
      });
    }
  },

  // Get a single social media account type
  async getAccountTypeById(req, res) {
    try {
      const { id } = req.params;
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId;

      const accountType = await getSocialMediaAccountTypeByIdService(
        id,
        tenantIds,
        userId
      );

      if (!accountType) {
        return res.status(404).json({
          message: 'Social media account type not found',
        });
      }

      res.json(accountType);
    } catch (error) {
      console.error('Error fetching social media account type:', error);
      res.status(500).json({
        message: 'Error fetching social media account type',
        error: error.message,
      });
    }
  },

  // Create a new social media account type
  async createAccountType(req, res) {
    try {
      const data = req.body;
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId;

      // Validate required fields
      if (!data.name) {
        return res.status(400).json({
          message: 'Name is required',
        });
      }

      const newAccountType = await createSocialMediaAccountTypeService(
        data,
        tenantIds,
        userId
      );

      res.status(201).json(newAccountType);
    } catch (error) {
      console.error('Error creating social media account type:', error);
      res.status(500).json({
        message: 'Error creating social media account type',
        error: error.message,
      });
    }
  },

  // Update a social media account type
  async updateAccountType(req, res) {
    try {
      const { id } = req.params;
      const data = req.body;
      const tenantIds = req.tenantIds;

      const updatedAccountType = await updateSocialMediaAccountTypeService(
        id,
        data,
        tenantIds
      );

      res.json(updatedAccountType);
    } catch (error) {
      console.error('Error updating social media account type:', error);

      if (
        error.message.includes('not found') ||
        error.message.includes('access denied')
      ) {
        return res.status(404).json({
          message: error.message,
        });
      }

      if (error.message.includes('Cannot update default')) {
        return res.status(403).json({
          message: error.message,
        });
      }

      res.status(500).json({
        message: 'Error updating social media account type',
        error: error.message,
      });
    }
  },

  // Delete a social media account type
  async deleteAccountType(req, res) {
    try {
      const { id } = req.params;
      const tenantIds = req.tenantIds;

      await deleteSocialMediaAccountTypeService(id, tenantIds);

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting social media account type:', error);

      if (
        error.message.includes('not found') ||
        error.message.includes('access denied')
      ) {
        return res.status(404).json({
          message: error.message,
        });
      }

      if (error.message.includes('Cannot delete default')) {
        return res.status(403).json({
          message: error.message,
        });
      }

      res.status(500).json({
        message: 'Error deleting social media account type',
        error: error.message,
      });
    }
  },
};
