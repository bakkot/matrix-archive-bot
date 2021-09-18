'use strict';

let firstLoad = true;
let isMultiline = hash => /^L[0-9]+-L[0-9]+$/.test(hash);
function highlightLinked() {
  for (let msg of document.querySelectorAll('.highlight')) {
    msg.classList.remove('highlight');
  }

  let hash = location.hash;
  if (hash.startsWith('#')) {
    hash = hash.substring(1);
  }
  if (isMultiline(hash)) {
    let parts = hash.split('-');
    if (parts.length !== 2) {
      return;
    }
    let [first, second] = parts;
    let tbody = document.getElementById('log-tbody');

    let firstIndex = -1;
    let secondIndex = -1;
    let children = tbody.children;
    for (let i = 0; i < children.length; ++i) {
      if (children[i].id === first) {
        firstIndex = i;
      } else if (children[i].id === second) {
        secondIndex = i;
      }
    }
    if (firstIndex > secondIndex) {
      [firstIndex, secondIndex] = [secondIndex, firstIndex];
    }
    for (let i = firstIndex; i <= secondIndex; ++i) {
      children[i].classList.add('highlight');
    }
    if (firstLoad) {
      children[firstIndex].scrollIntoView();
    }
  } else if (hash.length > 0) {
    let target = document.getElementById(hash);
    if (target) {
      target.classList.add('highlight');
    }
  }
  firstLoad = false;
}

addEventListener('DOMContentLoaded', highlightLinked);
addEventListener('hashchange', highlightLinked);

addEventListener('click', e => {
  if (e.target.classList.contains('ts')) {
    e.preventDefault();
    let href = e.target.href;

    if (e.shiftKey && location.hash.length > 1) {
      let hash = location.hash.substring(1);
      let firstHash;
      if (isMultiline(hash)) {
        firstHash = hash.split('-')[0];
      } else {
        firstHash = hash
      }
      let secondHash = e.target.hash.substring(1);
      let first = document.getElementById(firstHash);
      let second = document.getElementById(secondHash);
      let tbody = document.getElementById('log-tbody');
      if (first?.classList.contains('msg') && second?.classList.contains('msg')) {
        history.pushState({}, '', '#' + firstHash + '-' + secondHash);
      }
    } else {
      if (href === location.href) {
        // when clicking on currently-highlighted TS, un-highlight
        history.pushState({}, '', location.href.substring(0, location.href.indexOf('#')));
      } else {
        history.pushState({}, '', e.target.href);
      }
    }
    highlightLinked();
  }
});

addEventListener('DOMContentLoaded', () => {
  let query = document.querySelector('#query');
  let searchButton = document.querySelector('#search-submit');
  if (query == null || searchButton == null) {
    return;
  }

  searchButton.addEventListener('click', search);

  query.addEventListener('keyup', e => {
    if (e.keyCode === 13) {
      search();
    }
  });

  function search() {
    let suffix = query.value.trim() == '' ? '' : `?q=${query.value.trim()}`;
    location = `./search${suffix}`;
  }
});
