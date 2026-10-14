/** Mobile page served by the desktop. No remote assets. */
export const PHONE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0c0c0c">
<meta name="robots" content="noindex">
<title>TrueDeck</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0c0c0c;
    --bar: #141414;
    --card: #1a1a1a;
    --line: #2a2a2a;
    --text: #e8e8e8;
    --muted: #8a8a8a;
    --accent: #f0a050;
    --ok: #7fd99a;
    --danger: #f07178;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); }
  body {
    font: 16px/1.4 "Segoe UI", system-ui, sans-serif;
    min-height: 100dvh;
  }
  button, input, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; }
  #boot, #gate, #app { min-height: 100dvh; }
  #boot, #gate {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 28px 22px calc(28px + env(safe-area-inset-bottom));
    gap: 14px;
    max-width: 440px;
    margin: 0 auto;
  }
  h1 {
    margin: 0;
    font-size: 13px;
    letter-spacing: 0.16em;
    font-weight: 700;
  }
  p { margin: 0; color: var(--muted); }
  .err { color: var(--danger); min-height: 1.2em; }
  input, textarea {
    width: 100%;
    border: 1px solid var(--line);
    background: var(--card);
    border-radius: 12px;
    padding: 14px 16px;
    font-size: 16px;
  }
  input:focus, textarea:focus { outline: 2px solid var(--accent); border-color: transparent; }
  #code { letter-spacing: 0.18em; text-align: center; font-weight: 700; text-transform: uppercase; }
  button.go, #send {
    border: 0;
    border-radius: 12px;
    background: var(--accent);
    color: #1a1208;
    font-weight: 700;
    padding: 14px 18px;
    touch-action: manipulation;
  }
  button.go:disabled, #send:disabled { opacity: 0.45; }
  #app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    padding-top: env(safe-area-inset-top);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 8px;
  }
  .live { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); display: inline-block; }
  .dot.ok { background: var(--ok); }
  #sessions {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 4px 16px 10px;
  }
  #sessions .empty { font-size: 14px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--line);
    background: var(--card);
    border-radius: 999px;
    padding: 8px 12px;
    white-space: nowrap;
    color: var(--text);
    touch-action: manipulation;
  }
  .chip.on { border-color: var(--accent); }
  .chip i { width: 8px; height: 8px; border-radius: 50%; display: block; }
  .chip .proj { color: var(--muted); font-size: 12px; }
  #target { padding: 0 16px 8px; color: var(--muted); font-size: 13px; }
  #screen {
    flex: 1;
    margin: 0 12px;
    padding: 12px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    background: #101010;
    border: 1px solid var(--line);
    border-radius: 12px;
    font: 12px/1.45 ui-monospace, Consolas, monospace;
    color: #d5d5d5;
  }
  #sent { padding: 8px 16px 0; display: flex; flex-direction: column; gap: 4px; }
  #sent p {
    margin: 0;
    font-size: 13px;
    color: var(--text);
    background: var(--card);
    border-radius: 10px;
    padding: 8px 10px;
  }
  #composer {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
  }
  textarea { min-height: 52px; max-height: 140px; resize: none; flex: 1; }
  #send { flex-shrink: 0; }
  #send-note { padding: 0 16px 8px; font-size: 13px; color: var(--accent); min-height: 0; }
</style>
</head>
<body>
<p id="boot">Connecting to this PC…</p>
<div id="gate" hidden>
  <h1>TRUEDECK</h1>
  <p>Enter the code shown on the desktop.</p>
  <form id="login">
    <input id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="ABCD-2345" aria-label="Desktop code">
    <p class="err" id="gate-err"></p>
    <button class="go" type="submit">Open</button>
  </form>
</div>
<div id="app" hidden>
  <header>
    <h1>TRUEDECK</h1>
    <span class="live"><i class="dot" id="dot"></i> desktop</span>
  </header>
  <div id="sessions"></div>
  <div id="target"></div>
  <pre id="screen"></pre>
  <div id="sent"></div>
  <p id="send-note"></p>
  <form id="composer">
    <textarea id="prompt" rows="2" placeholder="Tell the desktop agent what to do" aria-label="Prompt"></textarea>
    <button id="send" type="submit">Send</button>
  </form>
