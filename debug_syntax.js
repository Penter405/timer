const fs = require('fs');

// Mock Env
process.env.GOOGLE_CLIENT_ID = 'mock';
process.env.GOOGLE_SHEET_ID = 'mock';
process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{}';

const files = ['api/update_nickname.js', 'api/get_nicknames.js', 'api/save_time.js'];

files.forEach(f => {
    try {
        console.log(`Checking ${f}...`);
        require(`./${f}`);
        console.log(`✅ ${f} syntax is OK`);
    } catch (e) {
        console.error(`❌ ${f} FAILED:`, e.message);
        // Note: Some errors might be due to missing dependencies if not installed, 
        // but syntax errors will show up.
    }
});
