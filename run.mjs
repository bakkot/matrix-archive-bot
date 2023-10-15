// API docs:
// https://matrix.org/docs/spec/client_server/latest

// it would be nice to use matrix-js-sdk
// but it is not really designed for this use case
// so I guess we're just gonna talk to the API directly

import fs from 'fs';
import { inspect } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

let __dirname = path.dirname(fileURLToPath(import.meta.url));
let logDir = path.join(__dirname, 'logs', 'json');

let lastSeenFilename = 'last-seen-event.txt';

let creds = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'credentials.json'), 'utf8'));

function print(obj) {
  console.log(inspect(obj, false, null, true /* enable colors */))
}

// poor man's sempahore
let waiting = [];
let available = 6;
function lock() {
  if (available > 0) {
    --available;
    return;
  }
  return new Promise(res => {
    waiting.push(res);
  });
}
function unlock() {
  if (waiting.length > 0) {
    waiting.shift()();
  } else {
    ++available;
  }
}
async function api(path) {
  await lock();
  try {
    return (await fetch('https://matrix.org/_matrix/client/r0/' + path, {
      headers: {
        'Authorization': `Bearer ${creds.accessToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    })).json();
  } finally {
    unlock();
  }
}

const MESSAGE_AND_MEMBER_FILTER = `{"types":["m.room.message","m.room.member"],"lazy_load_members":true}`;

(async () => {
  fs.mkdirSync(logDir, { recursive: true });

  let config = {};
  let configPath = path.join(logDir, '..', 'config.json');
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  let excluded = new Set(config.excluded ?? []);

  // https://matrix.org/docs/spec/client_server/latest#get-matrix-client-r0-joined-rooms
  let { joined_rooms } = await api('joined_rooms');

  let seen = new Set;
  let toInspect = joined_rooms;
  let allNonSpaceRooms = [];

  // first, fetch all rooms, and expand spaces
  while (toInspect.length > 0) {
    let thisBatch = toInspect;
    toInspect = [];
    await Promise.all(thisBatch.map(async roomId => {
      if (excluded.has(roomId) || seen.has(roomId)) {
        return;
      }
      seen.add(roomId);
      // https://matrix.org/docs/spec/client_server/latest#get-matrix-client-r0-rooms-roomid-state
      let state = await api(`rooms/${roomId}/state`);
      if (state == null) {
        console.log(`could not fetch state for ${roomId}`);
        return;
      }
      if (!Array.isArray(state)) {
        if (state.errcode) {
          console.log(`could not fetch state for ${roomId}, errcode: ${state.errcode}`);
        } else {
          console.log(`could not fetch state for ${roomId} - got ${JSON.stringify(state)}`);
        }
        return;
      }

      let name = state.find(e => e.type === 'm.room.name')?.content.name ?? 'UNKNOWN';
      console.log(`looking at ${name}`);

      let createEvent = state.find(e => e.type === 'm.room.create');
      if (createEvent == null) {
        console.error(`could not find create event for room ${roomId}`);
        return;
      }
      if (createEvent.content?.type === 'm.space') {
        console.log('is space');
        let children = state.filter(e => e.type === 'm.space.child' && e.content.via);
        children.forEach(c => toInspect.push(c.state_key));
        return;
      }

      let historyEvent = state.find(e => e.type === 'm.room.history_visibility' && e.content.history_visibility === 'world_readable');
      if (historyEvent == null) {
        console.log('could not find world_readable history, skipping');
        return;
      }

      allNonSpaceRooms.push({
        roomId,
        name,
        historyEventId: historyEvent.event_id,
      });
    }));
  }


  // update logs for all rooms
  // massive parallelism here is fine because `api()` is self-limiting
  await Promise.all(allNonSpaceRooms.map(async ({ roomId, name, historyEventId }) => {
    console.log(`fetching messages for ${name}`);

    let roomDir = path.join(logDir, sanitizeName(name));
    fs.mkdirSync(roomDir, { recursive: true });
    let lastSeenFile = path.join(roomDir, lastSeenFilename);
    let lastSeenId = historyEventId;

    let hasOldId = fs.existsSync(lastSeenFile);
    if (hasOldId) {
      lastSeenId = fs.readFileSync(lastSeenFile, 'utf8').trim();
      console.log('loaded old lastSeenId', lastSeenId);
    } else {
      // fall back to checking logs
      let logFiles = fs.readdirSync(roomDir).filter(f => f.match(/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json/));
      for (let file of logFiles.sort().reverse()) {
        let contents = JSON.parse(fs.readFileSync(path.join(roomDir, file), 'utf8'));
        if (contents.length > 0) {
          lastSeenId = contents[contents.length - 1].id;
          console.log('loaded old lastSeenId from old logfile', lastSeenId);
          break;
        }
      }
    }
    // we want the start token for the history event to point to the event, not to an earlier point
    // so that we are allowed to fetch membership for that token
    let contextLimit = lastSeenId === historyEventId ? 0 : 10;

    // we just need the context to get a pagination token
    // but since we're doing a query anyway, might as well check for new messages while we're at it
    // https://matrix.org/docs/spec/client_server/latest#get-matrix-client-r0-rooms-roomid-context-eventid
    let context = await api(`rooms/${roomId}/context/${lastSeenId}?limit=${contextLimit}&filter=${MESSAGE_AND_MEMBER_FILTER}`);

    let lastPaginationToken = context.start;
    let nextPaginationToken = context.end;
    let latestEventId = context.event.event_id;

    let nameMap = null;
    let messages = [];

    async function addEvents(events) {
      for (let [index, event] of events.entries()) {
        // TODO save reactions etc also
        if (event.type === 'm.room.message') {
          let content = event.content;
          if (content.msgtype === 'm.text' || content.msgtype === 'm.emote') {
            if (nameMap == null) {
              nameMap = await getMembers(roomId, name, lastPaginationToken) ?? new Map;
              resolveMemberEvents(events.slice(0, index));
            }
            messages.push({
              content,
              ts: event.origin_server_ts,
              senderName: nameMap.get(event.sender) ?? guessName(event.sender),
              senderId: event.sender,
              id: event.event_id,
            });
          }
        } else if (event.type === 'm.room.member') {
          if (nameMap != null) {
            resolveMemberEvent(event);
          }
        } else {
          throw new Error(`unexpected event type ${event.type}`);
        }
      }

      if (events.length > 0) {
        latestEventId = events[events.length - 1].event_id;
        saveDays(roomDir, messages);
      }
    }

    function resolveMemberEvent(event) {
      if (!nameMap.has(event.state_key)) {
        nameMap.set(event.state_key, memberMessageToDisplayname(event));
      } else if (event.content?.displayname != null) {
        nameMap.set(event.state_key, event.content.displayname);
      }
    }

    function resolveMemberEvents(events) {
      for (let event of events) {
        if (event.type === 'm.room.member' && event.content?.membership === 'join') {
          resolveMemberEvent(event);
        }
      }
    }


    if (context.events_after.some(e => e.type === 'm.room.message')) {
      // the token we have requires us to reconcile with events_before and the context event
      // so we can't rely on the logic in addEvents to handle this for us
      try {
        nameMap = await getMembers(roomId, name, context.start) ?? nameMap;
        // events_before is reverse chronological
        resolveMemberEvents([...context.events_before.reverse(), context.event]);
      } catch (e) {
        if (!e.message.includes('failed to get members')) {
          throw e;
        }
        // if we failed to get members, it's probably because our `lastSeenId` was within `contextLimit` events of the history event, so the context's start token is before we are allowed to query
        // (unfortunately there's no good way to know that without just trying it, as far as I can tell)
        // we were only fetching nonzero events as an optimization
        // so try again with limit = 0
        context = await api(`rooms/${roomId}/context/${lastSeenId}?limit=0&filter=${MESSAGE_AND_MEMBER_FILTER}`);
        lastPaginationToken = context.start;
        nextPaginationToken = context.end;
        latestEventId = context.event.event_id;
        nameMap = await getMembers(roomId, name, context.start) ?? nameMap;
      }
    }
    await addEvents(context.events_after);

    // unfortunately this API can return fewer messages than requested
    // so you have to fetch a page and then check if the end token is still the same
    // rather than just checking if you got fewer messages than you asked for
    // this seems dumb
    let hasMore = true;

    while (hasMore) {
      console.log('fetching next page...');
      let limit = 100;
      // https://matrix.org/docs/spec/client_server/latest#get-matrix-client-r0-rooms-roomid-messages
      let res = await api(`rooms/${roomId}/messages?dir=f&limit=${limit}&from=${nextPaginationToken}&filter=${MESSAGE_AND_MEMBER_FILTER}`);
      hasMore = res.end != null && (nextPaginationToken !== res.end);
      lastPaginationToken = res.start;
      nextPaginationToken = res.end;
      let chunk = res.chunk;
      if (!hasMore && chunk.length > 0) {
        throw new Error(`got nonempty chunk, but pagination token didn't change!`);
      }
      await addEvents(chunk);
    }

    saveDays(roomDir, messages, true);

    if (!hasOldId || lastSeenId !== latestEventId) {
      fs.writeFileSync(lastSeenFile, latestEventId, 'utf8');
    }
  }));
})().catch(e => {
  console.error(e);
  process.exit(1);
});

