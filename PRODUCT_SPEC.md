# HeySurf — Product Specification

> Talk to any website. Voice-controlled AI browser agent that sees, understands, and acts on web pages as you.

## 1. Vision

HeySurf is a Chrome Extension that gives you a voice-powered AI copilot for the web. Open any website — your Gmail, Amazon, Jira, banking portal — tap the mic, and tell it what to do. It reads the page's accessibility tree, reasons about it, executes actions (click, type, navigate), and speaks the result back to you. All within your logged-in browser sessions, no passwords shared.

## 2. Core User Experience

### The "Happy Path"

```
1. User is on any website (e.g., resy.com)
2. Opens HeySurf side panel (keyboard shortcut or extension icon)
3. Taps the mic button (or uses hotkey)
4. Says: "Book a table for 2, this Friday at 7pm"
5. HeySurf shows real-time transcript + action log:
   - "Reading page..."
   - "Clicking 'Find a Table'..."
   - "Setting party size to 2..."
   - "Selecting Friday 7:00 PM..."
   - "Clicking 'Reserve'..."
6. Speaks back: "Done — reserved Friday at 7pm for 2 people"
```

### Interface: Chrome Side Panel

The UI lives in Chrome's Side Panel API — a persistent sidebar that stays open alongside any website without covering page content.

**Side Panel Layout:**
```
┌─────────────────────────┐
│  HeySurf          [⚙️]  │
├─────────────────────────┤
│                         │
│  Conversation history   │
│  (scrollable)           │
│                         │
│  ┌───────────────────┐  │
│  │ 🎤 "Book a table  │  │
│  │ for 2 on Friday"  │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ 🤖 Reading page...│  │
│  │ → Click: "Find"   │  │
│  │ → Type: "2"       │  │
│  │ → Click: "7:00 PM"│  │
│  │ ✅ Booked!        │  │
│  └───────────────────┘  │
│                         │
├─────────────────────────┤
│  [🎤 Tap to speak]     │
│  or type a command...   │
├─────────────────────────┤
│  [Status: Ready]        │
└─────────────────────────┘
```

## 3. Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3)                         │
│                                                         │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────┐  │
│  │  Side Panel   │   │ Content Script │   │ Service  │  │
│  │  (UI)         │   │ (per tab)      │   │ Worker   │  │
│  │               │   │                │   │ (brain)  │  │
│  │ • Voice I/O   │   │ • Read a11y    │   │          │  │
│  │ • Chat log    │   │   tree         │   │ • Agent  │  │
│  │ • Settings    │◄─►│ • Execute DOM  │◄─►│   loop   │  │
│  │ • Status      │   │   actions      │   │ • LLM    │  │
│  │               │   │ • Observe      │   │   calls  │  │
│  │               │   │   mutations    │   │ • State  │  │
│  └──────────────┘   └────────────────┘   └────┬─────┘  │
│                                                │        │
└────────────────────────────────────────────────┼────────┘
                                                 │
                                    ┌────────────▼────────────┐
                                    │   LLM Provider Layer    │
                                    │                         │
                                    │  ┌─────────┐ ┌───────┐ │
                                    │  │ OpenAI  │ │Claude │ │
                                    │  │ (deflt) │ │Gemini │ │
                                    │  │         │ │etc.   │ │
                                    │  └─────────┘ └───────┘ │
                                    └─────────────────────────┘
```

### Component Responsibilities

**Side Panel (UI Layer)**
- Voice input via Web Speech API (SpeechRecognition)
- Voice output via Web Speech API (SpeechSynthesis)
- Text input fallback (type instead of speak)
- Conversation history display
- Real-time action log (what the agent is doing)
- Settings panel (API keys, voice preferences, LLM provider selection)
- Stop/cancel button for in-progress tasks

**Content Script (Page Layer)**
- Injected into every tab the user activates HeySurf on
- Extracts the accessibility tree from the live DOM
- Executes actions: click, type, select, scroll, navigate
- Reports DOM mutations (page changed after action)
- Highlights elements being acted on (visual feedback)

**Service Worker (Brain)**
- Orchestrates the agent loop
- Manages conversation state
- Calls LLM API with accessibility tree + task
- Parses LLM responses into executable actions
- Routes actions to the correct tab's content script
- Handles errors, retries, and task completion detection

## 4. Agent Loop (Core Algorithm)

```
function agentLoop(userTask):
    conversationHistory = []
    maxSteps = 15

    for step in 1..maxSteps:
        // 1. Read current page state
        tree = contentScript.getAccessibilityTree()
        url  = contentScript.getCurrentURL()
        title = contentScript.getPageTitle()

        // 2. Ask LLM what to do next
        response = llm.chat({
            system: SYSTEM_PROMPT,
            messages: [
                ...conversationHistory,
                {
                    role: "user",
                    content: formatPageContext(url, title, tree) +
                             (step == 1 ? userTask : "Action executed. Here's the updated page.")
                }
            ],
            tools: ACTION_TOOLS  // defined as function-calling tools
        })

        // 3. If LLM returns a tool call → execute it
        if response.hasToolCall:
            action = response.toolCall  // e.g., { name: "click", args: { selector: ... } }
            result = contentScript.executeAction(action)
            conversationHistory.append(response, result)
            updateUI("Executed: " + action.description)

        // 4. If LLM returns text → task is done (or needs clarification)
        else:
            speak(response.text)
            updateUI(response.text)
            return response.text
