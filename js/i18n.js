/* ═══ Internationalization (i18n) Engine — Daftarche ═══
   Full Persian (fa) and English (en) localization layer.
   Provides dictionary lookup, token interpolation, locale-aware date/time/number
   formatting, DOM localization and Gregorian calendar support. */

import { loadLang, saveLang as storeSaveLang } from './store.js';
import { faNum, faDigits, esc, dayKey } from './utils.js';
import { notify } from './bus.js';

export const LANGUAGES = {
  fa: 'فارسی',
  en: 'English',
};

export const DEFAULT_LANG = 'fa';

export const TRANSLATIONS = {
  fa: {
    app: {
      title: 'دفتَرچه — لیست کارهای خودمون',
      tagline: 'لیست کارهای خودمون',
    },
    nav: {
      today: 'امروز',
      tasks: 'کارها',
      focus: 'تمرکز',
      library: 'کتابخانه',
      more: 'بیشتر',
      week: 'هفته من',
      stats: 'آمار من',
      achv: 'نشان‌ها',
      profile: 'پروفایل',
      settings: 'تنظیمات',
    },
    moreSheet: {
      week: 'تقویم هفتگی و برنامه‌ریزی روزها',
      stats: 'نگاهی به عملکرد و کارت قابل اشتراک',
      achv: 'دستاوردهایی که جمع کردی',
      profile: 'نام، عکس و کاراکترت',
      settings: 'رنگ و تم، پیوستگی و پاک‌کردن داده‌ها',
    },
    today: {
      title: 'امروز',
      subtitle: 'لیست کارهای امروز و حال و هوا',
      greeting: 'سلام {name} 👋',
      greetingAnonymous: 'سلام 👋',
      emptySummary: 'برنامه‌ات برای امروز خالیه؛ هر کاری خواستی اضافه کن ✨',
      pendingCasual: '{n} کار برای امروز',
      pendingImportant: '{n} کار مهم',
      completed: '{n} انجام شده',
      recommendationTitle: 'الان چی کار کنیم؟',
      frogHero: 'قورباغهٔ روز',
      skipRecommendation: 'یه کار دیگه…',
      allDone: 'همه کارهای امروز انجام شد! عالی پیش رفتی 🎉',
      noTasksYet: 'هیچ کاری برای امروز نداری. با زدن دکمهٔ + کار تازه اضافه کن.',
      quickAddPlaceholder: 'کاری که می‌خوای انجام بدی رو بنویس…',
      progressTitle: 'پیشرفت امروز',
      progressDone: '{pct}% کارهای امروز انجام شده',
      weekChartTitle: 'هفته من',
      streakHot: '{n} روز پیاپی 🔥',
      streakNormal: '{n} روز پیاپی',
      streakZero: 'شروع پیوستگی',
      moodTitle: 'حال و هوای امروز',
      focusCta: 'تمرکز روی این کار',
    },
    tasks: {
      title: 'کارها',
      subtitle: 'ذهنت رو خالی کن، کارها رو بنویس',
      addPlaceholder: 'مثلاً «فردا ساعت ۳ جلسه با علی» یا فقط عنوان کار',
      searchPlaceholder: 'جستجوی کارها…',
      allTasks: 'همه',
      emptyTitle: 'کاری این‌جا نیست',
      emptySub: 'با نوشتن اولین کار، روزت رو شروع کن.',
      priorityLow: 'کم',
      priorityMid: 'متوسط',
      priorityHigh: 'زیاد',
      priorityLabel: 'اولویت {p}',
      addTime: '+ زمان',
      addDueDate: '+ تاریخ',
      timeRangeLabel: '{from} تا {to}',
      overdue: 'گذشته از مهلت',
      today: 'امروز',
      tomorrow: 'فردا',
      dayAfter: 'پس‌فردا',
      daysLeft: '{n} روز دیگه',
      noDeadline: 'بدون مهلت',
      edit: 'ویرایش',
      delete: 'حذف',
      pin: 'سنجاق',
      unpin: 'برداشتن سنجاق',
      focus: 'تمرکز روی این کار',
      confirmDelete: 'این کار حذف بشه؟',
      filterAll: 'همه',
      priorityColon: 'اولویت:',
      categoryColon: 'دسته:',
      dueColon: 'مهلت:',
      durationColon: 'زمان:',
      customDate: 'تاریخ…',
      durNone: 'ندارد',
      dur5: '۵ دقیقه',
      dur15: '۱۵ دقیقه',
      dur30: '۳۰ دقیقه',
      dur60: '۶۰ دقیقه',
      dur90: '۹۰ دقیقه',
      durCustom: 'زمان دلخواه',
      minutePlaceholder: 'دقیقه',
      durCustomAria: 'مدت زمان دلخواه به دقیقه',
      filterActive: 'در حال انجام',
      filterDone: 'انجام شده',
      filterOverdue: 'کار های عقب افتاده',
      clearDone: 'پاک‌کردن انجام‌شده‌ها',
      nameAddPlaceholder: '{name}، مثلاً «فردا ساعت ۳ جلسه با علی» یا فقط عنوان کار',
      clearSearch: 'پاک کردن جستجو',
      diceTitle: 'کار بعدی چیه؟',
      diceAria: 'انتخاب شانسی کار بعدی',
      diceGo: 'بریم سراغش',
      diceAgain: 'یکی دیگه',
      diceEmpty: 'همه کارا انجام شده، دمت گرم!',
    },
    categories: {
      all: 'همه',
      study: 'درس',
      project: 'پروژه',
      home: 'خونه',
      shopping: 'خرید',
      health: 'سلامت',
      misc: 'متفرقه',
      work: 'کار',
      family: 'خانواده',
      finance: 'مالی',
    },
    moods: {
      m1: { label: 'حالوم خرابه مشتی', sub: 'ناراحت نباش، یه روز خوب میاد!' },
      m2: { label: 'هعی', sub: '' },
      m3: { label: 'بد نیستم', sub: '' },
      m4: { label: 'خوبم', sub: '' },
      m5: { label: 'میزان میزان', sub: 'همیشه میزان باشی گل!' },
    },
    planner: {
      title: 'برنامه‌ریزی هفتگی',
      subtitle: 'هفته‌ت رو بچین، روز به روز',
      prevWeek: 'هفتهٔ قبل',
      nextWeek: 'هفتهٔ بعد',
      today: 'امروز',
      addPlaceholder: 'کار برای {day}… (مثلاً: جلسه ساعت ۱۰ تا ۱۱ #پروژه)',
      noTasksDay: 'برای این روز کاری ثبت نشده.',
      summary: '{planned} کار برنامه‌ریزی‌شده · {done} انجام‌شده',
      timelineTitle: 'تایم‌لاین روز',
      untimedTitle: 'کارهای بدون ساعت (شناور)',
      doneTitle: 'انجام‌شده در این روز',
      activityTitle: 'این روز چه‌خبر بود',
      timeAndSpan: 'ساعت و بازهٔ زمانی',
      to: 'تا',
    },
    focus: {
      title: 'تمرکز',
      subtitle: 'روی یه کار تمرکز کن',
      ambienceTitle: 'فضای تمرکز',
      focusSpace: 'فضای تمرکز',
      ambienceLabelOn: 'صدای محیط: روشن',
      ambienceLabelOff: 'صدای محیط: خاموش',
      sceneSilence: 'سکوت',
      sceneRain: 'باران',
      sceneSea: 'دریا',
      sceneForest: 'جنگل',
      volMusic: 'موسیقی',
      volAmb: 'محیط',
      musicTitle: 'موسیقی',
      addMusic: '+ افزودن آهنگ',
      musicOff: 'خاموش',
      musicNight: 'آرامش شب',
      musicSpring: 'صبح بهاری',
      musicDeep: 'تمرکز عمیق',
      start: 'شروع تمرکز',
      pause: 'توقف',
      resume: 'ادامه',
      giveUp: 'پایان تمرکز',
      finishPrompt: 'نشست تمرکز به پایان رسید!',
      reflectionTitle: 'چطور گذشت؟',
      reflectionSub: 'یه نفس راحت بکش؛ عالی کار کردی.',
      soundAndAmbience: 'صدا و موسیقی',
    },
    library: {
      title: 'قفسهٔ من',
      subtitle: 'کتاب‌ها، جزوه‌ها و یادداشت‌ها',
      searchPlaceholder: 'جستجوی عنوان کتاب…',
      filterAll: 'همه',
      filterReading: 'در حال مطالعه',
      filterUnread: 'خوانده‌نشده',
      filterDone: 'تکمیل‌شده',
      sortRecent: '⇅ اخیر',
      sortProgress: '⇅ پیشرفت',
      sortNewest: '⇅ تازه‌ها',
      sortTitle: '⇅ الفبا',
      shelfTitle: 'قفسهٔ من',
      completedTitle: 'مطالعهٔ کامل‌شده',
      emptyTitle: 'هنوز کتابی اینجا نیست.',
      emptySub: 'یک PDF اضافه کن تا مطالعه‌ات رو از همین‌جا ادامه بدی.',
      addPdf: 'افزودن PDF',
      backToShelf: '→ قفسه',
      goalChip: '🎯 هدف',
      pageProgress: 'صفحه {current} از {total}',
      markAsRead: 'خواندم',
      markUnread: 'نخوانده',
      eraserTitle: 'پاک‌کن',
      undoTitle: 'لغو آخرین علامت',
      addNoteTitle: 'افزودن یادداشت صفحه',
      notesBadgeTitle: 'یادداشت‌ها و هایلایت‌ها',
      statBooks: '📚 کتاب‌ها',
      statPages: '📄 صفحه‌ها',
      statTime: '⏱ مطالعه',
      statNotes: '📝 نکات',
      addBook: 'افزودن کتاب',
      searchAria: 'جستجوی کتاب',
      sortAria: 'مرتب‌سازی کتاب‌ها',
      filterAria: 'فیلتر وضعیت کتاب',
      currentlyReading: 'در حال مطالعه',
      continueReading: 'ادامه مطالعه ←',
      startReading: '📖 شروع',
      continueReadingBtn: '📖 ادامه',
      completedBadge: 'مطالعهٔ کامل‌شده',
      goalTitle: 'هدف مطالعه',
      goalSubtitle: 'می‌خوای با خوندن این کتاب به چی برسی؟',
      goalFull: 'مطالعهٔ کامل کتاب',
      goalPersonal: 'هدف شخصی',
      goalTextPlaceholder: 'مثلاً: یادگیری معماری نرم‌افزار',
      goalDaily: 'هدف روزانه:',
      goalPagesPlaceholder: 'مثلاً ۱۰',
      goalPagesUnit: 'صفحه در روز',
      goalSave: 'ثبت هدف',
      goalCancel: 'بی‌خیال',
      renameTitle: 'تغییر نام کتاب',
      renameSubtitle: 'نام دلخواهت رو برای این کتاب بنویس:',
      renamePlaceholder: 'عنوان کتاب',
      renameSave: 'ذخیره نام',
      renameCancel: 'انصراف',
    },
    profile: {
      title: 'پروفایل',
      subtitle: 'شناسنامهٔ دفترچه‌ات',
      addPhoto: 'افزودن عکس پروفایل',
      changePhoto: 'تغییر عکس',
      removePhoto: 'حذف عکس',
      changeName: 'تغییر اسم',
      myCharacter: 'کاراکتر من',
      companion: 'همدم دفتَرچه',
      changeChar: 'تغییر',
      myStats: 'آمار من',
      statsCta: 'مشاهده',
      statsHint: 'نگاهی به هفت روز، ماه، سه‌ماهه، شش‌ماهه و یک‌سال گذشته — با کارت قابل اشتراک‌گذاری.',
      badges: 'نشان‌ها',
      allBadges: 'همهٔ نشان‌ها',
      settingsDoor: 'تنظیمات',
      settingsHint: 'رنگ و تم دفترچه، مرخصی پیوستگی، مدت تمرکز — و پاک‌کردن داده‌ها.',
    },
    settings: {
      title: 'تنظیمات',
      subtitle: 'دفترچه رو مال خودت کن',
      appearance: 'ظاهر',
      theme: 'تم',
      themeHint: 'نه رنگ — پنج روشن و چهار تیره. انتخاب هر نصف یادش می‌مونه، پس دفعهٔ بعد که سر بزنی همون رنگی که گذاشتی برمی‌گرده.',
      autoTheme: 'تم خودکار',
      autoThemeHint: 'تغییر خودکار تم روشن و تیره مطابق با حالت تاریک/روشن گوشی یا مرورگر.',
      autoThemeActive: 'فعال',
      autoThemeInactive: 'غیرفعال',
      language: 'زبان / Language',
      languageHint: 'زبان رابط کاربری و سیستم تقویم دفترچه.',
      langFa: 'فارسی',
      langEn: 'English',
      streakAndFocus: 'پیوستگی و تمرکز',
      freezeTitle: 'مرخصی پیوستگی',
      freezeHint: 'هر ۳۰ روز فعال یه مرخصی می‌گیری (تا دو تا در انبار). اگه یه روز جا بمونی، خودش می‌پوشونه‌ش تا پیوستگیت نشکنه.',
      freezeOn: 'روشن',
      freezeOff: 'خاموش',
      focusDurTitle: 'مدت هر نشست تمرکز',
      focusDurHint: 'پیش‌فرض هر نشست؛ از خود صفحهٔ تمرکز عوضش کن.',
      birthdayTitle: 'تاریخ تولد',
      birthdayLabel: 'تولدت',
      birthdayHint: 'دفترچه دوست داره تاریخ تولدتو بدونه!',
      aboutTitle: 'درباره',
      tourTitle: 'راهنمای دفترچه',
      tourBtn: 'بریم',
      tourHint: 'تور کوتاهی که همه‌جای دفترچه رو نشون می‌ده — همونی که بار اول دیدی، از اول.',
      versionTitle: 'نسخه',
      changelogTitle: 'تازه‌های دفترچه',
      changelogBtn: 'ببین',
      changelogHint: 'هر بار دفترچه به‌روز می‌شه، این‌جا می‌تونی ببینی چی عوض شده.',
      backupTitle: 'پشتیبان‌گیری و ماندگاری',
      persistTitle: 'ذخیرهٔ پایدار',
      persistChecking: 'بررسی…',
      persistActive: 'فعال',
      persistInactive: 'غیرفعال',
      persistHint: 'با فعال بودن ذخیرهٔ پایدار، مرورگر اطلاعات دفترچه را در کمبود حافظه پاک نمی‌کند.',
      exportTitle: 'گرفتن پشتیبان',
      exportBtn: 'دانلود',
      exportHint: 'کارها، پیوستگی، نشان‌ها، تنظیمات و پیشرفت کتاب‌ها توی یه فایل ذخیره می‌شن. خودِ فایل PDFها و موسیقی‌ها توش نیستن.',
      importTitle: 'بازگردانی از پشتیبان',
      importBtn: 'انتخاب فایل',
      importHint: 'فایل معتبر که وارد شد، خودش می‌پرسه ادغام بشه یا جایگزین.',
      shortcutsTitle: 'راهنما و میانبرها',
      shortcutsLabel: 'کلیدهای میانبر صفحه‌کلید',
      shortcutsBtn: 'راهنما (؟)',
      shortcutsHint: 'میانبرهای سریع برای ایجاد کار (N)، جستجو (/) و حرکت بین ردیف‌ها (J/K) با کیبورد؛ برای جابه‌جایی ردیف Alt را نگه دار و ↑/↓ را بزن.',
      themeModeAria: 'روشن یا تیره',
      autoThemeAria: 'تم خودکار بر اساس تم سیستم',
      clearDataTitle: 'پاک‌کردن همهٔ داده‌ها',
      clearDataBtn: 'پاک کن',
      clearDataHint: 'کارها، کتاب‌ها، موسیقی‌ها و تنظیمات پاک می‌شن. این کار برگشت‌پذیر نیست.',
      aboutTagline: 'کار هاتو به دفتَرچه بسپار',
    },
    due: {
      today: 'امروز',
      tomorrow: 'فردا',
      afterTomorrow: 'پس‌فردا',
      none: 'بدون مهلت',
      prevMonth: 'ماه قبل',
      nextMonth: 'ماه بعد',
      dialogTitle: 'مهلت انجام',
      dialogSub: 'تاریخ انجام کار را انتخاب کن',
    },
    common: {
      save: 'ذخیره',
      cancel: 'انصراف',
      close: 'بستن',
      delete: 'حذف',
      edit: 'ویرایش',
      back: 'بازگشت',
      minute: 'دقیقه',
      hour: 'ساعت',
      day: 'روز',
    },
    dialogs: {
      nameTitle: 'اسمت چیه؟',
      nameSub: 'دفترچه دوست داره اسمت رو بدونه تا کار باهاش صمیمی‌تر بشه.',
      namePlaceholder: 'مثلاً: سارا، علی…',
      nameSave: 'ثبت اسم',
      nameSkip: 'بعداً می‌گم',
      clearAllConfirm: 'همهٔ اطلاعات و داده‌های دفترچه پاک شود؟',
      confirm: 'تأیید',
      cancel: 'انصراف',
      delete: 'حذف',
      ok: 'باشه',
      wipeTitle: 'همهٔ داده‌ها پاک بشه؟',
      wipeBody: 'همهٔ کارها، آمار، کتاب‌ها و موسیقی‌ها پاک می‌شن. این کار قابل برگشت نیست.',
      wipeConfirm: 'پاک کن',
      wipeCancel: 'انصراف',
      backupChoiceTitle: 'پشتیبان وارد بشه',
      backupWhenPrefix: 'پشتیبان',
      backupWhenSuffix: 'گرفته شده.',
      backupMerge: 'ادغام با داده‌های فعلی',
      backupMergeHint: 'چیزی که این‌جا هست نمی‌ره جای دیگه؛ فایل بهش اضافه می‌شه.',
      backupReplace: 'جایگزینی کامل',
      backupReplaceHint: 'همهٔ داده‌های این دستگاه با فایل عوض می‌شه و برنمی‌گرده.',
      backupCancel: 'انصراف',
      avatarTitle: 'کاراکترت رو انتخاب کن',
      avatarSub: 'کاراکترهای اختصاصی دفتَرچه — همدمِ روزهای تو',
      avatarApply: 'انتخاب',
      avatarClose: 'بستن',
      shortcutsTitle: 'کلیدهای میانبر صفحه‌کلید',
      shortcutsClose: 'متوجه شدم',
      toastUndo: 'حذف شد',
      toastUndoBtn: 'پشیمون شدم!',
      toastErase: 'پاک شد',
      toastEraseBtn: 'برگردون',
      toastStorage: 'ذخیره نشد؛ حافظهٔ مرورگر پر یا در دسترس نیست. از تنظیمات یه پشتیبان بگیر.',
      toastStorageBtn: 'باشه',
      toastUpdate: 'نسخهٔ جدید اومده!',
      toastUpdateBtn: 'دریافتش کن',
    },
    shareCard: {
      title: 'کارت آمار',
      layoutLabel: 'شکل کارت',
      themeLabel: 'رنگ',
      accentLabel: 'لهجهٔ رنگ',
      metricsLabel: 'عددهای کارت',
      metricsHint: 'تا سه عدد کنار عدد اصلی می‌آد؛ انتخاب چهارم جای قبلی رو می‌گیره.',
      shareBtn: 'اشتراک‌گذاری',
      downloadBtn: 'ذخیرهٔ عکس',
    },
    stats: {
      title: 'آمار من',
      subtitle: 'نگاهی به عملکردت',
      shareCard: 'کارت آمار',
      taskTrends: 'روند کارها',
      emptyTitle: 'این بازه هنوز کاری نداشته.',
      emptySub: 'یه کار تیک بزن یا یه تمرکز شروع کن تا این صفحه پر بشه.',
      historyTitle: 'سابقهٔ تمرکز',
      insightsTitle: 'چیزهایی که دیدیم',
      insightsPeriod: '۷ روز گذشته',
      forNextTime: 'برای دفعه بعد',
      streakTooltip: 'روزهای پیاپی که حداقل یک کار تمام شده',
    },
    themes: {
      paper: 'کاغذ',
      lilac: 'یاسی',
      blush: 'گلاب',
      sage: 'نعناع',
      ink: 'کاغذی',
      night: 'شب',
      gold: 'طلایی',
      ocean: 'اقیانوس',
      plum: 'بادمجان',
    },
    birthday: {
      dialogTitle: 'تاریخ تولدت',
      clearBtn: 'پاک کردن تاریخ تولد',
      currentYear: 'سال جاری',
      backToMonth: 'برگشت به ماه',
      birthYearAria: 'سال تولد',
      prevYear: 'یک سال قبل',
      nextYear: 'یک سال بعد',
      pickYearPrompt: 'سال تولدت را انتخاب کن',
      pickYearLabel: 'سال تولد: {year} — انتخاب سال دیگر',
      yearUnknown: 'سال؟',
      prevDecade: 'دههٔ قبل',
      nextDecade: 'دههٔ بعد',
      decadeTitle: 'دههٔ {decade}',
      decadeYearsAria: 'سال‌های دههٔ {decade}',
      yearAria: 'سال {year}',
      ariaRegistered: 'تاریخ تولد: {date} — برای تعویض کلیک کن',
      ariaEmpty: 'تاریخ تولدت را ثبت کن',
    },
    tour: {
      stationKicker: 'ایستگاه {letter}',
      count: '{cur} از {total}',
      skipLong: 'دفترچه رو میشناسم بذار بریم سراغ کار زندگیمون',
      skipShort: 'فعلاً رد کن',
      prev: 'قبلی',
      next: 'بعدی',
      start: 'بریم!',
      finish: 'تمومش کن',
      step1Title: 'خوش اومدی به دفتَرچه!',
      step1Text: 'این‌جا دفترچهٔ کارهاته: کارهای روزمره، تمرکز و یادداشت‌ها. یه آشنایی کوتاه سه مرحله‌ای داشته باشیم؟',
      step2Title: 'اولین کارت رو بنویس!',
      step2Text: 'کارت رو طبیعی بنویس، مثلاً: «فردا ساعت ۵ عصر خرید نان #خانه». پردازشگر فارسی دفتَرچه خودش مهلت، ساعت و دسته‌بندی رو تنظیم می‌کنه.',
      step3Title: 'همدم و پیشنهاد هوشمند',
      step3Text: 'هر وقت ندونی الان چه کاری اولویت داره، همدمت از بین لیست بهت کار متناسب رو پیشنهاد می‌ده.',
      step4Title: 'حالا دفترچه مال خودته!',
      step4Text: 'هر وقت خواستی این راهنما رو دوباره مرور کنی، از همین دکمه توی تنظیمات در دسترسه. موفق باشی! ✨',
    },
    changelog: {
      title: 'دفترچه به‌روز شد',
      subtitle: 'یه کم تازه‌تر شدیم — اینا عوض شدن',
      ok: 'فهمیدم',
      versionPrefix: 'نسخهٔ',
    },
    shortcuts: {
      addTask: 'افزودن کار جدید',
      search: 'جستجو بین کارها',
      nextRow: 'انتخاب ردیف بعدی',
      prevRow: 'انتخاب ردیف قبلی',
      moveRow: 'جابه‌جایی ردیف',
      help: 'نمایش این راهنما',
      close: 'بستن پنجره‌ها و منوها',
    },
  },
  en: {
    app: {
      title: 'Daftarche — Personal Tasks & Notebook',
      tagline: 'Your personal notebook & tasks',
    },
    nav: {
      today: 'Today',
      tasks: 'Tasks',
      focus: 'Focus',
      library: 'Library',
      more: 'More',
      week: 'My Week',
      stats: 'My Stats',
      achv: 'Badges',
      profile: 'Profile',
      settings: 'Settings',
    },
    moreSheet: {
      week: 'Weekly calendar and day planning',
      stats: 'Activity insights and shareable card',
      achv: 'Achievements and milestones collected',
      profile: 'Name, avatar and companion character',
      settings: 'Themes, appearance and preferences',
    },
    today: {
      title: 'Today',
      subtitle: "Today's tasks and reflection",
      greeting: 'Hello, {name} 👋',
      greetingAnonymous: 'Hello 👋',
      emptySummary: 'Your schedule for today is clear; add any task you like ✨',
      pendingCasual: '{n} task for today | {n} tasks for today',
      pendingImportant: '{n} priority task | {n} priority tasks',
      completed: '{n} completed',
      recommendationTitle: 'What should we do now?',
      frogHero: 'Frog of the Day',
      skipRecommendation: 'Something else…',
      allDone: 'All tasks completed for today! Outstanding job 🎉',
      noTasksYet: 'No tasks scheduled for today. Press + to add a fresh task.',
      quickAddPlaceholder: 'What would you like to accomplish today?…',
      progressTitle: "Today's Progress",
      progressDone: "{pct}% of today's tasks completed",
      weekChartTitle: 'My Week',
      streakHot: '{n}-day streak 🔥',
      streakNormal: '{n}-day streak',
      streakZero: 'Start your streak',
      moodTitle: "Today's Mood",
      focusCta: 'Focus on this task',
    },
    tasks: {
      title: 'Tasks',
      subtitle: 'Clear your mind, capture your work',
      addPlaceholder: 'e.g. “Meeting with Ali tomorrow at 3” — or just a title',
      searchPlaceholder: 'Search tasks…',
      allTasks: 'All',
      emptyTitle: 'No tasks here yet',
      emptySub: 'Write down your first task to kick off your day.',
      priorityLow: 'Low',
      priorityMid: 'Medium',
      priorityHigh: 'High',
      priorityLabel: '{p} priority',
      addTime: '+ Time',
      addDueDate: '+ Date',
      timeRangeLabel: '{from} – {to}',
      overdue: 'Overdue',
      today: 'Today',
      tomorrow: 'Tomorrow',
      dayAfter: 'In 2 days',
      daysLeft: 'In {n} days',
      noDeadline: 'No deadline',
      edit: 'Edit',
      delete: 'Delete',
      pin: 'Pin',
      unpin: 'Unpin',
      focus: 'Focus on this task',
      confirmDelete: 'Delete this task?',
      filterAll: 'All',
      priorityColon: 'Priority:',
      categoryColon: 'Category:',
      dueColon: 'Due date:',
      durationColon: 'Duration:',
      customDate: 'Date…',
      durNone: 'None',
      dur5: '5 min',
      dur15: '15 min',
      dur30: '30 min',
      dur60: '60 min',
      dur90: '90 min',
      durCustom: 'Custom…',
      minutePlaceholder: 'min',
      durCustomAria: 'Custom duration in minutes',
      filterActive: 'In progress',
      filterDone: 'Completed',
      filterOverdue: 'Overdue',
      clearDone: 'Clear completed',
      nameAddPlaceholder: '{name}, e.g. “Meeting with Ali tomorrow at 3” — or just a title',
      clearSearch: 'Clear search',
      diceTitle: 'What next?',
      diceAria: 'Pick a random task',
      diceGo: 'Let’s do it',
      diceAgain: 'Roll again',
      diceEmpty: 'All tasks completed, great job!',
    },
    categories: {
      all: 'All',
      study: 'Study',
      project: 'Project',
      home: 'Home',
      shopping: 'Shopping',
      health: 'Health',
      misc: 'Misc',
      work: 'Work',
      family: 'Family',
      finance: 'Finance',
    },
    moods: {
      m1: { label: 'Rough day', sub: 'Hang in there, better days are coming!' },
      m2: { label: 'Meh', sub: '' },
      m3: { label: 'Not bad', sub: '' },
      m4: { label: 'Good', sub: '' },
      m5: { label: 'Feeling great!', sub: 'Keep shining!' },
    },
    planner: {
      title: 'Weekly Planner',
      subtitle: 'Plan ahead, day by day',
      prevWeek: 'Previous week',
      nextWeek: 'Next week',
      today: 'Today',
      addPlaceholder: 'Task for {day}… (e.g. Team sync 10:00 to 11:00 #project)',
      noTasksDay: 'No tasks planned for this day.',
      summary: '{planned} planned · {done} completed',
      timelineTitle: "Day's Timeline",
      untimedTitle: 'Flexible Tasks',
      doneTitle: 'Completed on This Day',
      activityTitle: 'Activity on This Day',
      timeAndSpan: 'Time & Span',
      to: 'to',
    },
    focus: {
      title: 'Focus',
      subtitle: 'Immerse yourself in one task',
      ambienceTitle: 'Atmosphere',
      focusSpace: 'Focus Space',
      ambienceLabelOn: 'Ambient sound: On',
      ambienceLabelOff: 'Ambient sound: Off',
      sceneSilence: 'Quiet',
      sceneRain: 'Rain',
      sceneSea: 'Ocean',
      sceneForest: 'Forest',
      volMusic: 'Music',
      volAmb: 'Ambience',
      musicTitle: 'Music',
      addMusic: '+ Add music',
      musicOff: 'Off',
      musicNight: 'Night Calm',
      musicSpring: 'Spring Morning',
      musicDeep: 'Deep Focus',
      start: 'Start Focus',
      pause: 'Pause',
      resume: 'Resume',
      giveUp: 'End Session',
      finishPrompt: 'Focus session complete!',
      reflectionTitle: 'How was your session?',
      reflectionSub: 'Take a deep breath; you did great work.',
      soundAndAmbience: 'Sound & Ambience',
    },
    library: {
      title: 'My Shelf',
      subtitle: 'Books, documents, and notes',
      searchPlaceholder: 'Search book titles…',
      filterAll: 'All',
      filterReading: 'Reading',
      filterUnread: 'Unread',
      filterDone: 'Completed',
      sortRecent: '⇅ Recent',
      sortProgress: '⇅ Progress',
      sortNewest: '⇅ Newest',
      sortTitle: '⇅ Alphabetical',
      shelfTitle: 'My Shelf',
      completedTitle: 'Completed Reading',
      emptyTitle: 'No books on your shelf yet.',
      emptySub: 'Add a PDF to continue reading right here.',
      addPdf: 'Add PDF',
      backToShelf: '← Shelf',
      goalChip: '🎯 Goal',
      pageProgress: 'Page {current} of {total}',
      markAsRead: 'Mark as read',
      markUnread: 'Mark unread',
      eraserTitle: 'Eraser',
      undoTitle: 'Undo last stroke',
      addNoteTitle: 'Add page note',
      notesBadgeTitle: 'Notes & Highlights',
      statBooks: '📚 Books',
      statPages: '📄 Pages',
      statTime: '⏱ Reading',
      statNotes: '📝 Notes',
      addBook: 'Add Book',
      searchAria: 'Search books',
      sortAria: 'Sort books',
      filterAria: 'Filter books',
      currentlyReading: 'Currently Reading',
      continueReading: 'Continue Reading →',
      startReading: '📖 Start',
      continueReadingBtn: '📖 Continue',
      completedBadge: 'Completed Reading',
      goalTitle: 'Reading Goal',
      goalSubtitle: 'What do you want to achieve with this book?',
      goalFull: 'Read entire book',
      goalPersonal: 'Personal goal',
      goalTextPlaceholder: 'e.g. Learn software architecture',
      goalDaily: 'Daily target:',
      goalPagesPlaceholder: 'e.g. 10',
      goalPagesUnit: 'pages per day',
      goalSave: 'Save Goal',
      goalCancel: 'Cancel',
      renameTitle: 'Rename Book',
      renameSubtitle: 'Enter a new title for this book:',
      renamePlaceholder: 'Book title',
      renameSave: 'Save Name',
      renameCancel: 'Cancel',
    },
    profile: {
      title: 'Profile',
      subtitle: 'Your Daftarche passport',
      addPhoto: 'Add profile photo',
      changePhoto: 'Change photo',
      removePhoto: 'Remove photo',
      changeName: 'Change name',
      myCharacter: 'My Companion',
      companion: 'Daftarche Companion',
      changeChar: 'Change',
      myStats: 'My Stats',
      statsCta: 'View',
      statsHint: 'Insights from the past 7 days, month, quarter, and year — with a shareable card.',
      badges: 'Badges',
      allBadges: 'All Badges',
      settingsDoor: 'Settings',
      settingsHint: 'Theme colors, streak freeze, focus duration, and data storage.',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Make Daftarche feel like home',
      appearance: 'Appearance',
      theme: 'Theme',
      themeHint: 'Nine curated themes — five light and four dark. Remembers your preference for each half.',
      autoTheme: 'Automatic Theme',
      autoThemeHint: 'Automatically adapts to your device or browser dark mode preference.',
      autoThemeActive: 'Active',
      autoThemeInactive: 'Disabled',
      language: 'Language / زبان',
      languageHint: 'Interface language and calendar system.',
      langFa: 'فارسی',
      langEn: 'English',
      streakAndFocus: 'Consistency & Focus',
      freezeTitle: 'Streak Freeze',
      freezeHint: 'Earn 1 freeze every 30 active days (up to 2 in reserve). Automatically shields your streak on a missed day.',
      freezeOn: 'On',
      freezeOff: 'Off',
      focusDurTitle: 'Default Focus Duration',
      focusDurHint: 'Starting length for sessions; adjust anytime from the Focus page.',
      birthdayTitle: 'Birthday',
      birthdayLabel: 'Your Birthday',
      birthdayHint: 'Daftarche would love to celebrate your birthday with you!',
      aboutTitle: 'About',
      tourTitle: 'Guided Tour',
      tourBtn: 'Explore',
      tourHint: 'A friendly walk through Daftarche — the same walkthrough from day one.',
      versionTitle: 'Version',
      changelogTitle: "What's New",
      changelogBtn: 'View',
      changelogHint: 'See what has been crafted and improved in recent updates.',
      backupTitle: 'Backup & Storage',
      persistTitle: 'Persistent Storage',
      persistChecking: 'Checking…',
      persistActive: 'Active',
      persistInactive: 'Disabled',
      persistHint: 'When persistent storage is granted, your browser preserves your data even under disk pressure.',
      exportTitle: 'Export Backup',
      exportBtn: 'Download',
      exportHint: 'Tasks, streaks, badges, settings, and book progress bundled into a single file.',
      importTitle: 'Import Backup',
      importBtn: 'Choose File',
      importHint: 'When a valid backup is selected, you can choose to merge or replace your data.',
      shortcutsTitle: 'Help & Shortcuts',
      shortcutsLabel: 'Keyboard Shortcuts',
      shortcutsBtn: 'Help (?)',
      shortcutsHint: 'Speed through your workflow with shortcuts for new tasks (N), search (/), item navigation (J/K), and reordering with Alt + ↑/↓.',
      themeModeAria: 'Light or dark mode',
      autoThemeAria: 'Automatic theme based on system preference',
      clearDataTitle: 'Delete All Data',
      clearDataBtn: 'Delete All',
      clearDataHint: 'Tasks, books, custom music, and settings will be permanently erased. This cannot be undone.',
      aboutTagline: 'Entrust your tasks to Daftarche',
    },
    due: {
      today: 'Today',
      tomorrow: 'Tomorrow',
      afterTomorrow: 'In 2 days',
      none: 'No deadline',
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      dialogTitle: 'Due Date',
      dialogSub: 'Select a date for this task',
    },
    common: {
      save: 'Save',
      cancel: 'Cancel',
      close: 'Close',
      delete: 'Delete',
      edit: 'Edit',
      back: 'Back',
      minute: 'min',
      hour: 'hr',
      day: 'day',
    },
    dialogs: {
      nameTitle: "What's your name?",
      nameSub: 'Daftarche loves addressing you by name for a warmer, personal feel.',
      namePlaceholder: 'e.g. Alex, Maya…',
      nameSave: 'Save Name',
      nameSkip: 'Maybe later',
      clearAllConfirm: 'Are you sure you want to delete all Daftarche data on this device?',
      confirm: 'Confirm',
      cancel: 'Cancel',
      delete: 'Delete',
      ok: 'OK',
      wipeTitle: 'Delete all data?',
      wipeBody: 'All tasks, stats, books, and music will be permanently deleted. This cannot be undone.',
      wipeConfirm: 'Delete All',
      wipeCancel: 'Cancel',
      backupChoiceTitle: 'Import Backup',
      backupWhenPrefix: 'Backup created',
      backupWhenSuffix: '',
      backupMerge: 'Merge with current data',
      backupMergeHint: 'Keep existing items and add everything from the file.',
      backupReplace: 'Replace everything',
      backupReplaceHint: 'All local data will be replaced with the backup file.',
      backupCancel: 'Cancel',
      avatarTitle: 'Choose your companion',
      avatarSub: 'Daftarche companions — your everyday friends',
      avatarApply: 'Select',
      avatarClose: 'Close',
      shortcutsTitle: 'Keyboard Shortcuts',
      shortcutsClose: 'Got it',
      toastUndo: 'Deleted',
      toastUndoBtn: 'Undo',
      toastErase: 'Erased',
      toastEraseBtn: 'Undo',
      toastStorage: 'Storage full or unavailable; please export a backup from Settings.',
      toastStorageBtn: 'OK',
      toastUpdate: 'A new update is ready!',
      toastUpdateBtn: 'Update now',
    },
    shareCard: {
      title: 'Stats Card',
      layoutLabel: 'Card Shape',
      themeLabel: 'Palette',
      accentLabel: 'Accent',
      metricsLabel: 'Card Metrics',
      metricsHint: 'Up to 3 metrics alongside the hero count; a 4th choice replaces the oldest.',
      shareBtn: 'Share',
      downloadBtn: 'Save Image',
    },
    stats: {
      title: 'My Stats',
      subtitle: 'A glance at your productivity',
      shareCard: 'Share Card',
      taskTrends: 'Task Trends',
      emptyTitle: 'No tasks logged for this period yet.',
      emptySub: 'Check off a task or start a focus session to bring this page to life.',
      historyTitle: 'Focus History',
      insightsTitle: 'Insights',
      insightsPeriod: 'Past 7 days',
      forNextTime: 'For Next Time',
      streakTooltip: 'Consecutive days with at least one task completed',
    },
    themes: {
      paper: 'Paper',
      lilac: 'Lilac',
      blush: 'Blush',
      sage: 'Sage',
      ink: 'Ink',
      night: 'Night',
      gold: 'Gold',
      ocean: 'Ocean',
      plum: 'Plum',
    },
    birthday: {
      dialogTitle: 'Your Birthday',
      clearBtn: 'Clear Birthday',
      currentYear: 'Current year',
      backToMonth: 'Back to month',
      birthYearAria: 'Birth year',
      prevYear: 'Previous year',
      nextYear: 'Next year',
      pickYearPrompt: 'Select your birth year',
      pickYearLabel: 'Birth year: {year} — select another year',
      yearUnknown: 'Year?',
      prevDecade: 'Previous decade',
      nextDecade: 'Next decade',
      decadeTitle: 'Decade of {decade}',
      decadeYearsAria: 'Years in the {decade}s',
      yearAria: 'Year {year}',
      ariaRegistered: 'Birthday: {date} — click to change',
      ariaEmpty: 'Set your birthday',
    },
    tour: {
      stationKicker: 'Station {letter}',
      count: '{cur} of {total}',
      skipLong: 'I know my way around Daftarche, let’s get right to work',
      skipShort: 'Skip for now',
      prev: 'Previous',
      next: 'Next',
      start: 'Let’s go!',
      finish: 'Finish',
      step1Title: 'Welcome to Daftarche!',
      step1Text: 'Here is your personal workspace: daily tasks, deep focus, and reading. Shall we take a quick walkthrough?',
      step2Title: 'Capture your first task!',
      step2Text: 'Write naturally, for example: “Tomorrow at 5pm buy groceries #home”. Daftarche’s parser automatically detects deadlines, times, and categories.',
      step3Title: 'Companion & Smart Suggestions',
      step3Text: 'Whenever you are unsure what to tackle next, your companion suggests the right task from your list.',
      step4Title: 'Daftarche is all yours!',
      step4Text: 'Whenever you’d like to revisit this walkthrough, you can open it anytime from Settings. Best of luck! ✨',
    },
    changelog: {
      title: 'Daftarche has been updated',
      subtitle: 'Fresh improvements and polish — here is what changed',
      ok: 'Got it',
      versionPrefix: 'Version',
    },
    shortcuts: {
      addTask: 'Add new task',
      search: 'Search tasks',
      nextRow: 'Select next row',
      prevRow: 'Select previous row',
      moveRow: 'Move the row',
      help: 'Show this cheat-sheet',
      close: 'Close dialogs and menus',
    },
  },
};

