import express from 'express';
import { smsController } from '../controllers/smsController.js';

const router = express.Router();

// Twilio webhook endpoint for incoming SMS messages
router.post('/incoming', async (req, res) => {
  try {
    console.log('🔔 SMS Webhook Hit!');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    
    // Set header to bypass ngrok warning
    res.setHeader('ngrok-skip-browser-warning', 'true');
    
    await smsController.handleIncomingSMS(req, res);
  } catch (error) {
    console.error('SMS Route Error:', error);
    // Send error response in TwiML format
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, an error occurred processing your message.</Message>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
  }
});

// Health check endpoint for Twilio
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'sms' });
});

// Test endpoint that just returns TwiML
router.post('/test', (req, res) => {
  console.log('TEST endpoint hit!', req.body);
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Test successful! Got: ${req.body.Body || 'no message'}</Message>
</Response>`);
});

export default router;
