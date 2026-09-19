const $ = selector => document.querySelector(selector);
let current = null;
let busy = false;
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
function showError(error) { $('#error').textContent = error.message; $('#error').hidden = false; }
function renderMessage(message, pending = false) {
  const article = document.createElement('article');
  article.className = `message ${message.role}${pending ? ' pending' : ''}`;
  const speaker = document.createElement('span');
  speaker.className = 'speaker'; speaker.textContent = message.role === 'user' ? 'YOU' : 'TAPPD-IN';
  article.append(speaker, document.createTextNode(message.content));
  $('#messages').append(article);
}
function render() {
  $('#messages').replaceChildren();
  for (const message of current?.messages || []) renderMessage(message);
  $('#welcome').hidden = !!current?.messages.length;
}
async function refreshHistory() {
  const chats = await api('/api/chats');
  $('#history').replaceChildren();
  for (const chat of chats) {
    const button = document.createElement('button');
    button.textContent = chat.title; button.title = chat.title;
    button.setAttribute('aria-current', String(chat.id === current?.id));
    button.disabled = busy;
    button.onclick = async () => {
      if (busy) return;
      try { current = await api(`/api/chats/${chat.id}`); render(); await refreshHistory(); }
      catch (error) { showError(error); }
    };
    $('#history').append(button);
  }
  return chats;
}
function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('button, textarea')) element.disabled = value;
  $('#thinking').hidden = !value;
}
$('#new-chat').onclick = async () => {
  if (busy) return;
  current = null; render(); $('#error').hidden = true; $('#message').value = '';
  try { await refreshHistory(); } catch (error) { showError(error); }
  $('#message').focus();
};
for (const button of document.querySelectorAll('[data-prompt]')) button.onclick = () => {
  $('#message').value = button.dataset.prompt; $('#message').focus();
};
$('#message').onkeydown = event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); if (!busy) $('#composer').requestSubmit();
  }
};
$('#composer').onsubmit = async event => {
  event.preventDefault();
  const content = $('#message').value.trim();
  if (!content || busy) return;
  $('#error').hidden = true; setBusy(true);
  try {
    if (!current) current = await api('/api/chats', {});
    $('#welcome').hidden = true; renderMessage({ role: 'user', content }, true);
    $('#thinking').scrollIntoView({ block: 'nearest' });
    current = await api(`/api/chats/${current.id}/messages`, { content });
    $('#message').value = ''; render();
  } catch (error) { render(); showError(error); }
  finally {
    setBusy(false);
    try { await refreshHistory(); } catch (error) { showError(error); }
    $('#message').focus();
  }
};
async function init() {
  setBusy(true);
  try {
    const status = await api('/api/status');
    $('#mode').textContent = status.demo ? 'Demo · No AI connected' : 'OpenCode';
    $('#footnote').textContent = status.demo ? 'Demo replies only. History resets when the server stops.' : 'History saved in MongoDB. AI can make mistakes.';
    const chats = await refreshHistory();
    if (chats.length) current = await api(`/api/chats/${chats[0].id}`);
    render();
  } catch (error) { showError(error); $('#mode').textContent = 'Unavailable'; }
  finally { setBusy(false); }
}
init();
