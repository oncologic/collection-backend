import {
  sendSponsorshipInquiryEmail,
  sendPurchaseReceiptEmail,
} from '../services/emailService.js';

export const handleSponsorshipInquiry = async (req, res) => {
  try {
    const formData = req.body;
    await sendSponsorshipInquiryEmail(formData);
    res.status(200).json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error in handleSponsorshipInquiry:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
};

/**
 * Handles sending receipt emails for credit purchases
 *
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body containing user and purchase data
 * @param {Object} req.body.userData - User data
 * @param {Object} req.body.purchaseData - Purchase data
 * @param {Object} res - Express response object
 */
export const handlePurchaseReceipt = async (req, res) => {
  try {
    const { userData, purchaseData } = req.body;

    if (!userData || !purchaseData) {
      return res.status(400).json({
        error:
          'Missing required data. Both userData and purchaseData are required.',
      });
    }

    await sendPurchaseReceiptEmail(userData, purchaseData);
    res.status(200).json({ message: 'Receipt email sent successfully' });
  } catch (error) {
    console.error('Error in handlePurchaseReceipt:', error);
    res.status(500).json({ error: 'Failed to send receipt email' });
  }
};