```

## 5. LLM Integration — Provider Abstraction

### Interface

```typescript
// src/llm/provider.ts

interface LLMProvider {
    name: string;
    chat(request: ChatRequest): Promise<ChatResponse>;
}

interface ChatRequest {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
}

interface ChatResponse {
    type: 'text' | 'tool_call';
    text?: string;
    toolCall?: {
        name: string;
        arguments: Record<string, any>;
    };
}
```

### Providers

```typescript
// src/llm/providers/openai.ts    ← default
// src/llm/providers/anthropic.ts ← swap-in
// src/llm/providers/gemini.ts    ← swap-in

// Factory
function createProvider(config: { provider: string; apiKey: string; model: string }): LLMProvider
```

### Default Configuration

| Role | Default Provider | Default Model | Why |
|------|-----------------|---------------|-----|
| Reasoning (agent loop) | OpenAI | gpt-4o | Strong tool-calling, fast |
| Voice-to-text | Web Speech API | Chrome built-in | Free, zero latency |
| Text-to-voice | Web Speech API | Chrome built-in | Free, instant |

User can override any of these in Settings. The voice layer can also be swapped to OpenAI Whisper / TTS if desired (future enhancement).

## 6. Tool Definitions (Function Calling)

The LLM sees these as callable tools:

```typescript
const AGENT_TOOLS = [
    {
        name: "click",
        description: "Click an element on the page",
        parameters: {
            target: "string — accessible name, role, or text content of the element",
            index: "number (optional) — if multiple matches, which one (0-indexed)"
        }
    },
    {
        name: "type",
        description: "Type text into an input field",
        parameters: {
            target: "string — accessible name or label of the input",
            text: "string — the text to type",
            clearFirst: "boolean — whether to clear existing text first (default: true)"
        }
    },
    {
        name: "select",
        description: "Select an option from a dropdown",
        parameters: {
            target: "string — accessible name of the select element",
            option: "string — the option text to select"
        }
    },
    {
        name: "scroll",
        description: "Scroll the page",
        parameters: {
            direction: "'up' | 'down' | 'top' | 'bottom'",
            amount: "number (optional) — pixels to scroll, default 500"
        }
    },
    {
        name: "navigate",
        description: "Navigate to a URL",
        parameters: {
            url: "string — the URL to navigate to"
        }
    },
    {
        name: "read_page",
        description: "Read specific content from the page (when the a11y tree is insufficient)",
        parameters: {
            query: "string — what content to extract (e.g., 'the price', 'all email addresses')"
        }
    },
    {
        name: "wait",
        description: "Wait for the page to update (e.g., after navigation or AJAX)",
        parameters: {
            milliseconds: "number — how long to wait (default: 2000)"
        }
    },
    {
        name: "done",
        description: "Signal that the task is complete",
        parameters: {
            summary: "string — what was accomplished, spoken back to the user"
        }
    }
]
```

## 7. Accessibility Tree Extraction

### Strategy

Content script builds a **compressed** accessibility tree representation optimized for LLM consumption:

```typescript
interface A11yNode {
    id: number;            // sequential ID for targeting
    role: string;          // button, link, textbox, heading, etc.
    name: string;          // accessible name (label text, aria-label, etc.)
    value?: string;        // current value (for inputs)
    description?: string;  // aria-description if present
    focused?: boolean;     // currently focused element
    checked?: boolean;     // for checkboxes/radios
    disabled?: boolean;    // if not interactive
    children?: A11yNode[]; // nested structure
}
```

### Compression Rules (keep token count low)

1. Skip purely decorative/layout nodes (div, span with no role)
2. Collapse text-only subtrees into a single text node
3. Truncate long text content to 200 characters
4. Skip hidden/aria-hidden elements
5. Limit tree depth to 8 levels
6. Cap total nodes at 500 (prioritize interactive elements)
7. Always include: buttons, links, inputs, headings, landmarks

### Output Format (sent to LLM)

```
Page: "Resy - Book Restaurants" (https://resy.com/cities/ny)

[1] heading "Find your table"
[2] textbox "Search restaurants" value=""
[3] button "Location: New York"
[4] button "Party Size: 2"
[5] button "Date: Today"
[6] button "Time: 7:00 PM"
[7] button "Search"
[8] heading "Featured"
[9] link "Le Bernardin"
[10] text "French · Midtown · $$$$"
[11] link "Carbone"
[12] text "Italian · Greenwich Village · $$$$"
...
```

## 8. System Prompt

```
You are HeySurf, a voice-controlled browser agent. You help users accomplish tasks
on web pages by reading the page structure and taking actions.

RULES:
1. You receive the page's accessibility tree with numbered elements [1], [2], etc.
2. To interact with elements, use the provided tools (click, type, select, etc.)
   referencing elements by their accessible name or text content.
3. Execute ONE action at a time, then wait for the updated page state.
4. When the task is complete, use the "done" tool with a brief spoken summary.
5. If you need information from the user, respond with a text message (it will
   be spoken aloud). Do NOT guess or assume information like dates, names, etc.
6. If a page requires login and the user is not logged in, tell them.
7. Keep your responses concise — they will be spoken aloud.
8. If you're stuck after 2 attempts on the same element, explain the problem
   and ask the user for guidance.

NEVER:
- Navigate away from the current site without asking
- Submit payment forms without explicit confirmation
- Click "delete" or destructive actions without confirming
- Share or read sensitive data aloud (passwords, SSNs, etc.)
```

## 9. Project Structure

```
heysurf/
├── manifest.json              # Chrome Extension manifest (MV3)
├── package.json               # Build dependencies
├── tsconfig.json              # TypeScript config
├── webpack.config.js          # Build config
│
├── src/
│   ├── background/
│   │   ├── service-worker.ts  # Extension service worker
│   │   └── agent-loop.ts     # Core agent orchestration
│   │
│   ├── content/
│   │   ├── content-script.ts  # Injected into web pages
│   │   ├── a11y-tree.ts      # Accessibility tree extraction
│   │   ├── actions.ts        # DOM action execution (click, type, etc.)
│   │   └── highlighter.ts    # Visual feedback overlay
│   │
│   ├── sidepanel/
│   │   ├── index.html        # Side panel HTML
│   │   ├── sidepanel.ts      # Side panel logic
│   │   ├── styles.css        # Side panel styles
│   │   └── components/
│   │       ├── chat.ts       # Chat message display
│   │       ├── voice.ts      # Mic button + voice I/O
│   │       └── settings.ts   # Settings panel
│   │
│   ├── llm/
│   │   ├── provider.ts       # LLMProvider interface
│   │   ├── tools.ts          # Tool definitions for function calling
│   │   ├── prompts.ts        # System prompts
│   │   └── providers/
│   │       ├── openai.ts     # OpenAI implementation (default)
│   │       ├── anthropic.ts  # Claude implementation
│   │       └── gemini.ts     # Gemini implementation
│   │
│   ├── shared/
│   │   ├── types.ts          # Shared TypeScript types
│   │   ├── messages.ts       # Chrome message passing types
│   │   └── storage.ts        # Chrome storage helpers
│   │
│   └── assets/
│       ├── icon-16.png
│       ├── icon-48.png
│       └── icon-128.png
│
├── PRODUCT_SPEC.md            # This file
└── README.md                  # Setup + usage instructions
```

## 10. Chrome Extension Manifest

```json
{
    "manifest_version": 3,
    "name": "HeySurf",
    "version": "0.1.0",
    "description": "Voice-controlled AI browser agent. Talk to any website.",

    "permissions": [
        "activeTab",
        "sidePanel",
        "storage",
        "scripting",
        "tabs"
    ],

    "background": {
        "service_worker": "background/service-worker.js",
        "type": "module"
    },

    "content_scripts": [{
        "matches": ["<all_urls>"],
        "js": ["content/content-script.js"],
        "run_at": "document_idle"
    }],

    "side_panel": {
        "default_path": "sidepanel/index.html"
    },

    "action": {
        "default_icon": {
            "16": "assets/icon-16.png",
            "48": "assets/icon-48.png",
            "128": "assets/icon-128.png"
        },
        "default_title": "HeySurf"
    },

    "icons": {
        "16": "assets/icon-16.png",
        "48": "assets/icon-48.png",
        "128": "assets/icon-128.png"
    }
}
```

## 11. Voice I/O Specification

### Speech-to-Text (Input)
- **Engine:** Web Speech API (`webkitSpeechRecognition`)
- **Language:** `en-US` (configurable)
- **Mode:** Single utterance (stops after silence)
- **Fallback:** Text input field always available
- **Visual:** Pulsing mic icon during listening, transcript shown in real-time

### Text-to-Speech (Output)
- **Engine:** Web Speech API (`SpeechSynthesis`)
- **Voice:** System default (user can pick from available voices in settings)
- **Behavior:** Speaks task completion summaries and clarifying questions
- **Control:** User can mute TTS in settings; visual transcript always shown

### Future Voice Upgrades (not in MVP)
- OpenAI Whisper for better transcription accuracy
- OpenAI TTS or ElevenLabs for natural-sounding voice
- Continuous listening mode with wake word ("Hey Surf")

## 12. Settings (Stored in chrome.storage.local)

```typescript
interface HeySurfSettings {
    // LLM Configuration
    llm: {
        provider: 'openai' | 'anthropic' | 'gemini';
        apiKey: string;
        model: string;  // e.g., "gpt-4o", "claude-sonnet-4-6", "gemini-2.0-flash"
    };

    // Voice Configuration
    voice: {
        inputEnabled: boolean;      // use mic (true) or text-only (false)
        outputEnabled: boolean;     // speak results aloud
        language: string;           // e.g., "en-US"
        voiceURI?: string;          // specific TTS voice
        rate: number;               // speech rate (0.5 - 2.0, default 1.0)
    };

    // Agent Behavior
    agent: {
        maxSteps: number;           // max actions per task (default: 15)
        confirmDestructive: boolean; // ask before delete/submit/pay (default: true)
        autoScroll: boolean;        // scroll to elements before acting (default: true)
        highlightActions: boolean;  // visual overlay on targeted elements (default: true)
    };
}
```

## 13. Security & Safety

### Hard Rules (non-configurable)
- API keys stored in `chrome.storage.local` (never synced, never sent except to LLM)
- Content script only injected on active tab when agent is running
- Agent never reads or speaks passwords, credit card numbers, SSNs
- Payment submission requires explicit voice/text confirmation
- Delete/destructive actions require confirmation
- Agent stops after `maxSteps` to prevent infinite loops

### Permissions (minimal)
- `activeTab` — only access the current tab when clicked
- `sidePanel` — the UI surface
- `storage` — persist settings and conversation history
- `scripting` — inject content script on demand
- `tabs` — read tab URL/title for context

No `<all_urls>` host permission. No `cookies`. No `webRequest`. Minimal attack surface.

## 14. MVP Scope (Weekend Build)

### In Scope
- [x] Chrome extension with side panel UI
- [x] Voice input (Web Speech API)
- [x] Voice output (SpeechSynthesis)
- [x] Text input fallback
- [x] Accessibility tree extraction from any page
- [x] Agent loop: tree → LLM → action → repeat
- [x] Actions: click, type, select, scroll, navigate, wait
- [x] OpenAI as default LLM with provider abstraction
- [x] Real-time action log in side panel
- [x] Visual element highlighting during actions
- [x] Settings panel (API key, model, voice preferences)
- [x] Conversation history (per session)
- [x] Safety confirmations for destructive actions

### Out of Scope (v2+)
- [ ] Multi-tab orchestration (act across multiple tabs)
- [ ] Workflow recording and replay
- [ ] Scheduled tasks
- [ ] Persistent conversation history across sessions
- [ ] OpenAI Whisper / TTS integration
- [ ] Wake word detection ("Hey Surf")
- [ ] Sharing workflows with others
- [ ] Cloud execution mode

## 15. Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Build | Webpack 5 |
| Extension | Chrome Manifest V3 |
| UI | Vanilla HTML/CSS/TS (no framework — keep it light) |
| Voice I/O | Web Speech API (built into Chrome) |
| LLM (default) | OpenAI GPT-4o via REST API |
| LLM (swappable) | Anthropic Claude, Google Gemini |
| State | chrome.storage.local |

No React, no Tailwind, no heavy dependencies. A Chrome extension should be fast and tiny.

## 16. Success Criteria

The weekend build is "done" when this demo works:

1. **Gmail:** "Summarize my latest 3 emails" → agent reads inbox, speaks summaries
2. **Amazon:** "Find the cheapest USB-C cable with 4+ stars" → navigates, filters, reports
3. **Wikipedia:** "What year was the Eiffel Tower built?" → reads page, answers
4. **Any form:** "Fill in my name as John Doe and email as john@example.com" → fills fields

If those 4 work, ship it.
