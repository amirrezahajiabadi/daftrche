/* The words of the onboarding, kept apart from the DOM code in onboarding.js so
   they can be read, tested and later translated without loading the app. */
import { GOALS } from './store.js';

/* Examples written in the app's own quick-add language, one set per goal, so the
   first thing a reader sees is a sentence they could have typed. None of them
   names a day: the first task must land on Today, where the tour looks for it. */
export const EXAMPLES = {
  tasks: ['جواب‌دادن به ایمیل‌ها', 'خرید نان #خانه', 'زنگ‌زدن به مامان'],
  books: ['۲۰ صفحه کتاب بخون ۳۰ دقیقه', 'مرور یادداشت‌های فصل ۲', 'انتخاب کتاب بعدی'],
  focus: ['نوشتن گزارش ۲۵ دقیقه', 'درس‌خوندن ۴۵ دقیقه #درس', 'مرتب‌کردن میز ۱۰ دقیقه'],
};
export const examplesFor = goal => EXAMPLES[GOALS.includes(goal) ? goal : 'tasks'];

/* The two titles and lines the pane shows, as data — so the copy can be read and
   tested without a DOM.

   Written as the benefit, not the feature: «کاری از قلم نمی‌افته» says what the
   reader gets out of the tasks page, where «کارها» only named a tab. The task
   step promises a ready answer rather than a blank box, because the example is
   already in the field when the pane opens. */
export const PANES = {
  goal: { steps: '۲ از ۳', title: 'دفترچه چه کاری از دوشت برداره؟', sub: 'یک انتخاب، تا مثال‌ها و راهنمای امروز به کارِ خودت بیاد.' },
  task: { steps: '۳ از ۳', title: 'اولین کار، آماده است', sub: 'همین رو تأیید کن یا بنویس؛ زمان و دسته رو خودم می‌فهمم.' },
};
