/* ═══ Journal Page, Today Entry Card & End-of-Day Wind-Down UI ═══
   Separates reflection & memory keeping into dedicated #page-journal while
   keeping a compact 1-tap card + «پایان روز» ritual on #page-today.
   Supports:
     · Freeform memories (optional title + body) + optional writing prompts
     · Compressed JPEG photo attachments (up to 4/day in IndexedDB + Lightbox)
     · «در چنین روزی…» Time Capsule banner & searchable timeline archive
     · End-of-Day Wind-Down 2-step modal with DAL-backed task rollover
*/

import { state } from './state.js';
import { MOODS, FACES } from './constants.js';
import { $, dayKey, shiftKey, faNum, esc } from './utils.js';
import { loadJournal, saveJournal, saveMoods } from './store.js';
import { subscribe, notify } from './bus.js';
import { updateTask } from './taskrepo.js';
import { getHistory } from './focushistory.js';
import { readLedger } from './ledger.js';
import { formatJalaliDate } from './jalali.js';
import { openDuePicker } from './duepicker.js';
import { confirmDialog } from './dialog.js';
import {
  MAX_JOURNAL_TITLE,
  MAX_JOURNAL_TEXT,
  MAX_JOURNAL_PHOTOS,
  JOURNAL_TEMPLATES,
  normalizeJournalEntry,
  normalizeJournalMap,
  hasJournalContent,
  getDailyPrompt,
  findPastMemories,
  filterJournalTimeline,
  groupJournalByJalaliMonth,
  computeJournalStats,
  buildWindDownSummary,
} from './journal-logic.js';
import {
  saveJournalPhoto,
  getJournalPhotoUrl,
  deleteJournalPhoto,
} from './journal-media.js';

let promptOffset = 0;
let capsuleOffset = 0;
let saveTimer = null;
let editingDateKey = null; // null => today's key
let timelineQuery = '';
let timelinePhotosOnly = false;
let timelineStarredOnly = false;
let timelineMoodFilter = null;
let lightboxPhotoIds = [];
let lightboxIndex = 0;
let tasksProvider = {
  getCompletedToday: () => [],
  getPendingToday: () => [],
};

const initializedTodayRoots = new WeakSet();
const initializedPageRoots = new WeakSet();

function currentTodayKey() {
  return dayKey(new Date());
}

function activeDateKey() {
  return editingDateKey || currentTodayKey();
}

function moodNumberForDay(key) {
  const raw = state.moods && typeof state.moods === 'object' ? Number(state.moods[key]) : 0;
  return Number.isInteger(raw) && raw >= 1 && raw <= MOODS.length ? raw : null;
}

function getJournalMap() {
  if (state.journal && typeof state.journal === 'object' && !Array.isArray(state.journal)) {
    return state.journal;
  }
  const loaded = loadJournal();
  state.journal = loaded;
  return loaded;
}

function getEntryForDay(key) {
  const map = getJournalMap();
  const raw = map[key];
  return raw ? normalizeJournalEntry(raw, key) : null;
}

function formatDayHeadline(key) {
  const today = currentTodayKey();
  if (key === today) return 'امروز';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = new Intl.DateTimeFormat('fa-IR', { weekday: 'long' }).format(dt);
  return `${weekday} ${formatJalaliDate(dt)}`;
}

function getTodayFocusMinutes(todayKeyStr) {
  const fromHistory = getHistory()
    .filter(r => r && Number.isFinite(Number(r.endedAt)) && dayKey(new Date(Number(r.endedAt))) === todayKeyStr)
    .reduce((sum, r) => sum + (Number(r.actualDurationMin) || 0), 0);
  let fromLedger = 0;
  try {
    const led = readLedger();
    fromLedger = Number(led?.days?.[todayKeyStr]?.focusMin) || 0;
  } catch { /* ignore */ }
  return Math.max(Math.round(fromHistory), Math.round(fromLedger));
}

