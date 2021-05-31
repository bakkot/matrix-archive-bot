# matrix-archive-bot

A bot to log matrix channels and render them as nice HTML.

## Setup

You'll need a Matrix account.

This bot assumes you want to log every channel you're in. If you want to log some subset of them, create a new account for the bot (or submit a PR fixing that).

Obtain your access token. On the Element.io web app, this is under Settings -> Help & About (yes, really). Put it in a file named `token.txt`.

`npm install` to install dependencies. Then:

`node run.js` will then download the complete history for every channel you're in, as JSON. Re-running it will only fetch new messages, so it's safe to run repeatedly.

`node render-html` will generate HTML files from any existing JSON logs. This does not hit the network.

## TODO

This bot only supports basic messages for now. Images, reactions, etc are not logged. Also, redactions show up as multiple messages.
