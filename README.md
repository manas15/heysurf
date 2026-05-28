# HeySurf 🏄

> Voice-controlled AI browser agent. Talk to any website.

HeySurf is a Chrome Extension that gives you a voice-powered AI copilot for the web. Open any website — Gmail, Amazon, GitHub, your banking portal — tap the mic, and tell it what to do. It reads the page's accessibility tree, creates a plan, executes actions with animated visual feedback, and speaks the result back to you.

## What It Does

- **Voice control** — speak commands, hear results (MediaRecorder + Whisper API)
- **Works on any website** — uses the DOM accessibility tree, not screenshots or vision models
- **Goal-oriented** — creates multi-step plans, tracks progress, recovers from failures
- **Multi-tab** — opens, reads, and acts across multiple browser tabs
- **Knows you** — learns your name, email, preferences, and commonly used sites
- **Visual feedback** — animated cursor, click ripples, element highlights show exactly what the agent is doing
- **Swappable LLMs** — OpenAI (default), Anthropic Claude, Google Gemini

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3)                          │
│                                                          │
│  ┌──────────────┐  ┌─────────────────┐  ┌────────────┐  │
│  │  Side Panel   │  │ Content Script  │  │  Service   │  │
│  │  (UI)         │  │ (per tab)       │  │  Worker    │  │
│  │               │  │                 │  │  (brain)   │  │
│  │ • Voice I/O   │  │ • A11y tree     │  │            │  │
│  │ • Chat log    │  │ • DOM actions   │  │ • Planner  │  │
│  │ • Plan view   │◄►│ • Overlay       │◄►│ • Agent    │  │
│  │ • Onboarding  │  │   cursor        │  │   loop     │  │
│  │ • Settings    │  │ • Visual        │  │ • Tab mgr  │  │
│  │ • Memories    │  │   feedback      │  │ • Memory   │  │
│  └──────────────┘  └─────────────────┘  └─────┬──────┘  │
│                                                │         │
└────────────────────────────────────────────────┼─────────┘
                                                 │
                                    ┌────────────▼──────────┐
                                    │    LLM Provider       │
                                    │  OpenAI / Claude /    │
                                    │  Gemini (swappable)   │
                                    └───────────────────────┘
```

### How the Agent Loop Works

```
User speaks → Whisper transcribes → Planner creates step-by-step plan
  → For each step:
      → Read page accessibility tree → Cursor moves to target
      → Highlight element + show label → Execute action
      → Verify step completion → Update working memory
      → Check if plan needs revision
  → Speak result back → Extract and save new memories
```

### Core Technology: DOM-Native Agents

Instead of taking screenshots and using vision models (expensive, slow, detectable), HeySurf reads the **accessibility tree** — the same structure screen readers use. This is:

| | Screenshots (vision) | Accessibility Tree (HeySurf) |
|---|---|---|
| Token cost | ~500KB per page | ~5-50KB per page |
| Speed | Slow (image processing) | Fast (text only) |
| Accuracy | Depends on visual layout | Semantic understanding |
| Cost | 25x more expensive | Minimal |
| Detection | Easy to detect | Uses standard browser APIs |

## Project Structure

```
heysurf/
├── manifest.json              # Chrome Extension manifest (MV3)
├── package.json
├── tsconfig.json
├── webpack.config.js
│
├── src/
│   ├── background/            # Service worker (the brain)
│   │   ├── service-worker.ts  # Extension lifecycle + message routing
│   │   ├── agent-loop.ts      # Plan-Act-Verify-Replan orchestration
│   │   ├── planner.ts         # Task planning + replanning LLM calls
│   │   ├── tab-manager.ts     # Multi-tab registry + operations
│   │   └── memory-extractor.ts# Post-task memory extraction
│   │
│   ├── content/               # Content scripts (injected into pages)
│   │   ├── content-script.ts  # Message handler
│   │   ├── a11y-tree.ts       # Accessibility tree extraction
│   │   ├── actions.ts         # DOM actions (click, type, scroll, etc.)
│   │   ├── overlay-host.ts    # Shadow DOM overlay container
│   │   ├── cursor.ts          # Animated SVG cursor
│   │   ├── effects.ts         # Click ripple, typing indicator, etc.
│   │   ├── highlight-overlay.ts # Overlay-based element highlights
│   │   └── visual-feedback.ts # Orchestrator for all visual effects
│   │
│   ├── sidepanel/             # Side panel UI
│   │   ├── index.html
│   │   ├── sidepanel.ts       # Main UI logic
│   │   ├── styles.css         # Dark theme styles
│   │   ├── voice.ts           # MediaRecorder + Whisper integration
│   │   ├── onboarding.ts      # First-run receptionist flow
│   │   └── memory-viewer.ts   # "What HeySurf knows" settings page
│   │
│   ├── llm/                   # LLM provider abstraction
│   │   ├── provider.ts        # Factory function
│   │   ├── tools.ts           # Function calling tool definitions
│   │   ├── prompts.ts         # System prompts + planning prompts
│   │   └── providers/
│   │       ├── openai.ts      # OpenAI GPT-4o (default)
│   │       ├── anthropic.ts   # Anthropic Claude
│   │       └── gemini.ts      # Google Gemini
│   │
│   ├── shared/                # Shared types and utilities
│   │   ├── types.ts           # TypeScript types for everything
│   │   ├── storage.ts         # chrome.storage helpers
│   │   └── messages.ts        # Typed message bus
│   │
│   └── assets/
│       ├── icon-16.png
│       ├── icon-48.png
│       ├── icon-128.png
│       └── permission.html    # Mic permission flow
│
├── PRD_V2.md                  # Technical product requirements
├── PRODUCT_SPEC.md            # Original v1 specification
├── HEYSURF_V2_PLAN.md         # v2 redesign plan
└── README.md                  # This file
```

## Setup & Development

### Prerequisites
- Node.js 18+
- Chrome browser
- An API key from OpenAI, Anthropic, or Google

### Install & Build

```bash
git clone https://github.com/manas15/heysurf.git
cd heysurf
npm install
npm run build
```

### Load in Chrome (Developer Mode)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder from this project
5. Pin HeySurf to your toolbar

### Development (Watch Mode)

```bash
npm run dev
```

This watches for file changes and rebuilds automatically. After each rebuild, go to `chrome://extensions` and click the reload button on HeySurf.