/* ── Active Language State ── */
let currentLang = DEFAULT_LANG;

export function initLang() {
  const saved = loadLang();
  currentLang = saved === 'en' ? 'en' : 'fa';
  applyRootAttributes(currentLang);
  return currentLang;
}

export function getLang() {
  return currentLang;
}

export function isEn() {
  return currentLang === 'en';
}

function applyRootAttributes(lang) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const root = document.documentElement;
  if (typeof root.setAttribute === 'function') {
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
  } else {
    root.lang = lang;
    root.dir = lang === 'en' ? 'ltr' : 'rtl';
  }
  if (root.dataset) root.dataset.lang = lang;
}

export function setLang(lang, { silent = false } = {}) {
  const target = lang === 'en' ? 'en' : 'fa';
  currentLang = target;
  storeSaveLang(target);
  applyRootAttributes(target);
  applyI18nToDOM();

  if (!silent && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('daftarche:lang-changed', { detail: { lang: target } }));
    } catch { /* ignore */ }
    notify();
  }
  return target;
}

/* ── Lookup & Interpolation ── */
function resolvePath(obj, path) {
  return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : null), obj);
}

export function t(key, params = {}) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.fa;
  let text = resolvePath(dict, key);
  if (text === null || text === undefined) {
    text = resolvePath(TRANSLATIONS.fa, key);
  }
  if (text === null || text === undefined) {
    return key;
  }
  if (typeof text !== 'string') return text;

  // Pluralization format: "singular | plural"
  if (text.includes(' | ')) {
    const parts = text.split(' | ');
    const count = Number(params.n ?? params.count ?? 1);
    text = count === 1 ? parts[0] : parts[1] || parts[0];
  }

  // Parameter replacement
  return text.replace(/\{(\w+)\}/g, (_, k) => {
    if (params[k] === undefined || params[k] === null) return `{${k}}`;
    const val = params[k];
    if (typeof val === 'number') {
      return formatNumber(val, currentLang);
    }
    return String(val);
  });
}

