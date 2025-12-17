/**
 * Google Apps Script for Concurrent-Safe Name Number Allocation
 * 
 * Architecture: Vercel API → GAS Web App (LockService) → Google Sheets
 * Sheet: Counts (team-based hash table)
 * 
 * Structure:
 * - Row 1: Headers (team0_name, team0_count, team1_name, team1_count, ...)
 * - Row ≥2: Data rows (username, count)
 * 
 * Concurrency: LockService ensures atomic read-increment-write operations
 */

// ================================
// CONFIGURATION
// ================================

const TEAM_COUNT = 13; // Number of hash buckets (teams)
const LOCK_TIMEOUT_MS = 10000; // 10 seconds
const SHARED_SECRET = 'YOUR_SHARED_SECRET_HERE'; // Must match Vercel env var

// ================================
// HASH FUNCTION
// ================================

/**
 * Simple string hash function
 * @param {string} str - String to hash
 * @returns {number} - Hash value
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get team index for username
 * @param {string} username - Username to hash
 * @returns {number} - Team index (0 to TEAM_COUNT-1)
 */
function getTeamIndex(username) {
  return hashString(username) % TEAM_COUNT;
}

// ================================
// CORE FUNCTION (WITH LOCK)
// ================================

/**
 * Get next name_number for username (Thread-safe)
 * 
 * Process:
 * 1. Acquire lock
 * 2. Calculate team index and columns
 * 3. Search for username in team column
 * 4. If found: increment count
 * 5. If not found: add new row with count=1
 * 6. Return new name_number
 * 7. Release lock (in finally)
 * 
 * @param {string} username - Username (e.g., "Penter")
 * @returns {number} - Next name_number
 */
function getNextNameNumber(username) {
  const lock = LockService.getScriptLock();
  
  try {
    // Acquire lock with timeout
    const hasLock = lock.waitLock(LOCK_TIMEOUT_MS);
    if (!hasLock) {
      throw new Error('LOCK_TIMEOUT');
    }
    
    // === CRITICAL SECTION START ===
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Counts');
    if (!sheet) {
      throw new Error('SHEET_NOT_FOUND: Counts');
    }
    
    // 1. Calculate team columns
    const teamIndex = getTeamIndex(username);
    const firstColumn = teamIndex * 2 + 1; // Username column
    const secondColumn = firstColumn + 1;  // Count column
    
    Logger.log(`[GAS] Username: ${username}, TeamIndex: ${teamIndex}, Columns: ${firstColumn}, ${secondColumn}`);
    
    // 2. Get all data from this team's two columns (starting from row 2)
    const lastRow = sheet.getLastRow();
    const dataRange = sheet.getRange(2, firstColumn, Math.max(lastRow - 1, 1), 2);
    const data = dataRange.getValues();
    
    // 3. Search for username in first column
    let foundRowIndex = -1;
    let currentCount = 0;
    
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === username) {
        foundRowIndex = i;
        currentCount = parseInt(data[i][1]) || 0;
        Logger.log(`[GAS] Found username at row ${i + 2}, current count: ${currentCount}`);
        break;
      }
    }
    
    const newCount = currentCount + 1;
    
    // 4. Write back to sheet
    if (foundRowIndex !== -1) {
      // Update existing row
      const actualRow = foundRowIndex + 2; // +2 because row 1 is header, and we started from row 2
      sheet.getRange(actualRow, secondColumn).setValue(newCount);
      Logger.log(`[GAS] Updated count at row ${actualRow} to ${newCount}`);
    } else {
      // Find first empty row in this team
      let emptyRowIndex = -1;
      for (let i = 0; i < data.length; i++) {
        if (!data[i][0]) { // Empty username cell
          emptyRowIndex = i;
          break;
        }
      }
      
      let targetRow;
      if (emptyRowIndex !== -1) {
        targetRow = emptyRowIndex + 2;
      } else {
        // Append new row
        targetRow = lastRow + 1;
      }
      
      // Write username and count
      sheet.getRange(targetRow, firstColumn).setValue(username);
      sheet.getRange(targetRow, secondColumn).setValue(newCount);
      Logger.log(`[GAS] Added new user at row ${targetRow} with count ${newCount}`);
    }
    
    // === CRITICAL SECTION END ===
    
    return newCount;
    
  } finally {
    // MUST release lock
    lock.releaseLock();
    Logger.log('[GAS] Lock released');
  }
}

// ================================
// WEB APP ENDPOINT
// ================================

/**
 * Web App POST endpoint
 * 
 * Request: { "username": "Penter" }
 * Headers: { "X-Secret-Key": "YOUR_SHARED_SECRET_HERE" }
 * 
 * Success: { "ok": true, "name_number": 3 }
 * Failure: { "ok": false, "error": "ERROR_CODE" }
 */
function doPost(e) {
  try {
    // 1. Verify shared secret
    const secretHeader = e.parameter.secret || e.postData?.contents && JSON.parse(e.postData.contents).secret;
    if (secretHeader !== SHARED_SECRET) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. Parse request
    const requestData = JSON.parse(e.postData.contents);
    const username = requestData.username;
    
    if (!username || typeof username !== 'string') {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'INVALID_USERNAME' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    Logger.log(`[GAS] Received request for username: ${username}`);
    
    // 3. Get name_number (with lock)
    const nameNumber = getNextNameNumber(username);
    
    // 4. Return success
    return ContentService
      .createTextOutput(JSON.stringify({ 
        ok: true, 
        name_number: nameNumber 
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    Logger.log(`[GAS] Error: ${error.message}`);
    
    // Return error response
    return ContentService
      .createTextOutput(JSON.stringify({ 
        ok: false, 
        error: error.message || 'INTERNAL_ERROR' 
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Test function (for debugging)
 */
function testGetNextNameNumber() {
  const result1 = getNextNameNumber('Penter');
  Logger.log('Result 1: ' + result1);
  
  const result2 = getNextNameNumber('Penter');
  Logger.log('Result 2: ' + result2);
  
  const result3 = getNextNameNumber('SpeedCuber');
  Logger.log('Result 3: ' + result3);
}
