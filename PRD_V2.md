# HeySurf v2.0 — Technical Product Requirements Document

## Overview

HeySurf v2.0 is a complete architectural redesign of the voice-controlled AI browser agent Chrome extension. This PRD covers all engineering requirements for transforming v1 (a basic reactive agent with broken voice and no visual feedback) into v2 (a goal-oriented, multi-tab, personalized agent with animated visual feedback and working voice I/O).

## Target User

Power users who want to control any website with their voice — developers, founders, PMs, researchers. People who have 15+ tabs open, use multiple SaaS tools, and want an AI copilot that knows them and can work across their browser.

---

## Epic 1: Voice I/O Overhaul

### E1.1: Speech-to-Text via MediaRecorder + Whisper API

**Problem:** `webkitSpeechRecognition` is broken in Chrome extension side panels due to a known Chromium bug (`chrome-extension://` origins are refused by the speech service).

**Solution:** Replace with `MediaRecorder` API (works in side panels) + OpenAI Whisper API for transcription.

**Requirements:**
- [ ] Capture microphone audio using `navigator.mediaDevices.getUserMedia({ audio: true })` directly in the side panel
- [ ] Record audio as `audio/webm;codecs=opus` using `MediaRecorder`
- [ ] On recording stop, POST audio blob to `POST https://api.openai.com/v1/audio/transcriptions` with model `whisper-1`
- [ ] Display real-time recording state (pulsing mic icon, duration counter)
- [ ] Handle mic permission flow: if `getUserMedia` fails with `NotAllowedError`, open a popup window (`chrome.windows.create`) with `permission.html` that triggers the browser permission prompt
- [ ] Add `permission.html` to extension assets that requests mic access, shows confirmation, then auto-closes
- [ ] Show interim "Recording..." state while mic is active, then "Transcribing..." while Whisper processes
- [ ] Support configurable STT provider (Whisper default, extensible to Deepgram/AssemblyAI)
- [ ] Voice language selection in settings (passed to Whisper as `language` param)

**Technical Notes:**
- `getUserMedia()` works in extension side panels (unlike `SpeechRecognition`)
- Whisper accepts webm/opus natively, no format conversion needed
- Typical latency: 1-3 seconds for short utterances
- Cost: ~$0.006/minute

### E1.2: Text-to-Speech Improvements

**Problem:** `SpeechSynthesis` works in extensions but has quirks (silent failures without user interaction, long text cutoff).

**Requirements:**
- [ ] Call `speechSynthesis.cancel()` before every `speak()` call to prevent silent failures
- [ ] Chunk long responses into sentences and queue them sequentially
- [ ] Add voice selection dropdown in settings (populated from `speechSynthesis.getVoices()`)
- [ ] Add option for OpenAI TTS API (`tts-1` model) as premium voice option
- [ ] Visual indicator in chat when TTS is speaking (speaker icon animation)
- [ ] "Stop speaking" button to cancel TTS mid-utterance

---

## Epic 2: Visual Cursor & Action Feedback System

### E2.1: Shadow DOM Overlay Infrastructure

**Problem:** v1 adds CSS classes directly to page elements, which breaks on many sites and provides minimal visual feedback.

**Solution:** Create a Shadow DOM overlay layer that renders all visual feedback without touching the page's DOM.

**Requirements:**
- [ ] Create overlay host: `<div>` with `position:fixed; z-index:2147483647; pointer-events:none` appended to `document.documentElement`
- [ ] Attach Shadow DOM (`attachShadow({ mode: 'open' })`) for complete CSS isolation
- [ ] Inject all overlay styles inside the shadow root
- [ ] Overlay must not intercept any page clicks/interactions
- [ ] Overlay must survive SPA navigation (appended to `documentElement`, not `body`)
- [ ] Lazy initialization: create overlay only when agent starts, destroy on agent stop

### E2.2: Animated Cursor

**Requirements:**
- [ ] Custom SVG cursor element (standard pointer arrow shape, dark fill, white stroke)
- [ ] Smooth movement to target elements using `element.animate()` (Web Animations API)
- [ ] Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-expo — starts fast, decelerates naturally)
- [ ] Duration: 400-500ms per movement
- [ ] Cursor tracks to element center using `getBoundingClientRect()`
- [ ] `will-change: transform` for GPU compositing
- [ ] Hide cursor when agent is idle, show when acting
- [ ] Small "press" animation on click (scale to 0.85 for 100ms, then back)
- [ ] Cursor fades out on task completion