/* ── DOM Localization ── */
export function applyI18nToDOM(root = (typeof document !== 'undefined' ? document : null)) {
  if (!root || !root.querySelectorAll) return;

  const isEn = currentLang === 'en';

  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  });

  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.dataset.i18nAriaLabel;
    if (key) el.setAttribute('aria-label', t(key));
  });

  // Nav items (rail and dock)
  root.querySelectorAll('.nav-tab[data-page]').forEach(tab => {
    const page = tab.dataset.page;
    const span = tab.querySelector('span');
    if (span && !span.hasAttribute('data-i18n')) {
      const translated = t(`nav.${page}`);
      if (translated && translated !== `nav.${page}`) span.textContent = translated;
    }
  });

  // More sheet items
  root.querySelectorAll('.more-item[data-page]').forEach(item => {
    const page = item.dataset.page;
    const nameEl = item.querySelector('.more-item-name');
    if (nameEl) {
      const translated = t(`nav.${page}`);
      if (translated && translated !== `nav.${page}`) nameEl.textContent = translated;
    }
    const hintEl = item.querySelector('.more-item-hint');
    if (hintEl) {
      const hint = t(`moreSheet.${page}`);
      if (hint && hint !== `moreSheet.${page}`) hintEl.textContent = hint;
    }
  });

  // Side rail more toggle and brand
  const moreToggleLead = root.querySelector('#sideRailMoreToggle .side-rail-more-lead span');
  if (moreToggleLead) moreToggleLead.textContent = t('nav.more');
  const moreTitle = root.querySelector('#moreTitle');
  if (moreTitle) moreTitle.textContent = t('nav.more');
  const railBrand = root.querySelector('.side-rail-brand span');
  if (railBrand) railBrand.textContent = isEn ? 'Daftarche' : 'دفتَرچه';

  // Quick-add input placeholders
  const todayInp = root.querySelector('#todayInput');
  if (todayInp) todayInp.placeholder = t('today.quickAddPlaceholder');
  const taskInp = root.querySelector('#taskInput');
  if (taskInp) {
    let name = '';
    try {
      const stored = localStorage.getItem('daftarche-name');
      if (stored) name = JSON.parse(stored);
    } catch { /* ignore */ }
    taskInp.placeholder = name
      ? t('tasks.nameAddPlaceholder', { name })
      : t('tasks.addPlaceholder');
  }
  const searchInp = root.querySelector('#searchInput');
  if (searchInp) searchInp.placeholder = t('tasks.searchPlaceholder');
  const searchClear = root.querySelector('#searchClear');
  if (searchClear) searchClear.setAttribute('aria-label', t('tasks.clearSearch'));
  const diceBtn = root.querySelector('#diceBtn');
  if (diceBtn) {
    diceBtn.title = t('tasks.diceTitle');
    diceBtn.setAttribute('aria-label', t('tasks.diceAria'));
  }

  // Row header labels in Tasks form
  const priRowSpan = root.querySelector('#priRow > span');
  if (priRowSpan) priRowSpan.textContent = t('tasks.priorityColon');
  const catRowSpan = root.querySelector('#catRow > span');
  if (catRowSpan) catRowSpan.textContent = t('tasks.categoryColon');
  const dueRowSpan = root.querySelector('#dueRow > span');
  if (dueRowSpan) dueRowSpan.textContent = t('tasks.dueColon');
  const durRowSpan = root.querySelector('#durRow > span');
  if (durRowSpan) durRowSpan.textContent = t('tasks.durationColon');

  // Filter chips in tasks page
  const fAll = root.querySelector('#filters button[data-filter="all"]');
  if (fAll) fAll.textContent = t('tasks.filterAll');
  const fActive = root.querySelector('#filters button[data-filter="active"]');
  if (fActive) fActive.textContent = t('tasks.filterActive');
  const fDone = root.querySelector('#filters button[data-filter="done"]');
  if (fDone) fDone.textContent = t('tasks.filterDone');
  const fOverdue = root.querySelector('#filters button[data-filter="overdue"]');
  if (fOverdue) fOverdue.textContent = t('tasks.filterOverdue');

  // Clear completed button
  const clearBtn = root.querySelector('#clearBtn');
  if (clearBtn) clearBtn.textContent = t('tasks.clearDone');

  // Helper to set button text while preserving any internal SVG icon
  const setBtnTextPreserveSvg = (btn, text) => {
    if (!btn) return;
    const svg = btn.querySelector('svg');
    btn.textContent = text;
    if (svg) btn.prepend(svg);
  };

  // Priority buttons in #priRow
  setBtnTextPreserveSvg(root.querySelector('#priRow button[data-p="low"]'), t('tasks.priorityLow'));
  setBtnTextPreserveSvg(root.querySelector('#priRow button[data-p="mid"]'), t('tasks.priorityMid'));
  setBtnTextPreserveSvg(root.querySelector('#priRow button[data-p="high"]'), t('tasks.priorityHigh'));

  // Due quick buttons in #dueRow
  const dToday = root.querySelector('#dueRow button[data-due="0"]');
  if (dToday) dToday.textContent = t('due.today');
  const dTom = root.querySelector('#dueRow button[data-due="1"]');
  if (dTom) dTom.textContent = t('due.tomorrow');
  const dAfter = root.querySelector('#dueRow button[data-due="2"]');
  if (dAfter) dAfter.textContent = t('due.afterTomorrow');
  const dNone = root.querySelector('#dueRow button[data-due="none"]');
  if (dNone) dNone.textContent = t('due.none');
  const dueCustom = root.querySelector('#dueCustom');
  if (dueCustom && !/^\d{4}-\d{2}-\d{2}$/.test(dueCustom.textContent.trim())) {
    dueCustom.textContent = t('tasks.customDate');
  }

  // Duration presets in #durRow
  const durNone = root.querySelector('#durRow button[data-dur="none"]');
  if (durNone) durNone.textContent = t('tasks.durNone');
  const dur5 = root.querySelector('#durRow button[data-dur="5"]');
  if (dur5) dur5.textContent = t('tasks.dur5');
  const dur15 = root.querySelector('#durRow button[data-dur="15"]');
  if (dur15) dur15.textContent = t('tasks.dur15');
  const dur30 = root.querySelector('#durRow button[data-dur="30"]');
  if (dur30) dur30.textContent = t('tasks.dur30');
  const dur60 = root.querySelector('#durRow button[data-dur="60"]');
  if (dur60) dur60.textContent = t('tasks.dur60');
  const dur90 = root.querySelector('#durRow button[data-dur="90"]');
  if (dur90) dur90.textContent = t('tasks.dur90');
  const durCustom = root.querySelector('#durRow button[data-dur="custom"]');
  if (durCustom) durCustom.textContent = t('tasks.durCustom');
  const durCustomInp = root.querySelector('#durCustom');
  if (durCustomInp) {
    durCustomInp.placeholder = t('tasks.minutePlaceholder');
    durCustomInp.setAttribute('aria-label', t('tasks.durCustomAria'));
  }

  // Section titles
  const todaySecs = root.querySelectorAll('#page-today section.today-sec');
  if (todaySecs.length >= 4) {
    const frogKicker = todaySecs[0].querySelector('.frog-kicker');
    if (frogKicker) frogKicker.textContent = t('today.recommendationTitle');
    const t2 = todaySecs[1].querySelector('h2');
    if (t2) t2.textContent = isEn ? "Today's Tasks" : 'کارهای امروز';
    const t3 = todaySecs[2].querySelector('h2');
    if (t3) t3.textContent = t('today.progressTitle');
    const t4 = todaySecs[3].querySelector('h2');
    if (t4) t4.textContent = t('today.moodTitle');
  }

  // Headings preserving SVG underlines
  const updateH1Text = (sel, text) => {
    const h1 = root.querySelector(sel);
    if (!h1) return;
    const svg = h1.querySelector('svg');
    h1.textContent = text + ' ';
    if (svg) h1.appendChild(svg);
  };
  updateH1Text('#page-tasks header h1', isEn ? 'Tasks' : 'دفتَرچه');
  updateH1Text('#page-week header h1', t('planner.title'));
  updateH1Text('#page-focus header h1', t('focus.title'));
  updateH1Text('#page-library header h1', t('library.title'));
  updateH1Text('#page-stats header h1', t('stats.title'));
  updateH1Text('#page-achv header h1', isEn ? 'Badges' : 'نشان‌ها');
  updateH1Text('#page-profile header h1', t('profile.title'));
  updateH1Text('#page-settings header h1', t('settings.title'));

  const setSub = (sel, text) => {
    const p = root.querySelector(sel);
    if (p) p.textContent = text;
  };
  setSub('#page-week header .subtitle', t('planner.subtitle'));
  setSub('#page-focus header .subtitle', t('focus.subtitle'));
  setSub('#page-library header .subtitle', t('library.subtitle'));
  setSub('#page-stats header .subtitle', t('stats.subtitle'));
  setSub('#statsSub', t('stats.subtitle'));
  setSub('#page-achv header .subtitle', isEn ? 'Milestones and rewards you unlocked' : 'دستاوردهایی که جمع کردی');
  setSub('#page-profile header .subtitle', t('profile.subtitle'));
  setSub('#page-settings header .subtitle', t('settings.subtitle'));

  // Week / Planner page controls
  const wkToday = root.querySelector('#wkToday');
  if (wkToday) wkToday.textContent = t('planner.today');
  const wkPrev = root.querySelector('#wkPrev');
  if (wkPrev) wkPrev.title = t('planner.prevWeek');
  const wkNext = root.querySelector('#wkNext');
  if (wkNext) wkNext.title = t('planner.nextWeek');

  // Settings page texts
  const setText = (id, key) => {
    const el = root.querySelector(id);
    if (el) el.textContent = t(key);
  };
  setText('#themeTitle', 'settings.themeTitle');
  setText('#themeHint', 'settings.themeHint');
  setText('#autoDarkTitle', 'settings.autoDarkTitle');
  setText('#autoDarkHint', 'settings.autoDarkHint');
  setText('#freezeTitle', 'settings.freezeTitle');
  setText('#freezeHint', 'settings.freezeHint');
  setText('#pomoDurationTitle', 'settings.focusDurTitle');
  setText('#pomoDurationHint', 'settings.focusDurHint');
  setText('#birthdayTitle', 'settings.birthdayTitle');
  setText('#birthdayHint', 'settings.birthdayHint');
  const bdHead = root.querySelector('#bdPick')?.closest('.vibe-card')?.querySelector('.vibe-head strong');
  if (bdHead) bdHead.textContent = t('settings.birthdayTitle');
  setText('#tourTitle', 'settings.tourTitle');
  setText('#tourHint', 'settings.tourHint');
  setText('#startTourBtn', 'settings.tourBtn');
  setText('#versionTitle', 'settings.versionTitle');
  setText('#changelogTitle', 'settings.changelogTitle');
  setText('#changelogHint', 'settings.changelogHint');
  setText('#openChangelogBtn', 'settings.changelogBtn');
  setText('#persistTitle', 'settings.persistTitle');
  setText('#persistHint', 'settings.persistHint');
  setText('#exportTitle', 'settings.exportTitle');
  setText('#exportHint', 'settings.exportHint');
  setText('#exportBtn', 'settings.exportBtn');
  setText('#importTitle', 'settings.importTitle');
  setText('#importHint', 'settings.importHint');
  setText('#importBtn', 'settings.importBtn');
  setText('#shortcutsTitle', 'settings.shortcutsTitle');
  setText('#shortcutsHint', 'settings.shortcutsHint');
  setText('#shortcutsBtn', 'settings.shortcutsBtn');

  // Theme segmented mode switch (Light / Dark)
  const modeSwitch = root.querySelector('#themeModeSwitch');
  if (modeSwitch) {
    const lightBtn = modeSwitch.querySelector('[data-key="light"]');
    if (lightBtn) lightBtn.textContent = isEn ? 'Light' : 'روشن';
    const darkBtn = modeSwitch.querySelector('[data-key="dark"]');
    if (darkBtn) darkBtn.textContent = isEn ? 'Dark' : 'تیره';
  }

  // Theme swatches
  root.querySelectorAll('#themeSwatches .swatch').forEach(swatch => {
    const key = swatch.dataset.key;
    const nameEl = swatch.querySelector('.swatch-name');
    if (nameEl && key) {
      nameEl.textContent = t('themes.' + key);
    }
  });

  // Streak freeze text
  const freezeBtn = root.querySelector('#profFreezeBtn');
  const freezeTxt = root.querySelector('#profFreezeText');
  if (freezeBtn && freezeTxt) {
    const on = freezeBtn.getAttribute('aria-checked') === 'true' || freezeBtn.classList.contains('on');
    freezeTxt.textContent = on ? (isEn ? 'On' : 'روشن') : (isEn ? 'Off' : 'خاموش');
  }

  // Auto theme text
  const autoBtn = root.querySelector('#themeAutoBtn');
  const autoTxt = root.querySelector('#themeAutoText');
  if (autoBtn && autoTxt) {
    const on = autoBtn.getAttribute('aria-checked') === 'true' || autoBtn.classList.contains('on');
    autoTxt.textContent = on ? t('settings.autoThemeActive') : t('settings.autoThemeInactive');
  }

  // Shortcuts cheat-sheet help key
  const helpKbd = root.querySelector('#shortcutHelpKey');
  if (helpKbd) helpKbd.textContent = isEn ? '?' : '؟';

  // Settings about tagline
  const aboutTagline = root.querySelector('.settings-about');
  if (aboutTagline) aboutTagline.textContent = t('settings.aboutTagline');

  // Stats page
  const statsCardBtn = root.querySelector('#shareStatsBtn span');
  if (statsCardBtn) statsCardBtn.textContent = t('stats.shareCard');
  const statsTrend = root.querySelector('#page-stats .week-head strong');
  if (statsTrend) statsTrend.textContent = t('stats.taskTrends');
  const statsEmptyStrong = root.querySelector('#page-stats #statsEmpty strong');
  if (statsEmptyStrong) statsEmptyStrong.textContent = t('stats.emptyTitle');
  const statsEmptyP = root.querySelector('#page-stats #statsEmpty p');
  if (statsEmptyP) statsEmptyP.textContent = t('stats.emptySub');
  const statsHistoryHead = root.querySelector('#statsHistory .stat-sec-head strong');
  if (statsHistoryHead) statsHistoryHead.textContent = t('stats.historyTitle');
  const statsInsightsHead = root.querySelector('#statsInsightsSection .stat-sec-head strong');
  if (statsInsightsHead) statsInsightsHead.textContent = t('stats.insightsTitle');
  const statsInsightsPeriod = root.querySelector('#statsInsightsSection .stat-sec-head span');
  if (statsInsightsPeriod) statsInsightsPeriod.textContent = t('stats.insightsPeriod');
  const insightsSuggestionHead = root.querySelector('#insightsSuggestion .vibe-head strong');
  if (insightsSuggestionHead) insightsSuggestionHead.textContent = t('stats.forNextTime');
  const streakChip = root.querySelector('#streakChip');
  if (streakChip) streakChip.title = t('stats.streakTooltip');

  // Focus audio & scene controls
  const focusSpaceHead = root.querySelector('#page-focus .vibe-card:first-of-type .vibe-head strong');
  if (focusSpaceHead) focusSpaceHead.textContent = t('focus.focusSpace');
  const ambSwitch = root.querySelector('#ambSwitch');
  if (ambSwitch) {
    const isAmbOn = ambSwitch.classList.contains('on');
    const ambLabel = root.querySelector('#ambLabel');
    if (ambLabel) ambLabel.textContent = isAmbOn ? t('focus.ambienceLabelOn') : t('focus.ambienceLabelOff');
    ambSwitch.setAttribute('aria-label', t('focus.ambienceTitle'));
  }
  const focusMusicHead = root.querySelector('#page-focus .vibe-card:nth-of-type(2) .vibe-head strong');
  if (focusMusicHead) focusMusicHead.textContent = t('focus.musicTitle');
  const addMusicLbl = root.querySelector('label.add-music');
  if (addMusicLbl) addMusicLbl.textContent = t('focus.addMusic');

  setBtnTextPreserveSvg(root.querySelector('#sceneChips button[data-scene="none"]'), t('focus.sceneSilence'));
  setBtnTextPreserveSvg(root.querySelector('#sceneChips button[data-scene="rain"]'), t('focus.sceneRain'));
  setBtnTextPreserveSvg(root.querySelector('#sceneChips button[data-scene="sea"]'), t('focus.sceneSea'));
  setBtnTextPreserveSvg(root.querySelector('#sceneChips button[data-scene="forest"]'), t('focus.sceneForest'));

  setBtnTextPreserveSvg(root.querySelector('#musicChips button[data-music="none"]'), t('focus.musicOff'));
  setBtnTextPreserveSvg(root.querySelector('#musicChips button[data-music="night"]'), t('focus.musicNight'));
  setBtnTextPreserveSvg(root.querySelector('#musicChips button[data-music="spring"]'), t('focus.musicSpring'));
  setBtnTextPreserveSvg(root.querySelector('#musicChips button[data-music="deep"]'), t('focus.musicDeep'));

  const volLabels = root.querySelectorAll('.vol-row label.vol span');
  if (volLabels.length >= 2) {
    volLabels[0].textContent = t('focus.volMusic');
    volLabels[1].textContent = t('focus.volAmb');
  }

  // Library tab controls & stats
  setBtnTextPreserveSvg(root.querySelector('#importBtn'), t('library.addBook'));
  const shelfHeadStrong = root.querySelector('#shelfView > .shelf-head strong');
  if (shelfHeadStrong) shelfHeadStrong.textContent = t('library.shelfTitle');
  const doneHeadStrong = root.querySelector('#doneShelf .shelf-head strong');
  if (doneHeadStrong) doneHeadStrong.textContent = t('library.completedTitle');

  const libStatLabels = root.querySelectorAll('#libraryStatsBar .lib-stat-label');
  if (libStatLabels.length >= 4) {
    libStatLabels[0].textContent = t('library.statBooks');
    libStatLabels[1].textContent = t('library.statPages');
    libStatLabels[2].textContent = t('library.statTime');
    libStatLabels[3].textContent = t('library.statNotes');
  }

  const shelfSearch = root.querySelector('#shelfSearch');
  if (shelfSearch) {
    shelfSearch.placeholder = t('library.searchPlaceholder');
    shelfSearch.setAttribute('aria-label', t('library.searchAria'));
  }
  const shelfSort = root.querySelector('#shelfSortSelect');
  if (shelfSort) {
    shelfSort.setAttribute('aria-label', t('library.sortAria'));
    const optLast = shelfSort.querySelector('option[value="lastRead"]');
    if (optLast) optLast.textContent = t('library.sortRecent');
    const optProg = shelfSort.querySelector('option[value="progress"]');
    if (optProg) optProg.textContent = t('library.sortProgress');
    const optNew = shelfSort.querySelector('option[value="newest"]');
    if (optNew) optNew.textContent = t('library.sortNewest');
    const optTitle = shelfSort.querySelector('option[value="title"]');
    if (optTitle) optTitle.textContent = t('library.sortTitle');
  }
  const shelfFilter = root.querySelector('#shelfFilter');
  if (shelfFilter) {
    shelfFilter.setAttribute('aria-label', t('library.filterAria'));
    const sfAll = shelfFilter.querySelector('button[data-filter="all"]');
    if (sfAll) sfAll.textContent = t('library.filterAll');
    const sfReading = shelfFilter.querySelector('button[data-filter="reading"]');
    if (sfReading) sfReading.textContent = t('library.filterReading');
    const sfUnread = shelfFilter.querySelector('button[data-filter="unread"]');
    if (sfUnread) sfUnread.textContent = t('library.filterUnread');
    const sfDone = shelfFilter.querySelector('button[data-filter="done"]');
    if (sfDone) sfDone.textContent = t('library.filterDone');
  }
  const shelfEmptyTitle = root.querySelector('#shelfEmpty p:not(.empty-sub)');
  if (shelfEmptyTitle) shelfEmptyTitle.textContent = t('library.emptyTitle');
  const shelfEmptySub = root.querySelector('#shelfEmpty .empty-sub');
  if (shelfEmptySub) shelfEmptySub.textContent = t('library.emptySub');
  const shelfEmptyCta = root.querySelector('#shelfEmpty .empty-cta');
  if (shelfEmptyCta) shelfEmptyCta.textContent = t('library.addPdf');

  // Goal & rename overlays
  const goalTitle = root.querySelector('#goalTitle');
  if (goalTitle) goalTitle.textContent = t('library.goalTitle');
  const goalSub = root.querySelector('#goalOverlay p');
  if (goalSub) goalSub.textContent = t('library.goalSubtitle');
  const goalChoiceFull = root.querySelector('#goalOverlay .goal-choice[data-gtype="full"]');
  if (goalChoiceFull) goalChoiceFull.textContent = t('library.goalFull');
  const goalChoicePers = root.querySelector('#goalOverlay .goal-choice[data-gtype="personal"]');
  if (goalChoicePers) goalChoicePers.textContent = t('library.goalPersonal');
  const goalTextInput = root.querySelector('#goalText');
  if (goalTextInput) goalTextInput.placeholder = t('library.goalTextPlaceholder');
  const goalPagesInput = root.querySelector('#goalPages');
  if (goalPagesInput) goalPagesInput.placeholder = t('library.goalPagesPlaceholder');
  const goalSaveBtn = root.querySelector('#goalSave');
  if (goalSaveBtn) goalSaveBtn.textContent = t('library.goalSave');
  const goalCloseBtn = root.querySelector('#goalClose');
  if (goalCloseBtn) goalCloseBtn.textContent = t('library.goalCancel');

  const renameTitle = root.querySelector('#renameTitle');
  if (renameTitle) renameTitle.textContent = t('library.renameTitle');
  const renameSub = root.querySelector('#renameOverlay p');
  if (renameSub) renameSub.textContent = t('library.renameSubtitle');
  const renameInp = root.querySelector('#renameInput');
  if (renameInp) renameInp.placeholder = t('library.renamePlaceholder');
  const renameSaveBtn = root.querySelector('#renameSave');
  if (renameSaveBtn) renameSaveBtn.textContent = t('library.renameSave');
  const renameCloseBtn = root.querySelector('#renameClose');
  if (renameCloseBtn) renameCloseBtn.textContent = t('library.renameCancel');

  // Profile page buttons & cards
  const editNameBtn = root.querySelector('#profileEditName');
  if (editNameBtn) editNameBtn.textContent = isEn ? 'Change name' : 'تغییر اسم';
  const charCardHead = root.querySelector('.char-card .vibe-head strong');
  if (charCardHead) charCardHead.textContent = isEn ? 'My Companion' : 'کاراکتر من';
  const charChangeBtn = root.querySelector('.char-change');
  if (charChangeBtn) charChangeBtn.textContent = isEn ? 'Change' : 'تغییر';
  const photoRemoveBtn = root.querySelector('#photoRemove');
  if (photoRemoveBtn) photoRemoveBtn.textContent = isEn ? 'Remove photo' : 'حذف عکس';

  const statsEntry = root.querySelector('#openStatsBtn');
  if (statsEntry) {
    const sHead = statsEntry.querySelector('strong');
    if (sHead) sHead.textContent = isEn ? 'My Stats' : 'آمار من';
    const sGo = statsEntry.querySelector('.entry-go');
    if (sGo) sGo.textContent = isEn ? 'View' : 'مشاهده';
    const sHint = statsEntry.querySelector('.entry-hint');
    if (sHint) sHint.textContent = isEn ? 'Insights from the past 7 days, month, quarter, and year — with a shareable card.' : 'نگاهی به هفت روز، ماه، سه‌ماهه، شش‌ماهه و یک‌سال گذشته — با کارت قابل اشتراک‌گذاری.';
  }

  const openAchvBtn = root.querySelector('#openAchvBtn');
  if (openAchvBtn) openAchvBtn.textContent = isEn ? 'All Badges' : 'همهٔ نشان‌ها';

  const setEntry = root.querySelector('#openSettingsBtn');
  if (setEntry) {
    const stHead = setEntry.querySelector('strong');
    if (stHead) stHead.textContent = isEn ? 'Settings' : 'تنظیمات';
    const stGo = setEntry.querySelector('.entry-go');
    if (stGo) stGo.textContent = isEn ? 'View' : 'مشاهده';
    const stHint = setEntry.querySelector('.entry-hint');
    if (stHint) stHint.textContent = isEn ? 'Theme colors, streak freeze, focus duration, and data storage.' : 'رنگ و تم دفترچه، مرخصی پیوستگی، مدت تمرکز — و پاک‌کردن داده‌ها.';
  }

  const profClearBtn = root.querySelector('#profClear');
  if (profClearBtn) profClearBtn.textContent = isEn ? 'Delete All' : 'پاک کن';
  const settingsAbout = root.querySelector('.settings-about');
  if (settingsAbout) settingsAbout.textContent = isEn ? 'Entrust your tasks to Daftarche' : 'کار هاتو به دفتَرچه بسپار';

  // Shortcuts cheat-sheet modal
  const shortcutsTitle = root.querySelector('#shortcutsTitle');
  if (shortcutsTitle) shortcutsTitle.textContent = isEn ? 'Keyboard Shortcuts' : 'کلیدهای میانبر صفحه‌کلید';
  const shortcutsClose = root.querySelector('#shortcutsClose');
  if (shortcutsClose) shortcutsClose.textContent = isEn ? 'Got it' : 'متوجه شدم';
  /* Each row says which key it is, so the sheet can grow a row without every
     label below it sliding up by one — the positional list this replaced did
     exactly that, and the help key was rewritten onto whichever row happened to
     sit in slot 4. */
  const shortcutRows = root.querySelectorAll('.shortcuts-table .shortcut-row');
  shortcutRows.forEach(row => {
    const span = row.querySelector('span[data-i18n]');
    if (span) span.textContent = t(span.dataset.i18n);
  });

  // Overlays: Avatar & Backup & Due
  const avTitle = root.querySelector('#avatarTitle');
  if (avTitle) avTitle.textContent = isEn ? 'Choose your companion' : 'کاراکترت رو انتخاب کن';
  const avSub = root.querySelector('#avatarOverlay p');
  if (avSub) avSub.textContent = isEn ? 'Daftarche companions — your everyday friends' : 'کاراکترهای اختصاصی دفتَرچه — همدمِ روزهای تو';
  const avApply = root.querySelector('#avatarApply');
  if (avApply) avApply.textContent = isEn ? 'Select' : 'انتخاب';
  const avClose = root.querySelector('#avatarClose');
  if (avClose) avClose.textContent = isEn ? 'Close' : 'بستن';

  const bkTitle = root.querySelector('#backupChoiceTitle');
  if (bkTitle) bkTitle.textContent = isEn ? 'Import Backup' : 'پشتیبان وارد بشه';
  const bkMergeStrong = root.querySelector('#backupMerge strong');
  if (bkMergeStrong) bkMergeStrong.textContent = isEn ? 'Merge with current data' : 'ادغام با داده‌های فعلی';
  const bkMergeSpan = root.querySelector('#backupMerge span');
  if (bkMergeSpan) bkMergeSpan.textContent = isEn ? 'Keep existing items and add everything from the file.' : 'چیزی که این‌جا هست نمی‌ره جای دیگه؛ فایل بهش اضافه می‌شه.';
  const bkReplaceStrong = root.querySelector('#backupReplace strong');
  if (bkReplaceStrong) bkReplaceStrong.textContent = isEn ? 'Replace everything' : 'جایگزینی کامل';
  const bkReplaceSpan = root.querySelector('#backupReplace span');
  if (bkReplaceSpan) bkReplaceSpan.textContent = isEn ? 'All local data will be replaced with the backup file.' : 'همهٔ داده‌های این دستگاه با فایل عوض می‌شه و برنمی‌گرده.';
  const bkCancel = root.querySelector('#backupCancel');
  if (bkCancel) bkCancel.textContent = isEn ? 'Cancel' : 'انصراف';

  const dueTitle = root.querySelector('#dueOverlay h2');
  if (dueTitle) dueTitle.textContent = isEn ? 'Due Date' : 'مهلت انجام';
  const dueSub = root.querySelector('#dueOverlay p');
  if (dueSub) dueSub.textContent = isEn ? 'Choose completion deadline' : 'تاریخ شمسی را انتخاب کن';
  const dueClose = root.querySelector('#dueClose');
  if (dueClose) dueClose.textContent = isEn ? 'Close' : 'بستن';

  // Toasts
  const undoToastText = root.querySelector('#undoToast .toast-text');
  if (undoToastText) undoToastText.textContent = isEn ? 'Deleted' : 'حذف شد';
  const undoBtn = root.querySelector('#undoBtn');
  if (undoBtn) undoBtn.textContent = isEn ? 'Undo' : 'پشیمون شدم!';
  const eraseToastText = root.querySelector('#eraseToast .toast-text');
  if (eraseToastText) eraseToastText.textContent = isEn ? 'Erased' : 'پاک شد';
  const eraseUndoBtn = root.querySelector('#eraseUndoBtn');
  if (eraseUndoBtn) eraseUndoBtn.textContent = isEn ? 'Undo' : 'برگردون';
  const storageToastText = root.querySelector('#storageToast .toast-text');
  if (storageToastText) storageToastText.textContent = isEn ? 'Storage full or unavailable; please export a backup from Settings.' : 'ذخیره نشد؛ حافظهٔ مرورگر پر یا در دسترس نیست. از تنظیمات یه پشتیبان بگیر.';
  const storageToastClose = root.querySelector('#storageToastClose');
  if (storageToastClose) storageToastClose.textContent = isEn ? 'OK' : 'باشه';
  const updateToastText = root.querySelector('#updateToast .toast-text');
  if (updateToastText) updateToastText.textContent = isEn ? 'A new update is ready!' : 'نسخهٔ جدید اومده!';
  const updateBtn = root.querySelector('#updateBtn');
  if (updateBtn) {
    updateBtn.textContent = isEn ? 'Update now' : 'دریافتش کن';
    /* The label js/pwa.js writes while the new build is being written is not
       Persian on an English device; the stage lines live in the markup the same
       way, and this is the one place that rewrites all four. */
    updateBtn.dataset.working = isEn ? 'Updating…' : 'در حال به‌روزرسانی…';
  }
  const updateSub = root.querySelector('#updateSub');
  if (updateSub) {
    updateSub.dataset.idle = isEn ? 'A fresh page from your notebook' : 'یک برگهٔ تازه از دفترچه';
    updateSub.dataset.working = isEn ? 'Writing the new build in…' : 'نسخهٔ تازه رو می‌نویسم…';
    updateSub.dataset.done = isEn ? 'Ready — reopening…' : 'آماده‌ست؛ بازش می‌کنم…';
    updateSub.textContent = updateSub.dataset[updateSub.dataset.stage || 'idle'];
  }

  // Share Sheet
  const shareTitle = root.querySelector('#shareTitle');
  if (shareTitle) shareTitle.textContent = isEn ? 'Stats Card' : 'کارت آمار';
  const shareLayoutLabel = root.querySelector('#shareLayoutLabel');
  if (shareLayoutLabel) shareLayoutLabel.textContent = isEn ? 'Card Shape' : 'شکل کارت';
  const shareThemeLabel = root.querySelector('#shareThemeLabel');
  if (shareThemeLabel) shareThemeLabel.textContent = isEn ? 'Palette' : 'رنگ';
  const shareAccentLabel = root.querySelector('#shareAccentLabel');
  if (shareAccentLabel) shareAccentLabel.textContent = isEn ? 'Accent' : 'لهجهٔ رنگ';
  const shareMetricsLabel = root.querySelector('#shareMetricsLabel');
  if (shareMetricsLabel) shareMetricsLabel.textContent = isEn ? 'Card Metrics' : 'عددهای کارت';
  const shareMetricsHint = root.querySelector('#shareMetricsHint');
  if (shareMetricsHint) shareMetricsHint.textContent = isEn ? 'Up to 3 metrics alongside the hero count.' : 'تا سه عدد کنار عدد اصلی می‌آد؛ انتخاب چهارم جای قبلی رو می‌گیره.';
  const shareGo = root.querySelector('#shareGo');
  if (shareGo) shareGo.textContent = isEn ? 'Share' : 'اشتراک‌گذاری';
  const shareDownload = root.querySelector('#shareDownload');
  if (shareDownload) shareDownload.textContent = isEn ? 'Save Image' : 'ذخیرهٔ عکس';
}

