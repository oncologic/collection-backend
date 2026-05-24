import { sendSponsorshipInquiryEmail } from '../services/emailService.js';

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
