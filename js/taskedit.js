/* ═══ Task editing — a picker for one chip, a sheet for the whole task ═══
   Two ways in, one job each.

   · openChipPicker  — a small menu under a row's chip (category, duration,
     priority). It replaces the old click-to-cycle: cycling hid the other choices,
     could not go backwards, and made a one-off change cost up to five clicks.
   · openTaskEditor  — the ⋯ menu's «ویرایش»: title, priority, category, deadline
     and duration in one sheet, so every field of a task can be changed from a
     phone as easily as from a desktop (it used to rename only).

   Neither writes to the task list. They hand a result back through a callback and
   js/tasks.js applies it, so the list stays the only place that mutates tasks. */

import { $, parseDurationMin, formatDuration, esc, faNum, formatClock, parseTimeRange } from './utils.js';
import { CATS, P_LABEL, PRI_ICONS, DUR_PRESETS, LIB_ICONS } from './constants.js';
import { formatJalaliDate } from './jalali.js';
import { openDuePicker } from './duepicker.js';
import { mountSelectMenu } from './pickmenu.js';

/* ── Chip picker ── */
let pop = null, popCleanup = null;

export function closeChipPicker(restore = true) {
  if (!pop) return;
  const anchor = pop.anchor;
  if (popCleanup) popCleanup();
  pop.el.remove();
  pop = popCleanup = null;
  if (restore && anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
}

/* options: [{ value, label, color?, icon? }]; custom: optional minutes input */
export function openChipPicker(anchor, { label, options, current, onPick, custom = null }) {
  closeChipPicker(false);
  const el = document.createElement('div');
  el.className = 'chip-pop';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', label);
  el.innerHTML = options.map((o, i) => {
    const on = o.value === current;
    const dot = o.color ? `<i class="chip-pop-dot" style="--cc:${o.color}" aria-hidden="true"></i>` : '';
    /* A list of choices is a radio group; a list of commands (the book card's ⋯) is
       a plain menu, with nothing ticked and the first item taking focus. */
    const role = o.action ? 'menuitem' : 'menuitemradio';
    const checked = o.action ? '' : ` aria-checked="${on}"`;
    return `<button type="button" role="${role}" class="chip-pop-item${o.danger ? ' danger' : ''}" data-i="${i}"${checked} tabindex="${on || (o.action && i === 0) ? 0 : -1}">`
      + `${o.icon || dot}<span>${esc(o.label)}</span>${on ? `<b class="chip-pop-check" aria-hidden="true">${LIB_ICONS.check}</b>` : ''}</button>`;
  }).join('') + (custom ? `<label class="chip-pop-custom"><span>${esc(custom.label)}</span>`
    + `<input type="number" min="1" max="480" inputmode="numeric" placeholder="دقیقه" aria-label="${esc(custom.label)}"></label>` : '');
  document.body.appendChild(el);
  pop = { el, anchor };

  /* Under the chip, flipped above when the bottom of the screen (and the dock)
     would cut it off, and kept inside the viewport sideways. */
  const place = () => {
    /* offset sizes, not a bounding rect: the entrance animation scales the box, and a
       scaled measurement would leave the menu hanging off the edge. */
    const a = anchor.getBoundingClientRect(), r = { width: el.offsetWidth, height: el.offsetHeight };
    const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 64;
    let top = a.bottom + 6;
    if (top + r.height > innerHeight - dock - 16) top = Math.max(8, a.top - r.height - 6);
    let left = a.left + a.width / 2 - r.width / 2;
    left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
    el.style.top = top + 'px'; el.style.left = left + 'px';
  };
  place();

  const items = () => [...el.querySelectorAll('.chip-pop-item')];
  const pick = value => { const cb = onPick; closeChipPicker(false); cb(value); };
  el.addEventListener('click', e => {
    const b = e.target.closest('.chip-pop-item');
    if (b) pick(options[Number(b.dataset.i)].value);
  });
  const input = el.querySelector('.chip-pop-custom input');
  if (input) input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = parseDurationMin(input.value);
    if (v === null) { input.setAttribute('aria-invalid', 'true'); return; }
    pick(v);
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChipPicker(); return; }
    if (e.key === 'Tab') { closeChipPicker(false); return; }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || e.target === input) return;
    e.preventDefault();
    const list = items(), at = list.indexOf(document.activeElement);
    const next = list[(at + step + list.length) % list.length];
    list.forEach(b => { b.tabIndex = b === next ? 0 : -1; });
    next.focus();
  });
  const onDown = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeChipPicker(false); };
  /* The scroll that brought the chip into view can still be arriving when the menu
     opens, so the first moments are ignored; after that, scrolling the page away
     from the chip dismisses the menu rather than leaving it floating. */
  const openedAt = performance.now();
  const onScroll = () => { if (performance.now() - openedAt > 400) closeChipPicker(false); };
  document.addEventListener('pointerdown', onDown, true);
  addEventListener('resize', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  popCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    removeEventListener('resize', onScroll);
    document.removeEventListener('scroll', onScroll, { capture: true, passive: true });
  };
  (items().find(b => b.getAttribute('aria-checked') === 'true') || items()[0]).focus({ preventScroll: true });
}