/* ── Locale-Aware Formatters ── */
export function formatNumber(n, lang = currentLang) {
  if (typeof n !== 'number') n = Number(n) || 0;
  if (lang === 'fa') return faNum(n);
  return n.toLocaleString('en-US');
}

export function formatDurationI18n(min, lang = currentLang) {
  if (min === null || min === undefined || min === '') return null;
  const m = Number(min);
  if (!Number.isInteger(m) || m < 1) return null;

  if (lang === 'fa') {
    if (m < 60) return `${faNum(m)} دقیقه`;
    const h = Math.floor(m / 60), r = m % 60;
    return r === 0 ? `${faNum(h)} ساعت` : `${faNum(h)} ساعت و ${faNum(r)} دقیقه`;
  }

  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

export function formatClockI18n(min, lang = currentLang) {
  if (min === null || min === undefined || min === '') return null;
  const m = Number(min);
  if (!Number.isInteger(m) || m < 0 || m >= 1440) return null;

  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  if (lang === 'fa') {
    return faDigits(hh) + ':' + faDigits(mm);
  }
  return `${hh}:${mm}`;
}

export function formatDateI18n(date, options, lang = currentLang) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'fa-IR', options).format(d);
}

export function formatRelativeDay(diff, dayKeyStr, lang = currentLang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.fa;
  const resolve = k => {
    const parts = k.split('.');
    return parts.reduce((acc, p) => (acc && acc[p] !== undefined ? acc[p] : null), dict) || k;
  };
  if (diff < 0) return { cls: 'late', text: resolve('tasks.overdue') };
  if (diff === 0) return { cls: 'today', text: resolve('tasks.today') };
  if (diff === 1) return { cls: 'soon', text: resolve('tasks.tomorrow') };
  if (diff === 2) return { cls: 'soon', text: resolve('tasks.dayAfter') };
  if (diff <= 7) {
    const tpl = resolve('tasks.daysLeft');
    const n = lang === 'fa' ? formatNumber(diff, 'fa') : diff;
    return { cls: 'soon', text: tpl.replace('{n}', n) };
  }

  const d = new Date(dayKeyStr + 'T00:00:00');
  const formatted = formatDateI18n(d, { month: 'short', day: 'numeric' }, lang);
  return { cls: 'far', text: formatted, date: formatted, ltr: lang === 'en' };
}

