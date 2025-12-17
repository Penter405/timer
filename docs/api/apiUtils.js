/**
 * API Utilities Module
 * Shared utilities for all Vercel serverless functions
 * Following option_3_vercel architecture: Web → Vercel → Sheet
 */

// ========================================
// CORS HANDLING
// ========================================

/**
 * Handle CORS for API requests
 * Supports dynamic origin validation and preflight OPTIONS requests
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {boolean} - True if OPTIONS request (should terminate), false otherwise
 */
function handleCORS(req, res) {
    const allowedOrigins = [
        'https://penter405.github.io',
        'http://localhost:8080',
        'http://127.0.0.1:8080',
        'http://localhost:5500' // Live Server default
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true; // Should terminate
    }
    return false; // Continue processing
}

// ========================================
// JWT VERIFICATION
// ========================================

/**
 * Parse Google JWT token to extract payload
 * @param {string} token - Google ID Token
 * @returns {Object|null} - Decoded payload or null on error
 */
function parseJwt(token) {
    try {
        if (!token || typeof token !== 'string') {
            return null;
        }

        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }

        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

        // Use Buffer.from for Node.js compatibility (works in Vercel)
        const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8');

        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error('[JWT] Parse Error:', e.message);
        return null;
    }
}

/**
 * Verify and extract email from Google JWT token
 * @param {string} token - Google ID Token
 * @returns {string|null} - Email or null if invalid
 */
function verifyGoogleToken(token) {
    if (!token) return null;

    const payload = parseJwt(token);
    if (!payload || !payload.email) {
        return null;
    }

    // Optional: Add expiration check
    if (payload.exp && Date.now() >= payload.exp * 1000) {
        console.error('[JWT] Token expired');
        return null;
    }

    return payload.email;
}

// ========================================
// RESPONSE HANDLERS
// ========================================

/**
 * Send standardized error response
 * @param {Object} res - Response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {string} details - Additional error details (optional)
 */
function sendError(res, statusCode, message, details = null) {
    const response = {
        success: false,
        error: message
    };

    if (details) {
        response.details = details;
    }

    console.error(`[API_ERROR] ${statusCode}: ${message}`, details || '');
    res.status(statusCode).json(response);
}

/**
 * Send standardized success response
 * @param {Object} res - Response object
 * @param {Object} data - Response data
 * @param {string} message - Success message (optional)
 */
function sendSuccess(res, data, message = null) {
    const response = {
        success: true,
        ...data
    };

    if (message) {
        response.message = message;
    }

    res.status(200).json(response);
}

// ========================================
// HASH TABLE UTILITIES
// ========================================

/**
 * Convert column index (0-based) to Excel column letter
 * @param {number} colIndex - Column index (0-based)
 * @returns {string} - Excel column letter (A, B, ..., Z, AA, AB, ...)
 */
function getColumnLetter(colIndex) {
    let temp, letter = '';
    while (colIndex >= 0) {
        temp = colIndex % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = Math.floor(colIndex / 26) - 1;
    }
    return letter;
}

/**
 * Hash function for string -> bucket index
 * @param {string} str - String to hash
 * @param {number} bucketSize - Number of buckets
 * @returns {number} - Bucket index
 */
function getBucketIndex(str, bucketSize) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash) % bucketSize;
}

/**
 * Get column range for a specific bucket in hash table
 * @param {string} sheetName - Sheet name
 * @param {number} bucketIndex - Bucket index
 * @param {number} cols - Number of columns per bucket (default: 3)
 * @returns {string} - Range string (e.g., "UserMap!A:C")
 */
function getBucketRange(sheetName, bucketIndex, cols = 3) {
    const startCol = bucketIndex * cols;
    const endCol = startCol + cols - 1;
    return `${sheetName}!${getColumnLetter(startCol)}:${getColumnLetter(endCol)}`;
}

// ========================================
// DATA FORMATTING
// ========================================

/**
 * Format value for Google Sheets to prevent auto-formatting
 * Adds single quote prefix to force text interpretation
 * @param {any} value - Value to format
 * @returns {string} - Formatted value
 */
function formatSheetValue(value) {
    if (value === null || value === undefined) return '';
    return `'${value}`;
}

/**
 * Strip leading quote from Sheet value
 * @param {string} value - Sheet value
 * @returns {string} - Cleaned value
 */
function cleanSheetValue(value) {
    if (typeof value === 'string' && value.startsWith("'")) {
        return value.substring(1);
    }
    return value;
}

/**
 * Format date for Google Sheets
 * @param {Date|string|number} date - Date to format
 * @returns {string} - Formatted date (YYYY/MM/DD)
 */
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
}

/**
 * Format time for Google Sheets
 * @param {Date|string|number} date - Date to format
 * @returns {string} - Formatted time (HH:MM:SS)
 */
function formatTime(date) {
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
    // CORS
    handleCORS,

    // JWT
    parseJwt,
    verifyGoogleToken,

    // Response
    sendError,
    sendSuccess,

    // Hash Table
    getColumnLetter,
    getBucketIndex,
    getBucketRange,

    // Data Formatting
    formatSheetValue,
    cleanSheetValue,
    formatDate,
    formatTime
};
