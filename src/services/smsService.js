import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import { users } from '../models/users.js';
import { collections } from '../models/collections.js';
import { externalLinks } from '../models/external_links.js';
import { collectionExternalLinks } from '../models/external_links.js';
import { usersTenants } from '../models/usersTenants.js';
import { eq, and, sql } from 'drizzle-orm';
import { generateStructuredNotationsService } from './aiService.js';
import { 
  addMultipleNotationsToExternalLinkService,
  getCollectionExternalLinkIdService 
} from './collectionService.js';
import twilio from 'twilio';

// Create a specific database connection for SMS service without SSL
const smsPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'postgres',
  ssl: false // Explicitly disable SSL
});

const db = drizzle(smsPool);

// Initialize Twilio client
const getTwilioClient = () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('Twilio credentials not configured');
    return null;
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
};

// Map phone numbers to users
const getUserByPhoneNumber = async (phoneNumber) => {
  try {
    console.log('Looking up user for phone number:', phoneNumber);
    
    // Clean phone number (remove formatting)
    const cleanedNumber = phoneNumber.replace(/\D/g, '');
    console.log('Cleaned number:', cleanedNumber);
    
    // Try to find user by phone number
    const result = await db.execute(sql`
      SELECT * FROM users 
      WHERE phone_number = ${cleanedNumber}
      LIMIT 1
    `);
    
    if (result.rows.length > 0) {
      console.log('User found:', result.rows[0].email);
      return result.rows[0];
    }
    
    // Try with country code variations (US)
    const withCountryCode = cleanedNumber.startsWith('1') 
      ? cleanedNumber 
      : '1' + cleanedNumber;
    const withoutCountryCode = cleanedNumber.startsWith('1') 
      ? cleanedNumber.substring(1) 
      : cleanedNumber;
    
    const variationResult = await db.execute(sql`
      SELECT * FROM users 
      WHERE phone_number = ${withCountryCode} 
         OR phone_number = ${withoutCountryCode}
      LIMIT 1
    `);
    
    if (variationResult.rows.length > 0) {
      console.log('User found with variation:', variationResult.rows[0].email);
      return variationResult.rows[0];
    }
    
    console.log('No user found for phone number:', phoneNumber);
    return null;
  } catch (error) {
    console.error('Error finding user by phone number:', error);
    return null;
  }
};

// Parse SMS commands
const parseSMSCommand = (message) => {
  const lowerMessage = message.toLowerCase().trim();
  
  // Check for help command
  if (lowerMessage === 'help' || lowerMessage === '?') {
    return { command: 'help' };
  }
  
  // Check for list command
  if (lowerMessage === 'list' || lowerMessage === 'my notes') {
    return { command: 'list' };
  }
  
  // Default to creating a notation
  return { command: 'create', content: message };
};

