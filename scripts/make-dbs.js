'use strict';

// you should only need to run this once
// once the databases are collected, running render-sql.js will keep them up to date
// after running this, create the initial splits by running

let fs = require('fs');
let path = require('path');
let { execFileSync } = require('child_process');

let sqlite3 = require('sqlite3');
let { open } = require('sqlite');

let root = path.join(__dirname, '..', 'logs', 'json');
let historicalRoot = path.join(__dirname, '..', 'logs', 'historical-json');

let rooms = [
  ...fs.readdirSync(root).sort().map(room => ({ historical: false, room })),
  ...fs.existsSync(historicalRoot) ? fs.readdirSync(historicalRoot).sort().map(room => ({ historical: true, room })) : [],
];

(async () => {
  for (let { room, historical } of rooms) {
    console.log(`Making DB for ${room}`);
    let jsonDir = path.join(historical ? historicalRoot : root, room);
    let sanitized = sanitizeRoomName(room);
    let dbFile = path.join(__dirname, '..', 'sql', sanitized + '.sqlite3');
    await makeDb(jsonDir, dbFile);
    execFileSync(path.join(__dirname, 'split-db.sh'), [dbFile, path.join(__dirname, '..', 'logs', 'docs', '_indexes', sanitized)]);
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});


async function makeDb(jsonDir, outFile) {
  if (fs.existsSync(outFile)) {
    console.log('db exists; rm it if you want to recreate it');
    return;
  }

  const db = await open({
    filename: outFile,
    driver: sqlite3.Database,
  });

  await db.run(`
    create virtual table search using fts5(
      sender, ts UNINDEXED, idx UNINDEXED, content,
      prefix=3
    );
  `);

  let finalName = null;
  let finalLines = null;
  for (let file of fs.readdirSync(jsonDir)) {
    if (!file.endsWith('.json')) {
      continue;
    }
    finalName = file;
    console.log('reading ' + file);
    let parts = [];
    let lines = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf8'));
    finalLines = lines;
    for (let [idx, line] of lines.entries()) {
      let { senderName, ts, content } = line;
      parts.push({ senderName, ts, idx, content });
    }
    if (parts.length === 0) {
      continue;
    }
    let statement = `insert into search values ${parts.map((v, i) => `($sender${i}, $ts${i}, $idx${i}, $content${i})`).join(', ')}`;
    let vals = Object.fromEntries(
      parts.flatMap(({ senderName, ts, idx, content}, i) => [
        [`$sender${i}`, senderName],
        [`$ts${i}`, ts],
        [`$idx${i}`, idx],
        [`$content${i}`, content.body],
      ])
    );
    await db.run(statement, vals);
  }

  // console.log('creating indexes...');

  // await db.run('create index "index on ts" on messages (ts)');
  // await db.run('create index "index on sender" on messages (sender)');
  // await db.run('create index "index on ts and sender" on messages (ts, sender)');

  console.log('creating fts...');
  await db.run(`insert into search(rowid, sender, ts, idx, content) select rowid, sender, ts, idx, content from messages`);
  await db.run(`insert into search(search) values ('optimize')`);

  console.log('optimizing...');
  await db.run(`pragma page_size = 2048`);
  await db.run(`vacuum`);
  await db.run(`analyze`);

  await db.close();

  console.log('noting last entry...');
  let lastAddedContents = { file: finalName };
  if (finalLines.length === 0) {
    lastAddedContents.ids = [];
  } else if (finalLines[0].id != null) {
    lastAddedContents.ids = finalLines.map(l => l.id);
  } else {
    // if we don't have a unique ID, fall back to timestamp
    lastAddedContents.ts = finalLines[finalLines.length - 1].ts;
  }
  let lastAddedName = outFile.replace(/\.sqlite3$/, '-last-added.json');
  fs.writeFileSync(lastAddedName, JSON.stringify(lastAddedContents), 'utf8');
}

function sanitizeRoomName(room) {
  if (room.startsWith('#')) {
    room = 'irc-' + room;
  }
  return room.replace(/ /g, '_').replace(/#/g, '');
}
