'use strict';

let fs = require('fs');
let path = require('path');

let crc = require('crc-32');
let { JSDOM } = require('jsdom');
let linkify = require('linkifyjs/html');

let { root, historicalRoot, rooms, sanitizeRoomName, applyModifications } = require('./utils.js');

const ROOT_SQL_URL = '../_indexes';

const ROOMLIST_JS_SRC = 'render-roomlist.js';

let roomsWithDays = rooms.map(({ room, historical }) => {
  let roomJsonDir = path.join(historical ? historicalRoot : root, room);
  let days = fs
    .readdirSync(roomJsonDir)
    .filter((f) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/.test(f))
    .map((d) => d.replace(/\.json$/, ''))
    .sort()
    .reverse();
  return { room, historical, days };
}).filter(x => x.days.length > 0);

for (let { room, historical, days } of roomsWithDays) {
  let roomDir = path.join('logs', 'docs', sanitizeRoomName(room));
  fs.mkdirSync(roomDir, { recursive: true });
  let roomJsonDir = path.join(historical ? historicalRoot : root, room);
  let alreadyDoneHtml = fs
    .readdirSync(roomDir)
    .filter((f) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.html$/.test(f))
    .map((d) => d.replace(/\.html$/, ''));

  if (!historical) {
    alreadyDoneHtml = alreadyDoneHtml
      .sort()
      .reverse()
      .slice(2); // always do at least the last two days
  }

  let alreadyDone = new Set(alreadyDoneHtml);

  let hasSearch = fs.existsSync(path.join('logs', 'docs', '_indexes', sanitizeRoomName(room), 'config.json'));

  for (let i = 0; i < days.length; ++i) {
    let day = days[i];
    if (alreadyDone.has(day)) {
      continue;
    }
    let events = JSON.parse(fs.readFileSync(path.join(roomJsonDir, day + '.json'), 'utf8'));
    let prev = i < days.length - 1 ? days[i + 1] : null;
    let next = i > 0 ? days[i - 1] : null;
    events = applyModifications(events);
    let rendered = renderDay(roomsWithDays, room, day, events, prev, next, hasSearch);
    if (!room.startsWith('#')) {
      // don't postprocess IRC logs
      rendered = postprocessHTML(rendered);
    }
    fs.writeFileSync(path.join(roomDir, day + '.html'), rendered, 'utf8');
  }

  if (days.length === 0) {
    continue;
  }
  let index = `<!doctype html>
<meta http-equiv="refresh" content="0; URL='${days[0]}'" />
`;
  fs.writeFileSync(path.join(roomDir, 'index.html'), index, 'utf8');

  // TODO gate this on the SQL existing
  fs.writeFileSync(path.join(roomDir, 'search.html'), renderSearch(roomsWithDays, room), 'utf8');
}

if (roomsWithDays.length > 0) {
  let indexDir = path.join('logs', 'docs');
  fs.mkdirSync(indexDir, { recursive: true });
  let index = renderDay(roomsWithDays, 'index', '', [], null, null, false);
  fs.writeFileSync(path.join(indexDir, 'index.html'), index, 'utf8');

  fs.writeFileSync(path.join(indexDir, ROOMLIST_JS_SRC), makeRoomJs(roomsWithDays), 'utf8');

  let resourcesDir = path.join(__dirname, 'resources');
  cpr(resourcesDir, indexDir);
}



function cpr(inDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (let file of fs.readdirSync(inDir)) {
    if (file.startsWith('.')) {
      continue;
    }
    let inFile = path.join(inDir, file);
    let outFile = path.join(outDir, file);
    if (fs.lstatSync(inFile).isDirectory()) {
      cpr(inFile, outFile);
    } else {
      fs.copyFileSync(inFile, outFile);
    }
  }
}

