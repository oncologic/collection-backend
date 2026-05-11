import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendSponsorshipInquiryEmail = async (formData) => {
  const {
    email,
    eventId,
    itemDescription,
    itemQuantity,
    name,
    notes,
    phone,
    submittedAt,
    tierId,
    tierName,
    eventName,
    tierPrice,
    company,
  } = formData;

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
          }
          .container {
            padding: 2rem;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
            color: white;
            padding: 2rem;
            border-radius: 8px 8px 0 0;
            margin: -2rem -2rem 2rem -2rem;
          }
          .section {
            margin-bottom: 1.5rem;
            padding: 1.5rem;
            background: #f8f9fa;
            border-radius: 6px;
          }
          .label {
            font-weight: bold;
            color: #0039cb;
            text-transform: uppercase;
            font-size: 0.8rem;
            letter-spacing: 0.5px;
          }
          .value {
            margin-top: 0.5rem;
            font-size: 1.1rem;
          }
          .price {
            font-size: 1.5rem;
            color: #0062ff;
            font-weight: bold;
          }
          .footer {
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 2px solid #eee;
            font-size: 0.9rem;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">New Sponsorship Inquiry</h1>
            <p style="margin: 0.5rem 0 0 0;">Submitted ${new Date(
              submittedAt
            ).toLocaleString()}</p>
          </div>

          <div class="section">
            <div class="label">Sponsor Information</div>
            <div class="value">
              <strong>${name}</strong><br>
              <strong>Company:</strong> ${company}<br>
              ${email}<br>
              ${phone}
            </div>
          </div>

          <div class="section">
            <div class="label">Package Details</div>
            <div class="value">
              <strong>Tier:</strong> ${tierName}<br>
              <strong>Price:</strong> <span class="price">$${parseFloat(
                tierPrice
              ).toLocaleString()}</span><br>
              <strong>Event Name:</strong> ${eventName}<br>
              <strong>Event ID:</strong> ${eventId}<br>
              <strong>Tier ID:</strong> ${tierId}
            </div>
          </div>

          ${
            itemDescription || notes
              ? `
          <div class="section">
            <div class="label">Additional Information</div>
            <div class="value">
              ${
                itemDescription
                  ? `<strong>Item Description:</strong> ${itemDescription}<br>`
                  : ''
              }
              ${
                itemQuantity
                  ? `<strong>Quantity:</strong> ${itemQuantity}<br>`
                  : ''
              }
              ${notes ? `<strong>Notes:</strong> ${notes}` : ''}
            </div>
          </div>
          `
              : ''
          }

          <div class="footer">
            <p>This is an automated message from your sponsorship management system. Please respond to the sponsor within 24 hours.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: process.env.ADMIN_EMAIL,
      subject: `New Sponsorship Inquiry - ${name}`,
      html: emailHtml,
    });
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

export const sendSubscriptionNotificationEmail = async (
  userData,
  organizationData
) => {
  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
          }
          .container {
            padding: 2rem;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
            color: white;
            padding: 2rem;
            border-radius: 8px 8px 0 0;
            margin: -2rem -2rem 2rem -2rem;
          }
          .section {
            margin-bottom: 1.5rem;
            padding: 1.5rem;
            background: #f8f9fa;
            border-radius: 6px;
          }
          .label {
            font-weight: bold;
            color: #0039cb;
            text-transform: uppercase;
            font-size: 0.8rem;
            letter-spacing: 0.5px;
          }
          .value {
            margin-top: 0.5rem;
            font-size: 1.1rem;
          }
          .footer {
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 2px solid #eee;
            font-size: 0.9rem;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">New Organization Subscriber</h1>
            <p style="margin: 0.5rem 0 0 0;">Subscribed ${new Date().toLocaleString()}</p>
          </div>

          <div class="section">
            <div class="label">Subscriber Information</div>
            <div class="value">
              <strong>${userData.firstName} ${userData.lastName}</strong><br>
              ${userData.email}
            </div>
          </div>

          <div class="section">
            <div class="label">Organization Details</div>
            <div class="value">
              <strong>Name:</strong> ${organizationData.name}<br>
              <strong>Description:</strong> ${
                organizationData.description || 'N/A'
              }<br>
              ${
                organizationData.tags?.length
                  ? `<strong>Tags:</strong> ${organizationData.tags
                      .map((tag) => tag.name)
                      .join(', ')}<br>`
                  : ''
              }
            </div>
          </div>

          <div class="footer">
            <p>This is an automated notification from your organization management system.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: process.env.ADMIN_EMAIL,
      subject: `New Subscriber - ${organizationData.name}`,
      html: emailHtml,
    });
    return true;
  } catch (error) {
    console.error('Error sending subscription notification email:', error);
    throw error;
  }
};

