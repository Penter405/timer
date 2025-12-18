const fetch = require('node-fetch');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess
} = require('../lib/apiUtils');

// ================================
// USERMAP HASH CONFIGURATION
// ================================
const USERMAP_TEAM_COUNT = 8; // 8 teams × 3 columns = 24 columns total
const USERMAP_COLS_PER_TEAM = 3; // Email | UserID | UniqueName

/**
 * Simple string hash function (same as GAS)
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
 * Get team index for email
 * @param {string} email - Email to hash
 * @returns {number} - Team index (0 to USERMAP_TEAM_COUNT-1)
 */
function getUserMapTeamIndex(email) {
    return hashString(email) % USERMAP_TEAM_COUNT;
}

/**
 * Update Nickname API (Hybrid Architecture)
 * 
 * Flow:
 * 1. Vercel: JWT verification, CORS
 * 2. GAS Web App: name_number allocation (with LockService)
 * 3. Vercel: Update UserMap with username#number
 * 
 * Architecture: Web → Vercel (JWT/CORS) → GAS (Lock+Counts) → Sheet
 * 
 * Request Body:
 * - token: Google ID Token (required)
 * - nickname: Nickname to set (optional, empty = registration only)
 */
module.exports = async (req, res) => {
    // Handle CORS
    if (handleCORS(req, res)) return;

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const gasWebAppUrl = process.env.GAS_WEB_APP_URL;
    const gasSecretKey = process.env.GAS_SECRET_KEY;

    try {
        // === 1. Verify Environment ===
        if (!gasWebAppUrl || !gasSecretKey) {
            return sendError(res, 500, 'Server misconfiguration', 'GAS 設定錯誤');
        }

        // === 2. Extract and Validate Input ===
        const { token, nickname } = req.body;

        // Verify JWT and extract email
        const email = verifyGoogleToken(token);
        if (!email) {
            return sendError(res, 401, 'Invalid or expired token', '請重新登入');
        }

        console.log(`[UPDATE_NICKNAME] Processing request for email: ${email}`);

        // === 3. Check if user exists in Total sheet ===
        const totalRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Total!A:A'
        });

        const totalRows = totalRes.data.values || [];
        let userID = null;
        let isNewUser = false;

        // Find email in Total sheet
        const emailIndex = totalRows.findIndex(row => row[0] === email);

        if (emailIndex === -1) {
            // New user - register in Total sheet
            isNewUser = true;
            console.log(`[UPDATE_NICKNAME] New user detected: ${email}`);

            const totalAppend = await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Total!A:A',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[email]] }
            });

            // Extract UserID from row number
            const updatedRange = totalAppend.data.updates.updatedRange;
            console.log(`[UPDATE_NICKNAME] Total append response:`, JSON.stringify(totalAppend.data.updates, null, 2));

            const match = updatedRange.match(/!A(\d+)/);
            userID = match ? match[1] : null;

            if (!userID) {
                console.error(`[UPDATE_NICKNAME] Failed to extract UserID. UpdatedRange: ${updatedRange}`);
                return sendError(res, 500, 'Failed to register user', '用戶註冊失敗');
            }

            console.log(`[UPDATE_NICKNAME] Registered new user with ID: ${userID}`);
        } else {
            // Existing user
            userID = (emailIndex + 1).toString(); // Row number is UserID
            console.log(`[UPDATE_NICKNAME] Existing user found with ID: ${userID}`);
        }

        // === 4. Call GAS Web App to get name_number (if nickname provided) ===
        let nameNumber = null;
        let uniqueName = '';

        if (nickname && nickname.trim()) {
            const username = nickname.trim();

            console.log(`[UPDATE_NICKNAME] Calling GAS for username: ${username}`);

            try {
                const gasResponse = await fetch(gasWebAppUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username: username,
                        secret: gasSecretKey
                    })
                });

                if (!gasResponse.ok) {
                    throw new Error(`GAS responded with status ${gasResponse.status}`);
                }

                const gasData = await gasResponse.json();
                console.log(`[UPDATE_NICKNAME] GAS response:`, gasData);

                if (!gasData.ok) {
                    throw new Error(gasData.error || 'GAS_ERROR');
                }

                nameNumber = gasData.name_number;
                uniqueName = `${username}#${nameNumber}`;

                console.log(`[UPDATE_NICKNAME] Allocated name: ${uniqueName}`);

            } catch (gasError) {
                console.error(`[UPDATE_NICKNAME] GAS call failed:`, gasError);
                return sendError(res, 500, 'Name allocation failed', 'name_number 分配失敗');
            }
        } else {
            // No nickname provided - sync mode: read existing uniqueName from UserMap
            console.log(`[UPDATE_NICKNAME] Sync mode: reading existing uniqueName from UserMap`);

            try {
                const teamIndex = getUserMapTeamIndex(email);
                const firstCol = teamIndex * USERMAP_COLS_PER_TEAM + 1;
                const lastCol = firstCol + USERMAP_COLS_PER_TEAM - 1;
                const colToLetter = (col) => String.fromCharCode(64 + col);
                const firstColLetter = colToLetter(firstCol);
                const lastColLetter = colToLetter(lastCol);

                const userMapRes = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `UserMap!${firstColLetter}:${lastColLetter}`
                });

                const teamData = userMapRes.data.values || [];

                for (let i = 0; i < teamData.length; i++) {
                    if (teamData[i] && teamData[i][0] === email) {
                        uniqueName = teamData[i][2] || ''; // Column 3 is UniqueName
                        console.log(`[UPDATE_NICKNAME] Found existing uniqueName: ${uniqueName || '(empty)'}`);
                        break;
                    }
                }
            } catch (readError) {
                console.error('[UPDATE_NICKNAME] Failed to read UserMap:', readError);
                // Continue without uniqueName
            }
        }

        // === 5. Update UserMap with uniqueName (Hash-based) ===
        // UserMap structure: 8 teams × 3 columns = 24 columns
        // Each team: [team0_email, team0_userID, team0_uniqueName, team1_email, ...]
        if (uniqueName || isNewUser) {
            try {
                // Calculate team columns based on email hash
                const teamIndex = getUserMapTeamIndex(email);
                const firstCol = teamIndex * USERMAP_COLS_PER_TEAM + 1; // 1-indexed
                const lastCol = firstCol + USERMAP_COLS_PER_TEAM - 1;

                // Convert column numbers to letters (1=A, 2=B, etc.)
                const colToLetter = (col) => String.fromCharCode(64 + col);
                const firstColLetter = colToLetter(firstCol);
                const lastColLetter = colToLetter(lastCol);

                console.log(`[UPDATE_NICKNAME] UserMap hash: email=${email}, teamIndex=${teamIndex}, cols=${firstColLetter}-${lastColLetter}`);

                // Get all data from this team's columns (starting from row 1)
                const userMapRes = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `UserMap!${firstColLetter}:${lastColLetter}`
                });

                const teamData = userMapRes.data.values || [];

                // Search for email in first column of this team
                let foundRowIndex = -1;
                for (let i = 0; i < teamData.length; i++) {
                    if (teamData[i] && teamData[i][0] === email) {
                        foundRowIndex = i;
                        break;
                    }
                }

                if (foundRowIndex !== -1) {
                    // Update existing row
                    const rowNum = foundRowIndex + 1; // 1-indexed
                    await sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `UserMap!${firstColLetter}${rowNum}:${lastColLetter}${rowNum}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[email, userID, uniqueName]] }
                    });
                    console.log(`[UPDATE_NICKNAME] Updated UserMap team ${teamIndex} row ${rowNum}`);
                } else {
                    // Find first empty row in this team
                    let emptyRowIndex = -1;
                    for (let i = 0; i < teamData.length; i++) {
                        if (!teamData[i] || !teamData[i][0]) {
                            emptyRowIndex = i;
                            break;
                        }
                    }

                    let targetRow;
                    if (emptyRowIndex !== -1) {
                        targetRow = emptyRowIndex + 1;
                    } else {
                        // Append after last row
                        targetRow = teamData.length + 1;
                    }

                    await sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `UserMap!${firstColLetter}${targetRow}:${lastColLetter}${targetRow}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[email, userID, uniqueName]] }
                    });
                    console.log(`[UPDATE_NICKNAME] Added to UserMap team ${teamIndex} row ${targetRow}: ${email}, ${userID}, ${uniqueName}`);
                }
            } catch (userMapError) {
                console.error('[UPDATE_NICKNAME] UserMap update failed:', userMapError);
                // Non-fatal error, continue with response
            }
        }

        // === 6. Return Response ===
        sendSuccess(res, {
            userID: userID,
            uniqueName: uniqueName || null,
            isNewUser: isNewUser
        }, isNewUser ? '新用戶註冊成功' : '資料更新成功');

    } catch (err) {
        console.error('[UPDATE_NICKNAME] Error:', err);
        sendError(res, 500, err.message, '伺服器錯誤，請稍後再試');
    }
};