function postprocessHTML(html) {
  // this is kind of slow, but extremely convenient
  let dom = new JSDOM(html);
  let document = dom.window.document;

  // fix up mx-reply header, pending a better solution
  for (let mx of document.querySelectorAll('mx-reply > blockquote')) {
    for (let i = 0; i < 3; ++i) {
      let a = mx.firstElementChild;
      a.remove();
    }
  }

  // replace matrix.to username links with colored spans
  let unameLinks = [...document.querySelectorAll('a')].filter((l) => l.href.startsWith('https://matrix.to/#/@'));
  for (let link of unameLinks) {
    let uname = link.textContent;
    let s = document.createElement('span');
    s.append(...link.childNodes);
    s.className = getNickClass(uname);
    link.replaceWith(s);
  }
  let result = dom.serialize();
  dom.window.close(); // attempt to reclaim memory from jsdom
  return result;
}

function renderRoomlistJS(room) {
  return room === 'index'
    ? ''
    : `<script>window.room = ${JSON.stringify(room).replace(/</g, '\\x3c')};</script><script src="../${ROOMLIST_JS_SRC}"></script>`;
}

function renderDay(rooms, room, day, events, prev, next, hasSearch) {
  let isIndex = room === 'index';
  let cssSrc = isIndex ? 'style.css' : '../style.css';
  let jsSrc = isIndex ? 'logs.js' : '../logs.js';

  return `<!doctype html>
<head>
  <meta charset="UTF-8">
  <title>${room === 'index' ? 'Matrix Logs' : `${room} on ${day}`}</title>
  <link rel="stylesheet" href="${cssSrc}">
  ${renderRoomlistJS(room)}
  <script src="${jsSrc}"></script>
</head>
<body><div class="wrapper">
<div class="sidebar">${renderSidebar(rooms, room, day, prev, next)}</div>
<div class="rhs">
${hasSearch ? renderSearchbar(room, false) : ''}
<div class="log"><table id="log-table"><tbody id="log-tbody">
${
  events.length > 0
    ? `
  ${events.map(renderEvent).join('\n  ')}
`
    // yes, we're sticking non-tr elements in the tbody
    // whatever, it's fine
    : room === 'index'
      ? '[see channel index on the left]'
      : '[no messages to display for this date]'
}
</tbody></table></div></div></div></body>
`;
}

function getNickClass(nick) {
  // we use the same logic for computing a class for the nick as whitequark: https://github.com/whitequark/irclogger/blob/d04a3e64079074c64d2b43fa79501a6d561b2b83/lib/irclogger/viewer_helpers.rb#L50-L53
  let nickClass = (crc.str(nick) % 16) + 1;
  if (nickClass <= 0) {
    nickClass += 16; // uuuuugh
  }
  return `nick-${nickClass}`;
}

function renderRoom(room, current) {
  return `<li><a href="${current === 'index' ? '' : '../'}${sanitizeRoomName(room)}/"${room === current ? ' class="current-room"' : ''}>${room}</a></li>`;
}

function renderSidebar(rooms, room, day, prev, next) {
  let header;
  if (room === 'index') {
    header = `<div class="title">Channel Index</div><div class="nav"></div>`;
  } else {
    let prevInner = `<span>prev</span>`;
    let nextInner = `<span style="float:right">next</span>`;
    header = `
<div class="title">${room}<br>${day}<br><a href="plaintext/">plaintext logs</a></div>
<div class="nav">
${prev == null ? prevInner : `<a href="${prev}" class="nav-link">${prevInner}</a>`}
${next == null ? nextInner : `<a href="${next}" class="nav-link">${nextInner}</a>`}
</div>
    `;
  }

  return `${header}${renderRoomList(rooms, room)}`;
}

function renderRoomList(rooms, room) {
  let mainContent = room === 'index'
    ? renderRawRoomList(rooms, room)
    : `<noscript>JavaScript is required to load the channel index, but you can go to <a href="../..">the static index</a> directly.</noscript>`;
  return `<div class="all-rooms">${mainContent}</div>
<div class="footer"><a href="https://github.com/bakkot/matrix-archive-bot">source on github</a></div>
`;
}