/* The option lists the row chips and the sheet both draw from */
export const catOptions = () => CATS.map(c => ({ value: c.key, label: c.label, color: c.color }));
export const priOptions = () => ['high', 'mid', 'low'].map(k => ({ value: k, label: P_LABEL[k], icon: `<span class="chip-pop-ico" data-p="${k}">${PRI_ICONS[k]}</span>` }));
export const durOptions = () => DUR_PRESETS.map(v => ({ value: v, label: v ? formatDuration(v) : 'بدون زمان' }));

/* ── Full editor ── */
const form = () => $('#taskEditForm');
let draft = null, onSaveCb = null, lastFocus = null;

const TIME_SLOTS = [
  { key: 'none', label: 'ندارد', from: null, to: null },
  { key: 'morning', label: 'صبح (۹ تا ۱۲)', from: 9 * 60, to: 12 * 60 },
  { key: 'noon', label: 'ظهر (۱۲ تا ۱۴)', from: 12 * 60, to: 14 * 60 },
  { key: 'evening', label: 'عصر (۱۶ تا ۱۸)', from: 16 * 60, to: 18 * 60 },
  { key: 'night', label: 'شب (۲۰ تا ۲۲)', from: 20 * 60, to: 22 * 60 },
  { key: 'custom', label: 'دلخواه' },
];

export function hourLabel(min) {
  const h = Math.floor(min / 60);
  if (h === 0) return '۱۲ شب';
  if (h < 5) return `${faNum(h)} شب`;
  if (h < 12) return `${faNum(h)} صبح`;
  if (h === 12) return '۱۲ ظهر';
  if (h < 17) return `${faNum(h - 12)} بعدازظهر`;
  if (h < 20) return `${faNum(h - 12)} عصر`;
  return `${faNum(h - 12)} شب`;
}

function ensureSelectOption(select, value) {
  if (!select || value == null) return;
  const strVal = String(value);
  if (!Array.from(select.options).some(o => o.value === strVal)) {
    const min = Number(value);
    const label = min % 60 === 0
      ? `${hourLabel(min)} · ${formatClock(min)}`
      : `${formatClock(min)}`;
    const newOpt = new Option(label, strVal);
    let inserted = false;
    for (const opt of select.options) {
      if (Number(opt.value) > min) {
        select.insertBefore(newOpt, opt);
        inserted = true;
        break;
      }
    }
    if (!inserted) select.add(newOpt);
  }
}

