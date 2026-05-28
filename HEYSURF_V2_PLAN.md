# HeySurf v2.0 — Complete Redesign Plan

> Based on deep research into multi-tab orchestration, personalization systems, voice in Chrome extensions, goal-oriented agent planning, and visual cursor feedback.

---

## What Was Wrong with v1 (Your Feedback, Diagnosed)

| Your Feedback | Root Cause | v2 Fix |
|---|---|---|
| "Doesn't understand working with multiple tabs" | v1 only reads the active tab. No tab registry, no cross-tab state, no ability to open/manage background tabs | Full multi-tab orchestrator with tab registry and cross-tab context |
| "Has no concept of who I am" | No onboarding, no user profile, no memory. Every session starts from zero | Onboarding receptionist + persistent memory + conversational context extraction |
| "Voice feature doesn't work at all" | `SpeechRecognition` API is **broken** in Chrome extension side panels (known Chromium bug — `chrome-extension://` origins are refused). This was never going to work | Replace with `MediaRecorder` + OpenAI Whisper API. Use `SpeechSynthesis` for TTS (this part works) |
| "Not able to understand how its actions are connected or what goal it's trying to achieve" | v1 is purely reactive — one action at a time with no plan. No working memory, no progress tracking, no goal anchoring | Plan-Act-Replan architecture with explicit task plans, step verification, working memory, and goal anchoring in every LLM call |
| "No pointer on screen to show what it's doing" | v1 only adds a CSS class outline to elements (fragile, invisible on many sites) | Shadow DOM overlay with animated cursor, click ripples, highlight boxes with labels, typing indicators, scroll indicators |

---

## Architecture: v1 vs v2

### v1 (Reactive)
```
User speaks → Read page → Ask LLM "what next?" → Do it → Repeat → Maybe done
```

### v2 (Goal-Oriented with Visual Feedback)
```
User speaks → Whisper transcribes → Planner creates step-by-step plan
  → For each step:
      → Read page(s) across tabs → Cursor moves to target → Highlight + label
      → Execute action with visual feedback → Verify step completion
      → Update working memory → Check if plan needs revision
  → Speak result back to user → Extract and save memories
```

---

## Component 1: Voice I/O (Fixed)

### Problem
`webkitSpeechRecognition` does NOT work in Chrome extension side panels. The API requires an HTTPS origin, but extension pages run under `chrome-extension://` which Chrome's speech service refuses. This is a confirmed, years-old Chromium bug.

### Solution: MediaRecorder + Whisper API

```
[Side Panel]
  │
  ├─ getUserMedia({ audio: true })     ← DOES work in side panels
  ├─ MediaRecorder captures webm/opus
  ├─ On stop → POST audio blob to OpenAI Whisper API
  ├─ Receive transcript text
  │
  └─ For TTS: SpeechSynthesis           ← DOES work in side panels
```

**Key implementation details:**
- `getUserMedia()` works in side panels (unlike `SpeechRecognition`)
- Record as `audio/webm;codecs=opus` — Whisper accepts this natively
- First-time mic permission: if `getUserMedia` fails with `NotAllowedError`, open a popup window (`chrome.windows.create`) with a permission.html page that triggers the browser's mic prompt, then close it
- Whisper API cost: ~$0.006/minute — negligible
- Latency: ~1-2 seconds for typical utterances (record → upload → transcribe)

**Voice settings (user configurable):**
- STT provider: Whisper (default), or Deepgram for real-time streaming
- TTS provider: SpeechSynthesis (free, default), or OpenAI TTS (`tts-1` with voice selection)
- Language selection
- Speech rate control
- Mute TTS toggle

---

## Component 2: Goal-Oriented Task Planner

### Problem
v1 is purely reactive — the LLM sees the page and picks the next action with no overall plan. It has no concept of progress, no memory of what it learned, and frequently drifts from the original goal.

### Solution: Plan-Act-Verify-Replan Loop

```
┌──────────────────────────────────────────────────┐
│                 TASK PLANNER                      │
│                                                  │
│  User goal + page state → LLM generates plan     │
│  Plan = 3-7 intent-level steps with success      │
│  criteria for each                               │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────┐
│              EXECUTION LOOP (per step)           │
│                                                  │
│  ┌─────────┐   ┌──────────┐   ┌──────────────┐  │
│  │ OBSERVE │──▶│  DECIDE  │──▶│   EXECUTE    │  │
│  │ (a11y   │   │  (LLM:   │   │  (with       │  │
│  │  tree)  │   │  step +  │   │   visual     │  │
│  │         │   │  context) │   │   feedback)  │  │
│  └─────────┘   └──────────┘   └──────┬───────┘  │
│                                       │          │
│  ┌──────────┐   ┌──────────────┐     │          │
│  │ REPLAN?  │◀──│   VERIFY     │◀────┘          │
│  │ (if      │   │   (did step  │                 │
│  │  needed) │   │    succeed?) │                 │
│  └──────────┘   └──────────────┘                 │
└──────────────────────────────────────────────────┘
```

