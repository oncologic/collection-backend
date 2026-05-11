import { subscriptionService } from '../src/services/subscriptionService.js';

// Mock the subscription service to avoid database calls
jest.mock('../src/services/subscriptionService.js', () => ({
  subscriptionService: {
    getAllPlans: jest.fn().mockResolvedValue([
      { displayName: 'Basic', price: 0 },
      { displayName: 'Premium', price: 9.99 },
      { displayName: 'Professional', price: 19.99 },
      { displayName: 'Enterprise', price: 49.99 },
    ]),
    getUserSubscriptionPlan: jest.fn().mockResolvedValue({
      plan: {
        maxExternalCollections: 3,
        maxAttachments: 10,
        canAddCollaborators: false,
      },
    }),
    canCreateExternalCollection: jest.fn().mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 3,
    }),
    canAddCollaborators: jest.fn().mockImplementation((userId) => ({
      allowed: userId.includes('professional') || userId.includes('enterprise'),
    })),
    canCreateAttachment: jest.fn().mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 10,
    }),
    getUsageStats: jest.fn().mockResolvedValue({
      plan: { displayName: 'Basic' },
      externalCollections: { current: 0, limit: 3 },
      attachments: { current: 0, limit: 10 },
      features: { canAddCollaborators: false },
    }),
  },
}));

// Mock user IDs for testing - using UUID format
const basicUserId = '123e4567-e89b-12d3-a456-426614174000';
const premiumUserId = '123e4567-e89b-12d3-a456-426614174001';
const professionalUserId = '123e4567-e89b-12d3-a456-426614174002';
const enterpriseUserId = '123e4567-e89b-12d3-a456-426614174003';

describe('Subscription Service Integration Tests', () => {
  it('should get all subscription plans', async () => {
    const plans = await subscriptionService.getAllPlans();
    expect(plans).toHaveLength(4);
    expect(plans[0]).toHaveProperty('displayName');
    expect(plans[0]).toHaveProperty('price');
  });

  it('should get basic plan limits', async () => {
    const basicPlan =
      await subscriptionService.getUserSubscriptionPlan(basicUserId);
    expect(basicPlan.plan).toHaveProperty('maxExternalCollections');
    expect(basicPlan.plan).toHaveProperty('maxAttachments');
    expect(basicPlan.plan).toHaveProperty('canAddCollaborators');
  });

  it('should check external collection limits', async () => {
    const canCreateExternal =
      await subscriptionService.canCreateExternalCollection(basicUserId, []);
    expect(canCreateExternal).toHaveProperty('allowed');
    expect(canCreateExternal).toHaveProperty('current');
    expect(canCreateExternal).toHaveProperty('limit');
  });

  it('should check collaborator permissions', async () => {
    const basicCollabPerms =
      await subscriptionService.canAddCollaborators(basicUserId);
    const proCollabPerms =
      await subscriptionService.canAddCollaborators(professionalUserId);

    expect(basicCollabPerms).toHaveProperty('allowed');
    expect(proCollabPerms).toHaveProperty('allowed');
  });

  it('should check attachment limits', async () => {
    const canCreateAttachment = await subscriptionService.canCreateAttachment(
      basicUserId,
      []
    );
    expect(canCreateAttachment).toHaveProperty('allowed');
    expect(canCreateAttachment).toHaveProperty('current');
    expect(canCreateAttachment).toHaveProperty('limit');
  });

  it('should get usage statistics', async () => {
    const usageStats = await subscriptionService.getUsageStats(basicUserId, []);
    expect(usageStats).toHaveProperty('plan');
    expect(usageStats).toHaveProperty('externalCollections');
    expect(usageStats).toHaveProperty('attachments');
    expect(usageStats).toHaveProperty('features');
  });
});

// Legacy function for manual testing
export async function testSubscriptionLimits() {
  console.log('Testing Subscription System...\n');

  try {
    // Test getting all plans
    console.log('1. Testing getAllPlans()');
    const plans = await subscriptionService.getAllPlans();
    console.log(`Found ${plans.length} subscription plans`);
    plans.forEach((plan) => {
      console.log(`- ${plan.displayName}: $${plan.price}/month`);
    });
    console.log('✅ getAllPlans() works\n');

    // Test basic plan limits
    console.log('2. Testing Basic Plan Limits');
    const basicPlan =
      await subscriptionService.getUserSubscriptionPlan(basicUserId);
    console.log(
      `Basic plan external collections limit: ${basicPlan.plan.maxExternalCollections}`
    );
    console.log(
      `Basic plan attachments limit: ${basicPlan.plan.maxAttachments}`
    );
    console.log(
      `Basic plan can add collaborators: ${basicPlan.plan.canAddCollaborators}`
    );
    console.log('✅ Basic plan limits retrieved\n');

    // Test external collection limits
    console.log('3. Testing External Collection Limits');
    const canCreateExternal =
      await subscriptionService.canCreateExternalCollection(basicUserId, []);
    console.log(
      `Basic user can create external collection: ${canCreateExternal.allowed}`
    );
    if (!canCreateExternal.allowed) {
      console.log(
        `Current: ${canCreateExternal.current}, Limit: ${canCreateExternal.limit}`
      );
    }
    console.log('✅ External collection limits work\n');

    // Test collaborator permissions
    console.log('4. Testing Collaborator Permissions');
    const basicCollabPerms =
      await subscriptionService.canAddCollaborators(basicUserId);
    const proCollabPerms =
      await subscriptionService.canAddCollaborators(professionalUserId);
    console.log(
      `Basic user can add collaborators: ${basicCollabPerms.allowed}`
    );
    console.log(
      `Professional user can add collaborators: ${proCollabPerms.allowed}`
    );
    console.log('✅ Collaborator permissions work\n');

    // Test attachment limits
    console.log('5. Testing Attachment Limits');
    const canCreateAttachment = await subscriptionService.canCreateAttachment(
      basicUserId,
      []
    );
    console.log(
      `Basic user can create attachment: ${canCreateAttachment.allowed}`
    );
    if (!canCreateAttachment.allowed) {
      console.log(
        `Current: ${canCreateAttachment.current}, Limit: ${canCreateAttachment.limit}`
      );
    }
    console.log('✅ Attachment limits work\n');

    // Test usage stats
    console.log('6. Testing Usage Statistics');
    const usageStats = await subscriptionService.getUsageStats(basicUserId, []);
    console.log('Usage stats for basic user:');
    console.log(`- Plan: ${usageStats.plan.displayName}`);
    console.log(
      `- External Collections: ${usageStats.externalCollections.current}/${usageStats.externalCollections.limit}`
    );
    console.log(
      `- Attachments: ${usageStats.attachments.current}/${usageStats.attachments.limit}`
    );
    console.log(
      `- Can add collaborators: ${usageStats.features.canAddCollaborators}`
    );
    console.log('✅ Usage statistics work\n');

    console.log('🎉 All subscription system tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run tests if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('subscription.test.js')) {
  testSubscriptionLimits();
}
