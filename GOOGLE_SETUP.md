# Google Cloud & Vercel Setup Instructions

To make the API work, you must set up a project in Google Cloud and link it to Vercel.

## Part 1: Google Cloud Setup
1.  Go to [Google Cloud Console](https://console.cloud.google.com/).
2.  **Create a New Project** (e.g., "Rubiks Timer").
3.  **Enable Google Sheets API**:
    - Go to "APIs & Services" > "Library".
    - Search for "Google Sheets API" and click **Enable**.
4.  **Create Service Account (For Vercel)**:
    - Go to "APIs & Services" > "Credentials".
    - Click "Create Credentials" > "Service Account".
    - Name it (e.g., "vercel-server").
    - **Important**: Grant it the role **Editor** (or Sheets Editor) so it can write to your sheet.
    - Click "Done".
    - Click on the newly created Service Account (email address).
    - Go to the **Keys** tab > "Add Key" > "Create new key" > **JSON**.
    - **Save this file!** You will need it for Vercel.
5.  **Create OAuth Client (For Frontend Login)**:
    - Go to "APIs & Services" > "Credentials".
    - Click "Create Credentials" > "OAuth client ID".
    - Application Type: **Web application**.
    - Authorized JavaScript origins:
        - `http://localhost:3000` (for local testing)
        - `https://your-github-username.github.io` (your production site)
    - Copy the **Client ID**. (You don't need the Client Secret for the frontend).

## Part 2: Google Sheet Setup
1.  Create a new Google Sheet at [sheets.google.com](https://sheets.google.com).
2.  **Share** the sheet with the **Service Account Email** (from Part 1, Step 4). Give it "Editor" access.
3.  Copy the **Spreadsheet ID** from the URL:
    - `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_IS_HERE/edit...`

## Part 3: Vercel Setup
1.  Install Vercel CLI: `npm i -g vercel` (or use the Vercel website).
2.  Deploy your project: `vercel` (run in terminal).
    - **IMPORTANT**: When Vercel asks, set the **Root Directory** to `docs`.
    - If it asks "Want to modify these settings?", answer **y** and change the location.
3.  **Environment Variables**:
    - Go to your Vercel Project Settings > Environment Variables.
    - Add the following:
        - `GOOGLE_CLIENT_EMAIL`: (From your JSON Key file)
        - `GOOGLE_PRIVATE_KEY`: (From your JSON Key file)
        - `GOOGLE_SHEET_ID`: (Your Spreadsheet ID)
        - `GOOGLE_CLIENT_ID`: (Your OAuth Client ID)
    - **Redeploy** for changes to take effect.