### Data Structures

```typescript
interface TaskPlan {
  goal: string;                    // Original user request (NEVER modified)
  steps: PlanStep[];
  currentStepIndex: number;
  status: 'planning' | 'executing' | 'replanning' | 'complete' | 'failed';
  workingMemory: WorkingMemory;
}

interface PlanStep {
  id: string;
  description: string;            // "Navigate to the careers page"
  successCriteria: string;        // "Page shows job listings"
  status: 'pending' | 'active' | 'complete' | 'failed' | 'skipped';
  result?: string;                // What was accomplished
  attempts: number;
}

interface WorkingMemory {
  discoveredFacts: string[];      // "Careers page is at /about/careers"
  failedApproaches: string[];    // "Search bar returns blog posts, not jobs"
  currentContext: string;         // Summary of where we are now
  tabContexts: Map<number, string>; // Per-tab summaries
}
```

### Planning Prompt

```
You are HeySurf, a web navigation planner.

ORIGINAL GOAL: {goal}
CURRENT PAGE: {page_title} ({url})
USER CONTEXT: {user_profile_summary}

Create a step-by-step plan with 3-7 steps. Each step should describe
WHAT to achieve (intent), not HOW to click (mechanism).

Rules:
- Front-load information gathering before taking action
- Each step needs clear success criteria
- If the task requires multiple websites, specify which tabs to use
- If you need info from the user (dates, preferences), ask FIRST

Format:
STEP 1: [description] | SUCCESS: [how to verify]
STEP 2: [description] | SUCCESS: [how to verify]
...
```

### Execution Prompt (injected every action)

```
ORIGINAL GOAL: {goal}

PLAN STATUS:
{formatted plan with checkmarks}

WORKING MEMORY:
- Known facts: {discoveredFacts}
- Failed approaches: {failedApproaches}

CURRENT STEP: {current step description}
SUCCESS CRITERIA: {current step success criteria}

CURRENT PAGE: {a11y tree}

What is the next action to accomplish this step?
```

### Verification (after each action)

```
STEP GOAL: "{step.description}"
SUCCESS CRITERIA: "{step.successCriteria}"
PAGE STATE AFTER ACTION: {observation}

Classify:
- COMPLETE: [what was achieved]
- IN_PROGRESS: [what still needs to happen]
- FAILED: [why, what we learned]
- UNEXPECTED: [what happened instead]
```

### Replanning Strategy (graduated)

1. **Action failed once** → Retry with error context
2. **Action failed 3 times** → Try alternative approach to same step
3. **Step failed** → Replan remaining steps with accumulated knowledge
4. **Completely lost** → "Fresh eyes" replan from scratch, keeping only discovered facts

---

## Component 3: Multi-Tab Orchestration

### Problem
v1 only ever reads/acts on the active tab. If the task requires opening a new site, comparing data across tabs, or doing parallel lookups — it can't.

### Solution: Tab Registry + Cross-Tab Context

**Service worker maintains a tab registry:**

```typescript
interface TabEntry {
  tabId: number;
  url: string;
  title: string;
  purpose: string;           // "LinkedIn job search", "Company website"
  lastA11ySnapshot?: string; // Compressed last-known state
  status: 'active' | 'loading' | 'idle' | 'closed';
}

// Stored in chrome.storage.session (survives SW termination)
interface TabRegistry {
  tabs: Map<number, TabEntry>;
  activeWorkflowTabIds: number[];
}
```

**New agent tools for multi-tab:**

```typescript
{
  name: "open_tab",
  description: "Open a new background tab with a URL",
  parameters: { url: string, purpose: string }
}
{
  name: "switch_tab",
  description: "Switch to a different open tab",
  parameters: { tabId: number }  // or purpose-based: { purpose: string }
}
{
  name: "read_tab",
  description: "Read the a11y tree from a specific tab without switching to it",
  parameters: { tabId: number }
}
{
  name: "close_tab",
  description: "Close a tab that is no longer needed",
  parameters: { tabId: number }
}
```

