/* ═══ Keyboard Shortcuts ═══
   Power navigation:
     · N / د: New task in the active page's quickadd box
     · / : Search tasks
     · J / ت: Move selection down to next task
     · K / ن: Move selection up to previous task
     · Alt + ↑ / ↓: Move the focused task one place up / down
     · ?: Open shortcuts cheat-sheet modal
*/

import { $ } from './utils.js';
import { moveTask } from './tasks.js';

export function openShortcuts() {
  const overlay = $('#shortcutsOverlay');
  if (overlay) {
    overlay.hidden = false;
    $('#shortcutsClose')?.focus();
  }
}

export function closeShortcuts() {
  const overlay = $('#shortcutsOverlay');
  if (overlay) overlay.hidden = true;
}

function isInputActive(e) {
  const tag = e.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
}

function isAnyModalOpen() {
  return document.querySelector('.overlay:not([hidden])') !== null;
}

function focusNewTask() {
  const activePage = document.querySelector('.page.active')?.id;
  if (activePage === 'page-today') {
    $('#todayInput')?.focus();
  } else if (activePage === 'page-week') {
    $('#wkInput')?.focus();
  } else {
    if (activePage !== 'page-tasks') {
      window.dispatchEvent(new CustomEvent('navigate', { detail: 'tasks' }));
    }
    setTimeout(() => $('#taskInput')?.focus(), 50);
  }
}

function focusSearch() {
  const activePage = document.querySelector('.page.active')?.id;
  if (activePage !== 'page-tasks') {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'tasks' }));
  }
  setTimeout(() => $('#searchInput')?.focus(), 50);
}

function stepTaskRow(step) {
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const rows = [...activePage.querySelectorAll('.task:not([hidden]), .t-row, .wk-row')];
  if (!rows.length) return;

  const currentIdx = rows.findIndex(r => r === document.activeElement || r.contains(document.activeElement));
  let nextIdx;
  if (currentIdx === -1) {
    nextIdx = step > 0 ? 0 : rows.length - 1;
  } else {
    nextIdx = Math.max(0, Math.min(rows.length - 1, currentIdx + step));
  }
  const target = rows[nextIdx];
  if (target) {
    target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

export function initShortcuts() {
  document.addEventListener('keydown', e => {
    // If a modal is open, Escape closes it
    const shortcutsModal = $('#shortcutsOverlay');
    if (shortcutsModal && !shortcutsModal.hidden) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeShortcuts();
      }
      return;
    }

    if (isInputActive(e)) return;
    if (isAnyModalOpen()) return;

    if (e.key === '?' || e.key === '؟' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      openShortcuts();
      return;
    }

    /* Alt+↑/↓ on a task row (or anything inside it) moves that task one place. */
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('#taskList .task');
      if (row) { e.preventDefault(); moveTask(row.dataset.id, e.key === 'ArrowUp' ? -1 : 1); }
      return;
    }

    if (e.altKey || e.ctrlKey || e.metaKey) return;

    const key = e.key.toLowerCase();
    if (key === 'n' || e.code === 'KeyN') {
      e.preventDefault();
      focusNewTask();
    } else if (key === '/' || e.code === 'Slash') {
      e.preventDefault();
      focusSearch();
    } else if (key === 'j' || e.code === 'KeyJ') {
      e.preventDefault();
      stepTaskRow(1);
    } else if (key === 'k' || e.code === 'KeyK') {
      e.preventDefault();
      stepTaskRow(-1);
    }
  });

  $('#shortcutsClose')?.addEventListener('click', closeShortcuts);
  $('#shortcutsOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'shortcutsOverlay') closeShortcuts();
  });
}
