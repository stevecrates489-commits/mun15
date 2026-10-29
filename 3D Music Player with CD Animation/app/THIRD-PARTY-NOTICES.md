# Third-party notices

## Dannify

The online section's browse layer, the search facets, the client table for
the direct stream resolver, and the shape of the screens were worked out
with **Dannify**, by Daniel Mwendwa.

<https://github.com/Riskraptor/Dannify>

Dannify is released under two licences, and the distinction matters:

- **Versions before 4.13.0 were MIT licensed.** The techniques used here —
  the direct InnerTube `/player` resolution with the app-client identities,
  the client table, the browse-layer shapes and the search parameters —
  come from that MIT-licensed code, and are used here under the MIT terms:

  > Copyright (c) 2026 Daniel Mwendwa
  >
  > Permission is hereby granted, free of charge, to any person obtaining a
  > copy of this software and associated documentation files (the
  > "Software"), to deal in the Software without restriction, including
  > without limitation the rights to use, copy, modify, merge, publish,
  > distribute, sublicense, and/or sell copies of the Software, and to permit
  > persons to whom the Software is furnished to do so, subject to the
  > following conditions:
  >
  > The above copyright notice and this permission notice shall be included
  > in all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
  > THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
  > FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  > DEALINGS IN THE SOFTWARE.

- **Version 4.13.0 and later are under a proprietary licence** that does not
  permit copying or redistribution. **No code from those versions is used
  here.** Everything in this repository derives from the MIT-licensed
  releases, and the implementations were written for this project in Rust
  and React.

The Dannify name, logo and design belong to their author and are not used.

## yt-dlp

The extractor fallback, and the download pipeline, drive **yt-dlp**.

<https://github.com/yt-dlp/yt-dlp> — released into the public domain
(the Unlicense).

`yt-dlp` is **not** bundled and **not** downloaded automatically. The user
installs it, and the app finds it on the `PATH` or wherever the settings say.
If it is not there, the direct resolver handles the streams on its own and
the settings say so.

## YouTube and Spotify

Neither provider's audio is included, and no provider's address is stored.
The app fetches what the user's own session can fetch, the way any
YouTube Music client does, and it says plainly in the settings what it is
doing and why.

## Jamendo, the Internet Archive and SomaFM

The open-licensed sources are used through their own public APIs, and each
track keeps its own licence, which the app shows. The Internet Archive's
items are licensed per item, and SomaFM's streams are live.
