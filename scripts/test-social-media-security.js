#!/usr/bin/env node

/**
 * Security Test Script for Social Media Accounts
 * Tests the visibility and access control implementation
 */

import { db } from '../src/db/index.js';
import { eq, and } from 'drizzle-orm';
import { socialMediaAccounts } from '../src/models/socialMedia.js';
import { users } from '../src/models/users.js';
import {
  getAllAccountsService,
  getAccountByIdService,
  createAccountService,
  updateAccountService,
} from '../src/services/socialMediaService.js';

// Test data
const testUserId1 = 'test-user-1';
const testUserId2 = 'test-user-2';
const testTenantId = 'test-tenant';
const testPlatformId = 'test-platform';
const testAccountTypeId = 'test-account-type';

async function runSecurityTests() {
  console.log('🔒 Starting Social Media Security Tests...\n');

  try {
    // Test 1: Non-admin cannot create public accounts
    console.log('Test 1: Non-admin cannot create public accounts');
    try {
      await createAccountService({
        name: 'Test Public Account',
        handle: '@test',
        url: 'https://example.com/test',
        platformId: testPlatformId,
        accountTypeId: testAccountTypeId,
        userId: testUserId1,
        tenantId: testTenantId,
        visibility: 'public'
      }, false); // isAdmin = false
      console.log('❌ FAILED: Non-admin was able to create public account');
    } catch (error) {
      if (error.message.includes('Only administrators can create public')) {
        console.log('✅ PASSED: Non-admin blocked from creating public account');
      } else {
        console.log('❌ FAILED: Wrong error message:', error.message);
      }
    }

    // Test 2: Admin can create public accounts
    console.log('\nTest 2: Admin can create public accounts');
    try {
      const publicAccount = await createAccountService({
        name: 'Admin Public Account',
        handle: '@admin-public',
        url: 'https://example.com/admin-public',
        platformId: testPlatformId,
        accountTypeId: testAccountTypeId,
        userId: testUserId1,
        tenantId: testTenantId,
        visibility: 'public'
      }, true); // isAdmin = true
      console.log('✅ PASSED: Admin created public account');
    } catch (error) {
      console.log('❌ FAILED: Admin could not create public account:', error.message);
    }

    // Test 3: User can only see their own private accounts
    console.log('\nTest 3: User can only see their own private accounts');
    
    // Create private account for user1
    const privateAccount1 = await createAccountService({
      name: 'User1 Private Account',
      handle: '@user1-private',
      url: 'https://example.com/user1-private',
      platformId: testPlatformId,
      accountTypeId: testAccountTypeId,
      userId: testUserId1,
      tenantId: testTenantId,
      visibility: 'private'
    }, false);

    // Create private account for user2
    const privateAccount2 = await createAccountService({
      name: 'User2 Private Account',
      handle: '@user2-private',
      url: 'https://example.com/user2-private',
      platformId: testPlatformId,
      accountTypeId: testAccountTypeId,
      userId: testUserId2,
      tenantId: testTenantId,
      visibility: 'private'
    }, false);

    // User1 should only see their own private account
    const user1Accounts = await getAllAccountsService([testTenantId], null, testUserId1);
    const user1PrivateAccounts = user1Accounts.filter(a => a.visibility === 'private');
    
    if (user1PrivateAccounts.length === 1 && user1PrivateAccounts[0].userId === testUserId1) {
      console.log('✅ PASSED: User1 can only see their own private accounts');
    } else {
      console.log('❌ FAILED: User1 can see other users\' private accounts');
    }

    // Test 4: getAccountByIdService respects visibility
    console.log('\nTest 4: getAccountByIdService respects visibility');
    
    // User2 trying to access User1's private account
    const unauthorizedAccess = await getAccountByIdService(
      privateAccount1.id, 
      testUserId2, 
      [testTenantId]
    );
    
    if (unauthorizedAccess === null) {
      console.log('✅ PASSED: User2 cannot access User1\'s private account');
    } else {
      console.log('❌ FAILED: User2 can access User1\'s private account');
    }

    // User1 accessing their own private account
    const authorizedAccess = await getAccountByIdService(
      privateAccount1.id, 
      testUserId1, 
      [testTenantId]
    );
    
    if (authorizedAccess !== null) {
      console.log('✅ PASSED: User1 can access their own private account');
    } else {
      console.log('❌ FAILED: User1 cannot access their own private account');
    }

    // Test 5: Non-admin cannot update account to public
    console.log('\nTest 5: Non-admin cannot update account to public');
    try {
      await updateAccountService(
        privateAccount1.id,
        { visibility: 'public' },
        testUserId1,
        false, // isAdmin = false
        [testTenantId]
      );
      console.log('❌ FAILED: Non-admin was able to change account to public');
    } catch (error) {
      if (error.message.includes('Only administrators can set account visibility to public')) {
        console.log('✅ PASSED: Non-admin blocked from changing account to public');
      } else {
        console.log('❌ FAILED: Wrong error message:', error.message);
      }
    }

    // Test 6: User cannot update another user's account
    console.log('\nTest 6: User cannot update another user\'s account');
    try {
      await updateAccountService(
        privateAccount2.id,
        { name: 'Hacked Account' },
        testUserId1,
        false,
        [testTenantId]
      );
      console.log('❌ FAILED: User1 was able to update User2\'s account');
    } catch (error) {
      if (error.message.includes('Unauthorized')) {
        console.log('✅ PASSED: User1 blocked from updating User2\'s account');
      } else {
        console.log('❌ FAILED: Wrong error message:', error.message);
      }
    }

    console.log('\n🎉 Security tests completed!');

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  }
}

// Run the tests
runSecurityTests().then(() => {
  console.log('\nTests finished. Please review the results above.');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});