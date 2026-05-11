import { stripe } from '../src/services/stripe.js';
import { db } from '../src/db/index.js';
import { users } from '../src/models/users.js';
import { eq } from 'drizzle-orm';

async function cleanupDuplicatesForUser(email) {
  console.log(`🔍 Looking up user: ${email}`);

  // Find user by email
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user[0]) {
    console.error('❌ User not found');
    return;
  }

  if (!user[0].stripeCustomerId) {
    console.error('❌ User has no Stripe customer ID');
    return;
  }

  // Get all subscriptions for this customer
  const subscriptions = await stripe.subscriptions.list({
    customer: user[0].stripeCustomerId,
    status: 'all',
  });

  const activeSubscriptions = subscriptions.data.filter(
    (sub) => sub.status === 'active' || sub.status === 'trialing'
  );

  // Show all active subscriptions

  activeSubscriptions.forEach((sub, index) => {
    const plan = sub.items.data[0]?.price?.nickname || 'Unknown plan';
    const amount = sub.items.data[0]?.price?.unit_amount / 100 || 0;
  });

  // Keep the most recent subscription, cancel the rest
  const sortedSubscriptions = activeSubscriptions.sort(
    (a, b) => b.created - a.created
  );
  const subscriptionToKeep = sortedSubscriptions[0];
  const subscriptionsToCancel = sortedSubscriptions.slice(1);

  // Cancel duplicate subscriptions
  for (const subscription of subscriptionsToCancel) {
    try {
      await stripe.subscriptions.cancel(subscription.id);
    } catch (error) {
      console.error(`❌ Failed to cancel ${subscription.id}:`, error.message);
    }
  }

  // Update user record with the kept subscription
  const planName = subscriptionToKeep.metadata?.planName || 'professional'; // fallback
  await db
    .update(users)
    .set({
      stripeSubscriptionId: subscriptionToKeep.id,
      subscriptionPlan: planName,
      subscriptionStatus: 'active',
      updatedAt: new Date(),
    })
    .where(eq(users.id, user[0].id));


// Get email from command line arguments
const email = process.argv[2];

if (!email) {
 
  process.exit(1);
}

cleanupDuplicatesForUser(email)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
