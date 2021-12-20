'use strict';

let fs = require('fs');
let path = require('path');

let root = path.join(__dirname, 'logs', 'json');
let historicalRoot = path.join(__dirname, 'logs', 'historical-json');

let rooms = [
  ...fs.readdirSync(root).filter(r => !r.startsWith('.')).sort().map(room => ({ historical: false, room })),
  ...fs.existsSync(historicalRoot) ? fs.readdirSync(historicalRoot).filter(r => !r.startsWith('.')).sort().map(room => ({ historical: true, room })) : [],
];


function sanitizeRoomName(room) {
  if (room.startsWith('#')) {
    room = 'irc-' + room;
  }
  return room.replace(/ /g, '_').replace(/#/g, '');
}

function isReplace(event) {
  return event.content?.['m.relates_to']?.rel_type === 'm.replace';
}

function applyModifications(events) {
  let replacing = events.map((v, i) => [v, i]).filter(p => isReplace(p[0]));
  if (replacing.length === 0) {
    return events;
  }
  let clone = [...events];
  let ids = new Map(events.map((e, i) => [e.id, i]));
  for (let [replacer, replacerIndex] of replacing) {
    let targetIndex = ids.get(replacer.content['m.relates_to'].event_id);
    if (targetIndex != null) {
      clone[targetIndex].content = replacer.content['m.new_content'];
      clone[replacerIndex] = null;
    }
  }
  return clone.filter(e => e != null);
}

module.exports = { root, historicalRoot, rooms, sanitizeRoomName, applyModifications };
