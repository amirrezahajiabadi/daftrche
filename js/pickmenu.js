/* ═══ Select pill — the app's own list in place of the system one ═══
   A native <select> is the phone's wheel: correct, familiar, and wearing the
   operating system's skin instead of this app's. In the calendar it opened a
   white system menu with a blue highlighted row over a warm paper page; the
   shelf's sort order did the same above a rounded search bar. Both are a short
   pick from a short list, so both now wear what the rest of the app wears: a
   rounded button on the page's paper, and a card under it holding the choices,
   the current one filled.

   The <select> itself stays in the DOM and stays the source of truth. It holds
   the value, it is the element callers listen to with `change`, and it is what
   a test, a backup or a form would read. Only its face is replaced, so anything
   that already worked against those two controls keeps working: choosing a row
   sets `select.value` and dispatches the same `change` a wheel would.

   Two details are load-bearing:
     · the label is read from the <select>'s own option text every time, and a
       MutationObserver watches the options — the app's translator rewrites
       those labels after load, and the pill must not keep the old language;
     · the list is a fixed-position card in <body>, measured against the
       button. A list inside the calendar's toolbar would be clipped by it, and
       a year list under a header that is already near the bottom of the screen
       opens upward instead of running off it. */

import { esc } from './utils.js';

const SORT_ICON = '<svg class="sm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h8M4 12h5M4 17h3"/><path d="M17 5.5v12.5"/><path d="M13.9 14.9L17 18l3.1-3.1"/></svg>';
const CHECK_ICON = '<svg class="sm-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.4 4.5L19 7"/></svg>';

export { SORT_ICON };

/* One list at a time: a second pill closes the first, because two open cards
   over one page is never what was meant. */
let openClose = null;

/* The shelf's options are written with a sort glyph in them («⇅ آخرین مطالعه»).
   The pill draws that glyph as an icon, so it is not printed twice; native
   options keep their text, and the translator can rewrite it freely. */
const plain = text => String(text || '').replace(/^[\s⇅↑↓]+/, '').trim();

/* `text` is how an option is shortened on the pill only: an hour reads
   «دو بعدازظهر · ۱۴:۰۰» in the list, where there is room to say it, and «۱۴:۰۰»
   on the button, which shares its row with the other end of the range. */
export function mountSelectMenu(select, { icon = '', label = '', text = null } = {}) {
  if (!select) return () => {};
  if (select.__smSync) return select.__smSync;

  const wrap = document.createElement('span');
  wrap.className = 'sm';
  select.before(wrap);
  wrap.append(select);
  select.classList.add('sm-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sm-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = icon
    + '<span class="sm-val"></span>'
    + '<svg class="sm-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  wrap.append(btn);

  const value = btn.querySelector('.sm-val');
  let list = null;

  const sync = () => {
    const opt = select.options[select.selectedIndex];
    const shown = plain(opt ? opt.textContent : '');
    value.textContent = text ? text(shown) : shown;
    const name = label || select.getAttribute('aria-label') || '';
    if (name) btn.setAttribute('aria-label', name);
  };

  const rows = () => Array.from(list ? list.querySelectorAll('.sm-opt') : []);

  function place() {
    if (!list) return;
    const r = btn.getBoundingClientRect();
    const w = list.offsetWidth;
    const h = list.offsetHeight;
    const gap = 6;
    const room = window.innerHeight;
    let top = r.bottom + gap;
    /* Upward when the list would not fit below but does fit above — the year
       list sits high on the page in portrait, the sort pill low on the shelf. */
    if (top + h > room - 10 && r.top - gap - h > 10) top = r.top - gap - h;
    /* The page is RTL, so the list lines up with the button's right edge. */
    const right = Math.min(Math.max(8 + w, r.right), window.innerWidth - 8);
    const left = Math.max(8, right - w);
    list.style.top = `${Math.round(Math.max(8, top))}px`;
    list.style.left = `${Math.round(Math.min(left, window.innerWidth - w - 8))}px`;
  }

  function mark(i) {
    const all = rows();
    all.forEach((row, n) => {
      row.classList.toggle('act', n === i);
      if (n === i) row.focus({ preventScroll: true });
    });
    const active = all[i];
    if (active) active.scrollIntoView({ block: 'nearest' });
    /* Focusing or scrolling a row can move the page under the button, so the
       card is measured again after the row is in place — otherwise it sits a
       few pixels off the pill it belongs to. */
    place();
  }

  const activeIndex = () => Math.max(0, rows().findIndex(row => row.classList.contains('act')));

  function choose(i) {
    const opt = select.options[i];
    if (!opt) return;
    const same = i === select.selectedIndex;
    select.selectedIndex = i;
    /* The same event a native list fires, from the same element: every existing
       listener (`change` on the calendar bar, on the shelf's select) is untouched
       and needs no knowledge of this file. */
    if (!same) select.dispatchEvent(new Event('change', { bubbles: true }));
    /* The label is the chosen option's text, and a listener above may have
       re-rendered the page around this pill while the event was travelling —
       so the face is redrawn after the event, never before it. */
    sync();
    close();
  }

  function onPick(e) {
    const row = e.target.closest('.sm-opt');
    if (row) choose(Number(row.dataset.i));
  }

  function onKey(e) {
    const all = rows().length;
    const i = activeIndex();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); mark((i + 1) % all); break;
      case 'ArrowUp': e.preventDefault(); mark((i - 1 + all) % all); break;
      case 'Home': e.preventDefault(); mark(0); break;
      case 'End': e.preventDefault(); mark(all - 1); break;
      case 'Escape': e.preventDefault(); close(); break;
      case 'Tab': close(false); break;
      default: return;
    }
    e.stopPropagation();
  }

  function onOutside(e) {
    if (!list) return;
    if (list.contains(e.target) || btn.contains(e.target)) return;
    close(false);
  }

  function onReposition() { place(); }

  function close(returnFocus = true) {
    if (!list) return;
    list.remove();
    list = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', onReposition, { capture: true, passive: true });
    window.removeEventListener('resize', onReposition);
    if (openClose === close) openClose = null;
    if (returnFocus) btn.focus({ preventScroll: true });
  }

  function open() {
    if (list) return;
    if (openClose) openClose(false);
    openClose = close;

    const items = Array.from(select.options);
    if (!items.length) return;

    list = document.createElement('div');
    list.className = 'sm-list';
    list.setAttribute('role', 'listbox');
    list.innerHTML = items.map((opt, i) => '<button type="button" class="sm-opt" role="option" tabindex="-1"'
      + ` data-i="${i}" aria-selected="${i === select.selectedIndex}">`
      + `<span class="sm-opt-t">${esc(plain(opt.textContent))}</span>${CHECK_ICON}</button>`).join('');
    const name = label || select.getAttribute('aria-label');
    if (name) list.setAttribute('aria-label', name);
    document.body.append(list);

    btn.setAttribute('aria-expanded', 'true');
    place();

    list.addEventListener('click', onPick);
    list.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onReposition, { capture: true, passive: true });
    window.addEventListener('resize', onReposition, { passive: true });

    mark(Math.max(0, select.selectedIndex));
  }

  btn.addEventListener('click', () => (list ? close() : open()));
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  });

  /* The translator rewrites option labels and the aria-label in place; the pill
     follows them rather than freezing the text it was built with. */
  const mo = new MutationObserver(sync);
  mo.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] });

  select.addEventListener('change', sync);
  select.__smSync = sync;
  select.__smClose = () => close(false);
  sync();
  return sync;
}