### E2.3: Click Ripple Effect

**Requirements:**
- [ ] On click actions: expanding concentric ring animation at click point
- [ ] Two rings: inner (20px radius) and outer (40px radius), both fading to transparent
- [ ] Duration: 600ms, ease-out
- [ ] Uses `box-shadow` animation for performance (no DOM reflow)
- [ ] Auto-cleanup on `animationend`
- [ ] Color: primary indigo (#6366f1) with alpha

### E2.4: Element Highlight Boxes

**Requirements:**
- [ ] Overlay-positioned highlight box (not CSS class on target element)
- [ ] Box positioned using `getBoundingClientRect()` of target element
- [ ] 2px indigo border, subtle indigo background fill (8% opacity)
- [ ] Action label above the box (e.g., "clicking", "typing 'hello'", "selecting")
- [ ] Label: indigo background, white text, 11px system font, rounded top corners
- [ ] Entry animation: fade-in + slight scale from 1.05 to 1.0
- [ ] Track element position with `requestAnimationFrame` for 2-3 seconds (handles moving elements)
- [ ] Auto-remove after action completes

### E2.5: Typing Visualization

**Requirements:**
- [ ] Character-by-character typing instead of instant value assignment
- [ ] ~30ms per character with proper `keydown`, `input`, `keyup` events
- [ ] Pulsing dot indicator near cursor during typing
- [ ] Works with React/Vue/Angular synthetic event systems (proper event dispatching)
- [ ] Clear field first if `clearFirst` is true, then type character by character

### E2.6: Scroll & Navigation Indicators

**Requirements:**
- [ ] Scroll: directional arrow indicator (↑/↓) on right side of viewport, 800ms fade animation
- [ ] Navigate: brief toast-style "Navigating to..." indicator before page change
- [ ] Done: green checkmark animation, cursor fade-out

### E2.7: Visual Feedback Orchestrator

**Requirements:**
- [ ] Single `visualizeAction()` function that coordinates cursor + highlight + effects per action type
- [ ] Runs BEFORE the actual action executes (user sees the agent "approach" the element, then act)
- [ ] Content script handler calls `visualizeAction()` then `executeAction()` sequentially
- [ ] Configurable: users can disable visual feedback in settings

---

## Epic 3: Goal-Oriented Task Planner

### E3.1: Plan Data Structures

**Requirements:**
- [ ] `TaskPlan` type: goal, steps[], currentStepIndex, status, workingMemory
- [ ] `PlanStep` type: id, description, successCriteria, status, result, attempts
- [ ] `WorkingMemory` type: discoveredFacts[], failedApproaches[], currentContext, tabContexts
- [ ] Plan status enum: planning, executing, replanning, complete, failed
- [ ] Step status enum: pending, active, complete, failed, skipped

### E3.2: Task Planning LLM Call

**Requirements:**
- [ ] On task start, make an initial planning call: goal + page state + user context → plan with 3-7 steps
- [ ] Each step must have a description (intent, not mechanism) and success criteria
- [ ] Plan is parsed into structured `TaskPlan` object
- [ ] Plan displayed in side panel UI as a checklist (updates in real-time)
- [ ] If planning call fails, fall back to reactive mode (v1 behavior)

### E3.3: Step Verification

**Requirements:**
- [ ] After each action, make a verification LLM call: step goal + success criteria + current page → COMPLETE / IN_PROGRESS / FAILED / UNEXPECTED
- [ ] On COMPLETE: mark step done, update working memory with result, advance to next step
- [ ] On IN_PROGRESS: continue executing within the same step
- [ ] On FAILED: increment attempts, if maxAttempts reached → trigger replan
- [ ] On UNEXPECTED: add to failedApproaches, try alternative approach

### E3.4: Working Memory Management

**Requirements:**
- [ ] Maintain `discoveredFacts` array — things learned about the website during execution
- [ ] Maintain `failedApproaches` array — things that didn't work
- [ ] Include working memory in every execution LLM call
- [ ] Compress memory when it gets too long (summarize older facts)
- [ ] Clear memory when task completes (but extract persistent memories first — see Epic 5)

### E3.5: Replanning

**Requirements:**
- [ ] Graduated replanning strategy:
  1. Action failed once → retry with error context
  2. Action failed 3 times → try alternative approach
  3. Step failed → replan remaining steps with accumulated knowledge
  4. Completely lost → "fresh eyes" replan keeping only discovered facts
- [ ] Replan prompt includes: original goal, completed steps, working memory, current page state
- [ ] New plan replaces remaining steps, preserves completed steps
- [ ] Show "Replanning..." status in side panel

### E3.6: Goal Anchoring

**Requirements:**
- [ ] Include original user goal VERBATIM in every single LLM call (planning, execution, verification)
- [ ] Before each action, LLM must output: current step, why this action advances the step, expected result
- [ ] Self-evaluation every 5 actions: "Am I making progress? Am I stuck in a loop?"

### E3.7: Plan Display in Side Panel

**Requirements:**
- [ ] Collapsible plan section in side panel showing all steps
- [ ] Each step shows: checkbox (pending/active/complete/failed), description, step number
- [ ] Active step is highlighted with indigo accent
- [ ] Completed steps show green checkmark
- [ ] Failed steps show red X
- [ ] Working memory visible in expandable "Agent's notes" section
- [ ] Plan updates in real-time as the agent works

---

## Epic 4: Multi-Tab Orchestration

### E4.1: Tab Registry

**Requirements:**
- [ ] `TabRegistry` stored in `chrome.storage.session` (survives service worker termination)
- [ ] Track: tabId, url, title, purpose, lastSnapshot, status
- [ ] Auto-register tabs that HeySurf interacts with
- [ ] Auto-deregister on tab close (`chrome.tabs.onRemoved`)
- [ ] Update on tab navigation (`chrome.tabs.onUpdated`)

### E4.2: Multi-Tab Agent Tools

**Requirements:**
- [ ] `open_tab` tool: opens new background tab (`active: false`), injects content script, returns tabId
- [ ] `switch_tab` tool: activates a specific tab, brings window to front
- [ ] `read_tab` tool: reads a11y tree from a background tab via `chrome.scripting.executeScript` without switching
- [ ] `close_tab` tool: closes a tab and deregisters from registry
- [ ] All tools available to the LLM via function calling

### E4.3: Cross-Tab Context

**Requirements:**
- [ ] When planning, include list of open tabs with their purposes in the prompt
- [ ] `read_tab` returns a compressed a11y tree summary (not the full tree — save tokens)
- [ ] Working memory tracks per-tab discovered facts
- [ ] Plan steps can specify which tab they operate on

### E4.4: Service Worker Resilience

**Requirements:**
- [ ] All workflow state in `chrome.storage.session` (not in-memory variables)
- [ ] Content scripts maintain port connection to keep service worker alive during tasks
- [ ] On service worker wake-up, rehydrate state from `chrome.storage.session`
- [ ] Set `autoDiscardable: false` on workflow tabs to prevent Chrome from unloading them
- [ ] Register all event listeners at top level of service worker (Chrome MV3 requirement)

---

## Epic 5: Personalization & User Context

### E5.1: Onboarding Flow

**Requirements:**
- [ ] On first launch (no `userProfile` in storage), show onboarding in side panel instead of chat
- [ ] Onboarding is a conversational flow with HeySurf asking 4 questions:
  1. "What should I call you?" → name
  2. "What email do you use most for signups?" → email
  3. "What's your line of work?" → role
  4. "What sites will you use me on most?" → preferredSites
- [ ] Each question is skippable with a "Skip" button
- [ ] Show progress indicator (step 1 of 4, etc.)
- [ ] Explain WHY each question is being asked
- [ ] Allow editing later through settings
- [ ] Smooth transition from onboarding to "ready to go" state
- [ ] API key / provider setup is integrated into onboarding as step 0 with clear visual guidance

### E5.2: API Key & Provider Setup (Improved UX)

**Requirements:**
- [ ] Dedicated setup screen with provider cards (OpenAI, Anthropic, Gemini)
- [ ] Each card shows: logo, name, recommended model, key format hint (e.g., "Starts with sk-")
- [ ] Paste area with visual validation (green check on valid format, red on invalid)
- [ ] "Test Connection" button that makes a minimal API call to verify the key works
- [ ] Success/failure feedback with clear error messages
- [ ] Detect if user has existing provider subscriptions (via checking common cookie domains)
- [ ] Link to each provider's API key page for easy access
- [ ] Store API key securely in `chrome.storage.local`

### E5.3: User Profile Storage

**Requirements:**
- [ ] `UserProfile` type with: name, email, role, preferredSites, customFacts, onboardingComplete, timestamps
- [ ] CRUD functions in storage.ts
- [ ] Profile injected into every system prompt
- [ ] "Edit Profile" accessible from settings

### E5.4: Conversational Memory System

**Requirements:**
- [ ] After each completed task, run memory extraction LLM call
- [ ] Extract novel facts about user (preferences, workflows, relationships, site knowledge)
- [ ] Store as `Memory` objects with: fact, category, confidence, timestamps, usageCount
- [ ] Deduplicate against existing memories (string similarity check)
- [ ] Cap at 200 memories, evict lowest-confidence when over limit
- [ ] Boost confidence/usageCount when a memory is relevant to a task
- [ ] Inject top-20 most relevant memories into system prompt

### E5.5: Task History & Behavioral Learning

**Requirements:**
- [ ] Log completed tasks: timestamp, siteHost, taskText, outcome, durationMs
- [ ] Track site frequency stats: per-host visit count, common tasks, success rate
- [ ] Track common form values: field_label → most-used value
- [ ] Cap at 100 recent tasks (FIFO)
- [ ] Auto-purge records older than 30 days

### E5.6: Memory Viewer & Privacy Controls

**Requirements:**
- [ ] "What HeySurf Knows" page in settings
- [ ] Shows user profile (editable)
- [ ] Lists all memories with category tags, ability to delete individual memories
- [ ] "Clear All Memories" button
- [ ] "Clear Task History" button
- [ ] Sensitive field detection: never store passwords, SSNs, credit card numbers
- [ ] Privacy toggle: opt-in/out of behavioral learning (off by default)
- [ ] All data in `chrome.storage.local` only — never synced, never sent to cloud except current task context to LLM

---

## Epic 6: UI/UX Polish

### E6.1: Side Panel Redesign

**Requirements:**
- [ ] Dark theme with refined typography and spacing
- [ ] Chat area with message types: user (voice/text), agent (responses), action log (collapsible), plan view
- [ ] Status bar at bottom: current agent state (Ready / Listening / Thinking / Executing Step 2/5 / Done)
- [ ] Mic button: large, prominent, centered at bottom. States: idle (gray), listening (red pulsing), processing (indigo spinning)
- [ ] Text input always available alongside mic button
- [ ] Plan panel: collapsible checklist showing task plan progress
- [ ] "Agent's Notes" expandable section showing working memory
- [ ] Smooth animations on all state transitions

### E6.2: First-Run Experience

**Requirements:**
- [ ] Polished onboarding with HeySurf branding
- [ ] Provider setup with visual cards, not a raw dropdown
- [ ] Guided API key entry with validation
- [ ] Profile questions as a chat-like conversation
- [ ] Skip buttons and progress indicators
- [ ] "Let's go!" transition to ready state

### E6.3: Settings Panel Redesign

**Requirements:**
- [ ] Organized into sections: Account, LLM Provider, Voice, Agent Behavior, Privacy, About
- [ ] Toggle switches for boolean settings
- [ ] Visual model selector with recommendations per provider
- [ ] Voice preview ("Click to hear selected voice")
- [ ] Data management section (view/clear memories, task history, profile)

---

## Non-Functional Requirements

### Performance
- Overlay animations must maintain 60fps (only animate `transform` and `opacity`)
- A11y tree extraction must complete in <500ms on typical pages
- Side panel must load in <200ms
- Agent loop latency budget: 1-3s per action (LLM call dominant)

### Security
- API keys stored in `chrome.storage.local` only
- Never log or transmit API keys except to the configured LLM provider
- Sensitive field detection (passwords, SSNs, etc.) — never store, never read aloud
- Content scripts only execute when agent is actively running
- No passive browsing surveillance

### Reliability
- Service worker state persisted in `chrome.storage.session`
- Content script injection with PING/PONG verification and retry
- Graceful degradation: if planning fails → fall back to reactive mode
- If voice fails → text input always available
- If visual overlay fails → agent still executes actions (feedback is enhancement, not dependency)

---

## Milestones

| Milestone | Scope | Target |
|-----------|-------|--------|
| M1: Voice Fixed | E1.1, E1.2 | Day 1 AM |
| M2: Visual System | E2.1-E2.7 | Day 1 PM |
| M3: Task Planner | E3.1-E3.7 | Day 1 EVE |
| M4: Multi-Tab | E4.1-E4.4 | Day 2 AM |
| M5: Personalization | E5.1-E5.6 | Day 2 PM |
| M6: UI Polish | E6.1-E6.3 | Day 2 EVE |
