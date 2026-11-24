/* ═══ Lucky Dice: What's the Next Task? ═══ */

import { state } from './state.js';
import { $ } from './utils.js';
import { flashTask } from './tasks.js';

let rollFinal = null;

/* `scope` narrows the draw (the Today page passes its own pending tasks); with none
   it is every unfinished task, as it always was. */
let rollOnToday = false, scopeFn = null;
const lastScope = () => (scopeFn ? scopeFn() : []);
export const setRollScope = fn => { scopeFn = fn; };
export function openRoll(scopePool) {
  rollOnToday = Array.isArray(scopePool);
  const pool = rollOnToday ? scopePool : (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && !t.deletedAt && !t.done);
  $('#rollOverlay').hidden = false;
  $('#rollActions').hidden = true;
  const box = $('#rollBox');
  const txt = $('#rollText');
  box.classList.remove('landed', 'tick');
  rollFinal = null;
  if (!pool.length) {
    txt.textContent = 'همه کارا انجام شده، دمت گرم!';
    box.classList.add('landed');
    return;
  }
  let i = 0, steps = 16, delay = 45;
  (function spin() {
    const pick = pool[Math.random() * pool.length | 0];
    txt.textContent = pick.text;
    box.classList.remove('tick'); void box.offsetWidth; box.classList.add('tick');
    i++;
    if (i < steps) { delay += 13; setTimeout(spin, delay); }
    else {
      rollFinal = pick;
      box.classList.add('landed');
      $('#rollActions').hidden = false;
    }
  })();
}

export function initRoll() {
  $('#diceBtn').onclick = () => openRoll();
  $('#rollGo').onclick = () => {
    $('#rollOverlay').hidden = true;
    if (!rollFinal) return;
    /* From Today the row to flash is the one on this page, not the Tasks list. */
    const row = rollOnToday && document.querySelector(`#todayList [data-id="${rollFinal.id}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600);
    } else flashTask(rollFinal.id);
  };
  $('#rollAgain').onclick = () => openRoll(rollOnToday ? lastScope() : undefined);
  $('#rollClose').onclick = () => { $('#rollOverlay').hidden = true; };
  $('#rollOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
}