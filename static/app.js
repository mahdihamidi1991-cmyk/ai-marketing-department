'use strict';
const $ = s => document.querySelector(s);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const activeStatuses = ['routing','working','synthesizing'];
let state = {agents:[],chats:[],routines:[]}, chatId = null, currentRuns = [], selectedRun = null, lastSignature = '', pending = false, pollBusy = false, noticeTimer;
let connected = false, initialized = false, loadingChat = false, chatReady = true, navigation = 0, promptVersion = 0, stateVersion = 0, refreshVersion = 0, sessionChanged = false;
const drafts = new Map(), startingRoutines = new Set();
async function api(path, body) {
 let response;
 try { response = await fetch(path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Department':'1'},body:JSON.stringify(body)}); }
 catch { setConnection(false); throw new Error('Cannot reach your department. Keep Start.command running, then reconnect.'); }
 let data;
 try { data = await response.json(); }
 catch { setConnection(false); throw new Error('This page is not connected to the app. Open the address shown by Start.command.'); }
 if(response.status===401) { sessionChanged=true;$('#reconnect').textContent='Reload page';setConnection(false, 'Your local session has changed. Reload this page to reconnect.'); throw new Error('Session changed. Reload the page; your saved conversations remain available.'); }
 if (!response.ok) throw new Error(data.error || 'Could not complete this action.');
 return data;
}
function setConnection(available, message='Connection lost. Keep Start.command running, then reconnect.') {
 connected=available;$('#connection-alert').hidden=available;
 $('#connection-message').textContent=message;
 document.querySelectorAll('#context-form button[type="submit"], #routine-form button[type="submit"]').forEach(b=>b.disabled=!available);
 document.querySelectorAll('[data-routine-run]').forEach(b=>b.disabled=!available||pending||startingRoutines.has(b.dataset.routineRun));
 updateComposer();
}
function rememberDraft() { if(chatId) drafts.set(chatId, $('#prompt').value); }
function setPrompt(value) { $('#prompt').value=value;promptVersion++; }
function notify(message, error=false) { const box=$('#notice'); box.textContent=message;box.hidden=false;box.classList.toggle('error',error);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>box.hidden=true,error?10000:4000); }
function safeAction(fn) { return async e=>{try{await fn(e);}catch(error){notify(error.message,true);}}; }
function focusViewHeading(view) {
 const heading=$(`#view-${view} h1`);
 const target=heading?.getClientRects().length?heading:$('#view-title');
 target.setAttribute('tabindex','-1');target.focus({preventScroll:true});
}
function showView(view) {
 const previousFocus=document.activeElement;
 document.body.dataset.view=view;
 document.querySelectorAll('.history-menu').forEach(el=>el.open=false);
 document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);
 document.querySelectorAll('.nav-item').forEach(el=>{const active=el.dataset.view===view;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 $('#view-title').textContent=({chat:state.chats.find(c=>c.id===chatId)?.title||'Command room',team:'Your team',context:'Business context',routines:'Routines',settings:'Connection & setup'})[view];
 if(previousFocus!==document.body&&(!previousFocus.isConnected||!previousFocus.getClientRects().length||previousFocus.closest('details:not([open])')))focusViewHeading(view);
}
function syncMode() {
 const live=$('#mode').value==='live';$('#connection').textContent=live?'Live AI · OpenAI':'Demo · no API calls';$('#connection').classList.toggle('live',live);
 $('#mode-note').textContent=live?'Your brief, business context and recent conversation are sent to OpenAI. Up to 5 API calls per request.':'Demo uses sample templates. Add an API key in Connection & setup for real AI responses.';
}
function renderNav() {
 $('#chat-list').innerHTML=state.chats.length?state.chats.map(c=>`<button class="chat-link ${c.id===chatId?'selected':''}" data-chat="${c.id}" title="${escapeHTML(c.title)}">${escapeHTML(c.title)}</button>`).join(''):'<p class="muted">Your conversations will live here.</p>';
}
function renderTeam() {
 const open=new Set([...document.querySelectorAll('.charter-details[open]')].map(el=>el.dataset.charter));
 const section=(label,items)=>`<h3>${escapeHTML(label)}</h3><ul>${(items||[]).map(item=>`<li>${escapeHTML(item)}</li>`).join('')}</ul>`;
 $('#team-grid').innerHTML=state.agents.map(a=>`<article class="team-card"><span class="agent-icon ${a.id==='cmo'?'cmo-icon':''}">${a.id==='cmo'?'✳':escapeHTML(a.short)}</span>${a.stage?`<span class="charter-stage">${escapeHTML(a.stage)}</span>`:''}<h2>${escapeHTML(a.name)}</h2><p>${escapeHTML(a.mission||a.description)}</p><small>${escapeHTML(a.focus)}</small>${a.method?`<details class="charter-details" data-charter="${escapeHTML(a.id)}" ${open.has(a.id)?'open':''}><summary>How this role works</summary>${section('Needs from you',a.inputs)}${section('Approach',a.method)}${section('Delivers',a.deliverables)}${section('Quality checks',a.quality)}</details>`:''}</article>`).join('');
 $('#team-version').textContent=state.team_version?`Team ${state.team_version} · Coordinator + specialist charters`:'Restart Go Online to load the new role charters.';
 renderSkills();
}
function renderSkills() {
 const skill=(state.skills||[]).find(s=>s.id==='paid-media-ops');
 $('#skills-status').textContent=skill?`${skill.version} · Growth + Analytics · Analysis & drafts`:'Restart Go Online and reload to activate Paid Media Ops.';
 $('#skills-grid').innerHTML=(skill?.workflows||[]).map(w=>`<article class="team-card skill-card"><span class="charter-stage">${escapeHTML(w.name)}</span><h3 dir="auto">${escapeHTML(w.name_fa)}</h3><p>${escapeHTML(w.summary)}</p><small>${escapeHTML(w.output)}</small><div class="skill-actions"><button class="primary" data-skill-brief="${escapeHTML(w.id)}">Use brief</button><button class="quiet" data-skill-routine="${escapeHTML(w.id)}">Prepare routine</button></div></article>`).join('');
}
function prepareSkill(id, routine=false) {
 const workflow=(state.skills||[]).find(s=>s.id==='paid-media-ops')?.workflows.find(w=>w.id===id);
 if(!workflow)return;
 if(routine){
  if($('#routine-title').value.trim()||$('#routine-prompt').value.trim()){
   notify('Your routine draft already has text. Save it or clear the fields before loading a workflow.');return;
  }
  navigation++;showView('routines');$('#routine-title').value=workflow.routine_title;
  $('#routine-prompt').value=workflow.prompt;$('#cadence').value=workflow.cadence;
  $('#routine-form').scrollIntoView({block:'start'});$('#routine-prompt').focus({preventScroll:true});
  notify('Routine draft ready. Edit and save it. Runs are started manually.');
 }else{
  if($('#prompt').value.trim()){
   notify('Your brief already has text. Keep it, or use New brief before loading a workflow.');return;
  }
  newChat();setPrompt(workflow.prompt);$('#prompt').focus({preventScroll:true});
  notify('Brief ready. Add report data and choose Demo or Live AI before sending.');
 }
}
function renderRoutines() {
 $('#routine-list').innerHTML=state.routines.length?state.routines.map(r=>`<article class="routine-card"><h2>${escapeHTML(r.title)}</h2><small>${escapeHTML(r.cadence.toUpperCase())} · MANUAL START · ${r.last_run?'Last started '+escapeHTML(new Date(r.last_run).toLocaleString()):'Not run yet'}</small><p dir="auto">${escapeHTML(r.prompt)}</p><button class="primary" data-routine-run="${r.id}" ${pending||!connected||startingRoutines.has(r.id)?'disabled':''}>${startingRoutines.has(r.id)?'Starting…':'Run now · '+($('#mode').value==='live'?'Live AI':'Demo')}</button><button class="quiet" data-routine-delete="${r.id}">Delete routine</button></article>`).join(''):'<div class="info-band">No routines yet. Start with a weekly marketing review, content planning brief or monthly funnel diagnosis.</div>';
}
async function loadState(initial=false) {
 const version=++stateVersion, next=await api('/api/state');
 if(version!==stateVersion)return;
 state=next;setConnection(true);renderNav();renderTeam();renderRoutines();
 $('#context-template').disabled=!state.business_template;
 $('#mode option[value="live"]').disabled=!state.live_available;
 if(!state.live_available&&$('#mode').value==='live')$('#mode').value='demo';
 $('#api-status').innerHTML=`<span class="mode-badge ${state.live_available?'live':''}">${state.live_available?'Key configured · '+escapeHTML(state.model):'Demo ready · API key not configured'}</span>`;
 if(initial&&!initialized) $('#context').value=state.context;
 initialized=true;syncMode();
 if(document.body.dataset.view==='chat')$('#view-title').textContent=state.chats.find(c=>c.id===chatId)?.title||'Command room';
}
function formatText(text) {
 return DepartmentMarkdown.format(text);
}
function updateComposer() {
 const running=currentRuns.some(r=>activeStatuses.includes(r.status));
 $('#send').disabled=!connected||!chatReady||loadingChat||pending||running;
 $('#send').innerHTML=!connected?'Reconnect to send':loadingChat?'Loading conversation…':!chatReady?'Reopen conversation':running?'Team is working…':pending?'Starting…':'Send brief <span>↑</span>';
 $('#export').disabled=!connected||!chatId||!currentRuns.length;
}
function renderMessages() {
 const focused=document.activeElement;
 const feedbackFocus=focused?.dataset?.rate?{run:focused.dataset.run,rate:focused.dataset.rate}:null;
 $('#welcome').hidden=currentRuns.length>0||!!chatId;
 document.body.dataset.hasRuns=String(currentRuns.length>0||!!chatId);
 $('#messages').setAttribute('aria-busy',String(loadingChat));
 $('#messages').innerHTML=loadingChat?'<p class="conversation-loading" role="status">Loading your conversation…</p>':currentRuns.map(r=>{
 const active=activeStatuses.includes(r.status);
 const status=({routing:'CMO is diagnosing your brief…',working:'Specialists are developing their contributions…',synthesizing:'CMO is reviewing and synthesizing the answer…'})[r.status];
 const body=r.answer?`<div class="answer-body" dir="auto">${formatText(r.answer)}</div>`:active?`<div class="status-line">${r.cancel?'Stopping after the current step…':status}${r.diagnosis?`<p dir="auto">${escapeHTML(r.diagnosis)}</p>`:''}<button class="quiet" data-cancel="${r.id}" ${r.cancel?'disabled':''}>Stop this request</button></div>`:`<div class="status-line error">${escapeHTML(r.error||r.status)}<button class="quiet" data-retry="${r.id}">Load brief to try again</button></div>`;
 return `<div class="user-message" dir="auto">${escapeHTML(r.prompt)}</div><article class="answer"><div class="answer-label"><span class="small-logo">✳</span><b>AI CMO</b><small>${r.mode==='demo'?'DEMO TEMPLATE':escapeHTML(r.model)} · ${escapeHTML(r.status)}</small></div>${body}<div class="run-meta"><button class="inspect-run" data-inspect="${r.id}">${r.tasks.length} specialist tasks ↗</button><span>${r.calls} API calls · ${(r.input_tokens+r.output_tokens).toLocaleString()} tokens</span>${r.status==='completed'?`<button class="${r.rating===1?'chosen':''}" data-rate="1" data-run="${r.id}" aria-pressed="${r.rating===1}" aria-label="Mark response useful">Useful ✓</button><button class="${r.rating===-1?'chosen':''}" data-rate="-1" data-run="${r.id}" aria-pressed="${r.rating===-1}" aria-label="Mark response needs work">Needs work</button>`:''}</div></article>`;
 }).join('');
 if(feedbackFocus)document.querySelector(`#messages button[data-run="${feedbackFocus.run}"][data-rate="${feedbackFocus.rate}"]`)?.focus({preventScroll:true});
 updateComposer();
}
function renderTasks() {
 const r=currentRuns.find(r=>r.id===selectedRun)||currentRuns[currentRuns.length-1];
 $('#task-count').textContent=`${r?.tasks.length||0} tasks`;
 if(!r){$('#run-progress').textContent='Ready for your brief';$('#task-list').innerHTML='<div class="waiting-card"><span>◎</span><strong>The right people.<br>At the right moment.</strong><p>Your CMO selects specialists based on your request.</p></div>';return;}
 const open=new Set([...document.querySelectorAll('.task-card[open]')].map(el=>el.dataset.task));
 $('#run-progress').textContent=`${r.category||'Diagnosing request'} · ${r.status}${r.mode==='demo'?' · demo':''}`;
 $('#task-list').innerHTML=r.tasks.map(t=>{
  const a=state.agents.find(a=>a.id===t.agent);
  return `<details class="task-card ${escapeHTML(t.status)}" data-task="${t.id}" ${open.has(t.id)?'open':''}><summary><span class="agent-icon">${escapeHTML(a?.short||'AI')}</span><span><strong>${escapeHTML(a?.name||t.agent)}</strong><small>${escapeHTML(t.status)}</small></span></summary><div class="task-content" dir="auto"><p class="brief">${escapeHTML(t.brief)}</p>${formatText(t.output||t.error||'Waiting for this step…')}</div></details>`;
 }).join('')||'<div class="waiting-card"><span>◎</span><p>The CMO is choosing the right specialists.</p></div>';
}
async function refreshChat() {
 if(!chatId)return;
 const requestedChat=chatId, requestedNavigation=navigation, version=++refreshVersion;
 const data=await api(`/api/chats/${requestedChat}`);
 if(chatId!==requestedChat||navigation!==requestedNavigation||version!==refreshVersion)return;
 const signature=JSON.stringify(data.runs);
 currentRuns=data.runs;
 const wasLoading=loadingChat;loadingChat=false;chatReady=true;
 if(signature!==lastSignature||wasLoading){lastSignature=signature;renderMessages();renderTasks();}
 updateComposer();
}
async function openChat(id) {
 rememberDraft();navigation++;const version=navigation;
 chatId=id;currentRuns=[];selectedRun=null;lastSignature='';loadingChat=true;chatReady=false;
 setPrompt(drafts.get(id)||'');renderMessages();renderTasks();renderNav();showView('chat');
 try {await refreshChat();}
 catch(error){if(navigation===version){loadingChat=false;renderMessages();}throw error;}
 if(navigation===version){focusViewHeading('chat');window.scrollTo({top:0,behavior:'instant'});}
}
function newChat() {rememberDraft();navigation++;chatId=null;currentRuns=[];selectedRun=null;lastSignature='';loadingChat=false;chatReady=true;setPrompt('');renderMessages();renderTasks();renderNav();showView('chat');$('#brief-stage').scrollIntoView({block:'center'});$('#prompt').focus({preventScroll:true});}
async function submitBrief(prompt) {
 if($('#send').disabled)return;
 const requestNavigation=navigation, requestChat=chatId, draftVersion=promptVersion, mode=$('#mode').value;
 pending=true;updateComposer();
 try{
  const r=await api('/api/runs',{prompt,chat_id:requestChat,mode});
  if(requestNavigation===navigation){
   chatId=r.chat_id;selectedRun=r.id;lastSignature='';
   if(promptVersion===draftVersion)setPrompt('');
   rememberDraft();showView('chat');
  }else{
   if(requestChat&&drafts.get(requestChat)?.trim()===prompt)drafts.set(requestChat,'');
   notify('Request saved in History. You can keep working here.');
  }
  await loadState();
  if(requestNavigation===navigation){
   await refreshChat();
   if(requestNavigation===navigation){const messages=document.querySelectorAll('#messages > .user-message');messages[messages.length-1]?.scrollIntoView({block:'start',behavior:'instant'});}
  }
 }catch(error){
  if(!connected)error.message+=' Check History after reconnecting before sending again; the request may already have been saved.';
  throw error;
 }finally{pending=false;updateComposer();renderRoutines();}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.history-menu[open]').forEach(el=>{el.open=false;el.querySelector('summary').focus();});});
document.addEventListener('click',safeAction(async e=>{
 if(!e.target.closest('.history-menu'))document.querySelectorAll('.history-menu').forEach(el=>el.open=false);
 const button=e.target.closest('button');if(!button)return;
 if(button.dataset.view){navigation++;showView(button.dataset.view);window.scrollTo({top:0,behavior:'instant'});}
 if(button.hasAttribute('data-start-brief')){navigation++;showView('chat');$('#brief-stage').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});$('#prompt').focus({preventScroll:true});}
 if(button.dataset.chat)await openChat(button.dataset.chat);
 if(button.dataset.prompt){setPrompt(button.dataset.prompt);$('#prompt').focus();}
 if(button.dataset.skillBrief)prepareSkill(button.dataset.skillBrief);
 if(button.dataset.skillRoutine)prepareSkill(button.dataset.skillRoutine,true);
 if(button.dataset.inspect){selectedRun=button.dataset.inspect;renderTasks();$('.work-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});}
 if(button.dataset.cancel){await api('/api/cancel',{id:button.dataset.cancel});await refreshChat();}
 if(button.dataset.retry){const r=currentRuns.find(r=>r.id===button.dataset.retry);setPrompt(r.prompt);$('#mode').value=r.mode==='live'&&!state.live_available?'demo':r.mode;syncMode();$('#prompt').focus();}
 if(button.dataset.rate){await api('/api/feedback',{id:button.dataset.run,rating:Number(button.dataset.rate)});await refreshChat();notify('Feedback saved for quality review.');}
 if(button.dataset.routineDelete){if(confirm('Delete this saved routine? Past conversations will remain.')){await api('/api/routines/delete',{id:button.dataset.routineDelete});await loadState();}}
 if(button.dataset.routineRun){
  if(pending||!connected||startingRoutines.has(button.dataset.routineRun))return;
  const requestNavigation=navigation, id=button.dataset.routineRun;
  pending=true;startingRoutines.add(id);updateComposer();renderRoutines();
  try{const r=await api('/api/routines/run',{id,mode:$('#mode').value});await loadState();if(requestNavigation===navigation&&document.body.dataset.view==='routines')await openChat(r.chat_id);else notify('Routine started. Find its conversation in History.');}
  finally{pending=false;startingRoutines.delete(id);updateComposer();renderRoutines();}
 }
}));
$('#new-chat').addEventListener('click',newChat);
$('#reconnect').addEventListener('click',safeAction(async()=>{if(sessionChanged){location.reload();return;}await loadState(!initialized);await refreshChat();}));
$('#chat-form').addEventListener('submit',safeAction(async e=>{e.preventDefault();const prompt=$('#prompt').value.trim();if(!prompt){$('#prompt').focus();return;}await submitBrief(prompt);}));
$('#prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!$('#send').disabled){e.preventDefault();$('#chat-form').requestSubmit();}});
$('#prompt').addEventListener('input',()=>{promptVersion++;rememberDraft();});
$('#mode').addEventListener('change',()=>{syncMode();renderRoutines();});
$('#context-form').addEventListener('submit',safeAction(async e=>{e.preventDefault();const button=e.target.querySelector('button[type="submit"]');if(button.disabled)return;button.disabled=true;try{await api('/api/context',{context:$('#context').value});notify('Business context saved. It will be used for new requests.');}finally{button.disabled=!connected;}}));
$('#context-template').addEventListener('click',()=>{
 if(!state.business_template){notify('Restart Go Online and reload to load the business brief template.',true);return;}
 if($('#context').value.trim()){notify('Your brief already contains text. Keep it and use the guide below to add missing information.');return;}
 $('#context').value=state.business_template;$('#context').focus();
 notify('Template added to your draft. Fill it in, then save your business context.');
});
$('#routine-form').addEventListener('submit',safeAction(async e=>{e.preventDefault();const button=e.target.querySelector('button[type="submit"]');if(button.disabled)return;button.disabled=true;try{await api('/api/routines',{title:$('#routine-title').value,prompt:$('#routine-prompt').value,cadence:$('#cadence').value});e.target.reset();await loadState();notify('Routine saved. Use Run now when you’re ready.');}finally{button.disabled=!connected;}}));
$('#export').addEventListener('click',safeAction(async()=>{
 if(!chatId)return;const response=await fetch(`/api/export/${chatId}`);if(!response.ok)throw new Error('Export failed.');
 const blob=new Blob([await response.text()],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`marketing-handoff-${chatId.slice(0,8)}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Exported. Upload this file to your ChatGPT Project.');
}));
async function start(){setConnection(false,'Connecting to your local department…');try{await loadState(true);renderTasks();}catch(e){notify(e.message,true);}}
start();
setInterval(async()=>{if(pollBusy||!chatId||!connected||document.hidden||!currentRuns.some(r=>activeStatuses.includes(r.status)))return;pollBusy=true;try{await refreshChat();}catch(e){if(connected)notify(e.message,true);}finally{pollBusy=false;}},3000);
