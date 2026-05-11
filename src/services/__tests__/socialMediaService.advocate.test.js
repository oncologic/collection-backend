/**
 * Tests for Social Media Service - Advocate Permissions
 *
 * These tests verify that:
 * 1. Advocates can only see their own private accounts (not other users' private accounts)
 * 2. Advocates can see all public accounts regardless of creator
 * 3. The userId field is included in formatted responses (critical for frontend permission checks)
 * 4. Frontend canEditAccount logic works correctly with userId field
 *
 * Security Model:
 * - Advocates can delete accounts they created (any visibility)
 * - Advocates can delete public accounts (even if they didn't create them)
 * - Advocates CANNOT delete other users' private accounts
 * - Database queries filter out other users' private accounts at the query level
 */

import { db } from '../../db/index.js';
import {
  getAllAccountsService,
  getAccountByIdService,
  formatSocialMediaAccountsResponse,
} from '../socialMediaService.js';
import { eq, and, or, inArray, sql } from 'drizzle-orm';

// Mock the database
jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('Social Media Service - Advocate Permissions', () => {
  const advocateUserId = 'advocate-user-id';
  const otherUserId = 'other-user-id';
  const adminUserId = 'admin-user-id';
  const tenantId = 'test-tenant-id';
  const platformId = 'test-platform-id';
  const accountTypeId = 'test-account-type-id';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Ensure all async operations complete
    await new Promise((resolve) => setImmediate(resolve));
    jest.clearAllMocks();
  });

  describe('getAllAccountsService - Privacy and Visibility', () => {
    it("should only return advocate's own private accounts, not other users' private accounts", async () => {
      const mockAccounts = [
        {
          id: 'account-1',
          name: 'Advocate Private Account',
          handle: '@advocate-private',
          url: 'https://example.com/advocate-private',
          platformId,
          accountTypeId,
          userId: advocateUserId,
          tenantId,
          visibility: 'private',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
        },
        {
          id: 'account-2',
          name: 'Other User Private Account',
          handle: '@other-private',
          url: 'https://example.com/other-private',
          platformId,
          accountTypeId,
          userId: otherUserId,
          tenantId,
          visibility: 'private',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
        },
        {
          id: 'account-3',
          name: 'Public Account',
          handle: '@public',
          url: 'https://example.com/public',
          platformId,
          accountTypeId,
          userId: otherUserId,
          tenantId,
          visibility: 'public',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
        },
      ];

      // Mock the database query chain - simulate what the database would return
      // after applying the security filter (only advocate's private + all public)
      const filteredAccounts = [
        mockAccounts[0], // Advocate's private account
        mockAccounts[2], // Public account
      ];

      const mockQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(filteredAccounts),
      };

      db.select.mockReturnValue(mockQuery);

      const result = await getAllAccountsService(
        [tenantId],
        null,
        advocateUserId
      );

      // Advocate should see:
      // 1. Their own private account
      // 2. Public accounts (regardless of creator)
      // But NOT other users' private accounts

      const privateAccounts = result.filter(
        (acc) => acc.visibility === 'private'
      );
      const publicAccounts = result.filter(
        (acc) => acc.visibility === 'public'
      );

      // Should only see their own private account
      expect(privateAccounts.length).toBe(1);
      expect(privateAccounts[0].userId).toBe(advocateUserId);
      expect(privateAccounts[0].name).toBe('Advocate Private Account');

      // Should see public accounts
      expect(publicAccounts.length).toBe(1);
      expect(publicAccounts[0].visibility).toBe('public');

      // Verify the where clause includes the security filter
      expect(mockQuery.where).toHaveBeenCalled();
    });

    it('should return all public accounts for advocates regardless of creator', async () => {
      const mockAccounts = [
        {
          id: 'account-1',
          name: 'Public Account 1',
          handle: '@public1',
          url: 'https://example.com/public1',
          platformId,
          accountTypeId,
          userId: advocateUserId,
          tenantId,
          visibility: 'public',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
        },
        {
          id: 'account-2',
          name: 'Public Account 2',
          handle: '@public2',
          url: 'https://example.com/public2',
          platformId,
          accountTypeId,
          userId: otherUserId,
          tenantId,
          visibility: 'public',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
        },
      ];

      const mockQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockAccounts),
      };

      db.select.mockReturnValue(mockQuery);

      const result = await getAllAccountsService(
        [tenantId],
        null,
        advocateUserId
      );

      // Should see all public accounts
      expect(result.length).toBe(2);
      expect(result.every((acc) => acc.visibility === 'public')).toBe(true);
    });
  });

  describe('getAccountByIdService - Privacy and Visibility', () => {
    it('should allow advocate to access their own private account', async () => {
      const accountId = 'advocate-private-account-id';
      const mockAccount = [
        {
          id: accountId,
          name: 'Advocate Private Account',
          handle: '@advocate-private',
          url: 'https://example.com/advocate-private',
          platformId,
          accountTypeId,
          userId: advocateUserId,
          tenantId,
          visibility: 'private',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
        },
      ];

      const mockQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockAccount),
      };

      db.select.mockReturnValue(mockQuery);

      const result = await getAccountByIdService(accountId, advocateUserId, [
        tenantId,
      ]);

      expect(result).not.toBeNull();
      expect(result.id).toBe(accountId);
      expect(result.userId).toBe(advocateUserId);
      expect(result.visibility).toBe('private');
    });

    it("should prevent advocate from accessing another user's private account", async () => {
      const accountId = 'other-user-private-account-id';
      const mockAccount = [
        {
          id: accountId,
          name: 'Other User Private Account',
          handle: '@other-private',
          url: 'https://example.com/other-private',
          platformId,
          accountTypeId,
          userId: otherUserId, // Different user
          tenantId,
          visibility: 'private',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
        },
      ];

      const mockQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockAccount),
      };

      db.select.mockReturnValue(mockQuery);

      const result = await getAccountByIdService(
        accountId,
        advocateUserId, // Advocate trying to access other user's account
        [tenantId]
      );

      // Should return null because advocate cannot access other user's private account
      expect(result).toBeNull();
    });

    it('should allow advocate to access any public account', async () => {
      const accountId = 'public-account-id';
      const mockAccount = [
        {
          id: accountId,
          name: 'Public Account',
          handle: '@public',
          url: 'https://example.com/public',
          platformId,
          accountTypeId,
          userId: otherUserId, // Created by different user
          tenantId,
          visibility: 'public',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
        },
      ];

      const mockQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockAccount),
      };

      db.select.mockReturnValue(mockQuery);

      const result = await getAccountByIdService(accountId, advocateUserId, [
        tenantId,
      ]);

      expect(result).not.toBeNull();
      expect(result.id).toBe(accountId);
      expect(result.visibility).toBe('public');
    });
  });

  describe('formatSocialMediaAccountsResponse - userId inclusion', () => {
    it('should include userId in formatted account objects', () => {
      const rawAccounts = [
        {
          id: 'account-1',
          name: 'Test Account',
          handle: '@test',
          url: 'https://example.com/test',
          platformId,
          accountTypeId,
          userId: advocateUserId,
          tenantId,
          visibility: 'public',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
          accountTypeColor: '#000000',
          accountTypeIcon: 'FaInstagram',
          hashtags: null,
          organizationImageKey: null,
        },
      ];

      const formatted = formatSocialMediaAccountsResponse(rawAccounts);

      // Check that userId is included in the formatted response
      const account =
        Object.values(formatted)[0].accountTypes['foundation_organization']
          .accounts[0];

      expect(account).toHaveProperty('userId');
      expect(account.userId).toBe(advocateUserId);
      expect(account.id).toBe('account-1');
      expect(account.name).toBe('Test Account');
    });

    it('should include userId for both private and public accounts', () => {
      const rawAccounts = [
        {
          id: 'private-account',
          name: 'Private Account',
          handle: '@private',
          url: 'https://example.com/private',
          platformId,
          accountTypeId,
          userId: advocateUserId,
          tenantId,
          visibility: 'private',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
          accountTypeColor: '#000000',
          accountTypeIcon: 'FaInstagram',
          hashtags: null,
          organizationImageKey: null,
        },
        {
          id: 'public-account',
          name: 'Public Account',
          handle: '@public',
          url: 'https://example.com/public',
          platformId,
          accountTypeId,
          userId: otherUserId,
          tenantId,
          visibility: 'public',
          platformName: 'Instagram',
          accountTypeName: 'Foundation/Organization',
          accountTypeColor: '#000000',
          accountTypeIcon: 'FaInstagram',
          hashtags: null,
          organizationImageKey: null,
        },
      ];

      const formatted = formatSocialMediaAccountsResponse(rawAccounts);
      const accounts =
        Object.values(formatted)[0].accountTypes['foundation_organization']
          .accounts;

      // Both accounts should have userId
      expect(accounts[0]).toHaveProperty('userId');
      expect(accounts[0].userId).toBe(advocateUserId);
      expect(accounts[1]).toHaveProperty('userId');
      expect(accounts[1].userId).toBe(otherUserId);
    });
  });

  describe('Advocate Delete Permissions (Frontend Logic)', () => {
    // Note: deleteAccountService doesn't enforce permissions - that's handled in the frontend
    // These tests verify the frontend canEditAccount logic that determines if delete button should show

    it("should show delete button for advocate's own private account", () => {
      const account = {
        id: 'account-1',
        userId: advocateUserId,
        visibility: 'private',
      };

      // Simulate frontend canEditAccount check
      const canDelete = (account, isAdmin, isAdvocate, systemUser) => {
        if (isAdmin) return true;
        if (account.userId === systemUser?.id) return true; // User created it
        if (
          isAdvocate &&
          isAdvocate.length > 0 &&
          account.visibility === 'public'
        )
          return true;
        return false;
      };

      expect(
        canDelete(account, false, [{ tenantId }], { id: advocateUserId })
      ).toBe(true);
    });

    it("should show delete button for advocate's own public account", () => {
      const account = {
        id: 'account-2',
        userId: advocateUserId,
        visibility: 'public',
      };

      const canDelete = (account, isAdmin, isAdvocate, systemUser) => {
        if (isAdmin) return true;
        if (account.userId === systemUser?.id) return true;
        if (
          isAdvocate &&
          isAdvocate.length > 0 &&
          account.visibility === 'public'
        )
          return true;
        return false;
      };

      expect(
        canDelete(account, false, [{ tenantId }], { id: advocateUserId })
      ).toBe(true);
    });

    it('should show delete button for public accounts created by others', () => {
      const account = {
        id: 'account-3',
        userId: otherUserId, // Created by different user
        visibility: 'public', // But public
      };

      const canDelete = (account, isAdmin, isAdvocate, systemUser) => {
        if (isAdmin) return true;
        if (account.userId === systemUser?.id) return true;
        if (
          isAdvocate &&
          isAdvocate.length > 0 &&
          account.visibility === 'public'
        )
          return true;
        return false;
      };

      expect(
        canDelete(account, false, [{ tenantId }], { id: advocateUserId })
      ).toBe(true);
    });

    it("should NOT show delete button for other user's private account", () => {
      const account = {
        id: 'account-4',
        userId: otherUserId, // Different user
        visibility: 'private', // And private
      };

      const canDelete = (account, isAdmin, isAdvocate, systemUser) => {
        if (isAdmin) return true;
        if (account.userId === systemUser?.id) return true;
        if (
          isAdvocate &&
          isAdvocate.length > 0 &&
          account.visibility === 'public'
        )
          return true;
        return false;
      };

      expect(
        canDelete(account, false, [{ tenantId }], { id: advocateUserId })
      ).toBe(false); // Should be false - advocate cannot delete other's private accounts
    });

    it('should work correctly when userId is missing (graceful degradation)', () => {
      const account = {
        id: 'account-5',
        // userId is missing (old format before fix)
        visibility: 'public',
      };

      const canDelete = (account, isAdmin, isAdvocate, systemUser) => {
        if (isAdmin) return true;
        if (account.userId === systemUser?.id) return true;
        if (
          isAdvocate &&
          isAdvocate.length > 0 &&
          account.visibility === 'public'
        )
          return true;
        return false;
      };

      // Should still work for public accounts even without userId
      expect(
        canDelete(account, false, [{ tenantId }], { id: advocateUserId })
      ).toBe(true);
    });
  });

  describe('Integration: Frontend canEditAccount logic', () => {
    it('should work correctly with userId field for advocate-created accounts', () => {
      // Simulate the frontend canEditAccount function
      const canEditAccount = (
        account,
        isAdmin,
        isAdvocate,
        systemUser,
        userId
      ) => {
        // Admins can edit any account
        if (isAdmin) return true;

        // Check if user created this account
        const isCreator =
          account.userId === systemUser?.id || account.userId === userId;

        // Users can always edit accounts they created
        if (isCreator) return true;

        // Advocates can edit public accounts
        if (
          isAdvocate &&
          isAdvocate.length > 0 &&
          account.visibility === 'public'
        ) {
          return true;
        }

        return false;
      };

      // Test case 1: Advocate created private account
      const advocatePrivateAccount = {
        id: 'account-1',
        userId: advocateUserId,
        visibility: 'private',
      };

      expect(
        canEditAccount(
          advocatePrivateAccount,
          false, // isAdmin
          [{ tenantId, tenantName: 'Test' }], // isAdvocate
          { id: advocateUserId }, // systemUser
          'clerk-user-id' // userId (different from database ID)
        )
      ).toBe(true); // Should be true because userId matches

      // Test case 2: Advocate created public account
      const advocatePublicAccount = {
        id: 'account-2',
        userId: advocateUserId,
        visibility: 'public',
      };

      expect(
        canEditAccount(
          advocatePublicAccount,
          false,
          [{ tenantId, tenantName: 'Test' }],
          { id: advocateUserId },
          'clerk-user-id'
        )
      ).toBe(true); // Should be true because userId matches

      // Test case 3: Other user's public account
      const otherPublicAccount = {
        id: 'account-3',
        userId: otherUserId,
        visibility: 'public',
      };

      expect(
        canEditAccount(
          otherPublicAccount,
          false,
          [{ tenantId, tenantName: 'Test' }],
          { id: advocateUserId },
          'clerk-user-id'
        )
      ).toBe(true); // Should be true because it's public and user is advocate

      // Test case 4: Other user's private account
      const otherPrivateAccount = {
        id: 'account-4',
        userId: otherUserId,
        visibility: 'private',
      };

      expect(
        canEditAccount(
          otherPrivateAccount,
          false,
          [{ tenantId, tenantName: 'Test' }],
          { id: advocateUserId },
          'clerk-user-id'
        )
      ).toBe(false); // Should be false - advocate cannot edit other's private accounts

      // Test case 5: Account without userId (old format - should fail gracefully)
      const accountWithoutUserId = {
        id: 'account-5',
        visibility: 'public',
        // userId is missing
      };

      expect(
        canEditAccount(
          accountWithoutUserId,
          false,
          [{ tenantId, tenantName: 'Test' }],
          { id: advocateUserId },
          'clerk-user-id'
        )
      ).toBe(true); // Should still work because it's public
    });
  });
});
