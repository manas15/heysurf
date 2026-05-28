# HeySurf

Voice-controlled AI browser agent. Talk to any website.

## Setup

```bash
npm install
npm run build
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder from this project

## Usage

1. Click the HeySurf icon (or pin it to toolbar) to open the side panel
2. Open Settings (gear icon) and add your OpenAI API key
3. Navigate to any website
4. Tap the mic or type a command like:
   - "Summarize this page"
   - "Find the cheapest option"
   - "Fill in my name as John Doe"
5. Watch the agent work and hear the results

## Development

```bash
npm run dev   # watch mode — rebuilds on file changes
```

Then reload the extension in `chrome://extensions` after each rebuild.

## LLM Providers

HeySurf defaults to OpenAI but supports swapping to any provider in Settings:

| Provider | Models |
|----------|--------|
| OpenAI | gpt-4o, gpt-4o-mini |
| Anthropic | claude-sonnet-4-6-20250514 |
| Google | gemini-2.0-flash, gemini-2.5-pro |
