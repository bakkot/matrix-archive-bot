# matrix-archive-bot

A bot to log matrix channels and render them as nice HTML.

## Setup

You'll need a Matrix account.

This bot assumes you want to log every channel you're in. If you want to log some subset of them, create a new account for the bot (or submit a PR fixing that).

Obtain your access token. On the Element.io web app, this is under Settings -> Help & About (yes, really).

Create a file in this directory named `credentials.json` which has JSON with your `"userId"` (which looks like `"@bakkot-logbot:matrix.org"`) and your `"accessToken"` under keys of those names.

`npm install` to install dependencies. Then:

`node run.js` will then download the complete history for every channel you're in, as JSON. Re-running it will only fetch new messages, so it's safe to run repeatedly.

`node render-html.js` will generate HTML files from any existing JSON logs and put them in the `docs` directory, suitable for use with Github Pages. This does not hit the network.

## Regenerating rendered HTML

`render-html` will mostly avoid regenerating old pages. If you add or remove a room, however, you'll need to regenerate everything to update the indices. That's just a matter of doing `rm -rf logs/docs && node render-html.js` and waiting a little longer than usual.

## TODO

This bot only supports basic messages for now. Images, reactions, etc are not logged. Also, redactions show up as multiple messages.
