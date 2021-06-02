'use strict';

let fs = require('fs');
let path = require('path');

let root = path.join('logs', 'json');

let rooms = fs.readdirSync(root).sort();
for (let room of rooms) {
  let roomDir = path.join('logs', 'docs', sanitizeRoomName(room), 'plaintext');
  fs.mkdirSync(roomDir, { recursive: true });
  let days = fs
    .readdirSync(path.join(root, room))
    .filter(f => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/.test(f))
    .map(d => d.replace(/\.json$/, ''))
    .sort();

  // gotta get `groupBy` added... https://github.com/tc39/proposal-array-filtering/issues/2#issuecomment-810594446
  let months = new Map();
  for (let day of days) {
    let month = day.substring(0, 7);
    if (!months.has(month)) {
      months.set(month, []);
    }
    months.get(month).push(day);
  }
  fs.readdirSync(roomDir)
    .filter(f => /^[0-9]{4}-[0-9]{2}\.txt$/.test(f))
    .map(d => d.substring(0, 7))
    .slice(0, -1) // always do at least the last month
    .forEach(m => months.delete(m));

  for (let [month, days] of months) {
    let contents = [];
    for (let day of days) {
      contents.push(`${contents.length === 0 ? '' : '\n'}${day}\n`);
      let events = JSON.parse(fs.readFileSync(path.join(root, room, day + '.json'), 'utf8'));
      for (let event of events) {
        let { msgtype } = event.content;
        if (msgtype !== 'm.text' && msgtype !== 'm.emote') {
          throw new Error('unknown event message type ' + msgtype);
        }

        let date = new Date(event.ts);
        let ts = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0') + ':' + date.getSeconds().toString().padStart(2, '0') + '.' + date.getMilliseconds().toString().padStart(4, '0');

        let { senderName } = event;
        let shortNameMatch = senderName.match(/(.*) \(@[^\):\s]+:[^\):\s]+\.[^\):\s]+\)$/);
        if (shortNameMatch != null) {
          senderName = shortNameMatch[1];
        }
        contents.push(`[${ts}] <${senderName}>\n${msgtype === 'm.emote' ? '/me ' : ''}${event.content.body}\n\n`);
      }
    }
    fs.writeFileSync(path.join(roomDir, month + '.txt'), contents.join(''), 'utf8');
  }

  fs.writeFileSync(path.join(roomDir, 'index.html'), makeIndex(room, roomDir), 'utf8');
}

function makeIndex(room, roomDir) {
  let months = fs.readdirSync(roomDir)
    .filter(f => /^[0-9]{4}-[0-9]{2}\.txt$/.test(f));

  return `<!doctype html>
<head>
  <title>Logs for ${room}</title>
  <style>
  body {
    background-color: #fafafa;
    padding: 1.5em;
  }
  ul {
    line-height: 1.5;
  }
  </style>
</head>
<body>
  Logs for ${room}:
  <ul>
  ${months.map(m => `<li><a href="${m}">${m}</a></li>`).join('\n')}
  </ul>
</body>
`;
}

function sanitizeRoomName(room) {
  return room.replace(/ /g, '_');
}
