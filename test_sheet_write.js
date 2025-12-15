const { google } = require('googleapis');
const path = require('path');
require('dotenv').config(); // Try to load .env if present

// 1. Load Credentials
// Look for credentials.json in current directory
let credentials;
try {
    credentials = require('./credentials.json');
    console.log("✅ Found credentials.json");
} catch (e) {
    console.error("❌ ERROR: Could not find 'credentials.json' in this folder.");
    console.error("   Please download your JSON key from Google Cloud Console");
    console.error("   and rename it to 'credentials.json' in this folder.");
    process.exit(1);
}

// 2. Load Sheet ID
// Try from .env or fallback to hardcoded (User provided URL previously)
// URL: https://docs.google.com/spreadsheets/d/***REMOVED***/edit
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || '***REMOVED***';
console.log(`ℹ️ Using Spreadsheet ID: ${SPREADSHEET_ID}`);

async function testWrite() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        console.log("🔄 Attempting to append to 'Total' sheet...");

        // Simulate the logic from update_nickname.js
        const testEmail = `test_debug_${Date.now()}@example.com`;
        const testUniqueName = `DebugHero#${Math.floor(Math.random() * 1000)}`;

        const res = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Total!A:B',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[testEmail, testUniqueName]]
            },
        });

        console.log("✅ SUCCESS! Sheet updated.");
        console.log("   Updated Range:", res.data.updates.updatedRange);
        console.log("   Check your Google Sheet now. You should see a debug row.");

    } catch (error) {
        console.error("❌ WRITE FAILED:");
        console.error(error.message);

        if (error.message.includes("403") || error.message.includes("permission")) {
            console.log("\n💡 TIP: Does the Service Account Email have 'Editor' access?");
            console.log("   Open credentials.json and find 'client_email'.");
            console.log("   Share your Google Sheet with that email address as 'Editor'.");
        }
    }
}

testWrite();
