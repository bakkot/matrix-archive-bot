'use strict';

let path = require('path');
module.exports = {
  entry: './scripts/search.js',
  output: {
    path: path.resolve(__dirname, 'resources/search-js'),
    filename: 'search.js',
  },
};