const radio = (host, items, value, onChange) => {
  if (!host) return;
  host.innerHTML = items.map(o => {
    const on = o.value === value;
    const dot = o.color ? `<i class="chip-pop-dot" style="--cc:${o.color}" aria-hidden="true"></i>` : '';
    return `<button type="button" role="radio" class="te-chip${on ? ' sel' : ''}" aria-checked="${on}" data-v="${esc(String(o.value))}"${o.color ? ` style="--cc:${o.color}"` : ''}>${o.icon || dot}${esc(o.label)}</button>`;
  }).join('');
  host.onclick = e => {
    const b = e.target.closest('.te-chip'); if (!b) return;
    const o = items.find(x => String(x.value) === b.dataset.v);
    if (o) onChange(o.value);
  };
};

function paint() {
  radio($('#tePri'), priOptions().map(o => ({ ...o, icon: o.icon })), draft.p, v => { draft.p = v; paint(); });
  radio($('#teCat'), catOptions(), draft.cat, v => { draft.cat = v; paint(); });

  let currentSlotKey = 'none';
  if (draft.timeFrom != null && draft.timeTo != null) {
    const match = TIME_SLOTS.find(s => s.from === draft.timeFrom && s.to === draft.timeTo);
    currentSlotKey = match ? match.key : 'custom';
  }
  radio($('#teTime'), TIME_SLOTS.map(s => ({ value: s.key, label: s.label })), currentSlotKey, v => {
    if (v === 'none') {
      draft.timeFrom = null;
      draft.timeTo = null;
    } else if (v === 'custom') {
      if (draft.timeFrom == null || draft.timeTo == null || draft.timeTo <= draft.timeFrom) {
        const f = Number($('#teTimeFrom')?.value || (14 * 60));
        const t = Number($('#teTimeTo')?.value || (16 * 60));
        draft.timeFrom = f;
        draft.timeTo = t;
      }
    } else {
      const s = TIME_SLOTS.find(x => x.key === v);
      if (s) { draft.timeFrom = s.from; draft.timeTo = s.to; }
    }
    paint();
  });

  const customBox = $('#teTimeCustom');
  if (customBox) {
    customBox.hidden = currentSlotKey !== 'custom';
    if (currentSlotKey === 'custom') {
      const fromSel = $('#teTimeFrom'), toSel = $('#teTimeTo');
      if (draft.timeFrom != null && fromSel) {
        ensureSelectOption(fromSel, draft.timeFrom);
        fromSel.value = String(draft.timeFrom);
        fromSel.__smSync?.();
      }
      if (draft.timeTo != null && toSel) {
        ensureSelectOption(toSel, draft.timeTo);
        toSel.value = String(draft.timeTo);
        toSel.__smSync?.();
      }
    } else {
      const err = $('#teTimeError');
      if (err) err.hidden = true;
    }
  }

  radio($('#teDur'), durOptions(), DUR_PRESETS.includes(draft.durationMin) ? draft.durationMin : undefined, v => {
    draft.durationMin = v; $('#teDurCustom').value = ''; paint();
  });
  const due = $('#teDueBtn');
  due.textContent = draft.dueDate ? formatJalaliDate(new Date(draft.dueDate + 'T00:00:00')) : 'انتخاب مهلت…';
  $('#teDueClear').hidden = !draft.dueDate;
  const custom = $('#teDurCustom');
  if (draft.durationMin && !DUR_PRESETS.includes(draft.durationMin)) custom.value = draft.durationMin;
}

export function closeTaskEditor() {
  const ov = $('#taskEditOverlay');
  if (!ov || ov.hidden) return;
  ov.hidden = true; draft = onSaveCb = null;
  if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
}

export function openTaskEditor(task, onSave, opener = null) {
  const ov = $('#taskEditOverlay'); if (!ov) return;
  draft = {
    text: task.text,
    p: task.p || 'mid',
    cat: task.cat || 'misc',
    dueDate: task.dueDate || null,
    durationMin: task.durationMin || null,
    timeFrom: task.timeFrom ?? null,
    timeTo: task.timeTo ?? null,
  };
  onSaveCb = onSave; lastFocus = opener;
  $('#teTitle').value = task.text;
  $('#teDurCustom').value = '';
  $('#teError').hidden = true;
  const timeErr = $('#teTimeError');
  if (timeErr) timeErr.hidden = true;
  paint();
  ov.hidden = false;
}