</div>
<script>
(function () {
  var selected = ''
  var sending = false
  var sessionSig = ''
  var sentSig = ''
  try { selected = localStorage.getItem('td-session') || '' } catch (e) { selected = '' }

  function byId(id) { return document.getElementById(id) }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild) }
  function safeColor(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#f0a050' }
  function pick(sessions, current) {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].id === current) return current
    for (var j = 0; j < sessions.length; j++) if (sessions[j].agentId === 'grok') return sessions[j].id
    return sessions.length ? sessions[0].id : ''
  }
  function showBoot(msg) {
    byId('boot').hidden = false
    byId('boot').textContent = msg
    byId('gate').hidden = true
    byId('app').hidden = true
  }
  function showGate() {
    byId('boot').hidden = true
    byId('gate').hidden = false
    byId('app').hidden = true
  }
  function renderSessions(sessions) {
    var box = byId('sessions')
    clear(box)
    if (!sessions.length) {
      var p = document.createElement('p')
      p.className = 'empty'
      p.textContent = 'Open an agent on the desktop, then it shows up here.'
      box.appendChild(p)
      return
    }
    sessions.forEach(function (s) {
      var b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip' + (s.id === selected ? ' on' : '')
      b.setAttribute('data-id', s.id)
      var dot = document.createElement('i')
      dot.style.background = safeColor(s.color)
      var name = document.createElement('span')
      name.textContent = s.agentName || s.agentId || 'Agent'
      var proj = document.createElement('span')
      proj.className = 'proj'
      proj.textContent = s.project || ''
      b.appendChild(dot)
      b.appendChild(name)
      if (s.project) b.appendChild(proj)
      box.appendChild(b)
    })
  }
  function renderSent(lines) {
    var box = byId('sent')
    clear(box)
    var list = lines || []
    list.slice(-3).forEach(function (line) {
      var p = document.createElement('p')
      p.textContent = line
      box.appendChild(p)
    })
  }
  function showApp(state) {
    byId('boot').hidden = true
    byId('gate').hidden = true
    byId('app').hidden = false
    var sessions = state.sessions || []
    selected = pick(sessions, selected)
    try { localStorage.setItem('td-session', selected) } catch (e) {}
    var nextSig = sessions.map(function (s) {
      return s.id + '|' + (s.agentName || '') + '|' + (s.project || '') + '|' + (s.id === selected ? '1' : '0')
    }).join(',')
    if (nextSig !== sessionSig) {
      sessionSig = nextSig
      renderSessions(sessions)
    }
    var current = null
    for (var i = 0; i < sessions.length; i++) if (sessions[i].id === selected) current = sessions[i]
    byId('target').textContent = current
      ? ('Sending to ' + (current.agentName || 'agent') + (current.project ? ' · ' + current.project : ''))
      : 'Open an agent on the desktop to send a prompt.'
    var screen = byId('screen')
    var next = (state.frames && state.frames[selected]) || 'Waiting for output from this session.'
    if (screen.textContent !== next) {
      var nearBottom = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 48
      screen.textContent = next
      if (nearBottom) screen.scrollTop = screen.scrollHeight
    }
    var sentLines = (state.sent && state.sent[selected]) || []
    var nextSent = sentLines.join(String.fromCharCode(10))
    if (nextSent !== sentSig) {
      sentSig = nextSent
      renderSent(sentLines)
    }
    byId('dot').className = 'dot ok'
    byId('send').disabled = sending || !current
  }
  function load() {
    return fetch('/api/state', { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { showGate(); return null }
      if (!r.ok) throw new Error('status')
      return r.json()
    }).then(function (state) {
      if (state) showApp(state)
    })
  }
  byId('login').addEventListener('submit', function (ev) {
    ev.preventDefault()
    var err = byId('gate-err')
    err.textContent = ''
    fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: byId('code').value })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'That code did not match.') })
      return load()
    }).catch(function (e) {
      err.textContent = e.message || 'That code did not match.'
    })
  })
  byId('sessions').addEventListener('click', function (ev) {
    var node = ev.target
    while (node && node !== byId('sessions') && node.tagName !== 'BUTTON') node = node.parentNode
    if (!node || node.tagName !== 'BUTTON') return
    selected = node.getAttribute('data-id') || ''
    load()
  })
  byId('composer').addEventListener('submit', function (ev) {
    ev.preventDefault()
    var box = byId('prompt')
    var text = box.value.trim()
    if (!text || !selected || sending) return
    sending = true
    byId('send').disabled = true
    fetch('/api/prompt', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: selected, text: text })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'Send failed') })
      box.value = ''
      byId('send-note').textContent = 'Sent. The desktop session has the prompt.'
      return load()
    }).catch(function (e) {
      byId('send-note').textContent = e.message || 'Send failed'
    }).then(function () {
      sending = false
      byId('send').disabled = !selected
    })
  })
  setInterval(function () {
    if (document.hidden) return
    if (byId('app').hidden) return
    load().catch(function () { byId('dot').className = 'dot' })
  }, 1200)
  load().catch(function () {
    showBoot('The desktop did not answer. Leave TrueDeck open on the PC, then reload.')
  })
})()
</script>
</body>
</html>
`