/* ── Character Localized Details ── */
export const CHAR_DETAILS = {
  qorqori: {
    fa: { name: 'قورقوری', sub: 'همدم دفتَرچه' },
    en: { name: 'Qorqori', sub: 'Daftarche Companion' },
  },
  rizolo: {
    fa: { name: 'ریزولو', sub: 'دوستِ شروع‌های کوچک' },
    en: { name: 'Rizolo', sub: 'Friend of small beginnings' },
  },
  khabalo: {
    fa: { name: 'خوابالو', sub: 'دوستِ روزهای آروم' },
    en: { name: 'Khabalo', sub: 'Friend of peaceful days' },
  },
  fekrbaz: {
    fa: { name: 'فکرباز', sub: 'دوستِ لحظه‌های تمرکز' },
    en: { name: 'Fekrbaz', sub: 'Friend of deep focus' },
  },
  jingool: {
    fa: { name: 'جینگول', sub: 'دوستِ لحظه‌های خوب' },
    en: { name: 'Jingool', sub: 'Friend of joyful moments' },
  },
};

export const CHAR_QUOTES_I18N = {
  qorqori: {
    fa: [
      'قورباغه‌ات رو اول صبح قورت بده، بقیه‌ش آسونه!',
      'هر قدم کوچیک تو، یک پرش بزرگ به سمت هدفه.',
      'نترس از کارهای سخت؛ با هم انجامش می‌دیم!',
    ],
    en: [
      'Eat that frog first thing in the morning; the rest is easy!',
      'Every small step you take is a great leap toward your goals.',
      "Don't worry about tough tasks; we'll conquer them together!",
    ],
  },
  rizolo: {
    fa: [
      'فقط دو دقیقه شروع کن؛ ادامه دادن آسون‌تر می‌شه.',
      'کارهای بزرگ از همین ریزه‌کاری‌های کوچک شروع می‌شن.',
      'یک کار تموم‌شده بهتر از صد تا کار شروع‌نشده‌ست.',
    ],
    en: [
      'Just start for two minutes; keeping going is easy.',
      'Big achievements start with the tiniest details.',
      'One finished task beats a hundred unfinished ones.',
    ],
  },
  khabalo: {
    fa: [
      'استراحت هم بخشی از کاره؛ به خودت سخت نگیر.',
      'آروم پیش برو، هر کاری به وقتش می‌رسه.',
      'خستگی دشمن پیشرفته؛ هر وقت نیاز داشتی نفس بکش.',
    ],
    en: [
      'Rest is part of the craft; be gentle with yourself.',
      'Move steadily; everything arrives in its own season.',
      'Rest when you need to; breathing is progress.',
    ],
  },
  fekrbaz: {
    fa: [
      'حواست رو جمع کن روی همین یک کار؛ دنیا منتظرت می‌مونه.',
      'ذهنت رو از شلوغی خالی کن و غرق کار شو.',
      'تمرکز عمیق یعنی هنر نه گفتن به حواس‌پرتی‌ها.',
    ],
    en: [
      'Focus on just this one thing; the world can wait.',
      'Clear away the noise and dive deep into your craft.',
      'Deep focus is the art of saying no to distractions.',
    ],
  },
  jingool: {
    fa: [
      'کارها رو با شادی انجام بده؛ زندگی کوتاه‌تر از اخم کردنه!',
      'یه لبخند بزن، امروز قراره کلی تیکِ قشنگ بخوره!',
      'هر کاری که تموم می‌کنی، یک جشن کوچیکه!',
    ],
    en: [
      'Bring joy to your work; life is too short to frown!',
      'Smile; today is going to see plenty of satisfying checkmarks!',
      'Every task you finish is a reason to celebrate!',
    ],
  },
};

