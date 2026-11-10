/* The provider test page.
 *
 * One page per provider, and this one for all of them. The point is to see
 * what a provider ACTUALLY answers — the URL that was asked, the status, the
 * body — instead of a panel that says "not found" and leaves you guessing.
 *
 * Open it straight from the file system: no build, no server. */
;(function () {
  'use strict'

  var providers = window.LYRIC_PROVIDERS || {}

  function el(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  }

  function say(node, text) {
    node.textContent = text
  }

  /** run one provider and draw what it said */
  function test(id, card) {
    var provider = providers[id]
    var out = card.querySelector('.out')
    if (!provider) {
      say(out, 'no such provider')
      return
    }
    if (provider.blocked) {
      say(out, 'NOT AVAILABLE — ' + provider.blocked)
      card.classList.add('blocked')
      return
    }
    var query = window.LYRIC_QUERY()
    say(out, 'asking…')
    card.classList.remove('blocked', 'hit', 'miss')
    var started = Date.now()
    provider.run(query).then(
      function (answer) {
        var ms = Date.now() - started
        var head = '✔ ' + (answer.lines || 0) + ' lines in ' + ms + 'ms'
        if (answer.status) head += '  ·  HTTP ' + answer.status
        if (answer.picked) head += '  ·  ' + answer.picked
        card.classList.add(answer.lines ? 'hit' : 'miss')
        out.innerHTML = ''
        out.appendChild(el('div', 'head', head))
        out.appendChild(el('div', 'url', answer.url || ''))
        if (answer.note) out.appendChild(el('div', 'note', answer.note))
        if (provider.shell) {
          out.appendChild(
            el(
              'div',
              'note',
              'This provider answers with no CORS header, so a page cannot read it — ' +
                'the refusal is the browser’s rule, not the provider’s. The player ' +
                'asks it through its own shell, where it works.',
            ),
          )
        }
        var body = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)
        out.appendChild(el('pre', 'body', (body || '(empty)').slice(0, 1200)))
      },
      function (e) {
        card.classList.add('miss')
        say(out, '✖ failed — ' + (e && e.message ? e.message : String(e)))
      },
    )
  }

  function build() {
    var only = document.body.getAttribute('data-provider')
    var grid = document.getElementById('grid')
    var ids = Object.keys(providers)
    if (only) ids = ids.filter(function (id) { return id === only })

    ids.forEach(function (id) {
      var provider = providers[id]
      var card = el('div', 'card')
      card.setAttribute('data-id', id)
      card.setAttribute('data-tier', String(provider.tier))
      var head = el('div', 'row')
      head.appendChild(el('span', 'tier', 'T' + provider.tier))
      head.appendChild(el('span', 'name', provider.label))
      if (provider.shell) head.appendChild(el('span', 'tag', 'SHELL'))
      if (provider.blocked) head.appendChild(el('span', 'tag', 'UNAVAILABLE'))
      card.appendChild(head)
      card.appendChild(el('div', 'sub', provider.note || ''))

      var out = el('div', 'out')
      card.appendChild(out)

      var button = el('button', 'go', 'TEST')
      button.onclick = function () { test(id, card) }
      card.appendChild(button)

      grid.appendChild(card)
    })

    var testAll = document.getElementById('test-all')
    if (testAll) {
      testAll.onclick = function () {
        var cards = grid.querySelectorAll('.card')
        for (var i = 0; i < cards.length; i++) test(cards[i].getAttribute('data-id'), cards[i])
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build)
  } else {
    build()
  }
})()
