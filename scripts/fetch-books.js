const fs   = require('fs');
const path = require('path');

const RAW_BASE    = 'https://raw.githubusercontent.com/TeamLapen/Vampirism/dev/projects/vampirism/src/main/resources/assets/vampirism';
const AUTHOR_BASE = 'https://raw.githubusercontent.com/TeamLapen/Vampirism/dev/projects/vampirism/src/generated/resources/data/vampirism/vampirism/vampire_book';
const DIR_API     = 'https://api.github.com/repos/TeamLapen/Vampirism/contents/projects/vampirism/src/main/resources/assets/vampirism/vampire_books?ref=dev';
const LANGS       = ['en_us', 'ru_ru', 'uk_ua'];

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'vampirism-books-fetcher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

function normalizeNewlines(text) {
  if (typeof text !== 'string') return text;
  return text.trim().replace(/\n{4,}/g, '\n\n\n');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchAll() {
  console.log('Discovering book IDs…');
  const entries = await get(DIR_API);
  const bookIds = entries.filter(e => e.type === 'dir').map(e => e.name);
  console.log(`Found ${bookIds.length} books.`);

  const langTitles = {};
  for (const lang of LANGS) {
    try {
      const full = await get(`${RAW_BASE}/lang/${lang}.json`);
      langTitles[lang] = Object.fromEntries(
        Object.entries(full).filter(([k]) => k.startsWith('vampire_book.'))
      );
      console.log(`Loaded lang: ${lang}`);
    } catch (e) {
      console.warn(`  Could not load ${lang}: ${e.message}`);
      langTitles[lang] = {};
    }
  }

  const bookAuthors = {};
  for (const bookId of bookIds) {
    try {
      const d = await get(`${AUTHOR_BASE}/${bookId}.json`);
      const author = d.author;
      if (typeof author === 'string') bookAuthors[bookId] = author;
      else if (author?.translate)     bookAuthors[bookId] = { translate: author.translate };
    } catch (_) {}
  }

  const books = {};
  for (const bookId of bookIds) {
    books[bookId] = {};
    for (const lang of LANGS) {
      try {
        const d = await get(`${RAW_BASE}/vampire_books/${bookId}/${lang}.json`);
        if (Array.isArray(d.contents)) d.contents = d.contents.map(normalizeNewlines);
        if (typeof d.credit === 'string') d.credit = normalizeNewlines(d.credit);
        books[bookId][lang] = d;
      } catch (_) {}
    }
    console.log(`  Fetched book: ${bookId}`);
  }

  return { bookIds, langTitles, bookAuthors, books };
}

function getTitle(bookId, lang, langTitles) {
  const key = `vampire_book.vampirism.${bookId}`;
  return langTitles[lang]?.[key] || langTitles.en_us?.[key] || bookId.replace(/_/g, ' ');
}

function getAuthor(bookId, lang, langTitles, bookAuthors) {
  const a = bookAuthors[bookId];
  const resolve = key => langTitles[lang]?.[key] || langTitles.en_us?.[key] || 'Unknown';
  if (!a)              return resolve('vampire_book.vampirism.unknown.author');
  if (typeof a === 'string') return a;
  if (a.translate)     return resolve(a.translate);
  return resolve('vampire_book.vampirism.unknown.author');
}

function mcTextToHtml(raw) {
  if (!raw || !raw.includes('§')) return escapeHtml(raw || '');
  let html = '', style = {}, i = 0;

  const openSpan = () => {
    const parts = [];
    if (style.bold)          parts.push('font-weight:bold');
    if (style.italic)        parts.push('font-style:italic');
    const deco = [style.underline && 'underline', style.strikethrough && 'line-through'].filter(Boolean).join(' ');
    if (deco) parts.push(`text-decoration:${deco}`);
    return parts.length ? `<span style="${parts.join(';')}">` : '<span>';
  };

  let buf = '';
  const flush = () => {
    if (!buf) return;
    html += openSpan() + escapeHtml(buf) + '</span>';
    buf = '';
  };

  while (i < raw.length) {
    if (raw[i] === '§' && i + 1 < raw.length) {
      flush();
      const code = raw[i + 1]; i += 2;
      if      (code === 'r') style = {};
      else if (code === 'l') style.bold = true;
      else if (code === 'o') style.italic = true;
      else if (code === 'n') style.underline = true;
      else if (code === 'm') style.strikethrough = true;
    } else {
      buf += raw[i++];
    }
  }
  flush();
  return html;
}

function renderPageHtml(text) {
  return mcTextToHtml(text).replace(/\n/g, '<br>');
}

function buildIndexHtml({ bookIds, langTitles, bookAuthors, books }, generatedAt) {

  const UI_TEXT = {
    en_us: { title: 'Vampirism Lore Books',       langLabel: 'Language:', noTranslation: 'No translation available. Showing English.', darkMode: '☾ Dark Mode',   lightMode: '☀ Light Mode',   byAuthor: 'by: '    },
    ru_ru: { title: 'Книги лора Вампиризма',       langLabel: 'Язык:',    noTranslation: 'Перевод недоступен. Показано на английском.',  darkMode: '☾ Тёмный режим', lightMode: '☀ Светлый режим', byAuthor: 'Автор: ' },
    uk_ua: { title: 'Книги лору Вампірізма',       langLabel: 'Мова:',    noTranslation: 'Переклад недоступний. Показано англійською.',  darkMode: '☾ Темний режим', lightMode: '☀ Світлий режим', byAuthor: 'від: '   },
  };

  const booksHtml = bookIds.map(bookId => {
    const langBlocks = LANGS.map(lang => {
      const book      = books[bookId];
      const data      = book?.[lang] || book?.en_us;
      const isFallback = !book?.[lang] && !!book?.en_us;
      const ui        = UI_TEXT[lang];
      const title     = getTitle(bookId, lang, langTitles);
      const author    = getAuthor(bookId, lang, langTitles, bookAuthors);

      let inner = '';
      if (isFallback) {
        inner += `<div class="no-translation">${escapeHtml(ui.noTranslation)}</div>`;
      }
      if (data?.contents) {
        inner += data.contents.map((text, idx, arr) =>
          `<div class="page">${renderPageHtml(text)}</div>` +
          (idx < arr.length - 1 ? '<div class="page-divider"></div>' : '')
        ).join('');
      }
      if (data?.credit) {
        inner += `<div class="credit">— ${escapeHtml(data.credit)}</div>`;
      }
      if (!data) {
        inner = '<div class="error">No content.</div>';
      }

      return `
      <div class="lang-block" data-lang="${lang}">
        <div class="book-title-row" data-book-id="${bookId}">
          <span class="book-title-text">${escapeHtml(title)}</span>
          <span class="arrow">▼</span>
        </div>
        <div class="book-author">${escapeHtml(ui.byAuthor + author)}</div>
        <div class="book-content">${inner}</div>
      </div>`;
    }).join('');

    return `<div class="book-container" data-book-id="${escapeHtml(bookId)}">${langBlocks}</div>`;
  }).join('\n');

  const uiJson = JSON.stringify(UI_TEXT);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/x-icon" href="icon.ico">
  <link rel="canonical" href="https://thegridexpert.github.io/vampirism-books">
  <title>Vampirism Mod Lore Books</title>
  <meta name="description" content="Contains an up-to-date collection of vampire books (lore entries) from Vampirism mod for Minecraft. Available in English, Russian, and Ukrainian.">
  <style>
    :root {
      --bg: #fdf6ff; --text: #4b2e83; --text-light: #6a519e;
      --border: #d9c2e5; --accent: #9d7cb2; --panel-bg: #f8f0ff; --switch-bg: #e0d0f0;
    }
    [data-theme="dark"] {
      --bg: #0f0b15; --text: #d6c2f0; --text-light: #b088e0;
      --border: #4a3a6b; --accent: #7a5ca8; --panel-bg: #1a1525; --switch-bg: #3a2f55;
    }
    *, *::before, *::after { box-sizing: border-box; transition: background-color 0.3s, color 0.3s, border-color 0.3s; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); max-width: 850px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    .controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
    .theme-toggle { background: var(--switch-bg); border: none; padding: 6px 12px; border-radius: 6px; color: var(--text); cursor: pointer; font-weight: 600; }
    #language-selector { display: flex; align-items: center; gap: 8px; }
    #language-selector label { font-weight: bold; color: var(--text-light); }
    #language-selector select { padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-bg); color: var(--text); font-size: 15px; }
    h1 { text-align: center; margin-bottom: 16px; color: var(--text); }
    .book-container { margin-bottom: 24px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-bg); overflow: hidden; }

    /* Language blocks: only the active lang is shown */
    .lang-block { display: none; }
    .lang-block.active { display: block; }

    .book-title-row {
      padding: 14px 18px 4px; font-size: 1.25em; font-weight: 600; cursor: pointer;
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .book-title-row .arrow { font-size: 0.8em; color: var(--text-light); transition: transform 0.25s; }
    .book-title-row.collapsed .arrow { transform: rotate(180deg); }
    .book-author { font-size: 0.9em; color: var(--text-light); padding: 4px 18px 8px; border-bottom: 1px solid var(--border); }
    .book-content { padding: 0 18px; max-height: 0; overflow: hidden; transition: max-height 0.3s ease, padding 0.3s ease; }
    .book-content.expanded { padding: 18px; max-height: none; }
    .no-translation { font-style: italic; color: var(--text-light); margin-bottom: 12px; }
    .page { white-space: pre-wrap; margin-bottom: 16px; line-height: 1.6; }
    .page:last-child { margin-bottom: 0; }
    .page-divider { height: 1px; background: var(--border); margin: 16px 0; border: none; }
    .credit { font-style: italic; color: var(--text-light); margin-top: 10px; border-top: 1px dashed var(--border); padding-top: 8px; }
    .error { color: #ff6b6b; }
  </style>
</head>
<body>
  <h1 id="page-title">Vampirism Lore Books</h1>
  <div class="controls">
    <div id="language-selector">
      <label id="lang-label" for="lang-select">Language:</label>
      <select id="lang-select">
        <option value="en_us">English</option>
        <option value="ru_ru">Русский</option>
        <option value="uk_ua">Українська</option>
      </select>
    </div>
    <button class="theme-toggle" id="theme-toggle">☾ Dark Mode</button>
  </div>

  <div id="books-container">
${booksHtml}
  </div>

  <div style="display:none;">
    <p>For a plain-text version of all lore books, see <a href="books-full.html">books-full.html</a>.</p>
  </div>

  <script>
    const UI_TEXT = ${uiJson};

    const themeToggle = document.getElementById('theme-toggle');
    let currentTheme = localStorage.getItem('vampire-theme') === 'dark' ? 'dark' : 'light';

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const ui = UI_TEXT[document.getElementById('lang-select').value] || UI_TEXT.en_us;
      themeToggle.textContent = theme === 'dark' ? ui.lightMode : ui.darkMode;
    }
    applyTheme(currentTheme);

    themeToggle.addEventListener('click', () => {
      currentTheme = currentTheme === 'light' ? 'dark' : 'light';
      localStorage.setItem('vampire-theme', currentTheme);
      applyTheme(currentTheme);
    });

    function switchLang(lang) {
      const ui = UI_TEXT[lang] || UI_TEXT.en_us;
      document.getElementById('page-title').textContent = ui.title;
      document.getElementById('lang-label').textContent = ui.langLabel;
      themeToggle.textContent = currentTheme === 'dark' ? ui.lightMode : ui.darkMode;

      document.querySelectorAll('.lang-block').forEach(el => {
        el.classList.toggle('active', el.dataset.lang === lang);
      });

      document.querySelectorAll('.book-container').forEach(container => {
        const bookId = container.dataset.bookId;
        const wasExpanded = expandedBooks.has(bookId);
        const newBlock = container.querySelector(\`.lang-block[data-lang="\${lang}"]\`);
        if (newBlock) {
          const content = newBlock.querySelector('.book-content');
          const titleRow = newBlock.querySelector('.book-title-row');
          if (wasExpanded) {
            content.classList.add('expanded');
            titleRow.classList.remove('collapsed');
          } else {
            content.classList.remove('expanded');
            titleRow.classList.add('collapsed');
          }
        }
      });
    }

    const expandedBooks = new Set();

    document.querySelectorAll('.book-title-row').forEach(row => {
      row.classList.add('collapsed'); // start all collapsed
      row.addEventListener('click', () => {
        const bookId = row.dataset.bookId;
        const content = row.closest('.lang-block').querySelector('.book-content');
        const isExpanding = !content.classList.contains('expanded');
        if (isExpanding) {
          expandedBooks.add(bookId);
        } else {
          expandedBooks.delete(bookId);
        }
        content.classList.toggle('expanded', isExpanding);
        row.classList.toggle('collapsed', !isExpanding);
      });
    });

    const savedLang = localStorage.getItem('vampire-lang') || 'en_us';
    document.getElementById('lang-select').value = savedLang;
    switchLang(savedLang);

    document.getElementById('lang-select').addEventListener('change', e => {
      localStorage.setItem('vampire-lang', e.target.value);
      switchLang(e.target.value);
    });
  </script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BookSeries",
    "name": "Vampirism Mod Lore Books",
    "description": "The complete collection of lore and stories from the Vampirism Minecraft mod.",
    "genre": "Fantasy/Gaming",
    "url": "https://thegridexpert.github.io/vampirism-books",
    "sameAs": "https://thegridexpert.github.io/vampirism-books/books-full.html"
  }
  </script>
</body>
</html>`;
}

function buildFullHtml({ bookIds, langTitles, bookAuthors, books }, generatedAt) {
  const lines = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>Vampirism Mod Lore Books – Full Text</title>`,
    `  <meta name="description" content="Full text of all lore books from the Vampirism Minecraft mod. Last updated: ${generatedAt}">`,
    '  <link rel="canonical" href="https://thegridexpert.github.io/vampirism-books/books-full.html">',
    '  <style>',
    '    body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.7; color: #222; }',
    '    h1 { border-bottom: 2px solid #888; padding-bottom: 8px; }',
    '    h2 { margin-top: 2em; color: #4b2e83; }',
    '    article { border-bottom: 1px solid #ccc; padding-bottom: 2em; margin-bottom: 2em; }',
    '    .page { margin: 1em 0; white-space: pre-wrap; }',
    '    footer { font-style: italic; color: #666; margin-top: 1em; }',
    '    .meta { color: #888; font-size: 0.85em; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <h1>Vampirism Mod – All Lore Books</h1>',
    `  <p class="meta">Full English text of all lore books from the <a href="https://github.com/TeamLapen/Vampirism">Vampirism Minecraft mod</a>. Auto-generated on ${escapeHtml(generatedAt)}.</p>`,
    '  <p><a href="/">← Back to interactive reader</a></p>',
  ];

  for (const bookId of bookIds) {
    const book   = books[bookId];
    const data   = book?.en_us;
    const title  = getTitle(bookId, 'en_us', langTitles);
    const author = getAuthor(bookId, 'en_us', langTitles, bookAuthors);
    lines.push('<article>');
    lines.push(`  <h2>${escapeHtml(title)}</h2>`);
    lines.push(`  <p><em>by ${escapeHtml(author)}</em></p>`);
    if (data?.contents) {
      for (const page of data.contents) {
        lines.push(`  <div class="page">${escapeHtml(page)}</div>`);
      }
    }
    if (data?.credit) {
      lines.push(`  <footer>— ${escapeHtml(data.credit)}</footer>`);
    }
    lines.push('</article>');
  }

  lines.push('</body>', '</html>');
  return lines.join('\n');
}

(async () => {
  const generatedAt = new Date().toISOString();
  const data = await fetchAll();

  const outDir = path.join(__dirname, '..');

  fs.writeFileSync(path.join(outDir, 'books-full.html'), buildFullHtml(data, generatedAt));
  console.log('Written: public/books-full.html');

  fs.writeFileSync(path.join(outDir, 'index.html'), buildIndexHtml(data, generatedAt));
  console.log('Written: public/index.html');
})();