**Key implementation patterns:**
- Use `chrome.tabs.create({ url, active: false })` for background tabs
- Use `chrome.scripting.executeScript()` to read DOM from background tabs
- Use `chrome.storage.session` for tab state (survives service worker termination)
- Keep port connections from content scripts to prevent SW termination during tasks
- Set `autoDiscardable: false` on workflow tabs to prevent Chrome from unloading them

**Plan step format with tab awareness:**

```
STEP 1: Open LinkedIn and search for "software engineer" jobs in NYC
  TAB: new tab (linkedin.com)
  SUCCESS: Search results page showing job listings

STEP 2: Open the first 3 job listings in separate tabs
  TAB: new tabs from LinkedIn results
  SUCCESS: 3 tabs with individual job postings

STEP 3: Extract title, company, salary from each job tab
  TAB: cycle through job tabs
  SUCCESS: Structured data collected from all 3 listings
```

---

## Component 4: Personalization & User Context

### Problem
HeySurf has no idea who you are. Every session starts cold. It can't fill forms with your info, doesn't know your preferred sites, and speaks to you generically.

### Solution: Three-Layer Context System

#### Layer 1: Onboarding (Explicit — gathered once)

On first launch, HeySurf becomes a friendly receptionist:

```
HeySurf: "Hey! I'm HeySurf — your voice copilot for the web.
          Let me learn a few things so I can help you faster.
          What should I call you?"
User:    "Manas"
HeySurf: "Nice, Manas! What email do you use most for
          signups and forms?"
User:    "manas@example.com"
HeySurf: "Got it. What do you do? (developer, designer, PM...)"
User:    "Founder and developer"
HeySurf: "Last one — what sites will you use me on the most?"
User:    "Gmail, GitHub, Amazon, Resy"
HeySurf: "All set! I'll remember this. Let's go — what can
          I help with?"
```

**Stored as:**
```typescript
interface UserProfile {
  name: string;
  email: string;
  role: string;
  preferredSites: string[];
  customFacts: Record<string, string>;  // extensible
  onboardingComplete: boolean;
  createdAt: number;
}
```

#### Layer 2: Conversational Memory (Passive — extracted after each task)

After each task completes, a lightweight LLM call extracts any new facts:

```
Given this conversation, extract any new facts about the user that
would be useful in future sessions. Only extract NOVEL information,
not things we already know.

Already known: {existing_memories}
Conversation: {task_transcript}

Output facts in format:
- [category] fact text

Categories: identity, preference, workflow, site_knowledge, relationship
```

**Examples of extracted memories:**
- `[preference] User prefers window seats on flights`
- `[workflow] User checks GitHub notifications first thing in the morning`
- `[site_knowledge] User's Resy account is under the email manas@example.com`
- `[relationship] Sarah is the user's co-founder`

**Stored as:**
```typescript
interface Memory {
  id: string;
  fact: string;
  category: 'identity' | 'preference' | 'workflow' | 'site_knowledge' | 'relationship';
  source: 'onboarding' | 'conversation' | 'behavior';
  confidence: number;       // 0-1, decays if never used
  createdAt: number;
  lastUsedAt: number;
  usageCount: number;
}
```

- Cap at 200 memories, evict lowest-confidence
- Boost confidence when a memory is referenced during a task
- Decay unused memories gradually

#### Layer 3: Behavioral Learning (Automatic — from usage patterns)

Track what the user does with HeySurf over time:

```typescript
interface TaskRecord {
  timestamp: number;
  siteHost: string;
  taskText: string;
  outcome: 'success' | 'failed' | 'abandoned';
  durationMs: number;
}
```

This enables:
- **Frequent site detection** → suggest quick actions
- **Common task patterns** → "You usually check email in the morning, want me to summarize?"
- **Form value learning** → auto-suggest name, email, address from past fills

#### Context Injection into Prompts

```
USER CONTEXT:
- Name: Manas
- Email: manas@example.com
- Role: Founder and developer
- Frequent sites: Gmail, GitHub, Amazon, Resy

THINGS I KNOW ABOUT MANAS:
- Prefers window seats on flights
- Sarah is his co-founder (sarah@company.com)
- Usually checks GitHub notifications first
- Resy account is under manas@example.com

Use this context to personalize your actions. Use Manas's name in
spoken responses. Fill forms with his info when asked. Navigate to
his preferred sites when requests are ambiguous.
```

#### Privacy Controls

