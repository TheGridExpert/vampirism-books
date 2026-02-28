const fs = require('fs');
const path = require('path');

const LANGS = ['en_us', 'ru_ru', 'uk_ua'];

const API_BASE = 'https://api.github.com/repos/TeamLapen/Vampirism/contents';
const RAW_BASE = 'https://raw.githubusercontent.com/TeamLapen/Vampirism/dev/projects/vampirism/src/main/resources/assets/vampirism';
const AUTHOR_BASE = 'https://raw.githubusercontent.com/TeamLapen/Vampirism/dev/projects/vampirism/src/generated/resources/data/vampirism/vampirism/vampire_book';
const BOOKS_DIR_API = `${API_BASE}/projects/vampirism/src/main/resources/assets/vampirism/vampire_books?ref=dev`;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function fetchJSON(url) {
  try {
    const headers = { 'User-Agent': 'vampirism-books-fetcher' };
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`  Fetch failed for ${url}: ${e.message}`);
    return null;
  }
}

function stripFormattingCodes(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/§./g, '');
}

function filterLangTitles(langData) {
  if (!langData) return {};
  const filtered = {};
  for (const [key, value] of Object.entries(langData)) {
    if (key.startsWith('vampire_book.')) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function getBookTitle(bookId, langTitles, lang = 'en_us') {
  const key = `vampire_book.vampirism.${bookId}`;
  return langTitles[lang]?.[key]
    || langTitles['en_us']?.[key]
    || bookId.replace(/_/g, ' ');
}

function resolveAuthor(bookId, bookAuthors, langTitles, lang = 'en_us') {
  const author = bookAuthors[bookId];
  if (!author) return 'Unknown';
  if (typeof author === 'string') return author;
  if (author.translate) {
    return langTitles[lang]?.[author.translate]
      || langTitles['en_us']?.[author.translate]
      || 'Unknown';
  }
  return 'Unknown';
}

async function discoverBookIds() {
  console.log('🔍 Discovering book IDs from repository...');
  const entries = await fetchJSON(BOOKS_DIR_API);
  if (!Array.isArray(entries)) {
    console.error('❌ Failed to list vampire_books directory. Check GitHub API access.');
    process.exit(1);
  }
  const bookIds = entries
    .filter(e => e.type === 'dir')
    .map(e => e.name);

  console.log(`   Found ${bookIds.length} books: ${bookIds.join(', ')}\n`);
  return bookIds;
}

async function main() {
  console.log('📚 Fetching Vampirism book data...\n');

  const BOOK_IDS = await discoverBookIds();

  const output = {
    generatedAt: new Date().toISOString(),
    langTitles: {},
    bookAuthors: {},
    books: {}
  };

  for (const lang of LANGS) {
    const data = await fetchJSON(`${RAW_BASE}/lang/${lang}.json`);
    if (data) {
      output.langTitles[lang] = filterLangTitles(data);
      console.log(`✅ Lang ${lang} (${Object.keys(output.langTitles[lang]).length} book keys)`);
    } else {
      console.warn(`⚠️  Lang ${lang} failed`);
    }
  }

  for (const bookId of BOOK_IDS) {
    const authorData = await fetchJSON(`${AUTHOR_BASE}/${bookId}.json`);
    if (authorData?.author) {
      output.bookAuthors[bookId] = authorData.author;
    }

    output.books[bookId] = {};
    for (const lang of LANGS) {
      const data = await fetchJSON(`${RAW_BASE}/vampire_books/${bookId}/${lang}.json`);
      if (data) {
        output.books[bookId][lang] = data;
      }
    }

    const available = Object.keys(output.books[bookId]).join(', ') || 'none';
    console.log(`📖 ${bookId}: [${available}]`);
  }

  const outDir = path.join(__dirname, '..', 'public');
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, 'books.json'),
    JSON.stringify(output, null, 2),
    'utf8'
  );
  console.log('\n✅ Written: public/books.json');

  const html = buildFullHTML(output, BOOK_IDS);
  fs.writeFileSync(path.join(outDir, 'books-full.html'), html, 'utf8');
  console.log('✅ Written: public/books-full.html');
}

function buildFullHTML(data, bookIds) {
  const { langTitles, bookAuthors, books, generatedAt } = data;

  let body = '';

  for (const bookId of bookIds) {
    const bookData = books[bookId];
    if (!bookData) continue;

    const content = bookData['en_us'];
    if (!content) continue;

    const title = getBookTitle(bookId, langTitles, 'en_us');
    const author = resolveAuthor(bookId, bookAuthors, langTitles, 'en_us');

    body += `<article>\n`;
    body += `  <h2>${escapeHTML(title)}</h2>\n`;
    body += `  <p><em>by ${escapeHTML(author)}</em></p>\n`;

    if (Array.isArray(content.contents)) {
      content.contents.forEach((page) => {
        const text = stripFormattingCodes(page).trim();
        if (text) {
          body += `  <section class="page">\n`;
          body += `    <p>${escapeHTML(text).replace(/\n/g, '<br>')}</p>\n`;
          body += `  </section>\n`;
        }
      });
    }

    if (content.credit) {
      body += `  <footer>— ${escapeHTML(stripFormattingCodes(content.credit))}</footer>\n`;
    }

    body += `</article>\n\n`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vampirism Mod Lore Books – Full Text</title>
  <meta name="description" content="Full text of all lore books from the Vampirism Minecraft mod. Last updated: ${generatedAt}">
  <link rel="canonical" href="https://thegridexpert.github.io/vampirism-books/books-full.html">
  <style>
    body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.7; color: #222; }
    h1 { border-bottom: 2px solid #888; padding-bottom: 8px; }
    h2 { margin-top: 2em; color: #4b2e83; }
    article { border-bottom: 1px solid #ccc; padding-bottom: 2em; margin-bottom: 2em; }
    .page { margin: 1em 0; }
    footer { font-style: italic; color: #666; margin-top: 1em; }
    .meta { color: #888; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>Vampirism Mod – All Lore Books</h1>
  <p class="meta">Full English text of all lore books from the <a href="https://github.com/TeamLapen/Vampirism">Vampirism Minecraft mod</a>. Auto-generated on ${generatedAt}.</p>
  <p><a href="/">← Back to interactive reader</a></p>

${body}
</body>
</html>`;
}

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
