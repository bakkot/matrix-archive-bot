'use strict';

let fs = require('fs');
let path = require('path');

let root = path.join(__dirname, 'logs', 'json');
let historicalRoot = path.join(__dirname, 'logs', 'historical-json');

let rooms = [
  ...fs.readdirSync(root).sort().map(room => ({ historical: false, room })),
  ...fs.existsSync(historicalRoot) ? fs.readdirSync(historicalRoot).sort().map(room => ({ historical: true, room })) : [],
];


function sanitizeRoomName(room) {
  if (room.startsWith('#')) {
    room = 'irc-' + room;
  }
  return room.replace(/ /g, '_').replace(/#/g, '');
}

module.exports = { root, historicalRoot, rooms, sanitizeRoomName };
