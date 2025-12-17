const fetch = require('node-fetch');
const getSheetsClient = require('./sheetsClient');
const {
    handleCORS,
    verifyGoogleToken,
    sendError,
    sendSuccess
} = require('../lib/apiUtils');

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
        }

        // === 5. Update UserMap with uniqueName ===
        // UserMap stores: Email | UserID | UniqueName
        if (uniqueName) {
            try {
                // Check if email already exists in UserMap
                const userMapRes = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: 'UserMap!A:A'
                });

                const userMapRows = userMapRes.data.values || [];
                const existingIndex = userMapRows.findIndex(row => row[0] === email);

                if (existingIndex !== -1) {
                    // Update existing row (row number = index + 1)
                    const rowNum = existingIndex + 1;
                    await sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `UserMap!A${rowNum}:C${rowNum}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[email, userID, uniqueName]] }
                    });
                    console.log(`[UPDATE_NICKNAME] Updated UserMap row ${rowNum}`);
                } else {
                    // Append new row
                    await sheets.spreadsheets.values.append({
                        spreadsheetId,
                        range: 'UserMap!A:C',
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[email, userID, uniqueName]] }
                    });
                    console.log(`[UPDATE_NICKNAME] Appended to UserMap: ${email}, ${userID}, ${uniqueName}`);
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
