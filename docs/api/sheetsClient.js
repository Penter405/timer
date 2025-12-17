/**
 * Google Sheets Client
 * Provides authenticated Sheets API client for serverless functions
 * Includes connection pooling and error handling
 */
const { google } = require('googleapis');

// Cache the auth client to reuse across function invocations
let cachedAuth = null;
let cachedSheets = null;

/**
 * Get or create Google Sheets API client
 * Implements connection pooling for serverless optimization
 * @returns {Object} - Google Sheets API v4 client
 */
function getSheetsClient() {
    // Return cached client if available
    if (cachedSheets) {
        console.log('[SHEETS_CLIENT] Using cached client');
        return cachedSheets;
    }

    console.log('[SHEETS_CLIENT] Creating new client');

    try {
        // Parse service account credentials from environment variable
        const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

        if (!credentialsJson) {
            throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON not set');
        }

        const credentials = JSON.parse(credentialsJson);

        // Create auth client
        cachedAuth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        // Create Sheets client
        cachedSheets = google.sheets({
            version: 'v4',
            auth: cachedAuth
        });

        console.log('[SHEETS_CLIENT] Client created successfully');
        return cachedSheets;

    } catch (error) {
        console.error('[SHEETS_CLIENT] Initialization error:', error);

        // Clear cache on error
        cachedAuth = null;
        cachedSheets = null;

        throw new Error(`Failed to initialize Sheets client: ${error.message}`);
    }
}

/**
 * Clear cached client (for testing or error recovery)
 */
function clearCache() {
    console.log('[SHEETS_CLIENT] Clearing cache');
    cachedAuth = null;
    cachedSheets = null;
}

/**
 * Test connection to Google Sheets
 * @param {string} spreadsheetId - Spreadsheet ID to test
 * @returns {Promise<boolean>} - True if connection successful
 */
async function testConnection(spreadsheetId) {
    try {
        const sheets = getSheetsClient();
        await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'properties.title'
        });
        console.log('[SHEETS_CLIENT] Connection test successful');
        return true;
    } catch (error) {
        console.error('[SHEETS_CLIENT] Connection test failed:', error);
        return false;
    }
}

module.exports = getSheetsClient;
module.exports.clearCache = clearCache;
module.exports.testConnection = testConnection;