export function getCharInfo(charId, lang = currentLang) {
  const d = CHAR_DETAILS[charId] || CHAR_DETAILS.qorqori;
  return d[lang] || d.fa;
}

export function getCharQuote(charId, index, lang = currentLang) {
  const q = CHAR_QUOTES_I18N[charId] || CHAR_QUOTES_I18N.qorqori;
  const list = q[lang] || q.fa;
  return list[index % list.length];
}

/* ── Gregorian Calendar Grid for Due Date Picker ── */
export const GREGORIAN_MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const GREGORIAN_WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function gregorianDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function leadBlanksGregorian(year, month) {
  // Monday is column 0 (0 for Sunday in JS getDay(), so (d + 6) % 7 puts Monday at 0)
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

export function stepGregorianMonth(year, month, step) {
  let m = month + step;
  let y = year;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}

export function renderGregorianMonthHead(host, opts) {
  if (!host) return;
  const { year, month, showYear = true, onPrev, onNext } = opts;
  const title = showYear
    ? `${GREGORIAN_MONTHS_EN[month - 1]} ${year}`
    : GREGORIAN_MONTHS_EN[month - 1];

  host.innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" aria-label="Previous month">‹</button>
      <strong class="cal-title" aria-live="polite">${title}</strong>
      <button type="button" class="cal-nav" aria-label="Next month">›</button>
    </div>`;

  const [prev, next] = host.querySelectorAll('.cal-head .cal-nav');
  if (prev) prev.onclick = onPrev || null;
  if (next) next.onclick = onNext || null;
}

export function renderGregorianMonthGrid(host, opts) {
  if (!host) return;
  const {
    year, month,
    keyOf,
    labelOf,
    selectedKey = null,
    todayKey = null,
    activeKey = null,
    onPick,
  } = opts;

  let html = '<div class="cal-week">';
  html += GREGORIAN_WEEKDAYS_EN.map(w => `<span>${w}</span>`).join('');
  html += '</div><div class="cal-grid" role="group" aria-label="Days of '
    + GREGORIAN_MONTHS_EN[month - 1] + '">';

  for (let i = 0; i < leadBlanksGregorian(year, month); i++) {
    html += '<span class="cal-blank"></span>';
  }

  const daysCount = gregorianDaysInMonth(year, month);
  for (let d = 1; d <= daysCount; d++) {
    const k = keyOf(year, month, d);
    const cls = [
      'cal-day',
      todayKey && k === todayKey ? 'today' : '',
      selectedKey && k === selectedKey ? 'sel' : '',
    ].filter(Boolean).join(' ');
    const label = labelOf ? labelOf(year, month, d) : `${GREGORIAN_MONTHS_EN[month - 1]} ${d}, ${year}`;
    const tab = activeKey === null ? '' : k === activeKey ? ' tabindex="0"' : ' tabindex="-1"';

    html += `<button type="button" class="${cls}" data-key="${k}" aria-label="${label}"${tab}${todayKey === k ? ' aria-current="date"' : ''}${selectedKey === k ? ' aria-pressed="true"' : ''}>${d}</button>`;
  }

  html += '</div>';
  host.innerHTML = html;

  if (onPick) {
    host.querySelectorAll('.cal-day').forEach(b => {
      b.onclick = () => onPick(b.dataset.key);
    });
  }
}
