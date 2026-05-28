import { UserProfile, Memory } from '../shared/types';
import { getUserProfile, saveUserProfile, getMemories, deleteMemory, clearAllMemories } from '../shared/storage';

let activeContainer: HTMLElement | null = null;

export function showMemoryViewer(container: HTMLElement): void {
  activeContainer = container;
  container.classList.remove('hidden');
  renderViewer(container);
}

export function hideMemoryViewer(): void {
  if (activeContainer) {
    activeContainer.classList.add('hidden');
    activeContainer.innerHTML = '';
    activeContainer = null;
  }
}

async function renderViewer(container: HTMLElement) {
  const profile = await getUserProfile();
  const memories = await getMemories();

  const grouped = groupMemories(memories);

  container.innerHTML = `
    <div class="memory-viewer-inner">
      <div class="memory-header">
        <button id="memory-back" class="icon-btn" title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h2>What HeySurf Knows</h2>
        <div></div>
      </div>

      <div class="memory-body">
        ${profile ? renderProfileSection(profile) : '<p class="memory-empty">No profile yet.</p>'}

        <div class="memory-section">
          <h3>Memories</h3>
          ${
            memories.length === 0
              ? '<p class="memory-empty">No memories stored yet. HeySurf learns as you use it.</p>'
              : Object.entries(grouped)
                  .map(
                    ([category, mems]) => `
              <div class="memory-category">
                <span class="category-tag">${formatCategory(category)}</span>
                <div class="memory-list">
                  ${mems
                    .map(
                      (m) => `
                    <div class="memory-item" data-id="${m.id}">
                      <span class="memory-fact">${escapeHtml(m.fact)}</span>
                      <button class="memory-delete-btn" data-id="${m.id}" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  `,
                    )
                    .join('')}
                </div>
              </div>
            `,
                  )
                  .join('')
          }
        </div>

        <div class="memory-actions">
          <button id="clear-memories-btn" class="danger-btn">Clear All Memories</button>
          <button id="clear-history-btn" class="danger-btn">Clear Task History</button>
        </div>
      </div>
    </div>
  `;

  // ---- Event binding ----

  container.querySelector('#memory-back')!.addEventListener('click', () => {
    hideMemoryViewer();
  });

  // Delete individual memories
  container.querySelectorAll('.memory-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id!;
      await deleteMemory(id);
      renderViewer(container);
    });
  });

  // Clear all memories
  container.querySelector('#clear-memories-btn')!.addEventListener('click', async () => {
    const confirmed = confirm('Delete all memories? This cannot be undone.');
    if (!confirmed) return;
    await clearAllMemories();
    renderViewer(container);
  });

  // Clear task history
  container.querySelector('#clear-history-btn')!.addEventListener('click', async () => {
    const confirmed = confirm('Clear all task history? This cannot be undone.');
    if (!confirmed) return;
    await chrome.storage.local.set({ taskHistory: [] });
    alert('Task history cleared.');
  });

  // Edit profile fields
  container.querySelectorAll('.profile-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const field = (btn as HTMLElement).dataset.field!;
      editProfileField(container, field, profile!);
    });
  });
}

function renderProfileSection(profile: UserProfile): string {
  const fields = [
    { key: 'name', label: 'Name', value: profile.name || '(not set)' },
    { key: 'email', label: 'Email', value: profile.email || '(not set)' },
    { key: 'role', label: 'Role', value: profile.role || '(not set)' },
    {
      key: 'preferredSites',
      label: 'Preferred Sites',
      value: profile.preferredSites.length ? profile.preferredSites.join(', ') : '(not set)',
    },
  ];

  return `
    <div class="memory-section">
      <h3>Your Profile</h3>
      <div class="profile-fields">
        ${fields
          .map(
            (f) => `
          <div class="profile-field">
            <span class="profile-label">${f.label}</span>
            <span class="profile-value">${escapeHtml(f.value)}</span>
            <button class="profile-edit-btn icon-btn" data-field="${f.key}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        `,
          )
          .join('')}
      </div>
    </div>
  `;
}

async function editProfileField(container: HTMLElement, field: string, profile: UserProfile) {
  const currentValue =
    field === 'preferredSites' ? profile.preferredSites.join(', ') : (profile as any)[field] || '';

  const newValue = prompt(`Edit ${field}:`, currentValue);
  if (newValue === null) return;

  if (field === 'preferredSites') {
    profile.preferredSites = newValue
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    (profile as any)[field] = newValue.trim();
  }

  profile.updatedAt = Date.now();
  await saveUserProfile(profile);
  renderViewer(container);
}

function groupMemories(memories: Memory[]): Record<string, Memory[]> {
  const grouped: Record<string, Memory[]> = {};
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m);
  }
  return grouped;
}

function formatCategory(category: string): string {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
