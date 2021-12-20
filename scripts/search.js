/* this gets compiled by webpack */

import { createDbWorker } from 'sql.js-httpvfs';
import { default as crc } from 'crc-32';

const workerUrl = new URL(
  'sql.js-httpvfs/dist/sqlite.worker.js',
  import.meta.url
);
const wasmUrl = new URL('sql.js-httpvfs/dist/sql-wasm.wasm', import.meta.url);

async function load(configUrl) {
  let perPage = 30;
  let previousSearch = '';
  let nextOffset = 0;

  let query = document.getElementById('query');
  let loadMore = document.getElementById('load-more');
  let thinking = document.getElementById('thinking');
  let errorOut = document.getElementById('error');
  let sort = document.getElementById('sort-order');
  let output = document.getElementById('search-output');

  function more(isMore) {
    if (isMore) {
      loadMore.style.display = '';
    } else {
      loadMore.style.display = 'none';
    }
  }

  query.addEventListener('keyup', e => {
    if (e.keyCode === 13) {
      startSearch();
    }
  });

  if (localStorage.getItem('sort-order') === 'newest') {
    // default for the element and therefore for this code is "oldest".
    sort.value = 'newest';
  }
  let lastSort = sort.value;

  function startSearch() {
    search(query.value, 0);
  }

  let isMore = false;
  async function search(query, offset) {
    query = query.trim();
    if (query === '') {
      return;
    }
    try {
      if (query.length < 3) {
        throw new Error('must be at least 3 characters');
      }

      if (sort.value !== lastSort) {
        offset = 0;
        localStorage.setItem('sort-order', sort.value);
        lastSort = sort.value;
      }

      if (offset === 0) {
        output.innerHTML = '';
        previousSearch = query;
        let currentUrl = new URL(location);
        currentUrl.searchParams.set('q', query);
        history.replaceState(null, '', currentUrl);
      }

      thinking.style.display = '';
      errorOut.style.display = 'none';
      more(false);

      // we fetch an extra so we can tell if we're done
      let cmd = `select * from search where search match '${escapeForSql(query)}' order by rowid ${sort.value === 'newest' ? 'desc' : ''} limit ${perPage + 1} offset ${offset}`;

      worker.worker.bytesRead = 0;
      let page = await worker.db.query(cmd);

      console.log('read total of ' + await worker.worker.bytesRead + ' bytes');

      nextOffset = offset + perPage;

      thinking.style.display = 'none';
      isMore = page.length > perPage;
      if (isMore) {
        page.length = perPage;
      }
      more(isMore);
      
      if (page.length === 0 && offset === 0) {
        output.innerHTML = 'no results';
      } else {
        for (let result of page) {
          output.append(renderLine(result));
        }
      }
    } catch (e) {
      console.error('query failed', e);
      let { message } = e;
      if (message.includes('request limit reached')) {
        message = 'too many requests, try again?';
      } else {
        message = 'error: ' + message;
      }
      errorOut.textContent = message;
      errorOut.style.display = '';
      thinking.style.display = 'none';
      more(isMore);
    }
  }

  const worker = await createDbWorker(
    [
      {
        // it's kind of a shame to add this network request instead of inlining
        // but we're about to do many many requests anyway, so whatever
        from: 'jsonconfig',
        configUrl: configUrl + '?cb=' + Math.floor(Math.random() * 1e15).toString(32),
      },
    ],
    workerUrl.toString(),
    wasmUrl.toString(),
    1024 * 512,
  );
  window.sqlWorker = worker;

  document.getElementById('search-submit').addEventListener('click', startSearch);

  document.getElementById('load-more').addEventListener('click', () => {
    search(previousSearch, nextOffset);
  });

  let fromUrl = new URLSearchParams(location.search).get('q');
  if (fromUrl != null) {
    query.value = fromUrl;
    startSearch();
  }
}


function renderLine(line) {
  let frag = document.createDocumentFragment();
  frag.append(document.createElement('tbody'));
  frag.children[0].innerHTML = renderEvent(line);

  return frag.children[0].children[0];
}


function renderEvent({ sender: senderName, ts, idx, content }) {
  // I am too lazy to do this the "right" way
  let date = new Date(ts);
  let year = '' + date.getUTCFullYear();
  let month = ('' + (1 + date.getUTCMonth())).padStart(2, '0');
  let days = ('' + date.getUTCDate()).padStart(2, '0');
  let hours = ('' + date.getUTCHours()).padStart(2, '0');
  let minutes = ('' + date.getUTCMinutes()).padStart(2, '0');
  let full = date.toString();
  let tsHtml = `<a class="ts" alt="${full}" href="${year}-${month}-${days}#L${idx}">${year}-${month}-${days}<br>${hours}:${minutes}</a>`;
  let shortNameMatch = senderName.match(/(.*) \(@[^\):\s]+:[^\):\s]+\.[^\):\s]+\)$/);
  if (shortNameMatch != null) {
    senderName = shortNameMatch[1];
  }
  // todo handle /me
  let name = `&lt;<span class="nick ${getNickClass(senderName)}">${escapeForHtml(senderName)}</span>&gt;`;
  let paras = content.split(/[\n\r]+/);
  return `<tr class="msg"><td class="ts-cell">${tsHtml}</td><td class="nick-cell"><div class="m-ov">${name}</div></td><td class="msg-cell">${paras.map(escapeForHtml).join('<br>')}</td></tr>`;
}

function getNickClass(nick) {
  // we use the same logic for computing a class for the nick as whitequark: https://github.com/whitequark/irclogger/blob/d04a3e64079074c64d2b43fa79501a6d561b2b83/lib/irclogger/viewer_helpers.rb#L50-L53
  let nickClass = (crc.str(nick) % 16) + 1;
  if (nickClass <= 0) {
    nickClass += 16; // uuuuugh
  }
  return `nick-${nickClass}`;
}


// the database is read-only, so don't worry too much about it
function escapeForSql(str) {
  return str
    .replace(/\s+/g, ' ')
    .replace(/'/g, "''")
    .replace(/[:-;]/g, ' '); // these are fts5 queries, where `:` and `-` have meaning; see https://www.sqlite.org/fts5.html#full_text_query_syntax
}

function escapeForHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


window.initSearch = load;