// Handle incoming SMS messages
export const handleIncomingSMSService = async ({ phoneNumber, message, accountSid }) => {
  try {
    // Get user by phone number
    const user = await getUserByPhoneNumber(phoneNumber);
    
    if (!user) {
      return {
        responseMessage: 'Sorry, this phone number is not registered. Please add your phone number to your account settings at ' + process.env.FRONTEND_URL
      };
    }
    
    // Get user's tenant - fetch from database if needed
    let userTenantId = null;
    if (!user.tenant_id && !user.tenantId) {
      // If user object doesn't have tenant, fetch it
      const tenantResult = await db.execute(sql`
        SELECT tenant_id FROM users_tenants 
        WHERE user_id = ${user.id}
        LIMIT 1
      `);
      
      if (tenantResult.rows.length > 0) {
        userTenantId = tenantResult.rows[0].tenant_id;
      }
    } else {
      userTenantId = user.tenant_id || user.tenantId;
    }
    
    // Use default tenant if none found
    if (!userTenantId) {
      userTenantId = process.env.DEFAULT_TENANT_ID || process.env.COMMUNITY_TENANT;
      console.log('Using default tenant ID:', userTenantId);
    }
    
    const tenantIds = userTenantId ? [userTenantId] : [];
    
    // Parse the SMS command
    const { command, content } = parseSMSCommand(message);
    
    // Handle different commands
    switch (command) {
      case 'help':
        return {
          responseMessage: 'Text any message to create a note. Commands:\n' +
            '• "list" - View recent notes\n' +
            '• "help" - Show this message\n' +
            'Example: "Call Dr. Smith at 3pm tomorrow"'
        };
        
      case 'list':
        // TODO: Implement listing recent notations
        return {
          responseMessage: 'Your recent notes:\n' +
            '1. [Recent note 1]\n' +
            '2. [Recent note 2]\n' +
            'View all at ' + process.env.FRONTEND_URL
        };
        
      case 'create':
      default:
        // Generate structured notation using AI
        const structuredResult = await generateStructuredNotationsService(
          content,
          false, // Don't separate list items for SMS
          user.id,
          tenantIds
        );
        
        if (!structuredResult.data || structuredResult.data.length === 0) {
          return {
            responseMessage: 'Sorry, I couldn\'t understand your message. Please try again.'
          };
        }
        
        // Get user's default collection for SMS notations
        const defaultCollection = await getOrCreateSMSCollection(user.id, userTenantId);
        
        if (!defaultCollection) {
          return {
            responseMessage: 'Sorry, we couldn\'t find a collection for your notes. Please check your account.'
          };
        }
        
        // Get the collection external link ID
        const collectionExternalLinkId = await getCollectionExternalLinkIdService(
          defaultCollection.externalLinkId
        );
        
        if (!collectionExternalLinkId) {
          return {
            responseMessage: 'Sorry, we couldn\'t set up your notes collection properly. Please check your account.'
          };
        }
        
        // Create the notations
        const notationsToCreate = structuredResult.data.map(notation => ({
          ...notation,
          visibility: 'private'
        }));
        
        const result = await addMultipleNotationsToExternalLinkService(
          collectionExternalLinkId,
          notationsToCreate,
          user.id
        );
        
        // Send confirmation message
        const notationCount = result.length;
        const notationText = notationCount === 1 
          ? `Created: "${result[0].title}"`
          : `Created ${notationCount} notes`;
          
        return {
          responseMessage: `✓ ${notationText}\nView at ${process.env.FRONTEND_URL}/collections/${defaultCollection.collectionId}`
        };
    }
  } catch (error) {
    console.error('Error in handleIncomingSMSService:', error);
    throw error;
  }
};

// Get or create a default SMS collection for the user
const getOrCreateSMSCollection = async (userId, tenantId) => {
  try {
    console.log('getOrCreateSMSCollection - userId:', userId, 'tenantId:', tenantId);
    
    // Ensure tenantId is valid
    if (!tenantId) {
      console.error('No tenantId provided');
      return null;
    }
    
    // Look for existing SMS collection
    const existingCollection = await db.execute(sql`
      SELECT 
        c.id as "collectionId",
        el.id as "externalLinkId"
      FROM collections c
      INNER JOIN collection_external_links cel ON c.id = cel.collection_id
      INNER JOIN external_links el ON cel.external_link_id = el.id
      WHERE c.user_id = ${userId}
      AND c.name = 'SMS Notes'
      AND c.tenant_id = ${tenantId}
      LIMIT 1
    `);
    
    if (existingCollection.rows.length > 0) {
      return existingCollection.rows[0];
    }
    
    // Create new SMS collection
    const newCollection = await db.transaction(async (tx) => {
      // Create collection
      const collection = await tx
        .insert(collections)
        .values({
          name: 'SMS Notes',
          description: 'Notes created via SMS',
          userId,
          tenantId,
          visibility: 'private',
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
      
      // Create external link
      const externalLink = await tx
        .insert(externalLinks)
        .values({
          name: 'SMS Notes',
          url: process.env.FRONTEND_URL + '/sms-notes',
          addedByUserId: userId,
          tenantId,
          visibility: 'private',
          dateAdded: new Date(),
          updatedAt: new Date()
        })
        .returning();
      
      // Link them together
      await tx
        .insert(collectionExternalLinks)
        .values({
          collectionId: collection[0].id,
          externalLinkId: externalLink[0].id,
          userId,
          name: 'SMS Notes',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      
      return {
        collectionId: collection[0].id,
        externalLinkId: externalLink[0].id
      };
    });
    
    return newCollection;
  } catch (error) {
    console.error('Error getting/creating SMS collection:', error);
    return null;
  }
};

// Send SMS notification
export const sendSMSNotification = async (phoneNumber, message) => {
  try {
    const client = getTwilioClient();
    if (!client) {
      console.error('Twilio client not configured');
      return false;
    }
    
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    
    console.log('SMS sent successfully:', result.sid);
    return true;
  } catch (error) {
    console.error('Error sending SMS:', error);
    return false;
  }
};