function guessName(senderId) {
  return senderId.match(/@([^:]+):/)[1];
}

function memberMessageToDisplayname(m) {
  return m.content?.displayname ?? guessName(m.state_key);
}

async function getMembers(roomId, room, at) {
  // https://matrix.org/docs/spec/client_server/latest#get-matrix-client-r0-rooms-roomid-members
  let res = await api(`rooms/${roomId}/members?membership=join&at=${at}`);
  if (res.errcode) {
    console.error(new Error(`failed to get members for room ${room}: ${JSON.stringify(res)}`));
    return null;
  }
  return new Map(res.chunk.map(m => [m.state_key, memberMessageToDisplayname(m)]));
}

function sanitizeName(name) {
  return name.replace(/[^A-Za-z0-9_ \-\.]+/g, '_');
}

function tsToDay(ts) {
  let date = new Date(ts);
  let year = date.getUTCFullYear();
  let month = ('' + (date.getUTCMonth() + 1)).padStart(2, '0');
  let day = ('' + date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// note: mutates events
function saveDays(dir, events, forceLast = false) {
  while (events.length > 0 && (forceLast || tsToDay(events[0].ts) !== tsToDay(events[events.length - 1].ts))) {
    let day = tsToDay(events[0].ts);
    console.log(`saving ${day}`);
    let forDay = [];
    while (events.length > 0 && tsToDay(events[0].ts) === day) {
      forDay.push(events.shift());
    }
    let file = path.join(dir, day + '.json');
    let existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];

    let seenIds = new Set();
    let sorted = [...existing, ...forDay]
      .filter((e) => (seenIds.has(e.id) ? false : (seenIds.add(e.id), true)))
      .sort((a, b) => a.ts - b.ts);
    // we don't just JSON.stringify because we want each event on its own line, for readability
    let contents = sorted.length === 0 ? '[]' : '[\n' + sorted.map((e) => JSON.stringify(e)).join(',\n') + '\n]';
    fs.writeFileSync(file, contents, 'utf8');
  }
}
