/*
Take logs in the format given by https://archive.logbot.info/
and render JSON similar enough to the matrix logs to satisfy the renderers
*/
'use strict';

let fs = require('fs');
let path = require('path');

if (process.argv.length !== 3) {
  console.error(`Usage: node ${path.basename(__filename)} logfile`);
  process.exit(1);
}

let lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');

let logDir;


let currentChannelName = null;
let currentFile = null;
let currentEntries = [];
for (let line of lines) {
  if (line.trim() === '') {
    continue;
  }
  let match = line.match(/^(?<ts>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}) (?<channelName>#[A-Za-z0-9#-_]+) (?<uname>(<[^>]+>)|(-[^-]+-)|(\* [^ ]+)) (?<message>.*)/);
  if (match == null) {
    console.error(`could not parse line`);
    console.error(line);
    process.exit(1);
  }
  let { ts: tsString, channelName, uname, message } = match.groups;

  if (currentChannelName == null) {
    if (fs.existsSync(path.join('logs', 'json', 'irc-' + channelName.replace(/#/g, '')))) {
      throw new Error('channel name already exists in non-historical logs');
    }
    logDir = path.join('logs', 'historical-json', channelName);
    fs.mkdirSync(logDir, { recursive: true });
    currentChannelName = channelName;
  } else if (currentChannelName !== channelName) {
    throw new Error('channel name is not consistent');
  }

  let ts = Date.parse(tsString + 'Z');
  let tsDate = new Date(ts);
  let year = tsDate.getUTCFullYear();
  let month = ('' + (tsDate.getUTCMonth() + 1)).padStart(2, '0');
  let date = ('' + tsDate.getUTCDate()).padStart(2, '0');
  let fileName = `${year}-${month}-${date}.json`;

  if (fileName !== currentFile) {
    writeCurrentBatch();
    currentFile = fileName;
    currentEntries = [];
  }
  let isSlashMe = uname.startsWith('*');
  let isIrcNotice = uname.startsWith('-');
  let justUname = isSlashMe ? uname.substring(2) : uname.slice(1, -1);
  let entry = {
    content: {
      body: message,
      msgtype: isSlashMe ? 'm.emote' : 'm.text'
    },
    ts,
    senderName: justUname,
    senderId: `${justUname}@irc`,
  };
  if (isIrcNotice) {
    entry.content.isIrcNotice = true;
  }
  currentEntries.push(entry);
}
writeCurrentBatch();


function writeCurrentBatch() {
  if (currentFile == null) {
    return;
  }
  // we don't just JSON.stringify because we want each event on its own line, for readability
  let contents = currentEntries.length === 0 ? '[]' : '[\n' + currentEntries.map((e) => JSON.stringify(e)).join(',\n') + '\n]';
  let targetFile = path.join(logDir, currentFile);
  if (fs.existsSync(targetFile)) {
    console.error(`${targetFile} already exists; not overwriting`);
    process.exit(1);
  }
  fs.writeFileSync(targetFile, contents, 'utf8');
}

