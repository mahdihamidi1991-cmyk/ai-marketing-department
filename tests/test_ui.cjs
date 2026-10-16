'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const DepartmentMarkdown = require('../static/format.js');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');

// This is a small DOM boundary, not a copy of the application. It records the
// application’s actual rendered HTML, disabled states and registered handlers.
function harness() {
 const requests = [], elements = new Map(), listeners = new Map();
 const effects = {reloads:0, intervals:[]};
 let document;
 function element(id, tag = 'div') {
  const attributes = new Map(), handlers = new Map(), classes = new Set();
  return {
   id, tagName:tag.toUpperCase(), dataset:{}, value:'', hidden:false, disabled:false,
   innerHTML:'', textContent:'', isConnected:true, open:false,
   classList:{toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); }},
   setAttribute(name, value) { attributes.set(name, String(value)); },
   removeAttribute(name) { attributes.delete(name); },
   hasAttribute(name) { return attributes.has(name); },
   getAttribute(name) { return attributes.get(name) ?? null; },
   getClientRects() { return this.hidden ? [] : [{}]; },
   closest(selector) { return selector === 'button' && this.tagName === 'BUTTON' ? this : null; },
   querySelector(selector) { return document.querySelector('#' + id + ' ' + selector); },
   addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
   dispatch(type, extra = {}) {
    const event = {target:this, preventDefault() {}, ...extra};
    return Promise.all((handlers.get(type) || []).map(fn => fn(event)));
   },
   focus() { document.activeElement = this; }, scrollIntoView() {}, reset() {}
  };
 }
 function get(selector) {
  if (!elements.has(selector)) {
   const tag = selector === '#send' || selector === '#new-chat' || selector === '#reconnect' || selector === '#export' || selector.includes('button[') ? 'button' : 'div';
   elements.set(selector, element(selector.replace(/^#/, ''), tag));
  }
  return elements.get(selector);
 }
 const views = ['chat','team','context','routines','settings'].map(view => {
  const el = get('#view-' + view); el.hidden = view !== 'chat'; return el;
 });
 const nav = ['chat','team','context','routines','settings'].map(view => {
  const el = element('nav-' + view, 'button'); el.dataset.view = view; return el;
 });
 const contextSubmit = get('#context-form button[type="submit"]'), routineSubmit = get('#routine-form button[type="submit"]');
 document = {
  body:element('body'), querySelector:get,
  querySelectorAll(selector) {
   if (selector === '.view') return views;
   if (selector === '.nav-item') return nav;
   if (selector === '#context-form button[type="submit"], #routine-form button[type="submit"]') return [contextSubmit, routineSubmit];
   return [];
  },
  addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); }
 };
 document.activeElement = document.body; document.body.dataset.view = 'chat'; get('#mode').value = 'demo';
 const context = vm.createContext({
  document, DepartmentMarkdown, URL, Blob,
  window:{scrollTo() {}}, location:{reload() { effects.reloads += 1; }}, matchMedia:() => ({matches:false}), confirm:() => false,
  setTimeout:() => 1, clearTimeout() {}, setInterval(fn, delay) {effects.intervals.push({fn,delay});return 1;},
  fetch(url, options = {}) {
   return new Promise((resolve, reject) => requests.push({url, options, resolve, reject, settled:false}));
  }
 });
 vm.runInContext(source, context, {filename:'app.js'});
 return {
  requests, get, effects,
  evaluate(code) { return vm.runInContext(code, context); },
  snapshot(code) { return JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', context)); },
  pending(url) { return requests.filter(request => request.url === url && !request.settled); },
  respond(url, data, status = 200) {
   const request = this.pending(url)[0]; assert.ok(request, 'Expected pending request for ' + url);
   request.settled = true; request.resolve({ok:status >= 200 && status < 300, status, json:async() => data});
  },
  reject(url) {
   const request = this.pending(url)[0]; assert.ok(request, 'Expected pending request for ' + url);
   request.settled = true; request.reject(new Error('Simulated connection failure'));
  },
  type(value) { get('#prompt').value = value; return get('#prompt').dispatch('input'); },
  submit() { return get('#chat-form').dispatch('submit'); },
  click(button) {
   const event = {target:button, preventDefault() {}};
   return Promise.all([button.dispatch('click'), ...(listeners.get('click') || []).map(fn => fn(event))]);
  },
  navigate(view) { return this.click(nav.find(button => button.dataset.view === view)); },
  routineButton(id) { const button = element('routine-' + id, 'button'); button.dataset.routineRun = id; return button; },
  skillButton(id, routine=false) { const button = element('skill-' + id, 'button'); button.dataset[routine?'skillRoutine':'skillBrief'] = id; return button; }
 };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const state = (chats = [], routines = []) => ({agents:[], chats, routines, live_available:false, model:'gpt-4.1-mini', context:''});
const run = (id, answer) => ({id, status:'completed', prompt:'Brief for ' + id, answer, mode:'demo', model:'demo', tasks:[], calls:0, input_tokens:0, output_tokens:0, rating:0});
async function ready(app, initialState = state()) { app.respond('/api/state', initialState); await flush(); assert.equal(app.get('#send').disabled, false); }
async function settleSubmission(app, submission, chatId = 'saved') {
 app.respond('/api/runs', {id:'created-run', chat_id:chatId}); await flush();
 app.respond('/api/state', state([{id:chatId, title:'Saved request'}])); await flush();
 if (app.pending('/api/chats/' + chatId).length) app.respond('/api/chats/' + chatId, {runs:[run('created-run','Saved response')]});
 await submission;
}

test('a delayed submission stays in History after New brief and preserves the new draft', async () => {
 const app = harness(); await ready(app);
 await app.type('Submitted request'); const submission = app.submit();
 assert.equal(app.pending('/api/runs').length, 1);
 await app.click(app.get('#new-chat')); await app.type('A different draft');
 await settleSubmission(app, submission);
 assert.equal(app.snapshot('chatId'), null);
 assert.equal(app.get('#prompt').value, 'A different draft');
 assert.equal(app.snapshot('document.body.dataset.view'), 'chat');
 assert.equal(app.requests.filter(request => request.url === '/api/chats/saved').length, 0);
 assert.match(app.get('#notice').textContent, /History/);
});

test('a delayed submission does not navigate back from Business context', async () => {
 const app = harness(); await ready(app);
 await app.type('Submitted request'); const submission = app.submit();
 await app.navigate('context'); app.get('#context').value = 'Unsaved business information';
 await settleSubmission(app, submission);
 assert.equal(app.snapshot('document.body.dataset.view'), 'context');
 assert.equal(app.get('#context').value, 'Unsaved business information');
 assert.equal(app.snapshot('chatId'), null);
 assert.equal(app.requests.filter(request => request.url.startsWith('/api/chats/')).length, 0);
});

test('text entered after Send is preserved when the submission resolves in the same view', async () => {
 const app = harness(); await ready(app);
 await app.type('Submitted request'); const submission = app.submit();
 await app.type('The next follow-up'); await settleSubmission(app, submission);
 assert.equal(app.snapshot('chatId'), 'saved');
 assert.equal(app.get('#prompt').value, 'The next follow-up');
 assert.match(app.get('#messages').innerHTML, /Saved response/);
 assert.equal(app.get('#send').disabled, false);
});

test('a response for an old conversation cannot replace the newly selected conversation', async () => {
 const app = harness(); await ready(app);
 const oldOpening = app.evaluate('openChat("older")');
 const newOpening = app.evaluate('openChat("newer")');
 app.respond('/api/chats/newer', {runs:[run('new-run','Newest answer')]}); await newOpening;
 app.respond('/api/chats/older', {runs:[run('old-run','Stale answer')]}); await oldOpening;
 assert.equal(app.snapshot('chatId'), 'newer');
 assert.deepEqual(app.snapshot('currentRuns.map(run => run.id)'), ['new-run']);
 assert.match(app.get('#messages').innerHTML, /Newest answer/);
 assert.ok(!app.get('#messages').innerHTML.includes('Stale answer'));
});

test('opening a conversation clears old content and disables Send until it has loaded', async () => {
 const app = harness(); await ready(app);
 const original = app.evaluate('openChat("original")');
 app.respond('/api/chats/original', {runs:[run('original-run','Previous answer')]}); await original;
 assert.match(app.get('#messages').innerHTML, /Previous answer/);
 const opening = app.evaluate('openChat("next")');
 assert.ok(!app.get('#messages').innerHTML.includes('Previous answer'));
 assert.match(app.get('#messages').innerHTML, /Loading your conversation/);
 assert.equal(app.get('#messages').getAttribute('aria-busy'), 'true');
 assert.equal(app.get('#send').disabled, true);
 await app.type('Draft while loading'); await app.submit();
 assert.equal(app.requests.filter(request => request.url === '/api/runs').length, 0);
 app.respond('/api/chats/next', {runs:[]}); await opening;
 assert.equal(app.get('#send').disabled, false);
 assert.equal(app.get('#messages').getAttribute('aria-busy'), 'false');
 assert.equal(app.get('#prompt').value, 'Draft while loading');
});

test('a failed startup connection leaves Send disabled and prevents accidental submission', async () => {
 const app = harness(); app.reject('/api/state'); await flush();
 assert.equal(app.get('#send').disabled, true);
 assert.equal(app.get('#connection-alert').hidden, false);
 assert.equal(app.get('#context-form button[type="submit"]').disabled, true);
 assert.equal(app.get('#routine-form button[type="submit"]').disabled, true);
 await app.type('Do not submit without connection'); await app.submit();
 assert.equal(app.requests.filter(request => request.url === '/api/runs').length, 0);
 assert.match(app.get('#notice').textContent, /Cannot reach/);
});

test('repeated Run now clicks while a routine starts create only one request', async () => {
 const routine = {id:'weekly', title:'Weekly review', cadence:'weekly', prompt:'Review marketing', last_run:null};
 const app = harness(); await ready(app, state([], [routine])); await app.navigate('routines');
 const starting = app.click(app.routineButton('weekly'));
 assert.equal(app.pending('/api/routines/run').length, 1);
 assert.match(app.get('#routine-list').innerHTML, /data-routine-run="weekly" disabled>Starting/);
 // Simulate a second button from a render while the first fetch is pending.
 await app.click(app.routineButton('weekly'));
 assert.equal(app.requests.filter(request => request.url === '/api/routines/run').length, 1);
 await app.navigate('context');
 app.respond('/api/routines/run', {chat_id:'routine-chat'}); await flush();
 app.respond('/api/state', state([{id:'routine-chat', title:'Weekly review'}], [routine])); await starting;
 assert.equal(app.snapshot('document.body.dataset.view'), 'context');
 assert.equal(app.requests.filter(request => request.url === '/api/chats/routine-chat').length, 0);
 assert.match(app.get('#notice').textContent, /History/);
 assert.equal(app.snapshot('pending'), false);
});

test('failed conversation loading does not enable Send into an unseen conversation', async () => {
 const app = harness(); await ready(app);
 const opening = app.evaluate('openChat("unavailable")');
 app.reject('/api/chats/unavailable'); await assert.rejects(opening, /Cannot reach/);
 assert.equal(app.get('#send').disabled, true);
 assert.equal(app.snapshot('chatReady'), false);
 assert.equal(app.get('#messages').getAttribute('aria-busy'), 'false');
 assert.equal(app.get('#connection-alert').hidden, false);
});

test('an older refresh for the same conversation cannot roll back completion or feedback', async () => {
 const app = harness(); await ready(app);
 const opening = app.evaluate('openChat("same-chat")');
 app.respond('/api/chats/same-chat', {runs:[{...run('tracked-run',''), status:'working'}]}); await opening;
 const olderRefresh = app.evaluate('refreshChat()');
 const newerRefresh = app.evaluate('refreshChat()');
 const [olderRequest, newerRequest] = app.pending('/api/chats/same-chat');
 assert.ok(olderRequest && newerRequest);
 newerRequest.settled = true;
 newerRequest.resolve({ok:true, status:200, json:async() => ({runs:[{...run('tracked-run','Final approved answer'), rating:1}]})});
 await newerRefresh;
 assert.equal(app.get('#send').disabled, false);
 assert.match(app.get('#messages').innerHTML, /Final approved answer/);
 olderRequest.settled = true;
 olderRequest.resolve({ok:true, status:200, json:async() => ({runs:[{...run('tracked-run',''), status:'working', rating:0}]})});
 await olderRefresh;
 assert.deepEqual(app.snapshot('currentRuns.map(run => ({status:run.status, rating:run.rating}))'), [{status:'completed', rating:1}]);
 assert.equal(app.get('#send').disabled, false);
 assert.match(app.get('#messages').innerHTML, /data-rate="1"[^>]*aria-pressed="true"/);
 assert.ok(!app.get('#messages').innerHTML.includes('Specialists are developing'));
});

test('session-change banner retry reloads the page instead of repeating API requests', async () => {
 const app = harness(); await ready(app);
 const check = app.evaluate('loadState()');
 app.respond('/api/state', {error:'Session expired'}, 401);
 await assert.rejects(check, /Session changed/);
 assert.equal(app.get('#connection-alert').hidden, false);
 assert.match(app.get('#connection-message').textContent, /session has changed/);
 assert.equal(app.get('#reconnect').textContent, 'Reload page');
 assert.equal(app.get('#send').disabled, true);
 const requestCount = app.requests.length;
 await app.click(app.get('#reconnect'));
 assert.equal(app.effects.reloads, 1);
 assert.equal(app.requests.length, requestCount);
});

test('ordinary reconnect preserves unsaved Business context and the current view', async () => {
 const app = harness(); await ready(app, {...state(), context:'Previously saved context'});
 assert.equal(app.get('#context').value, 'Previously saved context');
 await app.navigate('context'); app.get('#context').value = 'Unsaved updated audience and positioning';
 const check = app.evaluate('loadState()'); app.reject('/api/state'); await assert.rejects(check, /Cannot reach/);
 assert.equal(app.get('#connection-alert').hidden, false);
 const reconnecting = app.click(app.get('#reconnect'));
 app.respond('/api/state', {...state(), context:'Older server copy'}); await reconnecting;
 assert.equal(app.get('#context').value, 'Unsaved updated audience and positioning');
 assert.equal(app.snapshot('document.body.dataset.view'), 'context');
 assert.equal(app.get('#connection-alert').hidden, true);
 assert.equal(app.get('#context-form button[type="submit"]').disabled, false);
 assert.equal(app.get('#send').disabled, false);
 assert.equal(app.effects.reloads, 0);
});

test('completed conversations do not keep polling the tunnel', async () => {
 const app = harness();await ready(app);
 app.evaluate("chatId='saved';currentRuns=[{status:'completed'}]");
 const count=app.requests.length;
 assert.equal(app.effects.intervals[0].delay,3000);
 await app.effects.intervals[0].fn();
 assert.equal(app.requests.length,count);
});

test('active work is polled while visible and stops after completion', async () => {
 const app=harness();await ready(app);
 app.evaluate("chatId='saved';currentRuns=[{status:'working'}]");
 const check=app.effects.intervals[0].fn();
 assert.equal(app.pending('/api/chats/saved').length,1);
 app.respond('/api/chats/saved',{runs:[run('saved','Done')]});await check;
 const count=app.requests.length;await app.effects.intervals[0].fn();
 assert.equal(app.requests.length,count);
});

test('hidden tabs pause polling and visible tabs resume active work', async () => {
 const app=harness();await ready(app);
 app.evaluate("chatId='saved';currentRuns=[{status:'working'}];document.hidden=true");
 const count=app.requests.length;await app.effects.intervals[0].fn();
 assert.equal(app.requests.length,count);
 app.evaluate('document.hidden=false');
 const check=app.effects.intervals[0].fn();
 app.respond('/api/chats/saved',{runs:[run('saved','Done')]});await check;
});

test('guided brief creates an unsaved draft and never overwrites existing context', async () => {
 const app=harness();await ready(app,{...state(),business_template:'محصول:\nمشتری:\nهدف ۹۰ روزه:'});
 await app.get('#context-template').dispatch('click');
 assert.match(app.get('#context').value,/هدف ۹۰ روزه/);
 assert.equal(app.requests.filter(r=>r.url==='/api/context').length,0);
 app.get('#context').value='My real approved business context';
 await app.get('#context-template').dispatch('click');
 assert.equal(app.get('#context').value,'My real approved business context');
 assert.equal(app.requests.filter(r=>r.url==='/api/context').length,0);
});

test('role charters render safely and older servers prompt for restart', async () => {
 const app=harness();await ready(app);
 assert.match(app.get('#team-version').textContent,/Restart Go Online/);
 const loading=app.evaluate('loadState()');
 app.respond('/api/state',{...state(),team_version:'cmo-1.0',agents:[{
  id:'cmo',short:'CMO',name:'AI CMO',stage:'Coordinator charter v1',mission:'<img src=x onerror=bad()>',
  focus:'Diagnosis',inputs:['Request'],method:['<script>bad()</script>'],deliverables:['Artifact'],quality:['Evidence']
 }]});await loading;
 const html=app.get('#team-grid').innerHTML;
 assert.ok(!html.includes('<script>')&&!html.includes('<img'));
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/How this role works/);
 assert.match(app.get('#team-version').textContent,/cmo-1.0/);
});

const paidSkillState = () => ({...state(),team_version:'cmo-1.1',skills:[{
 id:'paid-media-ops',version:'paid-media-1.0',owner:'growth',workflows:[{
  id:'account-audit',name:'Ads account review',name_fa:'بررسی تبلیغات',summary:'<script>unsafe()</script>',
  output:'Campaign decisions',prompt:'[Paid Media Ops/account-audit]\nدادهٔ گزارش:',
  cadence:'weekly',routine_title:'بررسی هفتگی تبلیغات'
 }]
}]});

test('paid-ad workflow buttons prepare drafts without sending, saving or overwriting', async () => {
 const app=harness();await ready(app,paidSkillState());
 assert.match(app.get('#skills-grid').innerHTML,/&lt;script&gt;/);
 assert.ok(!app.get('#skills-grid').innerHTML.includes('<script>'));
 const requestCount=app.requests.length;
 await app.type('My unsaved brief');
 await app.click(app.skillButton('account-audit'));
 assert.equal(app.get('#prompt').value,'My unsaved brief');
 await app.click(app.get('#new-chat'));
 await app.click(app.skillButton('account-audit'));
 assert.equal(app.get('#prompt').value,'[Paid Media Ops/account-audit]\nدادهٔ گزارش:');
 assert.equal(app.snapshot('document.body.dataset.view'),'chat');
 assert.equal(app.requests.length,requestCount);
 await app.click(app.skillButton('account-audit',true));
 assert.equal(app.snapshot('document.body.dataset.view'),'routines');
 assert.equal(app.get('#routine-title').value,'بررسی هفتگی تبلیغات');
 assert.equal(app.get('#cadence').value,'weekly');
 app.get('#routine-prompt').value='My edited routine';
 await app.click(app.skillButton('account-audit',true));
 assert.equal(app.get('#routine-prompt').value,'My edited routine');
 assert.equal(app.requests.length,requestCount);
});

test('an older server cannot advertise an active paid-ad skill', async () => {
 const app=harness();await ready(app,state());
 assert.equal(app.get('#skills-grid').innerHTML,'');
 assert.match(app.get('#skills-status').textContent,/Restart Go Online/);
});
