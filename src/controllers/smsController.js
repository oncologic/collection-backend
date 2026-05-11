import { handleIncomingSMSService } from '../services/smsService.js';
import twilio from 'twilio';

// Twilio webhook signature validation
const validateTwilioRequest = (req) => {
  const twilioSignature = req.headers['x-twilio-signature'];
  const url = `${process.env.BASE_URL}/api/sms/incoming`;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!authToken || !twilioSignature) {
    return false;
  }
  
  return twilio.validateRequest(
    authToken,
    twilioSignature,
    url,
    req.body
  );
};

export const smsController = {
  handleIncomingSMS: async (req, res) => {
    try {
      console.log('🎯 In SMS Controller!');
      
      // Skip validation for testing
      // if (process.env.NODE_ENV === 'production' && !validateTwilioRequest(req)) {
      //   return res.status(403).json({ error: 'Invalid request signature' });
      // }

      const { From, Body, AccountSid } = req.body;
      console.log('SMS Details:', { From, Body, AccountSid });
      
      // Validate required fields
      if (!From || !Body) {
        console.error('Missing fields:', { From, Body });
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('Error: Missing required fields');
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(twiml.toString());
      }

      // For testing, let's just echo back
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(`Got your message: "${Body}". Processing...`);
      
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml.toString());
      
      // Process in background (don't await)
      handleIncomingSMSService({
        phoneNumber: From,
        message: Body,
        accountSid: AccountSid
      }).catch(error => {
        console.error('Background processing error:', error);
      });
    } catch (error) {
      console.error('Error handling incoming SMS:', error);
      
      // Send error response to user
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Sorry, we encountered an error processing your message. Please try again later.');
      
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml.toString());
    }
  }
};