/**
 * Sends a receipt email to a user after they purchase credits
 *
 * @param {Object} userData - User data including email, firstName, lastName
 * @param {Object} purchaseData - Details about the purchase
 * @param {string} purchaseData.packageId - ID of the purchased package
 * @param {number} purchaseData.credits - Number of credits purchased
 * @param {number} purchaseData.amount - Amount paid in cents
 * @param {string} purchaseData.transactionId - ID of the transaction
 * @param {string} purchaseData.paymentStatus - Status of the payment
 * @returns {Promise<boolean>} - True if email was sent successfully
 */
export const sendPurchaseReceiptEmail = async (userData, purchaseData) => {
  try {
    // Validate required data
    if (!userData || !userData.email) {
      throw new Error('Missing or invalid userData. Email is required.');
    }

    if (!purchaseData || !purchaseData.transactionId) {
      throw new Error(
        'Missing or invalid purchaseData. TransactionId is required.'
      );
    }

    const { email, firstName = 'Valued', lastName = 'Customer' } = userData;

    const {
      packageId = 'unknown',
      credits = 0,
      amount = 0,
      transactionId,
      paymentStatus = 'completed',
    } = purchaseData;

    const amountInDollars = (amount / 100).toFixed(2);
    const timestamp = new Date().toLocaleString();
    const receiptNumber = `REC-${transactionId.slice(-8).toUpperCase()}`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
            }
            .container {
              padding: 2rem;
              background: #ffffff;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
              color: white;
              padding: 2rem;
              border-radius: 8px 8px 0 0;
              margin: -2rem -2rem 2rem -2rem;
              text-align: center;
            }
            .section {
              margin-bottom: 1.5rem;
              padding: 1.5rem;
              background: #f8f9fa;
              border-radius: 6px;
            }
            .label {
              font-weight: bold;
              color: #0039cb;
              text-transform: uppercase;
              font-size: 0.8rem;
              letter-spacing: 0.5px;
            }
            .value {
              margin-top: 0.5rem;
              font-size: 1.1rem;
            }
            .price {
              font-size: 1.5rem;
              color: #0062ff;
              font-weight: bold;
            }
            .footer {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 2px solid #eee;
              font-size: 0.9rem;
              color: #666;
              text-align: center;
            }
            .thank-you {
              text-align: center;
              font-size: 1.2rem;
              margin: 2rem 0;
            }
            .receipt-number {
              text-align: right;
              font-size: 0.9rem;
              color: #666;
              margin-bottom: 1rem;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            th, td {
              padding: 0.75rem;
              text-align: left;
              border-bottom: 1px solid #eee;
            }
            th {
              background-color: #f1f5f9;
              font-weight: bold;
            }
            .total-row {
              font-weight: bold;
              background-color: #f1f5f9;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Purchase Receipt</h1>
              <p style="margin: 0.5rem 0 0 0;">${timestamp}</p>
            </div>
            
            <div class="receipt-number">
              Receipt #: ${receiptNumber}
            </div>

            <div class="section">
              <div class="label">Customer Information</div>
              <div class="value">
                <strong>${firstName} ${lastName}</strong><br>
                ${email}
              </div>
            </div>

            <div class="section">
              <div class="label">Purchase Details</div>
              <table>
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Credits</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>${packageId.charAt(0).toUpperCase() + packageId.slice(1)} Package</td>
                    <td>${credits}</td>
                    <td>$${amountInDollars}</td>
                  </tr>
                  <tr class="total-row">
                    <td colspan="2">Total</td>
                    <td>$${amountInDollars}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div class="section">
              <div class="label">Payment Information</div>
              <div class="value">
                <strong>Status:</strong> ${paymentStatus === 'succeeded' ? 'Paid' : paymentStatus}<br>
                <strong>Transaction ID:</strong> ${transactionId}<br>
                <strong>Payment Method:</strong> Credit Card
              </div>
            </div>

            <div class="thank-you">
              Thank you for your purchase!
            </div>

            <div class="footer">
              <p>If you have any questions about your purchase, please contact our support team.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY is not set. Email will not be sent.');

      // For development purposes, log the email content
      if (process.env.NODE_ENV === 'development') {
        console.log('Email HTML that would be sent:', emailHtml);
      }

      return false;
    }

    // Check if sender email is configured
    if (!process.env.RESEND_FROM_EMAIL) {
      console.warn('RESEND_FROM_EMAIL is not set. Using default.');
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@example.com';

    const response = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `Receipt for Your Credit Purchase`,
      html: emailHtml,
    });

    return true;
  } catch (error) {
    console.error('Error sending purchase receipt email:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
    });

    // Re-throw the error for the caller to handle
    throw error;
  }
};