- All data in `chrome.storage.local` — never synced, never sent to cloud
- "What HeySurf knows about you" page in settings — full transparency
- Delete individual memories or clear all
- Sensitive field detection — never store passwords, SSNs, credit card numbers
- Only track tasks where HeySurf was actively invoked (no passive surveillance)

---

## Component 5: Visual Cursor & Action Feedback

### Problem
v1 adds a CSS `outline` class directly to target elements. This is fragile (page CSS overrides it), invisible on many sites, and gives zero sense of "the agent is doing things."

### Solution: Shadow DOM Overlay with Animated Cursor

#### Architecture

```
┌─────────────────────────────────────────────┐
│  Real Web Page                              │
│  (untouched — no classes added)             │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Shadow DOM Overlay Host            │    │
│  │  (position:fixed, z-index:MAX,      │    │
│  │   pointer-events:none)              │    │
│  │                                     │    │
│  │  ┌───────────┐                      │    │
│  │  │  Animated  │  ← moves to targets │    │
│  │  │  Cursor    │    with easing      │    │
│  │  └───────────┘                      │    │
│  │                                     │    │
│  │  ┌───────────────────┐              │    │
│  │  │  Highlight Box    │  ← overlay   │    │
│  │  │  "clicking..."    │    positioned│    │
│  │  └───────────────────┘    over elem │    │
│  │                                     │    │
│  │  ○ ← click ripple animation         │    │
│  │                                     │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

#### Why Shadow DOM
- Complete CSS isolation — page styles can't break our overlay
- Our styles can't break the page
- Append to `document.documentElement` (not `body`) to survive SPA navigation
- `pointer-events: none` so the overlay never intercepts real clicks

#### The Cursor

SVG pointer cursor with `cubic-bezier(0.22, 1, 0.36, 1)` easing (ease-out-expo — starts fast, decelerates naturally like a real mouse movement). Uses Web Animations API for smooth, cancellable animation on the compositor thread.

#### Visual Feedback Per Action Type

| Action | Visual |
|--------|--------|
| **Click** | Cursor glides to element center → highlight box appears with "clicking" label → click ripple animation (two expanding, fading rings) → cursor does a small press animation |
| **Type** | Cursor moves to input → highlight box with "typing 'hello'" label → character-by-character typing with input events → pulsing dot indicator |
| **Scroll** | Directional arrow indicator on right side of viewport (↑ or ↓) with fade animation |
| **Navigate** | No cursor (page is about to change). Show a brief "Navigating to..." toast |
| **Select** | Cursor moves to dropdown → highlight box → option highlight on selection |
| **Wait** | Subtle pulsing dot near the cursor to show the agent is alive |
| **Done** | Cursor fades out, green checkmark briefly appears |

#### Key CSS Details
- Only animate `transform` and `opacity` (GPU-composited, 60fps)
- Never animate `left`/`top` — use `translate()`
- `will-change: transform` on the cursor element
- Clean up elements on `animationend` events, not `setTimeout`
- Time-bound all tracking loops (auto-stop after 2-3 seconds)

#### Typing Simulation
Instead of setting `input.value` instantly, type character-by-character:
- ~30ms per character with proper `keydown`/`input`/`keyup` events
- This looks real AND works better with React/Vue's synthetic event handling
- Shows the user exactly what's being typed

---

## Component 6: Updated System Prompt

```
You are HeySurf, a voice-controlled browser agent that helps {user.name}
accomplish tasks on the web.

YOUR APPROACH:
1. When given a task, FIRST create a plan (3-7 steps with success criteria)
2. Execute one action at a time with verification
3. Track what you've learned in working memory
4. If stuck, try an alternative approach before asking the user
5. When done, summarize what was accomplished (spoken aloud)

USER CONTEXT:
{personalization block}

RULES:
- Execute ONE action at a time, then verify the result
- Reference elements by their accessible name or visible text
- After each action, check: did it advance the current step?
- If stuck after 2 attempts, explain and ask {user.name} for guidance
- Keep spoken responses concise — they are read aloud

MULTI-TAB:
- You can open_tab, switch_tab, read_tab, and close_tab
- Use background tabs for research, keep the main tab for primary actions
- Include tab context in your reasoning

