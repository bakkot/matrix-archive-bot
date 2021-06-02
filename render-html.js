'use strict';

let fs = require('fs');
let path = require('path');

let crc = require('crc-32');
let { JSDOM } = require('jsdom');
let anchorme = require('anchorme').default;

let root = path.join('logs', 'json');

let rooms = fs.readdirSync(root).sort();
for (let room of rooms) {
  let roomDir = path.join('logs', 'docs', sanitizeRoomName(room));
  fs.mkdirSync(roomDir, { recursive: true });
  let days = fs
    .readdirSync(path.join(root, room))
    .filter((f) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/.test(f))
    .map((d) => d.replace(/\.json$/, ''))
    .sort()
    .reverse();
  let alreadyDoneHtml = fs
    .readdirSync(roomDir)
    .filter((f) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.html$/.test(f))
    .map((d) => d.replace(/\.html$/, ''))
    .sort()
    .reverse()
    .slice(2); // always do at least the last two days

  let alreadyDone = new Set(alreadyDoneHtml);

  for (let i = 0; i < days.length; ++i) {
    let day = days[i];
    if (alreadyDone.has(day)) {
      continue;
    }
    let events = JSON.parse(fs.readFileSync(path.join(root, room, day + '.json'), 'utf8'));
    let prev = i < days.length - 1 ? days[i + 1] : null;
    let next = i > 0 ? days[i - 1] : null;
    let rendered = postprocessHTML(renderDay(rooms, room, day, events, prev, next));
    fs.writeFileSync(path.join(roomDir, day + '.html'), rendered, 'utf8');
  }

  if (days.length === 0) {
    return;
  }
  let index = `<!doctype html>
<meta http-equiv="refresh" content="0; URL='${days[0]}'" />
`;
  fs.writeFileSync(path.join(roomDir, 'index.html'), index, 'utf8');
}

if (rooms.length > 0) {
  let indexDir = path.join('logs', 'docs');
  fs.mkdirSync(indexDir, { recursive: true });
  let index = renderDay(rooms, 'index', '', [], null, null);
  fs.writeFileSync(path.join(indexDir, 'index.html'), index, 'utf8');

  let resourcesDir = path.join(__dirname, 'resources');
  for (let file of fs.readdirSync(resourcesDir)) {
    fs.copyFileSync(path.join(resourcesDir, file), path.join(indexDir, file));
  }
}

function sanitizeRoomName(room) {
  return room.replace(/ /g, '_');
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
  return dom.serialize();
}

function renderDay(rooms, room, day, events, prev, next) {
  let isIndex = room === 'index';
  let cssSrc = isIndex ? 'style.css' : '../style.css';
  let jsSrc = isIndex ? 'logs.js' : '../logs.js';

  return `<!doctype html>
<head>
  <title>${room === 'index' ? 'Matrix Logs' : `${room} on ${day}`}</title>
  <link rel="stylesheet" href="${cssSrc}">
  <script src="${jsSrc}"></script>
</head>
<body><div class="wrapper">
<div class="sidebar">${renderSidebar(rooms, room, day, prev, next)}</div>
<div class="rhs"><div class="log">
${
  events.length > 0
    ? `<table><tbody id="log-tbody">
  ${events.map(renderEvent).join('\n  ')}
</tbody></table>`
    : room === 'index'
      ? '[see channel index on the left]'
      : '[no messages to display for this date]'
}
</div></div></div></body>
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
    header = `<div class="title">Channel Index</div>`;
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

return `${header}
<ul class="room-list">
${rooms.map(r => renderRoom(r, room)).join('\n')}
</ul>
<div class="footer"><a href="https://github.com/bakkot/matrix-archive-bot">source on github</a></div>
`;
}

function renderEvent(event, index) {
  let { msgtype } = event.content;
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

  contents = anchorme({
    input: contents,
    options: {
      exclude: (s) => anchorme.validate.email(s) || s.startsWith('file:///'),
    },
  });
  return `<tr class="msg" id="${id}"><td class="ts-cell">${ts}</td><td class="nick-cell">${name}</td><td class="msg-cell">${contents}</td></tr>`;
}

function escapeForHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
