import {
  TaskPlan,
  PlanStep,
  WorkingMemory,
  UserProfile,
  Memory,
} from '../shared/types';
import { getSettings } from '../shared/storage';
import { createProvider } from '../llm/provider';
import {
  PLANNING_PROMPT,
  VERIFICATION_PROMPT,
  REPLAN_PROMPT,
  formatPageContext,
  formatPlanStatus,
} from '../llm/prompts';

function generateId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildUserContext(
  userProfile: UserProfile | null,
  memories: Memory[],
): string {
  const parts: string[] = [];

  if (userProfile) {
    parts.push('User profile:');
    if (userProfile.name) parts.push(`  Name: ${userProfile.name}`);
    if (userProfile.email) parts.push(`  Email: ${userProfile.email}`);
    if (userProfile.role) parts.push(`  Role: ${userProfile.role}`);
    if (userProfile.preferredSites.length > 0) {
      parts.push(`  Preferred sites: ${userProfile.preferredSites.join(', ')}`);
    }
    for (const [key, value] of Object.entries(userProfile.customFacts)) {
      parts.push(`  ${key}: ${value}`);
    }
  }

  if (memories.length > 0) {
    parts.push('');
    parts.push('Known facts about the user:');
    for (const m of memories) {
      parts.push(`- [${m.category}] ${m.fact}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : 'No user context available.';
}

export async function createPlan(
  goal: string,
  pageContext: string,
  userProfile: UserProfile | null,
  memories: Memory[],
): Promise<TaskPlan> {
  const settings = await getSettings();
  const provider = createProvider(settings.llm);

  const userContext = buildUserContext(userProfile, memories);
  const prompt = PLANNING_PROMPT
    .replace('{{GOAL}}', goal)
    .replace('{{PAGE_CONTEXT}}', pageContext)
    .replace('{{USER_CONTEXT}}', userContext);

  const response = await provider.chat({
    model: settings.llm.model,
    systemPrompt: 'You are a task planning assistant. Respond only with valid JSON.',
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    temperature: 0.3,
  });

  const text = response.text || '';
  let parsed: { steps: Array<{ description: string; successCriteria: string }> };

  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    // Fallback: create a single-step plan
    parsed = {
      steps: [
        {
          description: goal,
          successCriteria: 'The user\'s goal has been achieved',
        },
      ],
    };
  }

  const steps: PlanStep[] = parsed.steps.map((s) => ({
    id: generateId(),
    description: s.description,
    successCriteria: s.successCriteria,
    status: 'pending' as const,
    attempts: 0,
    maxAttempts: 3,
  }));

  // Ensure 3-7 steps
  if (steps.length < 1) {
    steps.push({
      id: generateId(),
      description: goal,
      successCriteria: 'The goal has been achieved',
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    });
  }

  return {
    goal,
    steps,
    currentStepIndex: 0,
    status: 'executing',
    workingMemory: {
      discoveredFacts: [],
      failedApproaches: [],
      currentContext: '',
    },
  };
}

export async function verifyStepCompletion(
  step: PlanStep,
  pageContext: string,
  workingMemory: WorkingMemory,
): Promise<'complete' | 'in_progress' | 'failed' | 'unexpected'> {
  const settings = await getSettings();
  const provider = createProvider(settings.llm);

  const prompt = VERIFICATION_PROMPT
    .replace('{{STEP_DESCRIPTION}}', step.description)
    .replace('{{SUCCESS_CRITERIA}}', step.successCriteria)
    .replace('{{PAGE_STATE}}', pageContext)
    .replace('{{DISCOVERED_FACTS}}', workingMemory.discoveredFacts.join('; ') || 'None')
    .replace('{{FAILED_APPROACHES}}', workingMemory.failedApproaches.join('; ') || 'None');

  const response = await provider.chat({
    model: settings.llm.model,
    systemPrompt: 'You are a verification assistant. Respond only with valid JSON.',
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    temperature: 0.1,
  });

  const text = response.text || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    // Add any discovered facts to working memory
    if (parsed.discoveredFacts && Array.isArray(parsed.discoveredFacts)) {
      for (const fact of parsed.discoveredFacts) {
        if (fact && !workingMemory.discoveredFacts.includes(fact)) {
          workingMemory.discoveredFacts.push(fact);
        }
      }
    }

    const status = (parsed.status || '').toUpperCase();
    switch (status) {
      case 'COMPLETE':
        return 'complete';
      case 'FAILED':
        return 'failed';
      case 'UNEXPECTED':
        return 'unexpected';
      default:
        return 'in_progress';
    }
  } catch {
    return 'in_progress';
  }
}

export async function replan(
  plan: TaskPlan,
  pageContext: string,
  reason: string,
): Promise<TaskPlan> {
  const settings = await getSettings();
  const provider = createProvider(settings.llm);

  const completedSteps = plan.steps
    .filter((s) => s.status === 'complete')
    .map((s, i) => `${i + 1}. ${s.description} -> ${s.result || 'Done'}`)
    .join('\n') || 'None';

  const prompt = REPLAN_PROMPT
    .replace('{{GOAL}}', plan.goal)
    .replace('{{REASON}}', reason)
    .replace('{{COMPLETED_STEPS}}', completedSteps)
    .replace('{{DISCOVERED_FACTS}}', plan.workingMemory.discoveredFacts.join('; ') || 'None')
    .replace('{{FAILED_APPROACHES}}', plan.workingMemory.failedApproaches.join('; ') || 'None')
    .replace('{{PAGE_STATE}}', pageContext);

  const response = await provider.chat({
    model: settings.llm.model,
    systemPrompt: 'You are a task replanning assistant. Respond only with valid JSON.',
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    temperature: 0.3,
  });

  const text = response.text || '';

  let parsed: { steps: Array<{ description: string; successCriteria: string }> };
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    parsed = {
      steps: [
        {
          description: `Continue with: ${plan.goal}`,
          successCriteria: 'The goal has been achieved',
        },
      ],
    };
  }

  const newSteps: PlanStep[] = parsed.steps.map((s) => ({
    id: generateId(),
    description: s.description,
    successCriteria: s.successCriteria,
    status: 'pending' as const,
    attempts: 0,
    maxAttempts: 3,
  }));

  // Preserve completed steps, replace remaining
  const completedPlanSteps = plan.steps.filter((s) => s.status === 'complete');
  const allSteps = [...completedPlanSteps, ...newSteps];

  return {
    ...plan,
    steps: allSteps,
    currentStepIndex: completedPlanSteps.length,
    status: 'executing',
  };
}

export function buildExecutionPrompt(
  plan: TaskPlan,
  pageContext: string,
  userProfile: UserProfile | null,
  memories: Memory[],
): string {
  const parts: string[] = [];

  // Always include original goal verbatim
  parts.push(`ORIGINAL GOAL: ${plan.goal}`);
  parts.push('');

  // Plan status with checkmarks
  parts.push(formatPlanStatus(plan));
  parts.push('');

  // Current step details
  const currentStep = plan.steps[plan.currentStepIndex];
  if (currentStep) {
    parts.push(`CURRENT STEP (${plan.currentStepIndex + 1}/${plan.steps.length}):`);
    parts.push(`Description: ${currentStep.description}`);
    parts.push(`Success criteria: ${currentStep.successCriteria}`);
    parts.push(`Attempt: ${currentStep.attempts + 1}/${currentStep.maxAttempts}`);
    parts.push('');
  }

  // User context
  const userContext = buildUserContext(userProfile, memories);
  if (userContext !== 'No user context available.') {
    parts.push(userContext);
    parts.push('');
  }

  // Page context
  parts.push(pageContext);

  return parts.join('\n');
}