/**
 * Sends an invitation email to a collaborator for an external link
 *
 * @param {Object} inviteData - Data about the invitation
 * @param {string} inviteData.inviteeEmail - Email of the person being invited
 * @param {string} inviteData.inviteeName - Name of the person being invited
 * @param {Object} inviteData.inviter - User object of the person sending the invitation
 * @param {Object} inviteData.externalLink - External link the user is invited to collaborate on
 * @param {Object} inviteData.collection - Collection containing the external link
 * @param {string} inviteData.message - Optional message from the inviter
 * @param {string} inviteData.role - Role assigned to the collaborator
 * @returns {Promise<boolean>} - True if email was sent successfully
 */
export const sendCollaborationInviteEmail = async (inviteData) => {
  try {
    const {
      inviteeEmail,
      inviteeName,
      inviter,
      externalLink,
      collection,
      tenant,
      message,
      role,
    } = inviteData;

    if (!inviteeEmail || !externalLink || !collection || !inviter) {
      throw new Error('Missing required invite data');
    }

    const inviterName =
      `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim();
    const appUrl = process.env.FRONTEND_URL;

    // Create link to the collection/external link via login redirect
    const collaborationUrl = `${appUrl}/external-links/${externalLink.id}`;
    const actionLink = `${appUrl}/login?redirect_url=${encodeURIComponent(collaborationUrl)}`;
    const actionText = 'Sign In & View Collaboration';
    const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
            }
            .container {
              padding: 2rem;
              background: #ffffff;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
              color: white;
              padding: 2rem;
              border-radius: 8px 8px 0 0;
              margin: -2rem -2rem 2rem -2rem;
              text-align: center;
            }
            .section {
              margin-bottom: 1.5rem;
              padding: 1.5rem;
              background: #f8f9fa;
              border-radius: 6px;
            }
            .button {
              display: inline-block;
              padding: 14px 28px;
              background: #4B9EFF;
              color: #ffffff;
              text-decoration: none;
              border-radius: 6px;
              font-weight: bold;
              font-size: 16px;
              margin: 0.5rem 0.5rem 0.5rem 0;
              text-align: center;
              border: 2px solid #4B9EFF;
              box-shadow: 0 2px 4px rgba(75, 158, 255, 0.3);
              transition: all 0.3s ease;
            }
            .button:hover {
              background: #3a8aef;
              border-color: #3a8aef;
              box-shadow: 0 4px 8px rgba(75, 158, 255, 0.4);
            }
            .button-secondary {
              background: #ffffff;
              color: #495057;
              border: 2px solid #dee2e6;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }
            .button-secondary:hover {
              background: #f8f9fa;
              border-color: #adb5bd;
              color: #495057;
            }
            .message {
              font-style: italic;
              background: #f0f4f8;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #4B9EFF;
              margin: 1rem 0;
            }
            .tenant-info {
              background: #e8f4fd;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #0066cc;
              margin: 1rem 0;
            }
            .footer {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 2px solid #eee;
              font-size: 0.9rem;
              color: #666;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Collaboration Invitation</h1>
            </div>
            
            <div class="section">
              <h2>Hello${inviteeName ? ', ' + inviteeName : ''}!</h2>
              <p>${inviterName} has invited you to collaborate on "${externalLink.name}" as a <strong>${roleDisplay}</strong>.</p>
              
              ${
                message
                  ? `
              <div class="message">
                <p>"${message}"</p>
              </div>
              `
                  : ''
              }
              
              <p>This link is part of the collection "${collection.name}".</p>
              
              ${
                tenant?.name
                  ? `
              <div class="tenant-info">
                <p><strong>Organization:</strong> ${tenant.name}</p>
                <p><small>When creating your account, please select "${tenant.name}" as your organization to access this collaboration.</small></p>
              </div>
              `
                  : ''
              }
              
              <p>To access this collaboration, you'll need to sign in to your account first.</p>
              
              <div style="text-align: center; margin-top: 2rem;">
                <a href="${actionLink}" class="button">${actionText}</a>
              </div>
            </div>

            <div class="footer">
              <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY is not set. Email will not be sent.');
      // For development purposes, log the email content
      if (process.env.NODE_ENV === 'development') {
        console.log('Email HTML that would be sent:', emailHtml);
      }
      return false;
    }

    // Check if sender email is configured
    if (!process.env.RESEND_FROM_EMAIL) {
      console.warn('RESEND_FROM_EMAIL is not set. Using default.');
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    const response = await resend.emails.send({
      from: fromEmail,
      to: inviteeEmail,
      subject: `${inviterName} invited you to collaborate on "${externalLink.name}"`,
      html: emailHtml,
      reply_to: inviter.email,
    });

    return response;
  } catch (error) {
    console.error('Error sending collaboration invite email:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Sends a pending invitation email to someone who doesn't have an account yet
 *
 * @param {Object} inviteData - Data about the invitation
 * @param {string} inviteData.inviteeEmail - Email of the person being invited
 * @param {string} inviteData.inviteeName - Name of the person being invited
 * @param {Object} inviteData.inviter - User object of the person sending the invitation
 * @param {Object} inviteData.externalLink - External link the user is invited to collaborate on
 * @param {Object} inviteData.collection - Collection containing the external link
 * @param {string} inviteData.message - Optional message from the inviter
 * @param {string} inviteData.role - Role assigned to the collaborator
 * @param {string} inviteData.inviteToken - Unique token for accepting the invitation
 * @returns {Promise<boolean>} - True if email was sent successfully
 */
export const sendPendingInviteEmail = async (inviteData) => {
  try {
    const {
      inviteeEmail,
      inviteeName,
      inviter,
      externalLink,
      collection,
      tenant,
      message,
      role,
      inviteToken,
    } = inviteData;

    if (
      !inviteeEmail ||
      !externalLink ||
      !collection ||
      !inviter ||
      !inviteToken
    ) {
      throw new Error('Missing required invite data');
    }

    const inviterName =
      `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim();
    const appUrl = process.env.FRONTEND_URL || 'https://www.contexlia.com';

    // Create signup link with invitation token and redirect
    const collaborationUrl = `${appUrl}/external-links/${externalLink.id}`;
    const signupLink = `${appUrl}/invitations/accept?invite=${inviteToken}&redirect_url=${encodeURIComponent(collaborationUrl)}`;
    const loginLink = `${appUrl}/invitations/accept?invite=${inviteToken}&redirect_url=${encodeURIComponent(collaborationUrl)}`;
    const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
            }
            .container {
              padding: 2rem;
              background: #ffffff;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
              color: white;
              padding: 2rem;
              border-radius: 8px 8px 0 0;
              margin: -2rem -2rem 2rem -2rem;
              text-align: center;
            }
            .section {
              margin-bottom: 1.5rem;
              padding: 1.5rem;
              background: #f8f9fa;
              border-radius: 6px;
            }
            .button {
              display: inline-block;
              padding: 14px 28px;
              background: #4B9EFF;
              color: #ffffff;
              text-decoration: none;
              border-radius: 6px;
              font-weight: bold;
              font-size: 16px;
              margin: 0.5rem 0.5rem 0.5rem 0;
              text-align: center;
              border: 2px solid #4B9EFF;
              box-shadow: 0 2px 4px rgba(75, 158, 255, 0.3);
              transition: all 0.3s ease;
            }
            .button:hover {
              background: #3a8aef;
              border-color: #3a8aef;
              box-shadow: 0 4px 8px rgba(75, 158, 255, 0.4);
            }
            .button-secondary {
              background: #ffffff;
              color: #495057;
              border: 2px solid #dee2e6;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }
            .button-secondary:hover {
              background: #f8f9fa;
              border-color: #adb5bd;
              color: #495057;
            }
            .message {
              font-style: italic;
              background: #f0f4f8;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #4B9EFF;
              margin: 1rem 0;
            }
            .highlight {
              background: #fff3cd;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #ffc107;
              margin: 1rem 0;
            }
            .tenant-info {
              background: #e8f4fd;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #0066cc;
              margin: 1rem 0;
            }
            .footer {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 2px solid #eee;
              font-size: 0.9rem;
              color: #666;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">You're Invited to Collaborate!</h1>
            </div>
            
            <div class="section">
              <h2>Hello ${inviteeName}!</h2>
              <p>${inviterName} has invited you to collaborate on "${externalLink.name}" as a <strong>${roleDisplay}</strong>.</p>
              
              ${
                message
                  ? `
              <div class="message">
                <p>"${message}"</p>
              </div>
              `
                  : ''
              }
              
              <p>This link is part of the collection "${collection.name}".</p>
              
              ${
                tenant?.name
                  ? ` 
              <div class="highlight">
                <p><strong>To get started:</strong></p>
                 <p><strong>Tenant:</strong> ${tenant.name}</p>
                <p><strong>Important:</strong> When creating your account, please select "${tenant.name}" as your tenant to access this collaboration.</p>
                <p>You'll need to create an account or sign in to accept this invitation and start collaborating.</p>
              </div>
              
              <div style="text-align: center; margin-top: 2rem;">
                <a href="${signupLink}" class="button">Accept Invitation & Get Started</a>
              </div>
              
              <p style="margin-top: 1.5rem; font-size: 0.9rem; color: #666; text-align: center;">
                <strong>New to our platform?</strong> You'll be able to create an account during the invitation process.<br>
                <strong>Already have an account?</strong> You'll be prompted to sign in first.
              </p>
            </div>

            <div class="footer">
              <p>This invitation will expire in 7 days.</p>
              <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `
                  : ''
              }`;

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY is not set. Email will not be sent.');
      // For development purposes, log the email content
      if (process.env.NODE_ENV === 'development') {
        console.log('Pending invite email HTML that would be sent:', emailHtml);
      }
      return false;
    }

    // Check if sender email is configured
    if (!process.env.RESEND_FROM_EMAIL) {
      console.warn('RESEND_FROM_EMAIL is not set. Using default.');
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    const response = await resend.emails.send({
      from: fromEmail,
      to: inviteeEmail,
      subject: `${inviterName} invited you to collaborate on "${externalLink.name}"`,
      html: emailHtml,
      reply_to: inviter.email,
    });

    return true;
  } catch (error) {
    console.error('Error sending pending invite email:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Sends an invitation email to a collaborator for a collection
 *
 * @param {Object} inviteData - Data about the invitation
 * @param {string} inviteData.inviteeEmail - Email of the person being invited
 * @param {string} inviteData.inviteeName - Name of the person being invited
 * @param {Object} inviteData.inviter - User object of the person sending the invitation
 * @param {Object} inviteData.collection - Collection the user is invited to collaborate on
 * @param {Object} inviteData.tenant - Tenant information
 * @param {string} inviteData.message - Optional message from the inviter
 * @param {string} inviteData.role - Role assigned to the collaborator
 * @param {boolean} inviteData.cascadeToExternalLinks - Whether permissions will cascade to external links
 * @returns {Promise<boolean>} - True if email was sent successfully
 */
export const sendCollectionCollaborationInviteEmail = async (inviteData) => {
  try {
    const {
      inviteeEmail,
      inviteeName,
      inviter,
      collection,
      tenant,
      message,
      role,
      cascadeToExternalLinks,
    } = inviteData;

    if (!inviteeEmail || !collection || !inviter) {
      throw new Error('Missing required invite data');
    }

    const inviterName =
      `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim();
    const appUrl = process.env.FRONTEND_URL;

    // Create link to the collection via login redirect
    const collaborationUrl = `${appUrl}/collections/${collection.id}`;
    const actionLink = `${appUrl}/login?redirect_url=${encodeURIComponent(collaborationUrl)}`;
    const actionText = 'Sign In & View Collection';
    const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
            }
            .container {
              padding: 2rem;
              background: #ffffff;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
              color: white;
              padding: 2rem;
              border-radius: 8px 8px 0 0;
              margin: -2rem -2rem 2rem -2rem;
              text-align: center;
            }
            .section {
              margin-bottom: 1.5rem;
              padding: 1.5rem;
              background: #f8f9fa;
              border-radius: 6px;
            }
            .button {
              display: inline-block;
              padding: 14px 28px;
              background: #4B9EFF;
              color: #ffffff;
              text-decoration: none;
              border-radius: 6px;
              font-weight: bold;
              font-size: 16px;
              margin: 0.5rem 0.5rem 0.5rem 0;
              text-align: center;
              border: 2px solid #4B9EFF;
              box-shadow: 0 2px 4px rgba(75, 158, 255, 0.3);
              transition: all 0.3s ease;
            }
            .button:hover {
              background: #3a8aef;
              border-color: #3a8aef;
              box-shadow: 0 4px 8px rgba(75, 158, 255, 0.4);
            }
            .message {
              font-style: italic;
              background: #f0f4f8;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #4B9EFF;
              margin: 1rem 0;
            }
            .info-box {
              background: #e8f4fd;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #0066cc;
              margin: 1rem 0;
            }
            .tenant-info {
              background: #e8f4fd;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #0066cc;
              margin: 1rem 0;
            }
            .footer {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 2px solid #eee;
              font-size: 0.9rem;
              color: #666;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Collection Collaboration Invitation</h1>
            </div>
            
            <div class="section">
              <h2>Hello${inviteeName ? ', ' + inviteeName : ''}!</h2>
              <p>${inviterName} has invited you to collaborate on the collection "${collection.name}" as a <strong>${roleDisplay}</strong>.</p>
              
              ${
                message
                  ? `
              <div class="message">
                <p>"${message}"</p>
              </div>
              `
                  : ''
              }
              
              ${collection.description ? `<p>${collection.description}</p>` : ''}
              
              ${
                cascadeToExternalLinks
                  ? `
              <div class="info-box">
                <p><strong>Note:</strong> You will also have access to all public and unlisted external links within this collection.</p>
              </div>
              `
                  : ''
              }
              
              ${
                tenant?.name
                  ? `
              <div class="tenant-info">
                <p><strong>Organization:</strong> ${tenant.name}</p>
                <p><small>When creating your account, please select "${tenant.name}" as your organization to access this collaboration.</small></p>
              </div>
              `
                  : ''
              }
              
              <p>To access this collection, you'll need to sign in to your account first.</p>
              
              <div style="text-align: center; margin-top: 2rem;">
                <a href="${actionLink}" class="button">${actionText}</a>
              </div>
            </div>

            <div class="footer">
              <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY is not set. Email will not be sent.');
      // For development purposes, log the email content
      if (process.env.NODE_ENV === 'development') {
        console.log(
          'Collection invite email HTML that would be sent:',
          emailHtml
        );
      }
      return false;
    }

    // Check if sender email is configured
    if (!process.env.RESEND_FROM_EMAIL) {
      console.warn('RESEND_FROM_EMAIL is not set. Using default.');
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    const response = await resend.emails.send({
      from: fromEmail,
      to: inviteeEmail,
      subject: `${inviterName} invited you to collaborate on "${collection.name}"`,
      html: emailHtml,
      reply_to: inviter.email,
    });

    return response;
  } catch (error) {
    console.error(
      'Error sending collection collaboration invite email:',
      error
    );
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Sends an email notification to opportunity creator when someone applies via email
 *
 * @param {Object} data - Application data
 * @param {Object} data.opportunity - Opportunity object
 * @param {Object} data.application - Application object
 * @param {string} data.applicantEmail - Email of the applicant
 * @param {string} data.applicantName - Name of the applicant
 * @param {string} data.creatorEmail - Email of the opportunity creator
 * @param {string} data.creatorName - Name of the opportunity creator
 * @returns {Promise<boolean>} - True if email was sent successfully
 */
export const sendOpportunityApplicationEmail = async (data) => {
  try {
    const {
      opportunity,
      application,
      applicantEmail,
      applicantName,
      creatorEmail,
      creatorName,
    } = data;

    const opportunityTitle = opportunity.title || 'Untitled Opportunity';
    const applicantDisplayName = applicantName || applicantEmail;
    const coverLetter = application.coverLetter || 'No cover letter provided.';
    const resumeUrl = application.resumeUrl || null;
    const additionalInfo = application.additionalInfo || {};
    const whyInterested = additionalInfo.whyInterested || null;
    const availability = additionalInfo.availability || null;
    const linkedIn = additionalInfo.linkedIn || null;
    const portfolio = additionalInfo.portfolio || null;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
            }
            .container {
              padding: 2rem;
              background: #ffffff;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
              color: white;
              padding: 2rem;
              border-radius: 8px 8px 0 0;
              margin: -2rem -2rem 2rem -2rem;
            }
            .section {
              margin-bottom: 1.5rem;
              padding: 1.5rem;
              background: #f8f9fa;
              border-radius: 6px;
            }
            .section-title {
              font-weight: bold;
              color: #4B9EFF;
              margin-bottom: 0.5rem;
              font-size: 1.1rem;
            }
            .info-row {
              margin-bottom: 0.5rem;
            }
            .info-label {
              font-weight: 600;
              color: #555;
            }
            .button {
              display: inline-block;
              padding: 12px 24px;
              background: #4B9EFF;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              margin-top: 1rem;
            }
            .footer {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 1px solid #ddd;
              font-size: 0.9rem;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>New Opportunity Application</h1>
              <p>Someone has applied for your opportunity</p>
            </div>

            <div class="section">
              <div class="section-title">Opportunity Details</div>
              <div class="info-row">
                <span class="info-label">Position:</span> ${opportunityTitle}
              </div>
            </div>

            <div class="section">
              <div class="section-title">Applicant Information</div>
              <div class="info-row">
                <span class="info-label">Name:</span> ${applicantDisplayName}
              </div>
              <div class="info-row">
                <span class="info-label">Email:</span> 
                <a href="mailto:${applicantEmail}">${applicantEmail}</a>
              </div>
              ${
                linkedIn
                  ? `
              <div class="info-row">
                <span class="info-label">LinkedIn:</span> 
                <a href="${linkedIn}" target="_blank">${linkedIn}</a>
              </div>
              `
                  : ''
              }
              ${
                portfolio
                  ? `
              <div class="info-row">
                <span class="info-label">Portfolio:</span> 
                <a href="${portfolio}" target="_blank">${portfolio}</a>
              </div>
              `
                  : ''
              }
            </div>

            ${
              whyInterested
                ? `
            <div class="section">
              <div class="section-title">Why This Opportunity?</div>
              <p>${whyInterested.replace(/\n/g, '<br>')}</p>
            </div>
            `
                : ''
            }

            ${
              availability
                ? `
            <div class="section">
              <div class="section-title">Availability</div>
              <p>${availability.replace(/\n/g, '<br>')}</p>
            </div>
            `
                : ''
            }

            ${
              coverLetter && coverLetter !== 'No cover letter provided.'
                ? `
            <div class="section">
              <div class="section-title">Cover Letter</div>
              <p>${coverLetter.replace(/\n/g, '<br>')}</p>
            </div>
            `
                : ''
            }

            ${
              resumeUrl
                ? `
            <div class="section">
              <div class="section-title">Resume/CV</div>
              <p><a href="${resumeUrl}" target="_blank">View Resume</a></p>
            </div>
            `
                : ''
            }

            <div class="footer">
              <p>You can review and manage this application in your opportunity dashboard.</p>
              <p>To respond to the applicant, reply directly to this email or contact them at <a href="mailto:${applicantEmail}">${applicantEmail}</a></p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY is not set. Email will not be sent.');
      if (process.env.NODE_ENV === 'development') {
        console.log(
          'Opportunity application email HTML that would be sent:',
          emailHtml
        );
      }
      return false;
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    const response = await resend.emails.send({
      from: fromEmail,
      to: creatorEmail,
      subject: `New Application: ${opportunityTitle}`,
      html: emailHtml,
      reply_to: applicantEmail,
    });

    return true;
  } catch (error) {
    console.error('Error sending opportunity application email:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Sends a confirmation email to an applicant when they submit an application
 *
 * @param {Object} data - Application data
 * @param {Object} data.opportunity - Opportunity object
 * @param {string} data.applicantEmail - Email of the applicant
 * @param {string} data.applicantName - Name of the applicant
 * @returns {Promise<boolean>} - True if email was sent successfully
 */
export const sendApplicationConfirmationEmail = async (data) => {
  try {
    const { opportunity, applicantEmail, applicantName } = data;

    const opportunityTitle = opportunity.title || 'Untitled Opportunity';
    const applicantDisplayName = applicantName || applicantEmail;
    const primaryOrg =
      opportunity.organizations?.[0] || opportunity.organizations?.[0];
    const orgName = primaryOrg?.name || 'the organization';

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
            }
            .container {
              padding: 2rem;
              background: #ffffff;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
              color: white;
              padding: 2rem;
              border-radius: 8px 8px 0 0;
              margin: -2rem -2rem 2rem -2rem;
            }
            .section {
              margin-bottom: 1.5rem;
              padding: 1.5rem;
              background: #f8f9fa;
              border-radius: 6px;
            }
            .footer {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 1px solid #ddd;
              font-size: 0.9rem;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Application Received!</h1>
              <p>Thank you for your interest</p>
            </div>

            <div class="section">
              <p>Hi ${applicantDisplayName},</p>
              <p>
                Thank you for applying to <strong>${opportunityTitle}</strong>${orgName ? ` at ${orgName}` : ''}!
              </p>
              <p>
                We have received your application and the opportunity creator will review it shortly. 
                You will be contacted directly if they would like to move forward with your application.
              </p>
            </div>

            <div class="section">
              <h3 style="margin-top: 0; color: #4B9EFF;">What's Next?</h3>
              <ul>
                <li>The opportunity creator will review your application</li>
                <li>You may be contacted via email for next steps</li>
                <li>Please check your email regularly for updates</li>
              </ul>
            </div>

            <div class="footer">
              <p>If you have any questions, please contact the opportunity creator directly.</p>
              <p>Good luck with your application!</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY is not set. Email will not be sent.');
      if (process.env.NODE_ENV === 'development') {
        console.log(
          'Application confirmation email HTML that would be sent:',
          emailHtml
        );
      }
      return false;
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    const response = await resend.emails.send({
      from: fromEmail,
      to: applicantEmail,
      subject: `Application Confirmation: ${opportunityTitle}`,
      html: emailHtml,
    });

    return true;
  } catch (error) {
    console.error('Error sending application confirmation email:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Sends a pending invitation email for collection collaboration to someone who doesn't have an account yet
 *
 * @param {Object} inviteData - Data about the invitation
 * @param {string} inviteData.inviteeEmail - Email of the person being invited
 * @param {string} inviteData.inviteeName - Name of the person being invited
 * @param {Object} inviteData.inviter - User object of the person sending the invitation
 * @param {Object} inviteData.collection - Collection the user is invited to collaborate on
 * @param {Object} inviteData.tenant - Tenant information
 * @param {string} inviteData.message - Optional message from the inviter
 * @param {string} inviteData.role - Role assigned to the collaborator
 * @param {string} inviteData.inviteToken - Unique token for accepting the invitation
 * @param {boolean} inviteData.cascadeToExternalLinks - Whether permissions will cascade to external links
 * @returns {Promise<boolean>} - True if email was sent successfully
 */
export const sendPendingCollectionInviteEmail = async (inviteData) => {
  try {
    const {
      inviteeEmail,
      inviteeName,
      inviter,
      collection,
      tenant,
      message,
      role,
      inviteToken,
      cascadeToExternalLinks,
    } = inviteData;

    if (!inviteeEmail || !collection || !inviter || !inviteToken) {
      throw new Error('Missing required invite data');
    }

    const inviterName =
      `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim();
    const appUrl = process.env.FRONTEND_URL || 'https://www.contexlia.com';

    // Create signup link with invitation token and redirect
    const collaborationUrl = `${appUrl}/collections/${collection.id}`;
    const signupLink = `${appUrl}/invitations/accept?invite=${inviteToken}&redirect_url=${encodeURIComponent(collaborationUrl)}`;
    const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
            }
            .container {
              padding: 2rem;
              background: #ffffff;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #4B9EFF 0%, #9C6AFF 100%);
              color: white;
              padding: 2rem;
              border-radius: 8px 8px 0 0;
              margin: -2rem -2rem 2rem -2rem;
              text-align: center;
            }
            .section {
              margin-bottom: 1.5rem;
              padding: 1.5rem;
              background: #f8f9fa;
              border-radius: 6px;
            }
            .button {
              display: inline-block;
              padding: 14px 28px;
              background: #4B9EFF;
              color: #ffffff;
              text-decoration: none;
              border-radius: 6px;
              font-weight: bold;
              font-size: 16px;
              margin: 0.5rem 0.5rem 0.5rem 0;
              text-align: center;
              border: 2px solid #4B9EFF;
              box-shadow: 0 2px 4px rgba(75, 158, 255, 0.3);
              transition: all 0.3s ease;
            }
            .button:hover {
              background: #3a8aef;
              border-color: #3a8aef;
              box-shadow: 0 4px 8px rgba(75, 158, 255, 0.4);
            }
            .message {
              font-style: italic;
              background: #f0f4f8;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #4B9EFF;
              margin: 1rem 0;
            }
            .info-box {
              background: #e8f4fd;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #0066cc;
              margin: 1rem 0;
            }
            .highlight {
              background: #fff3cd;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #ffc107;
              margin: 1rem 0;
            }
            .tenant-info {
              background: #e8f4fd;
              padding: 1rem;
              border-radius: 4px;
              border-left: 4px solid #0066cc;
              margin: 1rem 0;
            }
            .footer {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 2px solid #eee;
              font-size: 0.9rem;
              color: #666;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">You're Invited to Collaborate!</h1>
            </div>
            
            <div class="section">
              <h2>Hello ${inviteeName}!</h2>
              <p>${inviterName} has invited you to collaborate on the collection "${collection.name}" as a <strong>${roleDisplay}</strong>.</p>
              
              ${
                message
                  ? `
              <div class="message">
                <p>"${message}"</p>
              </div>
              `
                  : ''
              }
              
              ${collection.description ? `<p>${collection.description}</p>` : ''}
              
              ${
                cascadeToExternalLinks
                  ? `
              <div class="info-box">
                <p><strong>Note:</strong> You will also have access to all public and unlisted external links within this collection.</p>
              </div>
              `
                  : ''
              }
              
              ${
                tenant?.name
                  ? ` 
              <div class="highlight">
                <p><strong>To get started:</strong></p>
                <p><strong>Tenant:</strong> ${tenant.name}</p>
                <p><strong>Important:</strong> When creating your account, please select "${tenant.name}" as your tenant to access this collaboration.</p>
                <p>You'll need to create an account or sign in to accept this invitation and start collaborating.</p>
              </div>
              
              <div style="text-align: center; margin-top: 2rem;">
                <a href="${signupLink}" class="button">Accept Invitation & Get Started</a>
              </div>
              
              <p style="margin-top: 1.5rem; font-size: 0.9rem; color: #666; text-align: center;">
                <strong>New to our platform?</strong> You'll be able to create an account during the invitation process.<br>
                <strong>Already have an account?</strong> You'll be prompted to sign in first.
              </p>
            </div>

            <div class="footer">
              <p>This invitation will expire in 7 days.</p>
              <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `
                  : ''
              }`;

    // Check if Resend API key is configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY is not set. Email will not be sent.');
      // For development purposes, log the email content
      if (process.env.NODE_ENV === 'development') {
        console.log(
          'Pending collection invite email HTML that would be sent:',
          emailHtml
        );
      }
      return false;
    }

    // Check if sender email is configured
    if (!process.env.RESEND_FROM_EMAIL) {
      console.warn('RESEND_FROM_EMAIL is not set. Using default.');
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    const response = await resend.emails.send({
      from: fromEmail,
      to: inviteeEmail,
      subject: `${inviterName} invited you to collaborate on "${collection.name}"`,
      html: emailHtml,
      reply_to: inviter.email,
    });

    return true;
  } catch (error) {
    console.error('Error sending pending collection invite email:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
};