## Usage

### First Run
1. Click the HeySurf icon to open the side panel
2. Select your LLM provider and enter your API key
3. Complete the quick onboarding (name, email, role, preferred sites)
4. Navigate to any website and start talking

### Voice Commands
- "Summarize this page"
- "Find the cheapest flight to Tokyo in August"
- "Fill in the form with my name and email"
- "Open LinkedIn and search for software engineer jobs in NYC"
- "Compare the prices on these two tabs"

### Keyboard Shortcuts
- Click mic button or press to start recording
- Press Enter to send a typed command
- Type commands as fallback when voice isn't convenient

## LLM Providers

HeySurf supports swapping the LLM at any time in Settings:

| Provider | Default Model | Best For |
|----------|--------------|----------|
| **OpenAI** | gpt-4o | Best tool-calling, fastest |
| **Anthropic** | claude-sonnet-4-6-20250514 | Strong reasoning |
| **Google Gemini** | gemini-2.0-flash | Cheapest, good enough |

## Version History

### v2.0 (Current)
- Voice I/O via MediaRecorder + Whisper API (actually works)
- Goal-oriented planner with step verification and replanning
- Multi-tab orchestration (open, read, switch, close tabs)
- Personalization: onboarding, conversational memory, behavioral learning
- Visual feedback: animated cursor, click ripples, overlay highlights, typing indicators
- Shadow DOM overlay (no page interference)
- Improved onboarding with provider cards and key validation
- Plan display in side panel with real-time progress

### v1.0
- Basic Chrome extension with side panel
- Accessibility tree extraction
- Reactive agent loop (one action at a time, no planning)
- OpenAI/Anthropic/Gemini provider abstraction
- Web Speech API (broken in extensions — replaced in v2)
- CSS class-based element highlighting (fragile — replaced in v2)

## What's Still Relevant from v1

The following v1 components carry forward into v2 (with modifications):

| Component | v1 Status | v2 Status |
|-----------|-----------|-----------|
| Manifest V3 structure | Working | Updated (added permissions) |
| A11y tree extraction | Working | Kept as-is |
| LLM provider abstraction | Working | Kept, models updated |
| OpenAI provider | Working | Kept as-is |
| Anthropic provider | Working | Kept as-is |
| Gemini provider | Working | Kept as-is |
| Tool definitions | Working | Extended with multi-tab tools |
| chrome.storage helpers | Working | Extended with profile/memory |
| TypeScript + Webpack build | Working | Kept as-is |
| Side panel HTML/CSS | Working | Redesigned |
| SpeechRecognition voice | Broken | Replaced with Whisper |
| CSS class highlighting | Fragile | Replaced with Shadow DOM overlay |
| Reactive agent loop | Limited | Replaced with planner |
| Content script messaging | Working (after fixes) | Improved with PING/PONG |

## Contributing

This is a personal project. PRs welcome for bug fixes and improvements.

## License

MIT