function renderRawRoomList(rooms, room) {
  // someday, partition
  let historicalRooms = rooms.filter(r => r.historical).map(r => r.room);
  let activeRooms = rooms.filter(r => !r.historical).map(r => r.room);

  if (historicalRooms.length === 0) {
    return `
<ul class="room-list">
${activeRooms.map(r => renderRoom(r, room)).join('\n')}
</ul>
`;
  } else {
    return `
<div class="room-list-wrapper">Active:<br>
<ul class="room-list">
${activeRooms.map(r => renderRoom(r, room)).join('\n')}
</ul>
</div>
<br>
<div class="room-list-wrapper">Historical:<br>
<ul class="room-list">
${historicalRooms.map(r => renderRoom(r, room)).join('\n')}
</ul>
</div>
`;
  }
}

function renderEvent(event, index) {
  let { msgtype } = event.content;
  if (msgtype == null) {
    // message was deleted
    return '';
  }
  if (msgtype !== 'm.text' && msgtype !== 'm.emote') {
    throw new Error('unknown event message type ' + msgtype);
  }
  let id = `L${index}`;
  let date = new Date(event.ts);
  let hours = ('' + date.getUTCHours()).padStart(2, '0');
  let minutes = ('' + date.getUTCMinutes()).padStart(2, '0');
  let full = date.toString();
  let ts = `<a class="ts" href="#${id}" alt="${full}">${hours}:${minutes}</a>`;
  let { senderName } = event;
  let shortNameMatch = senderName.match(/(.*) \(@[^\):\s]+:[^\):\s]+\.[^\):\s]+\)$/);
  if (shortNameMatch != null) {
    senderName = shortNameMatch[1];
  }
  let name = `<span class="nick ${getNickClass(senderName)}" title=${escapeForHtml(event.senderId)}>${escapeForHtml(
    senderName
  )}</span>`;
  name = msgtype === 'm.text' ? `&lt;${name}&gt;` : `${name}`;
  let contents =
    event.content.format === 'org.matrix.custom.html'
      ? event.content.formatted_body
      : escapeForHtml(event.content.body);

  contents = linkify(contents, {
    className: '',
    ignoreTags: ['pre'],
    validate: {
      email: false,
    },
  });
  return `<tr class="msg" id="${id}"><td class="ts-cell">${ts}</td><td class="nick-cell"><div class="m-ov">${name}</div></td><td class="msg-cell">${contents}</td></tr>`;
}

function escapeForHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


function renderSearch(rooms, room) {
  return `<!doctype html>
<meta charset="UTF-8">
<title>Search ${room}</title>

<link rel="stylesheet" href="../style.css">
<script src="../search-js/search.js"></script>
${renderRoomlistJS(room)}
<script>initSearch(new URL('${ROOT_SQL_URL}/${sanitizeRoomName(room)}/config.json', location))</script>
</head>
<body>

<div class="wrapper">
<div class="sidebar">
<div class="lhs-header"><div class="lhs-header-contents title">Search ${room}</div></div>
${renderRoomList(rooms, room)}
</div>

<div class="rhs">
${renderSearchbar(room, true)}
<div class="log">
<table id="log-table"><tbody id="search-output">
</tbody></table>

<input type="button" id="load-more" class="button" style="display:none" value="Load more">

<div id="thinking" style="display:none">Working...</div>
</div></div></div>
`;
}

function renderSearchbar(room, isActualPage) {
  return `<div class="rhs-header">
<span id="error" style="color: red; display:none">error</span>
${isActualPage ? `<select id="sort-order">
  <option value="oldest">Oldest first</option>
  <option value="newest">Newest first</option>
</select>` : ''}
<input type="text" id="query" size=25 placeholder="Search ${room}">
<a id="search-submit" class="button icon-link" title="Search">
  <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z"></path></svg>
</a>
</div>
`;
}

function makeRoomJs(rooms) {
  rooms = rooms.map(x => ({ historical: x.historical, room: x.room }));
  return `
"use strict";
let rooms = ${JSON.stringify(rooms).replace(/</g, '\\x3c')};

${sanitizeRoomName}
${renderRoom}
${renderRawRoomList}

addEventListener('DOMContentLoaded', () => {
  document.querySelector('.all-rooms').innerHTML = renderRawRoomList(rooms, room);
});
`;

}
