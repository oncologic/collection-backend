import { Webhook } from 'svix';

export const verifyClerkWebhook = (req, res, next) => {
  try {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
      throw new Error(
        'Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env'
      );
    }

    // Get the headers
    const svix_id = req.headers['svix-id'];
    const svix_timestamp = req.headers['svix-timestamp'];
    const svix_signature = req.headers['svix-signature'];

    // If there are no headers, error out
    if (!svix_id || !svix_timestamp || !svix_signature) {
      return res.status(400).json({
        error: 'Error occured -- no svix headers',
      });
    }

    // Get the body
    const payload = req.body;
    const body = JSON.stringify(payload);

    // Create a new Svix instance with your secret.
    const wh = new Webhook(WEBHOOK_SECRET);

    let evt;

    // Verify the payload with the headers
    try {
      evt = wh.verify(body, {
        'svix-id': svix_id,
        'svix-timestamp': svix_timestamp,
        'svix-signature': svix_signature,
      });
    } catch (err) {
      console.error('Error verifying webhook:', err);
      return res.status(400).json({
        error: 'Error occured',
      });
    }

    // Add the verified event to the request
    req.webhookEvent = evt;
    next();
  } catch (error) {
    console.error('Error in webhook verification:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};
