/* The lyric providers, as plain browser JavaScript.
 *
 * This is a copy of the app's matching logic (features/lyrics/providers.ts)
 * written out for the browser, so each provider can be tested on its own —
 * one page per provider, and one page with all of them.
 *
 * Open it straight from the file system: no build, no server.
 *
 * The one thing it cannot do is what the app's shell does. NetEase, KuGou and
 * QQ answer with no `Access-Control-Allow-Origin` header, so a page cannot
 * read them — the browser refuses before the answer is even read. Those are
 * marked SHELL here, and the page says so plainly: a refusal on this page
 * says nothing about whether the provider works in the player. */
;(function () {
  'use strict'

  /** the tags that name the SAME recording in a different way */
  var CLUTTER = [
    /\(feat\.[^)]*\)|\[feat\.[^\]]*\]/gi,
    /\bft\.\s[^)\]]*/gi,
    /\(official[^)]*\)|\[official[^\]]*\]/gi,
    /\(lyric[^)]*\)|\[lyric[^\]]*\]/gi,
    /\(visualizer[^)]*\)|\[visualizer[^\]]*\]/gi,
    /\(audio[^)]*\)|\[audio[^\]]*\]/gi,
    /\(remaster(ed)?[^)]*\)|\[remaster(ed)?[^\]]*\]/gi,
    /[-–—]\s*remaster(ed)?\s*\d{0,4}\s*$/gi,
    /\(from "[^"]*"\)/gi,
    /\(radio edit\)|\[radio edit\]/gi,
    /\(single version\)|\[single version\]/gi,
    /\(album version\)|\[album version\]/gi,
    /\(explicit\)|\[explicit\]/gi,
    /\(bonus track[^)]*\)|\[bonus track[^\]]*\]/gi,
    /\(deluxe[^)]*\)|\[deluxe[^\]]*\]/gi,
    /\(\s*\)|\[\s*\]/g,
    /^\s*[-–—]\s*|\s*[-–—]\s*$/g,
  ]

  /** every stage of the stripping is kept: one provider knows the full
      string, another knows only the song */
  function titleVariants(raw) {
    var list = []
    var push = function (value) {
      var v = value.replace(/\s+/g, ' ').trim()
      if (v && list.indexOf(v) === -1) list.push(v)
    }
    push(raw)
    var current = raw
    for (var i = 0; i < CLUTTER.length; i++) {
      var next = current.replace(CLUTTER[i], ' ')
      if (next !== current) {
        current = next
        push(current)
      }
    }
    return list
  }

  function artistCandidates(raw) {
    var list = []
    var push = function (v) {
      var t = (v || '').trim()
      if (t && list.indexOf(t) === -1) list.push(t)
    }
    push(raw)
    push(raw.split(/[&,;]/)[0] || '')
    push(raw.replace(/\s*[([]?\s*\b(feat|ft|featuring)\b\.?\s[^)\]]*[)\]]?/gi, ''))
    return list
  }

  function normalizeName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\b(the|a|an)\b/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function titleMatches(candidate, wanted) {
    var a = normalizeName(candidate)
    var b = normalizeName(wanted)
    if (!a || !b) return false
    return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1
  }

  /** the length RANKS a candidate; it does not veto it */
  function pickCandidate(candidates, query, titles, artists) {
    var usable = candidates.filter(function (c) {
      if (!query.durationMs || !c.durationMs) return true
      var shorter = Math.min(c.durationMs, query.durationMs)
      var longer = Math.max(c.durationMs, query.durationMs)
      return shorter / longer >= 0.5
    })
    if (!usable.length) return null
    var best = null
    usable.forEach(function (song) {
      var score = 0
      var named = false
      if (titles.some(function (t) { return titleMatches(song.title, t) })) { score += 10; named = true }
      else if (titles.some(function (t) { return normalizeName(song.title).indexOf(normalizeName(t)) !== -1 })) { score += 4; named = true }
      /* a candidate whose NAME does not match is a different song */
      if (!named) return
      if (artists.some(function (a) { return titleMatches(song.artist, a) })) score += 5
      if (query.durationMs && song.durationMs) {
        var off = Math.abs(song.durationMs - query.durationMs)
        if (off <= 2000) score += 5
        else score -= Math.min(3, Math.floor(off / 10000))
      }
      if (!best || score > best.score) best = { song: song, score: score }
    })
    if (!best) return null
    return best.score > 0 ? best.song : null
  }

  /** how many lyric lines a blob of LRC, TTML or plain text holds */
  function countLines(text) {
    if (!text) return 0
    var lrc = (text.match(/^\[\d{2}:\d{2}[.\d]*\]/gm) || []).length
    var ttml = (text.match(/<p[ >]/g) || []).length
    if (lrc || ttml) return Math.max(lrc, ttml)
    /* plain text has no timestamps — every line that says something counts */
    return text.split(/\r?\n/).filter(function (l) { return l.trim() }).length
  }

  /** base64 → text, the way the app decodes it */
  function decodeBase64(value) {
    try {
      var binary = atob(value)
      var bytes = new Uint8Array(binary.length)
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return new TextDecoder('utf-8').decode(bytes)
    } catch (e) {
      return ''
    }
  }

  /** fetch a URL and report what happened, whatever happened */
  function get(url, referer, timeoutMs) {
    var headers = {}
    if (referer) headers['Referer'] = referer
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, timeoutMs || 12000)
    return fetch(url, { headers: headers, redirect: 'follow', signal: controller.signal })
      .then(function (response) {
        return response.text().then(function (body) {
          clearTimeout(timer)
          return { ok: response.ok, status: response.status, body: body }
        })
      })
      .catch(function (e) {
        clearTimeout(timer)
        var message = String(e && e.message ? e.message : e)
        var blocked = /Failed to fetch|NetworkError|load failed/i.test(message)
        return {
          ok: false,
          status: 0,
          body: '',
          error: blocked
            ? 'the browser refused to read this — it has no CORS header'
            : message,
          blocked: blocked,
        }
      })
  }

  /**
   * Fetch and parse, and keep the status whatever happens.
   *
   * The status is the point: a provider that answers 404 has told us it has
   * no such song, and a provider the browser refused to read has told us
   * something else entirely. The two must not look the same.
   */
  function getJson(url, referer, timeoutMs) {
    return get(url, referer, timeoutMs).then(function (answer) {
      var parsed = null
      if (answer.ok && answer.body) {
        try {
          parsed = JSON.parse(answer.body)
        } catch (e) {
          parsed = null
        }
      }
      return {
        json: parsed,
        status: answer.status,
        ok: answer.ok,
        error: answer.error,
        blocked: answer.blocked,
        raw: answer.body,
      }
    })
  }

  /** the one sentence that says what went wrong */
  function why(answer, what) {
    if (answer.error) return answer.error
    if (answer.status === 404) return 'the service answered 404 — it has no such song'
    if (answer.status === 429) return 'the service is rate-limiting this machine'
    if (answer.status >= 500) return 'the service answered ' + answer.status + ' — it is broken'
    if (!answer.json) return (what || 'the answer could not be read') + ' (HTTP ' + answer.status + ')'
    return ''
  }

  /* ------------------------------------------------------------------ *
   * the providers
   * ------------------------------------------------------------------ */

  var NETEASE = 'https://music.163.com'
  var KUGOU_SEARCH = 'https://mobileservice.kugou.com/api/v3/search/song'
  var KUGOU_LYRICS = 'https://krcs.kugou.com/search'
  var KUGOU_DOWNLOAD = 'https://lyrics.kugou.com/download'
  var KPOE_SERVERS = [
    'https://lyricsplus.binimum.org',
    'https://lyricsplus-seven.vercel.app',
    'https://lyricsplus.prjktla.workers.dev',
    'https://lyrics-plus-backend.vercel.app',
  ]
  var UNISON = 'https://unison.boidu.dev/lyrics'
  var LRC_RED_MATCH = 'https://lrc.red/match.json'
  var LRC_RED_TTML = 'https://lrc.red/s'
  var GENIUS = 'https://fetch-genius.samidy.workers.dev/'
  var LRCLIB = 'https://lrclib.net/api/search'
  var LYRICS_OVH = 'https://api.lyrics.ovh/v1'

  var PROVIDERS = {}

  /* ---- Unison ---- */
  PROVIDERS.unison = {
    label: 'Unison',
    tier: 1,
    shell: false,
    note: 'Apple Music syllable timing, as TTML',
    run: function (q) {
      var params = new URLSearchParams({ song: q.titles[0], artist: q.artists[0] })
      if (q.durationMs) params.set('duration', String(Math.round(q.durationMs / 1000)))
      var url = UNISON + '?' + params.toString()
      return getJson(url).then(function (answer) {
        var found = answer.json || {}
        var ttml = (found.data && found.data.lyrics) || ''
        return {
          url: url,
          status: answer.status,
          body: answer.json || answer.raw,
          lines: countLines(ttml),
          note: ttml ? '' : why(answer, 'the service had nothing for this song'),
        }
      })
    },
  }

  /* ---- NetEase ---- */
  PROVIDERS.netease = {
    label: 'NetEase Cloud Music',
    tier: 1,
    shell: true,
    note: 'Largest open catalogue, millisecond timing',
    run: function (q) {
      var url =
        NETEASE +
        '/api/search/get?s=' +
        encodeURIComponent(q.titles[0]) +
        '&type=1&offset=0&total=true&limit=10'
      return getJson(url, NETEASE + '/').then(function (answer) {
        var songs = (answer.json && answer.json.result && answer.json.result.songs) || []
        if (!songs.length) {
          return {
            url: url,
            status: answer.status,
            body: answer.json || answer.raw,
            lines: 0,
            note: why(answer, 'the search answered with no songs'),
          }
        }
        var candidates = songs.map(function (s) {
          return {
            title: String(s.name || ''),
            artist: Array.isArray(s.artists) ? String((s.artists[0] || {}).name || '') : '',
            durationMs: Number(s.duration || 0),
          }
        })
        var song = pickCandidate(candidates, q, q.titles, q.artists)
        if (!song) {
          return {
            url: url,
            status: answer.status,
            body: answer.json,
            lines: 0,
            note: 'the catalogue had ' + songs.length + ' songs and none of them matched',
          }
        }
        var match = songs.find(function (s) {
          return String(s.id || '') !== '' && Number(s.duration || 0) === song.durationMs
        })
        var lyricUrl =
          NETEASE +
          '/api/song/lyric?id=' +
          match.id +
          '&lv=1&kv=1&tv=-1&rv=-1&cp=false&lrc_t=0&nocomment=1&fmt=json'
        return getJson(lyricUrl, NETEASE + '/').then(function (lyric) {
          var rec = lyric.json || {}
          var plain = (rec.lrc && rec.lrc.lyric) || ''
          var words = (rec.yrc && rec.yrc.lyric) || ''
          return {
            url: lyricUrl,
            status: lyric.status,
            body: lyric.json || lyric.raw,
            lines: countLines(plain || words),
            picked: song.title + ' · ' + Math.round(song.durationMs / 1000) + 's',
            note: plain || words ? '' : why(lyric, 'the song was found but it has no lyric'),
          }
        })
      })
    },
  }

  /* ---- QQ Music ---- */
  PROVIDERS.qq = {
    label: 'QQ Music',
    tier: 1,
    shell: true,
    note: 'Karaoke timing, strong on Asian catalogues',
    run: function (q) {
      var url =
        'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=json&format=json&g_tk=5381&q=' +
        encodeURIComponent(q.titles[0] + ' ' + q.artists[0])
      return getJson(url).then(function (answer) {
        var list = (answer.json && answer.json.data && answer.json.data.song && answer.json.data.song.list) || []
        return {
          url: url,
          status: answer.status,
          body: answer.json || answer.raw,
          lines: 0,
          note: list.length
            ? list.length + ' candidates found — the lyric step is not implemented in this page'
            : why(answer, 'the search answered with nothing'),
        }
      })
    },
  }

  /* ---- KuGou ---- */
  PROVIDERS.kugou = {
    label: 'KuGou Music',
    tier: 1,
    shell: true,
    note: 'Mobile karaoke format, wide reach',
    run: function (q) {
      var keyword = q.titles[0] + ' ' + q.artists[0]
      var url =
        KUGOU_SEARCH +
        '?format=json&keyword=' +
        encodeURIComponent(keyword) +
        '&page=1&pagesize=10&showtype=1'
      return getJson(url).then(function (answer) {
        var info = (answer.json && answer.json.data && answer.json.data.info) || []
        if (!info.length) {
          return {
            url: url,
            status: answer.status,
            body: answer.json || answer.raw,
            lines: 0,
            note: why(answer, 'the search answered with no songs'),
          }
        }
        var candidates = info.map(function (s) {
          return {
            title: String(s.songname || ''),
            artist: String(s.singername || ''),
            durationMs: Number(s.duration || 0) * 1000,
          }
        })
        var song = pickCandidate(candidates, q, q.titles, q.artists)
        if (!song) {
          return {
            url: url,
            status: answer.status,
            body: answer.json,
            lines: 0,
            note: 'the catalogue had ' + info.length + ' songs and none of them matched',
          }
        }
        var match = info.find(function (s) {
          return (
            String(s.hash || '') !== '' &&
            String(s.songname || '') === song.title &&
            Number(s.duration || 0) * 1000 === song.durationMs
          )
        })
        /* the hash ALONE — with album_audio_id the service answers with the
           lyrics of a different track entirely */
        var lyricUrl =
          KUGOU_LYRICS + '?ver=1&man=yes&client=pc&hash=' + encodeURIComponent(String(match.hash))
        return getJson(lyricUrl).then(function (listed) {
          var list = (listed.json && listed.json.candidates) || []
          if (!list.length) {
            return {
              url: lyricUrl,
              status: listed.status,
              body: listed.json || listed.raw,
              lines: 0,
              note: why(listed, 'no lyric candidates for that song'),
            }
          }
          var candidate = list[0]
          var downloadUrl =
            KUGOU_DOWNLOAD +
            '?ver=1&client=pc&fmt=lrc&charset=utf8&accesskey=' +
            encodeURIComponent(String(candidate.accesskey || '')) +
            '&id=' +
            encodeURIComponent(String(candidate.id || '')) +
            '&contentfmt=1'
          return getJson(downloadUrl).then(function (downloaded) {
            var lrc = decodeBase64(String((downloaded.json || {}).content || ''))
            return {
              url: downloadUrl,
              status: downloaded.status,
              body: { lyric: String(candidate.song || ''), lrc: lrc },
              lines: countLines(lrc),
              picked: String(candidate.song || ''),
              note: lrc ? '' : why(downloaded, 'the lyric came back empty'),
            }
          })
        })
      })
    },
  }

  /* ---- the LyricsPlus gateway and the two PaxSenix views of it ---- */
  function kpoeProvider(label, tier, source, note) {
    return {
      label: label,
      tier: tier,
      shell: true,
      note: note,
      run: function (q) {
        var sources = source.split(',').map(function (s) { return s.trim() }).filter(Boolean)
        var attempts = [source].concat(sources.slice(0, 4))
        var urls = []
        for (var i = 0; i < attempts.length; i++) {
          var params = new URLSearchParams({
            title: q.titles[0],
            artist: q.artists[0],
            source: attempts[i],
          })
          if (q.durationMs) params.set('duration', String(Math.round(q.durationMs / 1000)))
          for (var s = 0; s < KPOE_SERVERS.length; s++) {
            urls.push(KPOE_SERVERS[s] + '/v2/lyrics/get?' + params.toString())
          }
        }
        /* every mirror, every catalogue — all at once */
        return Promise.all(urls.map(function (url) { return getJson(url, null, 8000) })).then(function (answers) {
          for (var i = 0; i < answers.length; i++) {
            var found = answers[i].json
            if (!found || found.error) continue
            var entries = found.lyrics
            if (!Array.isArray(entries) || !entries.length) continue
            return {
              url: urls[i],
              status: answers[i].status,
              body: found,
              lines: entries.length,
              picked: found.type || '',
            }
          }
          var last = answers[answers.length - 1]
          var first = answers[0]
          return {
            url: urls[0],
            status: first.status,
            body: first.json || first.raw,
            lines: 0,
            note:
              'the gateway had nothing for this song (' +
              attempts.length +
              ' catalogues, ' +
              KPOE_SERVERS.length +
              ' mirrors). Last answer: ' +
              why(last, 'nothing') +
              (last.json && last.json.error ? ' — ' + JSON.stringify(last.json.error) : ''),
          }
        })
      },
    }
  }

  PROVIDERS.lyricsplus = kpoeProvider(
    'LyricsPlus',
    1,
    'apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word',
    'Aggregated Apple / Spotify word cache'
  )
  PROVIDERS['paxsenix-word'] = kpoeProvider(
    'PaxSenix · Musixmatch / Spotify',
    1,
    'musixmatch-word,musixmatch,spotify',
    'Word offsets through the LyricsPlus gateway'
  )
  PROVIDERS['paxsenix-line'] = kpoeProvider(
    'PaxSenix · Spotify',
    2,
    'spotify',
    'Line-level scrape of official releases'
  )

  /* ---- LRCLIB ---- */
  PROVIDERS.lrclib = {
    label: 'LRCLIB',
    tier: 2,
    shell: false,
    note: 'Open REST API, the fastest and cleanest',
    run: function (q) {
      var url = LRCLIB + '?q=' + encodeURIComponent(q.artists[0] + ' ' + q.titles[0])
      return getJson(url).then(function (answer) {
        var list = Array.isArray(answer.json) ? answer.json : []
        if (!list.length) {
          return {
            url: url,
            status: answer.status,
            body: answer.json || answer.raw,
            lines: 0,
            note: why(answer, 'the archive had nothing for that name'),
          }
        }
        var candidates = list.map(function (s) {
          return {
            title: String(s.trackName || ''),
            artist: String(s.artistName || ''),
            durationMs: Number(s.duration || 0) * 1000,
          }
        })
        var song = pickCandidate(candidates, q, q.titles, q.artists)
        if (!song) {
          return {
            url: url,
            status: answer.status,
            body: answer.json,
            lines: 0,
            note: 'the archive had ' + list.length + ' recordings and none of them matched',
          }
        }
        var match = list.find(function (s) {
          return Number(s.duration || 0) * 1000 === song.durationMs
        })
        var text = String((match && match.syncedLyrics) || (match && match.plainLyrics) || '')
        return {
          url: url,
          status: answer.status,
          body: answer.json,
          lines: countLines(text),
          picked: song.title + ' · ' + Math.round(song.durationMs / 1000) + 's',
        }
      })
    },
  }

  /* ---- lrc.red ---- */
  PROVIDERS['lrc-red'] = {
    label: 'Megalobiz · lrc.red',
    tier: 2,
    shell: false,
    note: 'Community archive of timed lyrics',
    run: function (q) {
      var params = new URLSearchParams({ track: q.titles[0], artist: q.artists[0] })
      if (q.durationMs) params.set('duration', String(Math.round(q.durationMs / 1000)))
      var url = LRC_RED_MATCH + '?' + params.toString()
      return getJson(url).then(function (answer) {
        var hits = (answer.json && answer.json.hits) || []
        if (!hits.length) {
          return {
            url: url,
            status: answer.status,
            body: answer.json || answer.raw,
            lines: 0,
            note: why(answer, 'the archive had no match for that name'),
          }
        }
        var isrc = String(hits[0].isrc || '')
        var ttmlUrl = LRC_RED_TTML + '/' + encodeURIComponent(isrc) + '.ttml'
        return get(ttmlUrl).then(function (ttml) {
          return {
            url: ttmlUrl,
            status: ttml.status,
            body: ttml.body.slice(0, 4000),
            lines: countLines(ttml.body),
            picked: isrc,
            note: ttml.ok ? '' : why({ status: ttml.status, error: ttml.error }, 'the lyric could not be read'),
          }
        })
      })
    },
  }

  /* ---- Genius ---- */
  PROVIDERS.genius = {
    label: 'Genius',
    tier: 3,
    shell: false,
    note: 'The largest plain-text archive in the world',
    run: function (q) {
      var params = new URLSearchParams({ title: q.titles[0], artist: q.artists[0] })
      var url = GENIUS + '?' + params.toString()
      return getJson(url).then(function (answer) {
        var text = String((answer.json && answer.json.lyrics) || '')
        return {
          url: url,
          status: answer.status,
          body: answer.json || answer.raw,
          lines: countLines(text),
          note: text ? '' : why(answer, 'the worker had nothing for this track'),
        }
      })
    },
  }

  /* ---- Lyrics.ovh ---- */
  PROVIDERS['lyrics-ovh'] = {
    label: 'Lyrics.ovh',
    tier: 3,
    shell: false,
    note: 'Zero-key public API, plain text',
    run: function (q) {
      var url = LYRICS_OVH + '/' + encodeURIComponent(q.artists[0]) + '/' + encodeURIComponent(q.titles[0])
      return getJson(url).then(function (answer) {
        var text = String((answer.json && answer.json.lyrics) || '')
        return {
          url: url,
          status: answer.status,
          body: answer.json || answer.raw,
          lines: countLines(text),
          note: text ? '' : why(answer, 'the archive had nothing for this title'),
        }
      })
    },
  }

  /* ---- the ones this build cannot reach ---- */
  PROVIDERS.youtube = {
    label: 'YouTube Music · Captions',
    tier: 2,
    shell: false,
    note: 'Official line sync and subtitles',
    blocked: 'no caption support exists in this build',
  }
  PROVIDERS.azlyrics = {
    label: 'AZLyrics',
    tier: 3,
    shell: false,
    note: 'High coverage for older and obscure tracks',
    blocked: 'the site answers a browser with a challenge',
  }
  PROVIDERS['musixmatch-web'] = {
    label: 'Musixmatch Web',
    tier: 3,
    shell: false,
    note: 'The site itself, as a last resort',
    blocked: 'the site answers a browser with a challenge',
  }

  window.LYRIC_PROVIDERS = PROVIDERS
  window.LYRIC_HELP = {
    titleVariants: titleVariants,
    artistCandidates: artistCandidates,
    pickCandidate: pickCandidate,
    countLines: countLines,
  }

  /** read the song out of the page's own inputs */
  window.LYRIC_QUERY = function () {
    var title = (document.getElementById('title') || {}).value || 'One More Time'
    var artist = (document.getElementById('artist') || {}).value || 'Daft Punk'
    var seconds = Number((document.getElementById('duration') || {}).value || 320)
    return {
      title: title,
      artist: artist,
      durationMs: seconds > 0 ? seconds * 1000 : 0,
      titles: titleVariants(title),
      artists: artistCandidates(artist),
    }
  }
})()
