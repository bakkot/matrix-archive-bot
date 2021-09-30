'use strict';

let fs = require('fs');
let path = require('path');
let sdk = require('matrix-js-sdk');

// token is under settings -> Help & About. yes, really.
let { userId, accessToken } = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'credentials.json'), 'utf8'));

let client = sdk.createClient({
  baseUrl: 'https://matrix.org',
  accessToken,
  userId,
});

client.startClient();
client.once('sync', (state, prevState, res) => {
  if (state !== 'PREPARED') {
    console.error('unknown state ' + state);
    process.exit(1);
  }
  onPrepared().catch((e) => {
    console.error(e);
    process.exit(1);
  });
});

async function onPrepared() {
  for (let room of client.getRooms()) {
    console.log('checking room ' + room.name);
    if (room.isSpaceRoom()) {
      console.log('skipping space room');
      continue;
    }
    let name = room.name.replace(/\//g, '_');
    let logDir = path.join('logs', 'json', name);
    fs.mkdirSync(logDir, { recursive: true });

    let existing = fs.readdirSync(logDir).filter((f) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/.test(f));
    let lastSeenMessageTs;
    let lastSeenDateTs;
    let partialEvents;
    if (existing.length === 0) {
      lastSeenMessageTs = 0;
      lastSeenDateTs = 0;
      partialEvents = [];
    } else {
      existing.sort();
      let latestFile = existing[existing.length - 1];
      let { year, month, date } = latestFile.match(
        /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<date>[0-9]{2})\.json$/
      ).groups;
      lastSeenDateTs = Date.UTC(year, month - 1, date);
      partialEvents = JSON.parse(fs.readFileSync(path.join(logDir, latestFile), 'utf8'));
      if (partialEvents.length === 0) {
        lastSeenMessageTs = lastSeenDateTs;
      } else {
        lastSeenMessageTs = partialEvents[partialEvents.length - 1].ts;
      }
    }

    // the JS API apparently does not support a method to just fetch some messages
    // the actual API does, but it's not worth the trouble to wrap it
    // instead, invoke the scrollback method repeatedly until the "live timeline" contains enough messages
    let timeline = room.getLiveTimeline();
    let done = false;
    while (!done && timeline.getEvents()[0].event.origin_server_ts >= lastSeenMessageTs) {
      console.log('fetching...');
      await client.scrollback(room, 100);
      done = room.oldState.paginationToken === null;
    }

    let events = [...timeline.getEvents()];
    events.reverse();

    let latestTs = events[0].event.origin_server_ts;
    let latestDate = new Date(latestTs);
    let currentDateTs = Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), latestDate.getUTCDate());
    let currentDateEvents = currentDateTs === lastSeenDateTs ? partialEvents : [];
    let offsetDays = 0;
    function finishDay() {
      let seenIds = new Set();
      let sorted = currentDateEvents
        .filter((e) => (seenIds.has(e.id) ? false : (seenIds.add(e.id), true)))
        .sort((a, b) => a.ts - b.ts);
      // we don't just JSON.stringify because we want each event on its own line, for readability
      let contents = sorted.length === 0 ? '[]' : '[\n' + sorted.map((e) => JSON.stringify(e)).join(',\n') + '\n]';

      let currentDate = new Date(currentDateTs);
      let year = currentDate.getUTCFullYear();
      let month = ('' + (currentDate.getUTCMonth() + 1)).padStart(2, '0');
      let date = ('' + currentDate.getUTCDate()).padStart(2, '0');
      let fileName = `${year}-${month}-${date}.json`;
      fs.writeFileSync(path.join(logDir, fileName), contents, 'utf8');

      // TODO replace this abomination when Temporal is available
      ++offsetDays;
      currentDateTs = Date.UTC(
        latestDate.getUTCFullYear(),
        latestDate.getUTCMonth(),
        latestDate.getUTCDate() - offsetDays
      );
      currentDateEvents = currentDateTs === lastSeenDateTs ? partialEvents : [];
    }
    for (let e of events) {
      // we have to do `<` rather than `<=` because two events can have the same TS
      // this means we always end up adding the last seen event to the current set, even though it's already there
      // but we deduplicate by ID, so that's fine
      while (e.event.origin_server_ts < currentDateTs) {
        finishDay();
      }
      if (e.event.origin_server_ts < lastSeenMessageTs) {
        break;
      }
      // for now, only worry about actual, text messages
      if (e.event.type === 'm.room.message') {
        let content = e.event.content;
        // TODO save reactions
        if (content.msgtype === 'm.text' || content.msgtype === 'm.emote') {
          currentDateEvents.push({
            content: e.event.content,
            ts: e.event.origin_server_ts,
            senderName: e.sender.name,
            senderId: e.sender.userId,
            id: e.event.event_id,
          });
        }
      }
    }
    if (currentDateEvents.length > 0) {
      finishDay();
    }
  }

  client.stopClient();

  // sometimes it hangs here for a minute or so, which is dumb; just kill it
  process.exit(0);
}
