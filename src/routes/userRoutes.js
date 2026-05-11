import express from 'express';
import {
  getAllUsers,
  getUserByEmail,
  getUserById,
  updateUser,
  getAllUserTypes,
  createUser,
  getAllTenants,
  getPublicTenants,
  addTenantToUser,
  joinPublicTenant,
  updateUserTenants,
  updateUserRolesForTenant,
} from '../controllers/userController.js';
import {
  requireUser,
  requireAdmin,
  requireSuperuser,
  requireClerkAuth,
  optionalAuthAndTenants,
} from '../middleware/authMiddleware.js';
import { publicApiRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

router.get('/', requireUser(), getUserById);

// Public endpoint to discover tenants that allow public access
router.get(
  '/tenants/public',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  getPublicTenants
);

router.get('/tenants', requireClerkAuth(), getAllTenants);

// Legacy alias retained for compatibility; listing all users is superuser-only.
router.get('/all', requireSuperuser(), getAllUsers);

// Superuser-only endpoint to get all users across all tenants
router.get('/admin/all', requireSuperuser(), getAllUsers);

router.get('/types', requireUser(), getAllUserTypes);

router.post('/', requireClerkAuth(), createUser);

router.post('/add-tenant', requireUser(), addTenantToUser);

router.post('/tenants/join', requireUser(), joinPublicTenant);

router.patch('/tenants', requireUser(), updateUserTenants);

// Endpoint to update user roles for a specific tenant (requires tenant admin access)
router.patch(
  '/roles/tenant',
  requireUser(),
  updateUserRolesForTenant
);

// Put dynamic routes with parameters at the end
router.patch('/:id', requireUser(), updateUser);

router.get('/:email', requireSuperuser(), getUserByEmail);

export default router;