function setSaveStatus(text, stateClass = '') {
  const el = $('#journalSaveStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('saving', 'saved');
  if (stateClass) el.classList.add(stateClass);
}

function persistDayEntry({ title, text, photos, promptId, mood, starred } = {}, key = activeDateKey()) {
  const map = { ...getJournalMap() };
  const existing = getEntryForDay(key);
  const cleanTitle = typeof title === 'string'
    ? title.trim().slice(0, MAX_JOURNAL_TITLE)
    : (existing?.title || '');
  const cleanText = typeof text === 'string'
    ? text.slice(0, MAX_JOURNAL_TEXT)
    : (existing?.text || '');
  const cleanPhotos = Array.isArray(photos)
    ? photos
    : (existing?.photos || []);
  const nextStarred = typeof starred === 'boolean'
    ? starred
    : Boolean(existing?.starred);
  const resolvedMood = mood !== undefined
    ? mood
    : (moodNumberForDay(key) ?? existing?.mood ?? null);

  const hasAny = Boolean(cleanTitle || cleanText.trim() || cleanPhotos.length > 0);
  if (!hasAny && !existing) {
    setSaveStatus('');
    return null;
  }

  const nextVersion = existing ? existing.version + 1 : 1;
  const entry = normalizeJournalEntry({
    dateKey: key,
    title: cleanTitle,
    text: cleanText,
    photos: cleanPhotos,
    promptId: promptId !== undefined ? promptId : (existing?.promptId || null),
    mood: resolvedMood,
    starred: nextStarred,
    updatedAt: Date.now(),
    version: nextVersion,
  }, key);

  if (entry) {
    map[key] = entry;
    state.journal = map;
    saveJournal(map);
    setSaveStatus(hasJournalContent(entry) ? 'ذخیره شد' : 'پاک شد', 'saved');
    notify();
  }
  return entry;
}

async function deleteEntryForDay(key) {
  const existing = getEntryForDay(key);
  if (!existing) return;
  const map = { ...getJournalMap() };
  delete map[key];
  state.journal = map;
  saveJournal(map);

  const photos = Array.isArray(existing.photos) ? existing.photos : [];
  if (photos.length) {
    await Promise.all(photos.map(p => deleteJournalPhoto(p.id)));
  }
  setSaveStatus('پاک شد', 'saved');
  notify();
}

function setDayMood(key, nextMood) {
  const prev = moodNumberForDay(key);
  const targetMood = prev === nextMood ? null : nextMood;
  const nextMoods = (state.moods && typeof state.moods === 'object') ? { ...state.moods } : {};
  if (targetMood) nextMoods[key] = targetMood;
  else delete nextMoods[key];
  state.moods = nextMoods;
  saveMoods(nextMoods);

  const existing = getEntryForDay(key);
  if (existing) {
    persistDayEntry({ mood: targetMood }, key);
  } else {
    notify();
  }
}

/* ── Today Dashboard Compact Entry Card ── */
export function renderJournal() {
  if (typeof document === 'undefined') return;
  const sec = $('#todayJournalSec');
  if (!sec) return;

  const todayKeyStr = currentTodayKey();
  const existing = getEntryForDay(todayKeyStr);
  const badge = $('#journalPreviewBadge');
  const snippetEl = $('#todayJournalSnippet');
  const openBtn = $('#todayJournalOpenBtn');
  const memories = findPastMemories(getJournalMap(), todayKeyStr);

  const hasNote = existing && hasJournalContent(existing);
  const photoLen = existing?.photos?.length || 0;

  if (badge) {
    if (hasNote && photoLen > 0) {
      badge.hidden = false;
      badge.textContent = `ثبت شده · ${faNum(photoLen)} عکس`;
    } else if (hasNote) {
      badge.hidden = false;
      badge.textContent = 'ثبت شده';
    } else if (memories.length > 0) {
      badge.hidden = false;
      badge.textContent = 'خاطرهٔ گذشته';
    } else {
      badge.hidden = true;
      badge.textContent = '';
    }
  }

  if (snippetEl) {
    if (hasNote) {
      const previewSrc = existing.title || existing.text.trim() || `${faNum(photoLen)} عکس ثبت شده برای امروز`;
      snippetEl.textContent = previewSrc.length > 88 ? previewSrc.slice(0, 88).trim() + '…' : previewSrc;
    } else if (memories.length > 0) {
      const m = memories[0];
      const memText = m.title || m.text.trim();
      const short = memText.length > 68 ? memText.slice(0, 68).trim() + '…' : memText;
      snippetEl.textContent = `${m.label}: «${short}»`;
    } else {
      snippetEl.textContent = 'خاطره‌های امروز، اتفاق‌های قشنگ یا عکس‌هات رو بنویس…';
    }
  }

  if (openBtn) {
    const labelSpan = openBtn.querySelector('span');
    if (labelSpan) labelSpan.textContent = hasNote ? 'مشاهده و ادامه' : 'نوشتن';
  }

  const wdBtn = $('#windDownTrigger');
  if (wdBtn) {
    wdBtn.classList.toggle('is-evening', new Date().getHours() >= 18);
  }
}

/* ── Dedicated #page-journal Rendering ── */
async function showLightboxIndex(idx) {
  const overlay = $('#journalPhotoOverlay');
  const img = $('#journalPhotoLightboxImg');
  const nav = $('#journalPhotoNav');
  const counter = $('#journalPhotoCounter');
  if (!overlay || !img || !lightboxPhotoIds.length) return;

  const safeIdx = ((idx % lightboxPhotoIds.length) + lightboxPhotoIds.length) % lightboxPhotoIds.length;
  lightboxIndex = safeIdx;
  const url = await getJournalPhotoUrl(lightboxPhotoIds[safeIdx]);
  if (!url) return;
  img.src = url;
  overlay.hidden = false;

  if (nav && counter) {
    const multi = lightboxPhotoIds.length > 1;
    nav.hidden = !multi;
    if (multi) counter.textContent = `${faNum(safeIdx + 1)} از ${faNum(lightboxPhotoIds.length)}`;
  }
}

async function openPhotoLightbox(idsOrUrl, startIndex = 0) {
  if (Array.isArray(idsOrUrl) && idsOrUrl.length) {
    lightboxPhotoIds = idsOrUrl.slice();
    await showLightboxIndex(startIndex);
    return;
  }
  const overlay = $('#journalPhotoOverlay');
  const img = $('#journalPhotoLightboxImg');
  const nav = $('#journalPhotoNav');
  if (!overlay || !img || !idsOrUrl) return;
  lightboxPhotoIds = [];
  lightboxIndex = 0;
  if (nav) nav.hidden = true;
  img.src = idsOrUrl;
  overlay.hidden = false;
}

function closePhotoLightbox() {
  const overlay = $('#journalPhotoOverlay');
  const img = $('#journalPhotoLightboxImg');
  const nav = $('#journalPhotoNav');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  lightboxPhotoIds = [];
  lightboxIndex = 0;
  if (nav) nav.hidden = true;
  if (img) img.removeAttribute('src');
}

function renderPhotosGrid(entry) {
  const grid = $('#journalPhotosGrid');
  const countEl = $('#journalPhotoCount');
  const addBtn = $('#journalPhotoAddBtn');
  const photos = entry?.photos || [];

  if (countEl) {
    countEl.textContent = photos.length > 0
      ? `${faNum(photos.length)} از ${faNum(MAX_JOURNAL_PHOTOS)} عکس`
      : '';
  }
  if (addBtn) {
    addBtn.classList.toggle('is-disabled', photos.length >= MAX_JOURNAL_PHOTOS);
  }
  if (!grid) return;

  if (!photos.length) {
    grid.hidden = true;
    grid.innerHTML = '';
    return;
  }

  grid.hidden = false;
  grid.innerHTML = photos.map((p, idx) => `
    <div class="jp-thumb" data-photo-id="${esc(p.id)}" data-photo-idx="${idx}">
      <button type="button" class="jp-thumb-open" aria-label="نمایش بزرگ‌تر عکس">
        <img alt="عکس پیوست‌شده">
      </button>
      <button type="button" class="jp-thumb-del" aria-label="حذف عکس" title="حذف عکس">×</button>
    </div>
  `).join('');

  photos.forEach(p => {
    getJournalPhotoUrl(p.id).then(url => {
      const box = grid.querySelector(`.jp-thumb[data-photo-id="${CSS.escape(p.id)}"] img`);
      if (box && url) {
        box.src = url;
        box.dataset.loadedUrl = url;
      }
    });
  });
}

function renderMoodPicker(activeMood, isToday = true) {
  const host = $('#journalMoodPicker');
  if (!host) return;
  const label = isToday ? 'حال امروزت چطوره؟' : 'حال‌وهوای این روز:';
  const items = MOODS.map((m, idx) => {
    const val = idx + 1;
    const isSel = activeMood === val;
    const faceSvg = FACES[idx] || '';
    return `
      <button type="button" class="jm-face-btn${isSel ? ' is-active' : ''}" data-mood="${val}" aria-pressed="${isSel}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${faceSvg}</svg>
        <span>${esc(m.label)}</span>
      </button>`;
  }).join('');
  host.innerHTML = `<span class="jm-bar-label">${label}</span>${items}`;
}

function renderTemplatesRow() {
  const host = $('#journalTemplatesRow');
  if (!host || host.dataset.ready === '1') return;
  host.dataset.ready = '1';
  const chips = JOURNAL_TEMPLATES.map(t =>
    `<button type="button" class="journal-tpl-chip" data-tpl-id="${esc(t.id)}">${esc(t.label)}</button>`
  ).join('');
  host.innerHTML = `<span class="journal-tpl-label">قالب آماده:</span>${chips}`;
}

function renderMoodFilterOptions() {
  const sel = $('#journalMoodFilterSelect');
  if (!sel || sel.dataset.ready === '1') return;
  sel.dataset.ready = '1';
  const opts = ['<option value="">همه حال‌وهواها</option>']
    .concat(MOODS.map((m, idx) => `<option value="${idx + 1}">${esc(m.label)}</option>`));
  sel.innerHTML = opts.join('');
}

function renderCapsuleBanner(todayKeyStr) {
  const banner = $('#journalCapsuleBanner');
  if (!banner) return;
  const memories = findPastMemories(getJournalMap(), todayKeyStr);
  if (!memories.length) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  const safeIdx = ((capsuleOffset % memories.length) + memories.length) % memories.length;
  const m = memories[safeIdx];
  const titleHtml = m.title ? `<strong class="jc-cap-title">${esc(m.title)}</strong>` : '';
  const bodyText = m.text.trim();
  const snippet = bodyText.length > 220 ? bodyText.slice(0, 220).trim() + '…' : bodyText;
  const firstPhoto = m.photos && m.photos[0] ? m.photos[0] : null;
  const cycleBtn = memories.length > 1
    ? `<button type="button" class="jc-cap-next" id="journalCapsuleNextBtn">${faNum(safeIdx + 1)} از ${faNum(memories.length)} · بعدی</button>`
    : '';

  banner.hidden = false;
  banner.innerHTML = `
    <div class="journal-capsule" data-date-key="${esc(m.dateKey)}">
      <div class="jc-head">
        <span class="jc-kicker">در چنین روزی…</span>
        <div class="jc-head-tools">
          <span class="jc-meta">${esc(m.label)} · <span dir="ltr">${esc(m.jalaliDate)}</span></span>
          ${cycleBtn}
        </div>
      </div>
      <div class="jc-cap-row">
        <div class="jc-cap-copy">
          ${titleHtml}
          ${snippet ? `<p class="jc-body">${esc(snippet)}</p>` : ''}
        </div>
        ${firstPhoto ? `<img class="jc-cap-thumb" data-photo-id="${esc(firstPhoto.id)}" alt="خاطره تصویری">` : ''}
      </div>
    </div>`;

  if (firstPhoto) {
    getJournalPhotoUrl(firstPhoto.id).then(url => {
      const img = banner.querySelector(`.jc-cap-thumb[data-photo-id="${CSS.escape(firstPhoto.id)}"]`);
      if (img && url) img.src = url;
    });
  }
}

const STAR_BADGE_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

function renderTimelineCard(entry, currentEdit) {
  const moodObj = entry.mood ? MOODS[entry.mood - 1] : null;
  const isEditing = entry.dateKey === currentEdit;
  const trimmed = entry.text.trim();
  const snippet = trimmed.length > 160 ? trimmed.slice(0, 160) + '…' : trimmed;
  const photos = entry.photos || [];
  const thumbsHtml = photos.slice(0, 4).map((p, idx) =>
    `<img class="jt-thumb" data-photo-id="${esc(p.id)}" data-photo-idx="${idx}" alt="عکس خاطره">`
  ).join('');
  const starMark = entry.starred ? `<span class="jt-star-mark" title="خاطرهٔ برگزیده">${STAR_BADGE_SVG}</span>` : '';
  const moodBadge = moodObj ? `<span class="jt-mood">${esc(moodObj.label)}</span>` : '';
  const titleHtml = entry.title ? `<h3 class="jt-title">${esc(entry.title)}</h3>` : '';
  const textHtml = snippet ? `<p class="jt-text">${esc(snippet)}</p>` : '';
  const thumbsBlock = thumbsHtml ? `<div class="jt-thumbs">${thumbsHtml}</div>` : '';

  return `
    <article class="jt-card${isEditing ? ' is-editing' : ''}" data-date-key="${esc(entry.dateKey)}">
      <div class="jt-card-head">
        <div class="jt-date-group">
          <span class="jt-date" dir="ltr">${esc(entry.jalaliDate)}</span>
          ${starMark}
          ${moodBadge}
        </div>
        <button type="button" class="jt-edit-btn" data-edit-day="${esc(entry.dateKey)}">${isEditing ? 'در حال ویرایش' : 'باز کردن'}</button>
      </div>
      ${titleHtml}
      ${textHtml}
      ${thumbsBlock}
    </article>`;
}

function renderTimelineGroup(group, currentEdit) {
  const cardsHtml = group.items.map(e => renderTimelineCard(e, currentEdit)).join('');
  return `
    <div class="jt-month-group">
      <div class="jt-month-head">
        <span class="jt-month-title">${esc(group.label)}</span>
        <span class="jt-month-count">${faNum(group.items.length)} یادداشت</span>
      </div>
      ${cardsHtml}
    </div>`;
}

function renderTimeline() {
  const listEl = $('#journalTimeline');
  const statsEl = $('#journalArchiveStats');
  if (!listEl) return;

  const map = getJournalMap();
  const stats = computeJournalStats(map, currentTodayKey());
  if (statsEl) {
    if (!stats.totalEntries) {
      statsEl.textContent = '';
    } else {
      const parts = [`${faNum(stats.totalEntries)} خاطره`];
      if (stats.totalPhotos > 0) parts.push(`${faNum(stats.totalPhotos)} عکس`);
      if (stats.streakDays >= 2) parts.push(`${faNum(stats.streakDays)} روز پیاپی`);
      statsEl.textContent = parts.join(' · ');
    }
  }

  const entries = filterJournalTimeline(map, {
    query: timelineQuery,
    photosOnly: timelinePhotosOnly,
    starredOnly: timelineStarredOnly,
    mood: timelineMoodFilter,
  });

  const clearSearchBtn = $('#journalSearchClearBtn');
  if (clearSearchBtn) clearSearchBtn.hidden = !timelineQuery;

  const hasFilters = Boolean(timelineQuery || timelinePhotosOnly || timelineStarredOnly || timelineMoodFilter);
  if (!entries.length) {
    listEl.innerHTML = `<p class="jt-empty">${hasFilters
      ? 'خاطره‌ای با این فیلتر یا جستجو پیدا نشد.'
      : 'هنوز خاطره‌ای ثبت نشده؛ همین بالا اولین یادداشتت رو بنویس.'}</p>`;
    return;
  }

  const currentEdit = activeDateKey();
  const groups = groupJournalByJalaliMonth(entries);
  listEl.innerHTML = groups.map(g => renderTimelineGroup(g, currentEdit)).join('');

  listEl.querySelectorAll('.jt-thumb[data-photo-id]').forEach(img => {
    const pid = img.dataset.photoId;
    if (!pid) return;
    getJournalPhotoUrl(pid).then(url => {
      if (url) img.src = url;
    });
  });
}

function renderTodayContextChip(editKey, todayKeyStr) {
  const chip = $('#journalTodayContextChip');
  if (!chip) return;
  if (editKey !== todayKeyStr) {
    chip.hidden = true;
    chip.dataset.summaryText = '';
    return;
  }
  const doneCount = (tasksProvider.getCompletedToday() || []).length;
  const focusMin = getTodayFocusMinutes(todayKeyStr);
  if (!doneCount && !focusMin) {
    chip.hidden = true;
    chip.dataset.summaryText = '';
    return;
  }
  const parts = [];
  if (doneCount > 0) parts.push(`${faNum(doneCount)} کار انجام‌شده`);
  if (focusMin > 0) parts.push(`${faNum(focusMin)} دقیقه تمرکز`);
  const summaryLine = `خلاصهٔ امروز: ${parts.join(' · ')}`;
  chip.hidden = false;
  chip.textContent = summaryLine;
  chip.dataset.summaryText = summaryLine;
}

export function renderJournalPage() {
  if (typeof document === 'undefined') return;
  const page = $('#page-journal');
  if (!page) return;

  const todayKeyStr = currentTodayKey();
  const editKey = activeDateKey();

  const subtitle = $('#journalPageDate');
  if (subtitle) {
    subtitle.textContent = new Intl.DateTimeFormat('fa-IR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date());
  }

  const editingLabel = $('#journalEditingLabel');
  if (editingLabel) editingLabel.textContent = formatDayHeadline(editKey);

  const backTodayBtn = $('#journalBackTodayBtn');
  if (backTodayBtn) backTodayBtn.hidden = editKey === todayKeyStr;

  const entry = getEntryForDay(editKey);
  const moodNum = moodNumberForDay(editKey) ?? entry?.mood ?? null;
  const moodHint = $('#journalMoodHint');
  if (moodHint) moodHint.hidden = true;

  renderMoodPicker(moodNum, editKey === todayKeyStr);
  renderTodayContextChip(editKey, todayKeyStr);
  renderTemplatesRow();
  renderMoodFilterOptions();

  const starBtn = $('#journalStarBtn');
  if (starBtn) {
    const isStarred = Boolean(entry?.starred);
    starBtn.classList.toggle('is-starred', isStarred);
    starBtn.setAttribute('aria-pressed', String(isStarred));
  }

  const delBtn = $('#journalDeleteEntryBtn');
  if (delBtn) delBtn.hidden = !(entry && hasJournalContent(entry));

  const titleInput = $('#journalTitleInput');
  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = entry?.title || '';
  }
  const textarea = $('#journalTextarea');
  if (textarea && document.activeElement !== textarea) {
    textarea.value = entry?.text || '';
  }

  const promptEl = $('#journalPromptText');
  if (promptEl) {
    promptEl.textContent = getDailyPrompt(editKey, promptOffset).text;
  }

  renderPhotosGrid(entry);
  renderCapsuleBanner(todayKeyStr);
  renderTimeline();
}

/* ── Wind-Down Modal («پایان روز») ── */
function renderWindDownStep2(summary, todayKeyStr) {
  const list = $('#windDownRemainingList');
  const emptyEl = $('#windDownAllDoneNote');
  const moveBtn = $('#windDownMoveTomorrowBtn');
  const remaining = summary.remainingTasks;

  if (list) {
    if (!remaining.length) {
      list.innerHTML = '';
      list.hidden = true;
    } else {
      list.hidden = false;
      list.innerHTML = remaining.map(t => `<li class="wd-task-item"><span class="wd-task-dot" aria-hidden="true"></span><span>${esc(t.text)}</span></li>`).join('');
    }
  }
  if (emptyEl) emptyEl.hidden = remaining.length > 0;
  if (moveBtn) {
    moveBtn.hidden = remaining.length === 0;
    moveBtn.disabled = false;
    moveBtn.textContent = `انتقال ${faNum(remaining.length)} کار ناتمام به فردا`;
  }

  const quickNote = $('#windDownQuickNote');
  if (quickNote) {
    const entry = getEntryForDay(todayKeyStr);
    quickNote.value = entry ? entry.text : '';
  }
}

function openWindDownModal() {
  const overlay = $('#windDownOverlay');
  if (!overlay) return;

  const todayKeyStr = currentTodayKey();
  const completed = tasksProvider.getCompletedToday();
  const pending = tasksProvider.getPendingToday();
  const focusMinutes = getTodayFocusMinutes(todayKeyStr);
  const summary = buildWindDownSummary({
    todayTasks: [...completed, ...pending],
    focusMinutes,
    dateKey: todayKeyStr,
  });

  const step1 = $('#windDownStep1');
  const step2 = $('#windDownStep2');
  if (step1) step1.hidden = false;
  if (step2) step2.hidden = true;

  const doneCountEl = $('#windDownDoneCount');
  const focusMinEl = $('#windDownFocusMin');
  const msgEl = $('#windDownMessage');
  const moveStatus = $('#windDownMoveStatus');
  if (doneCountEl) doneCountEl.textContent = faNum(summary.completedCount);
  if (focusMinEl) focusMinEl.textContent = faNum(summary.focusMinutes);
  if (msgEl) msgEl.textContent = summary.message;
  if (moveStatus) {
    moveStatus.hidden = true;
    moveStatus.textContent = '';
  }

  renderWindDownStep2(summary, todayKeyStr);
  overlay.hidden = false;
}

function closeWindDownModal() {
  const overlay = $('#windDownOverlay');
  if (!overlay || overlay.hidden) return;
  const quickNote = $('#windDownQuickNote');
  const todayKeyStr = currentTodayKey();
  if (quickNote) {
    const existingText = getEntryForDay(todayKeyStr)?.text || '';
    if (quickNote.value !== existingText) {
      persistDayEntry({ text: quickNote.value }, todayKeyStr);
    }
  }
  overlay.hidden = true;
  renderJournal();
  renderJournalPage();
}

export function initJournalPage() {
  if (typeof document === 'undefined') return;
  const page = $('#page-journal');
  if (!page || initializedPageRoots.has(page)) {
    renderJournalPage();
    return;
  }
  initializedPageRoots.add(page);
  state.journal = normalizeJournalMap(getJournalMap());

  const titleInput = $('#journalTitleInput');
  const textarea = $('#journalTextarea');
  const promptPanel = $('#journalPromptPanel');
  const promptToggle = $('#journalPromptToggle');

  const scheduleAutoSave = () => {
    setSaveStatus('در حال نوشتن…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const key = activeDateKey();
      const promptId = promptPanel && !promptPanel.hidden
        ? getDailyPrompt(key, promptOffset).id
        : undefined;
      persistDayEntry({
        title: titleInput?.value ?? '',
        text: textarea?.value ?? '',
        promptId,
      }, key);
      renderTimeline();
      renderJournal();
    }, 400);
  };

  const flushComposerSave = () => {
    clearTimeout(saveTimer);
    const key = activeDateKey();
    const cur = getEntryForDay(key);
    const tVal = (titleInput?.value ?? '').trim();
    const bVal = textarea?.value ?? '';
    const promptId = promptPanel && !promptPanel.hidden
      ? getDailyPrompt(key, promptOffset).id
      : undefined;
    if ((cur?.title || '') !== tVal || (cur?.text || '') !== bVal) {
      persistDayEntry({ title: tVal, text: bVal, promptId }, key);
      renderJournalPage();
      renderJournal();
    }
  };

  titleInput?.addEventListener('input', scheduleAutoSave);
  titleInput?.addEventListener('blur', flushComposerSave);
  textarea?.addEventListener('input', scheduleAutoSave);
  textarea?.addEventListener('blur', flushComposerSave);

  // Mood picker inline inside #page-journal
  $('#journalMoodPicker')?.addEventListener('click', e => {
    const btn = e.target.closest('.jm-face-btn[data-mood]');
    if (!btn) return;
    const moodVal = Number(btn.dataset.mood);
    if (!Number.isInteger(moodVal)) return;
    setDayMood(activeDateKey(), moodVal);
    renderJournalPage();
  });

  // Starred toggle & Delete day entry
  $('#journalStarBtn')?.addEventListener('click', () => {
    const key = activeDateKey();
    const cur = getEntryForDay(key);
    const tVal = (titleInput?.value ?? cur?.title ?? '').trim();
    const bVal = textarea?.value ?? cur?.text ?? '';
    const photos = cur?.photos || [];
    if (!tVal && !bVal.trim() && !photos.length) return;
    persistDayEntry({
      title: tVal,
      text: bVal,
      photos,
      starred: !cur?.starred,
    }, key);
    renderJournalPage();
  });

  $('#journalDeleteEntryBtn')?.addEventListener('click', async () => {
    const key = activeDateKey();
    const cur = getEntryForDay(key);
    if (!cur || !hasJournalContent(cur)) return;
    const ok = await confirmDialog({
      title: 'حذف یادداشت این روز؟',
      body: 'متن و عکس‌های ثبت‌شده برای این تاریخ برای همیشه حذف می‌شوند.',
      confirmLabel: 'حذف کن',
      cancelLabel: 'انصراف',
      danger: true,
    });
    if (!ok) return;
    clearTimeout(saveTimer);
    if (titleInput) titleInput.value = '';
    if (textarea) textarea.value = '';
    await deleteEntryForDay(key);
    renderJournalPage();
    renderJournal();
  });

  // Pick any past Jalali date via calendar
  $('#journalPickDayBtn')?.addEventListener('click', () => {
    openDuePicker({
      current: activeDateKey(),
      onPick: pickedKey => {
        if (!pickedKey) return;
        const today = currentTodayKey();
        const clampedKey = pickedKey > today ? today : pickedKey;
        flushComposerSave();
        editingDateKey = clampedKey === today ? null : clampedKey;
        promptOffset = 0;
        renderJournalPage();
        textarea?.focus({ preventScroll: true });
      },
    });
  });

  // Insert Today's activity summary chip into journal text
  $('#journalTodayContextChip')?.addEventListener('click', e => {
    const summaryText = e.currentTarget.dataset.summaryText || '';
    if (!summaryText || !textarea) return;
    const curText = textarea.value;
    const nextText = curText.trim()
      ? `${curText.trimEnd()}\n\n${summaryText}`
      : summaryText;
    textarea.value = nextText.slice(0, MAX_JOURNAL_TEXT);
    persistDayEntry({ title: titleInput?.value ?? '', text: textarea.value }, activeDateKey());
    renderJournalPage();
    textarea.focus();
  });

  promptToggle?.addEventListener('click', () => {
    if (!promptPanel) return;
    const nextHidden = !promptPanel.hidden;
    promptPanel.hidden = nextHidden;
    promptToggle.setAttribute('aria-expanded', String(!nextHidden));
    if (!nextHidden) {
      const promptEl = $('#journalPromptText');
      if (promptEl) promptEl.textContent = getDailyPrompt(activeDateKey(), promptOffset).text;
    }
  });

  $('#journalUsePromptBtn')?.addEventListener('click', () => {
    if (!textarea) return;
    const key = activeDateKey();
    const prompt = getDailyPrompt(key, promptOffset);
    const curText = textarea.value;
    const nextText = curText.trim()
      ? `${curText.trimEnd()}\n\n${prompt.text}\n`
      : `${prompt.text}\n`;
    textarea.value = nextText.slice(0, MAX_JOURNAL_TEXT);
    persistDayEntry({
      title: titleInput?.value ?? '',
      text: textarea.value,
      promptId: prompt.id,
    }, key);
    renderJournalPage();
    textarea.focus();
  });

  $('#journalNextPromptBtn')?.addEventListener('click', () => {
    promptOffset += 1;
    const promptEl = $('#journalPromptText');
    if (promptEl) promptEl.textContent = getDailyPrompt(activeDateKey(), promptOffset).text;
  });

  $('#journalPromptHideBtn')?.addEventListener('click', () => {
    if (promptPanel) promptPanel.hidden = true;
    promptToggle?.setAttribute('aria-expanded', 'false');
  });

  $('#journalTemplatesRow')?.addEventListener('click', e => {
    const btn = e.target.closest('.journal-tpl-chip[data-tpl-id]');
    if (!btn || !textarea) return;
    const tpl = JOURNAL_TEMPLATES.find(t => t.id === btn.dataset.tplId);
    if (!tpl) return;
    const key = activeDateKey();
    if (titleInput && !titleInput.value.trim()) titleInput.value = tpl.title;
    const curText = textarea.value;
    const nextText = curText.trim()
      ? `${curText.trimEnd()}\n\n${tpl.body}`
      : tpl.body;
    textarea.value = nextText.slice(0, MAX_JOURNAL_TEXT);
    persistDayEntry({
      title: titleInput?.value ?? '',
      text: textarea.value,
      promptId: tpl.id,
    }, key);
    renderJournalPage();
    textarea.focus();
  });

  $('#journalBackTodayBtn')?.addEventListener('click', () => {
    flushComposerSave();
    editingDateKey = null;
    promptOffset = 0;
    renderJournalPage();
  });

  // Keyboard accessibility for label button
  $('#journalPhotoAddBtn')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('#journalPhotoInput')?.click();
    }
  });

  const photoInput = $('#journalPhotoInput');
  const photoError = $('#journalPhotoError');
  photoInput?.addEventListener('change', async () => {
    const files = [...(photoInput.files || [])];
    photoInput.value = '';
    if (!files.length) return;
    if (photoError) { photoError.hidden = true; photoError.textContent = ''; }

    const key = activeDateKey();
    const cur = getEntryForDay(key);
    const existingPhotos = cur?.photos ? cur.photos.slice() : [];
    const remainingSlots = MAX_JOURNAL_PHOTOS - existingPhotos.length;

    if (remainingSlots <= 0) {
      if (photoError) {
        photoError.hidden = false;
        photoError.textContent = `برای هر روز حداکثر ${faNum(MAX_JOURNAL_PHOTOS)} عکس قابل ثبت است.`;
      }
      return;
    }

    const toProcess = files.slice(0, remainingSlots);
    const added = [];
    for (const f of toProcess) {
      try {
        const meta = await saveJournalPhoto(f);
        added.push(meta);
      } catch (err) {
        if (photoError) {
          photoError.hidden = false;
          photoError.textContent = err?.message || 'ذخیرهٔ یکی از عکس‌ها انجام نشد.';
        }
      }
    }

    if (added.length) {
      const nextPhotos = [...existingPhotos, ...added].slice(0, MAX_JOURNAL_PHOTOS);
      persistDayEntry({
        title: titleInput?.value ?? cur?.title ?? '',
        text: textarea?.value ?? cur?.text ?? '',
        photos: nextPhotos,
      }, key);
      renderJournalPage();
      renderJournal();
    }
  });

  $('#journalPhotosGrid')?.addEventListener('click', async e => {
    const thumb = e.target.closest('.jp-thumb');
    if (!thumb) return;
    const photoId = thumb.dataset.photoId;
    if (!photoId) return;

    if (e.target.closest('.jp-thumb-del')) {
      const key = activeDateKey();
      const cur = getEntryForDay(key);
      if (!cur) return;
      const nextPhotos = (cur.photos || []).filter(p => p.id !== photoId);
      persistDayEntry({
        title: titleInput?.value ?? cur.title,
        text: textarea?.value ?? cur.text,
        photos: nextPhotos,
      }, key);
      await deleteJournalPhoto(photoId);
      renderJournalPage();
      renderJournal();
      return;
    }

    if (e.target.closest('.jp-thumb-open')) {
      const cur = getEntryForDay(activeDateKey());
      const ids = (cur?.photos || []).map(p => p.id);
      const startIdx = Number(thumb.dataset.photoIdx) || 0;
      await openPhotoLightbox(ids.length ? ids : [photoId], startIdx);
    }
  });

  $('#journalSearchInput')?.addEventListener('input', e => {
    timelineQuery = e.target.value || '';
    renderTimeline();
  });
  $('#journalSearchClearBtn')?.addEventListener('click', () => {
    timelineQuery = '';
    const inp = $('#journalSearchInput');
    if (inp) { inp.value = ''; inp.focus(); }
    renderTimeline();
  });

  $('#journalStarredFilterBtn')?.addEventListener('click', e => {
    timelineStarredOnly = !timelineStarredOnly;
    e.currentTarget.setAttribute('aria-pressed', String(timelineStarredOnly));
    e.currentTarget.classList.toggle('is-active', timelineStarredOnly);
    renderTimeline();
  });

  $('#journalPhotosFilterBtn')?.addEventListener('click', e => {
    timelinePhotosOnly = !timelinePhotosOnly;
    e.currentTarget.setAttribute('aria-pressed', String(timelinePhotosOnly));
    e.currentTarget.classList.toggle('is-active', timelinePhotosOnly);
    renderTimeline();
  });

  $('#journalMoodFilterSelect')?.addEventListener('change', e => {
    const v = Number(e.target.value);
    timelineMoodFilter = Number.isInteger(v) && v >= 1 && v <= MOODS.length ? v : null;
    renderTimeline();
  });

  $('#journalTimeline')?.addEventListener('click', async e => {
    const thumb = e.target.closest('.jt-thumb[data-photo-id]');
    if (thumb && thumb.dataset.photoId) {
      const card = thumb.closest('.jt-card[data-date-key]');
      const entry = card?.dataset.dateKey ? getEntryForDay(card.dataset.dateKey) : null;
      const ids = (entry?.photos || []).map(p => p.id);
      const idx = Number(thumb.dataset.photoIdx) || 0;
      await openPhotoLightbox(ids.length ? ids : [thumb.dataset.photoId], idx);
      return;
    }
    const cardOrBtn = e.target.closest('[data-edit-day], .jt-card[data-date-key]');
    const targetDay = cardOrBtn?.dataset.editDay || cardOrBtn?.dataset.dateKey;
    if (!targetDay) return;
    flushComposerSave();
    editingDateKey = targetDay === currentTodayKey() ? null : targetDay;
    promptOffset = 0;
    renderJournalPage();
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#journalCapsuleBanner')?.addEventListener('click', async e => {
    if (e.target.closest('#journalCapsuleNextBtn')) {
      capsuleOffset += 1;
      renderCapsuleBanner(currentTodayKey());
      return;
    }
    const thumb = e.target.closest('.jc-cap-thumb[data-photo-id]');
    if (thumb && thumb.dataset.photoId) {
      const card = thumb.closest('.journal-capsule[data-date-key]');
      const entry = card?.dataset.dateKey ? getEntryForDay(card.dataset.dateKey) : null;
      const ids = (entry?.photos || []).map(p => p.id);
      await openPhotoLightbox(ids.length ? ids : [thumb.dataset.photoId], 0);
      return;
    }
    const cap = e.target.closest('.journal-capsule[data-date-key]');
    if (cap?.dataset.dateKey) {
      flushComposerSave();
      editingDateKey = cap.dataset.dateKey === currentTodayKey() ? null : cap.dataset.dateKey;
      renderJournalPage();
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  const lightbox = $('#journalPhotoOverlay');
  lightbox?.addEventListener('click', e => {
    if (e.target === lightbox) closePhotoLightbox();
  });
  $('#journalPhotoClose')?.addEventListener('click', closePhotoLightbox);
  $('#journalPhotoPrev')?.addEventListener('click', () => {
    if (lightboxPhotoIds.length > 1) showLightboxIndex(lightboxIndex - 1);
  });
  $('#journalPhotoNext')?.addEventListener('click', () => {
    if (lightboxPhotoIds.length > 1) showLightboxIndex(lightboxIndex + 1);
  });
  document.addEventListener('keydown', e => {
    if (!lightbox || lightbox.hidden) return;
    if (e.key === 'Escape') {
      closePhotoLightbox();
    } else if (e.key === 'ArrowLeft' && lightboxPhotoIds.length > 1) {
      showLightboxIndex(lightboxIndex + 1);
    } else if (e.key === 'ArrowRight' && lightboxPhotoIds.length > 1) {
      showLightboxIndex(lightboxIndex - 1);
    }
  });

  renderJournalPage();
}

export function initJournal(providers = {}) {
  if (typeof document === 'undefined') return;
  if (providers && typeof providers.getCompletedToday === 'function') {
    tasksProvider = providers;
  }

  const sec = $('#todayJournalSec');
  if (!sec || initializedTodayRoots.has(sec)) {
    renderJournal();
    return;
  }
  initializedTodayRoots.add(sec);

  state.journal = normalizeJournalMap(getJournalMap());

  const openJournal = () => {
    editingDateKey = null;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('navigate', { detail: 'journal' }));
    }
  };
  $('#todayJournalOpenBtn')?.addEventListener('click', openJournal);
  $('#todayJournalCard')?.addEventListener('click', e => {
    if (!e.target.closest('#todayJournalOpenBtn')) openJournal();
  });

  $('#windDownTrigger')?.addEventListener('click', openWindDownModal);

  const overlay = $('#windDownOverlay');
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) closeWindDownModal();
  });
  $('#windDownClose1')?.addEventListener('click', closeWindDownModal);
  $('#windDownNextBtn')?.addEventListener('click', () => {
    const step1 = $('#windDownStep1');
    const step2 = $('#windDownStep2');
    if (step1) step1.hidden = true;
    if (step2) step2.hidden = false;
    $('#windDownQuickNote')?.focus({ preventScroll: true });
  });
  $('#windDownBackBtn')?.addEventListener('click', () => {
    const step1 = $('#windDownStep1');
    const step2 = $('#windDownStep2');
    if (step1) step1.hidden = false;
    if (step2) step2.hidden = true;
  });
  $('#windDownDoneBtn')?.addEventListener('click', closeWindDownModal);

  $('#windDownMoveTomorrowBtn')?.addEventListener('click', () => {
    const todayKeyStr = currentTodayKey();
    const tomorrowKey = shiftKey(todayKeyStr, 1);
    const pending = tasksProvider.getPendingToday().slice();
    let moved = 0;
    for (const t of pending) {
      if (!t || !t.id) continue;
      const res = updateTask(t.id, { dueDate: tomorrowKey });
      if (res && res.ok) moved += 1;
    }
    const moveBtn = $('#windDownMoveTomorrowBtn');
    const moveStatus = $('#windDownMoveStatus');
    const list = $('#windDownRemainingList');
    const emptyEl = $('#windDownAllDoneNote');
    if (moveBtn) moveBtn.hidden = true;
    if (list) { list.innerHTML = ''; list.hidden = true; }
    if (emptyEl) emptyEl.hidden = false;
    if (moveStatus) {
      moveStatus.hidden = false;
      moveStatus.textContent = moved > 0
        ? `${faNum(moved)} کار ناتمام به فردا منتقل شد.`
        : 'کاری برای انتقال باقی نمانده است.';
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) {
      closeWindDownModal();
    }
  });

  renderJournal();
  subscribe(() => {
    renderJournal();
    if ($('#page-journal')?.classList.contains('active')) {
      renderJournalPage();
    }
  });
}
