# PS5 In-Person Store Finder

A simple web app that helps you search for PS5 stock at Bengaluru electronics retail chains and gaming stores.

## Features
- Enter a product like `PS5`
- Voice input option for product selection
- AI-backed store contact discovery and availability verification
- Filters for brand, distance, and price

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` and add your key(s):
   - `SEARCHSPACE_API_KEY` for live seller contact discovery
   - `AGORA_APP_ID` for the voice-agent simulation label
   - Optional: `GEMINI_API_KEY` as a fallback search assistant
   - Optionally `PORT`
3. Start the app:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:5173`

## Notes
- The app uses a predefined list of Bengaluru electronics chains and gaming stores.
- SearchSpace is used to find real seller phone numbers from the web. The app does not scrape Google directly.
- If SearchSpace is missing or unauthorized, the platform can only use local verified fallback contacts.
- The verification step uses an AI assistant to simulate a voice call check and return availability.