SAFETY:
- Never navigate away from current site without asking
- Never submit payment without explicit confirmation
- Never read sensitive data aloud (passwords, SSNs, credit cards)
- Never fabricate information for form fields — ask if unsure
```

---

## Updated Project Structure

```
heysurf/
├── manifest.json
├── package.json
├── tsconfig.json
├── webpack.config.js
│
├── src/
│   ├── background/
│   │   ├── service-worker.ts      # Extension lifecycle + message routing
│   │   ├── agent-loop.ts          # REWRITTEN: Plan-Act-Verify-Replan
│   │   ├── planner.ts             # NEW: Task planning + replanning
│   │   ├── tab-manager.ts         # NEW: Multi-tab registry + operations
│   │   └── memory-extractor.ts    # NEW: Post-task memory extraction
│   │
│   ├── content/
│   │   ├── content-script.ts      # Message handler (updated)
│   │   ├── a11y-tree.ts           # Accessibility tree extraction
│   │   ├── actions.ts             # DOM actions (updated: char-by-char typing)
│   │   ├── overlay-host.ts        # NEW: Shadow DOM overlay container
│   │   ├── cursor.ts              # NEW: Animated SVG cursor
│   │   ├── effects.ts             # NEW: Click ripple, typing indicator, etc.
│   │   ├── highlight-overlay.ts   # NEW: Overlay-based element highlights
│   │   └── visual-feedback.ts     # NEW: Orchestrator for all visual effects
│   │
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── sidepanel.ts           # Updated with new voice, onboarding
│   │   ├── styles.css             # Updated UI
│   │   ├── voice.ts               # NEW: MediaRecorder + Whisper
│   │   ├── onboarding.ts          # NEW: First-run receptionist flow
│   │   └── memory-viewer.ts       # NEW: "What HeySurf knows" settings page
│   │
│   ├── llm/
│   │   ├── provider.ts
│   │   ├── tools.ts               # Updated: new multi-tab tools
│   │   ├── prompts.ts             # REWRITTEN: planning prompts, goal anchoring
│   │   └── providers/
│   │       ├── openai.ts
│   │       ├── anthropic.ts
│   │       └── gemini.ts
│   │
│   ├── shared/
│   │   ├── types.ts               # Updated: plan, memory, tab types
│   │   ├── storage.ts             # Updated: profile, memories, task history CRUD
│   │   └── messages.ts            # NEW: Typed message bus
│   │
│   └── assets/
│       ├── icon-16.png
│       ├── icon-48.png
│       ├── icon-128.png
│       └── permission.html        # NEW: Mic permission flow
│
├── PRODUCT_SPEC.md
├── HEYSURF_V2_PLAN.md
└── README.md
```

---

## Updated Manifest

```json
{
  "manifest_version": 3,
  "name": "HeySurf",
  "version": "2.0.0",
  "description": "Voice-controlled AI browser agent. Talk to any website.",
  "permissions": [
    "activeTab",
    "sidePanel",
    "storage",
    "scripting",
    "tabs",
    "offscreen"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
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

Key changes:
- Added `"offscreen"` permission (for mic permission fallback)
- Added `"host_permissions": ["<all_urls>"]` (needed for `chrome.scripting.executeScript` on any tab)

---

## Implementation Order

### Phase 1: Fix Voice (Day 1 morning)
Replace broken SpeechRecognition with MediaRecorder + Whisper. This unblocks testing everything else.

### Phase 2: Visual Overlay System (Day 1 afternoon)
Shadow DOM host, animated cursor, click ripples, highlight boxes. This makes the agent's work visible and impressive.

### Phase 3: Goal-Oriented Planner (Day 1 evening)
Rewrite agent loop with plan-act-verify-replan. Add working memory. This makes the agent competent.

### Phase 4: Multi-Tab (Day 2 morning)
Tab registry, new tools (open_tab, switch_tab, read_tab), cross-tab context. Service worker state management with chrome.storage.session.

### Phase 5: Personalization (Day 2 afternoon)
Onboarding flow, user profile, memory extraction, context injection into prompts.

### Phase 6: Polish & Demo (Day 2 evening)
Test across Gmail, Amazon, LinkedIn, Wikipedia. Record demo video.

---

## Success Criteria (v2)

The build is "done" when these demos work:

1. **Multi-tab research**: "Find the 3 cheapest flights to Tokyo in August on Google Flights and compare them" → opens tabs, extracts data, compares
2. **Personalized form filling**: "Sign me up for this newsletter" → fills in name and email from profile without asking
3. **Voice round-trip**: Speak a command → see transcript → watch agent work with animated cursor → hear spoken result
4. **Goal-tracking**: "Find all engineering jobs at Tesla" → shows plan in sidebar, checks off steps, navigates across pages, handles pagination
5. **Visual wow factor**: Someone watching over your shoulder can see exactly what the agent is doing — cursor moving, elements highlighting, text appearing character by character
