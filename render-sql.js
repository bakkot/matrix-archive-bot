'use strict';


let fs = require('fs');
let path = require('path');
let { execFileSync } = require('child_process');

let sqlite = require('better-sqlite3');

let { root, historicalRoot, rooms, sanitizeRoomName, applyModifications } = require('./utils.js');
let { makeDb } = require('./scripts/make-dbs.js');

(async () => {
  for (let { room, historical } of rooms) {
    let jsonDir = path.join(historical ? historicalRoot : root, room);
    let sanitized = sanitizeRoomName(room);
    let dbFile = path.join(__dirname, 'sql', sanitized + '.sqlite3');
    let lastAddedFile = path.join(__dirname, 'sql', sanitized + '-last-added.json');
    if (!fs.existsSync(dbFile)) {
      await makeDb(jsonDir, dbFile);
    }
    if (!fs.existsSync(dbFile)) {
      // db not created by prevous step; e.g. no one has talked yet
      continue;
    }
    if (!fs.existsSync(lastAddedFile)) {
      throw new Error(`expected to find ${lastAddedFile}`);
    }

    let indexDir = path.join(__dirname, 'logs', 'docs', '_indexes', sanitized);

    // add everything more recent than the last-added item
    let last = JSON.parse(fs.readFileSync(lastAddedFile, 'utf8'));
    let toAdd = fs.readdirSync(jsonDir).sort().filter(f => f.endsWith('.json') && f >= last.file);
    let parts = [];
    let finalName;
    let finalLines;
    for (let file of toAdd) {
      let lines = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf8'));
      finalName = file;
      finalLines = lines;
      lines = applyModifications(lines);
      let linesAndIdx = [...lines.entries()];
      if (file === last.file) {
        if (last.ids != null) {
          let seen = new Set(last.ids);
          linesAndIdx = linesAndIdx.filter(l => !seen.has(l[1].id));
        } else {
          linesAndIdx = linesAndIdx.filter(l => l[1].ts > last.ts);
        }
      }
      for (let [idx, line] of linesAndIdx) {
        let { senderName, ts, content } = line;
        if (content.msgtype == null) {
          // message was deleted
          continue;
        }
        parts.push({ senderName, ts, idx, content });
      }
    }
    if (parts.length === 0) {
      if (!fs.existsSync(indexDir)) {
        execFileSync(path.join(__dirname, 'scripts', 'split-db.sh'), [dbFile, indexDir]);
      }
      continue;
    }

    // TODO split this up if there's too many placeholders for sqlite
    // unfortunately I don't know how many that is
    let statement = `insert into search values ${parts.map((v, i) => `($sender${i}, $ts${i}, $idx${i}, $content${i})`).join(', ')}`;
    let vals = Object.fromEntries(
      parts.flatMap(({ senderName, ts, idx, content }, i) => [
        [`sender${i}`, senderName],
        [`ts${i}`, ts],
        [`idx${i}`, idx],
        [`content${i}`, content.body],
      ])
    );

    const db = sqlite(dbFile);
    db.prepare(statement).run(vals);
    db.close();

    execFileSync(path.join(__dirname, 'scripts', 'split-db.sh'), [dbFile, indexDir]);

    let lastAddedContents = { file: finalName };
    if (finalLines.length === 0) {
      lastAddedContents.ids = [];
    } else if (finalLines[0].id != null) {
      lastAddedContents.ids = finalLines.map(l => l.id);
    } else {
      // if we don't have a unique ID, fall back to timestamp
      lastAddedContents.ts = finalLines[finalLines.length - 1].ts;
    }
    fs.writeFileSync(lastAddedFile, JSON.stringify(lastAddedContents), 'utf8');
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});