export function initTaskEditor() {
  const f = form(), ov = $('#taskEditOverlay');
  if (!f || !ov) return;

  const fromSel = $('#teTimeFrom'), toSel = $('#teTimeTo');
  if (fromSel && toSel) {
    const opts = Array.from({ length: 24 }, (_, h) => {
      const min = h * 60;
      return `<option value="${min}">${hourLabel(min)} · ${formatClock(min)}</option>`;
    }).join('');
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    fromSel.value = String(14 * 60);
    toSel.value = String(16 * 60);

    /* The hour is picked from the app's own pill (js/pickmenu.js) like the
       calendar's year, not from the phone's white system sheet. The pill shows
       the clock — «۱۴:۰۰» — because it shares the row with the other end of the
       range; the list keeps the spoken hour beside it. */
    const hourText = t => t.split('·').pop().trim();
    mountSelectMenu(fromSel, { text: hourText });
    mountSelectMenu(toSel, { text: hourText });

    const onTimeChange = () => {
      const fVal = Number(fromSel.value);
      const tVal = Number(toSel.value);
      const err = $('#teTimeError');
      if (tVal <= fVal) {
        if (err) err.hidden = false;
      } else {
        if (err) err.hidden = true;
        if (draft) {
          draft.timeFrom = fVal;
          draft.timeTo = tVal;
        }
      }
    };
    fromSel.addEventListener('change', onTimeChange);
    toSel.addEventListener('change', onTimeChange);
  }

  $('#teDueBtn').addEventListener('click', () => {
    openDuePicker({ current: draft && draft.dueDate, onPick: key => { if (draft) { draft.dueDate = key || null; paint(); } } });
  });
  $('#teDueClear').addEventListener('click', () => { draft.dueDate = null; paint(); $('#teDueBtn').focus(); });
  $('#teDurCustom').addEventListener('input', e => {
    const v = parseDurationMin(e.target.value);
    if (e.target.value === '') return;
    draft.durationMin = v;           // null while the number is out of range
    e.target.setAttribute('aria-invalid', String(v === null));
    radio($('#teDur'), durOptions(), undefined, nv => { draft.durationMin = nv; $('#teDurCustom').value = ''; paint(); });
  });
  $('#teTitle').addEventListener('input', () => { $('#teError').hidden = true; });
  $('#teClose')?.addEventListener('click', closeTaskEditor);
  $('#teCancel').addEventListener('click', closeTaskEditor);
  ov.addEventListener('click', e => { if (e.target === ov) closeTaskEditor(); });
  ov.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#dueOverlay')?.hidden !== false) { e.stopPropagation(); closeTaskEditor(); } });
  f.addEventListener('submit', e => {
    e.preventDefault();
    const text = $('#teTitle').value.trim();
    if (!text) { $('#teError').hidden = false; $('#teTitle').focus(); return; }
    const raw = $('#teDurCustom').value;
    if (raw !== '' && parseDurationMin(raw) === null) { $('#teDurCustom').focus(); return; }

    const customBox = $('#teTimeCustom');
    if (customBox && !customBox.hidden) {
      const fVal = Number($('#teTimeFrom')?.value);
      const tVal = Number($('#teTimeTo')?.value);
      if (isNaN(fVal) || isNaN(tVal) || tVal <= fVal) {
        const err = $('#teTimeError');
        if (err) err.hidden = false;
        $('#teTimeFrom')?.focus();
        return;
      }
      if (draft) {
        draft.timeFrom = fVal;
        draft.timeTo = tVal;
      }
    }

    const cb = onSaveCb, result = { ...draft, text };
    closeTaskEditor();
    if (cb) cb(result);
  });
}
