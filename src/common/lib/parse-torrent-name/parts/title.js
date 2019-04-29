'use strict';

var core = require('../core');

require('./common');

var torrent, start, end, raw;

core.on('setup', function (data) {
  torrent = data;
  start = 0;
  end = undefined;
  raw = undefined;
});

core.on('part', function (part) {
  if(!part.match) {
    return;
  }

  if(part.match.index === 0) {
    start = part.match[0].length;

    return;
  }

  if(!end || part.match.index < end) {
    end = part.match.index;
  }
});

core.on('common', function () {
  const raw = end ? torrent.name.substr(start, end - start).split('(')[0] : torrent.name;
  let clean = raw;

  // clean up title
  // removes [asdfadsf] from start of title
  clean = clean.replace(/^\[.*?][\s|-]?/, '').trim();

  // removes www.asdf.sdf from start of title
  clean = clean.replace(/^www\..*\.([^\s|-|_]+)/i, '').trim();

  clean = clean.replace(/^ -/, '');
  clean = clean.replace(/^-\s/, '');
  clean = clean.replace(/^-/, '');
  clean = clean.replace(/\s?-$/, '');

  // if(clean.indexOf(' ') === -1 && clean.indexOf('.') !== -1) {
  //   clean = clean.replace(/\./g, ' ');
  // }
  if(clean.indexOf('.') !== -1) {
    clean = clean.replace(/\./g, ' ');
  }

  clean = clean.replace(/_/g, ' ');
  clean = clean.replace(/([\(_]|- )$/, '').trim();

  core.emit('part', {
    name: 'title',
    raw: raw,
    clean: clean.toLowerCase()
  });
});
