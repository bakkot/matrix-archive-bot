# matrix-archive-bot

A bot to log matrix channels and render them as nice HTML.

Currently does not follow channels; you will need to re-run it whenever you want to refresh the logs. It will make an effort to avoid doing unnecessary work on subsequent runs.

## Setup

You'll need a Matrix account.

This bot assumes you want to log every channel you're in. If you want to log some subset of them, create a new account for the bot (or submit a PR fixing that).

Obtain your access token. On the Element.io web app, this is under Settings -> Help & About (yes, really).

Create a file in this directory named `credentials.json` which has JSON with your `"userId"` (which looks like `"@bakkot-logbot:matrix.org"`) and your `"accessToken"` under keys of those names.

`npm install` to install dependencies. Then:

`npm run collect` will then download the complete history for every channel you're in, as JSON. Re-running it will only fetch new messages, so it's safe to run repeatedly.

`npm run render` will generate HTML files from any existing JSON logs and put them in the `docs` directory, suitable for use with Github Pages. This does not hit the network.

## Regenerating rendered HTML

`render-html` will mostly avoid regenerating old pages. If you add or remove a room, however, you'll need to regenerate everything to update the indices. That's just a matter of doing `rm -rf logs/docs && node render-html.js` and waiting a little longer than usual.

## Search

A puzzle: how do you support full-text search for a site hosted on a static fileserver, like Github Pages?

Answer: that sounds impossible.

OK, here's another puzzle: how do you support _querying a SQL database_ for a site hosted on a static fileserver?

Answer: that sounds even more impossible.

Turns out, @phiresky has [solved the latter problem](https://phiresky.github.io/blog/2021/hosting-sqlite-databases-on-github-pages/). It's an absolute marvel. Go read that post. The underlying trick is [HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests), which your server must support. (Github Pages does.)

So we get full-text search by reducing the problem to querying a SQL database with [FTS5](https://www.sqlite.org/fts5.html). Along with the HTML output, we build and host one SQL database per channel, split into one-megabyte chunks (to make the git diffs more manageable).

The databases are intialized by running `node scripts/make-dbs.js`. After that, `npm run render` will keep it up to date.

The first time you build this, or if you modify `scripts/search.js`, you'll need to run `npm build-search-script`. That uses webpack, which is pretty slow. If I could figure out how to get esbuild to include wasm resources, I'd use esbuild instead and have it run as part of `render`, but as it is I don't want to add the overhead required to run webpack to rebuild a script which never changes.

The `sqlite`, `sqlite3`, and `sql.js-httpvfs` dependencies are only used for search. You can skip them if you're not going to make the pages searchable.

Note that I'm using [a fork](https://github.com/phiresky/sql.js-httpvfs/pull/20) of the original `sql.js-httpvfs` which has support for bailing out when you've requested too much data. The tarball for the fork is committed to this repo.

## TODO

This bot only supports basic messages for now. Images, reactions, etc are not logged. Also, redactions show up as multiple messages.
