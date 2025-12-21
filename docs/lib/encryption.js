/**
 * Simple nickname encryption/decryption utilities
 * Uses Base64 encoding with UserID as salt
 */

/**
 * Encrypt nickname with UserID as salt
 * @param {string} nickname - Original nickname (e.g., "PlayerName#123")
 * @param {number|string} userID - User ID to use as salt
 * @returns {string} - Base64 encoded encrypted nickname
 */
function encryptNickname(nickname, userID) {
    if (!nickname) return '';

    const salt = userID.toString();
    const combined = `${salt}:${nickname}`;

    // Base64 encode
    return Buffer.from(combined, 'utf8').toString('base64');
}

/**
 * Decrypt nickname with UserID verification
 * @param {string} encrypted - Base64 encoded encrypted nickname
 * @param {number|string} userID - User ID to verify
 * @returns {string|null} - Decrypted nickname or null if verification fails
 */
function decryptNickname(encrypted, userID) {
    if (!encrypted) return null;

    try {
        // Base64 decode
        const decoded = Buffer.from(encrypted, 'base64').toString('utf8');
        const [salt, nickname] = decoded.split(':');

        // Verify salt matches userID
        if (salt !== userID.toString()) {
            console.warn('[Encryption] UserID mismatch in decryption');
            return null;
        }

        return nickname;
    } catch (error) {
        console.error('[Encryption] Decryption error:', error.message);
        return null;
    }
}

/**
 * Batch encrypt multiple nicknames
 * @param {Array} items - Array of objects with nickname and userID
 * @returns {Array} - Array with encrypted nicknames
 */
function encryptNicknames(items) {
    return items.map(item => ({
        ...item,
        encryptedNickname: encryptNickname(item.nickname, item.userID)
    }));
}

/**
 * Batch decrypt multiple nicknames
 * @param {Array} items - Array of objects with encryptedNickname and userID
 * @returns {Array} - Array with decrypted nicknames
 */
function decryptNicknames(items) {
    return items.map(item => ({
        ...item,
        nickname: decryptNickname(item.encryptedNickname, item.userID)
    }));
}

module.exports = {
    encryptNickname,
    decryptNickname,
    encryptNicknames,
    decryptNicknames
};
