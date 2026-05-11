import express from 'express';
import { requireAdmin, requireSuperuser } from '../middleware/authMiddleware.js';
import {
  getAllTenants,
  getTenantById,
  createTenant,
  updateTenant,
  deleteTenant,
  getTenantUsers,
  addUserToTenant,
  removeUserFromTenant,
  updateUserRolesInTenant,
} from '../controllers/tenantController.js';

const router = express.Router();

// Superuser-only cross-tenant existing-user assignment
router.post('/:id/users', requireSuperuser(), addUserToTenant);

// All remaining tenant routes require admin access
router.use(requireAdmin());

// Tenant CRUD operations
router.get('/', getAllTenants);
router.get('/:id', getTenantById);
router.post('/', createTenant);
router.patch('/:id', updateTenant);
router.delete('/:id', deleteTenant);

// Tenant user management
router.get('/:id/users', getTenantUsers);
router.delete('/:id/users/:userId', removeUserFromTenant);
router.patch('/:id/users/:userId/roles', updateUserRolesInTenant);

export default router;
