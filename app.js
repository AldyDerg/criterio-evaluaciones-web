'use strict';

const $=selector=>document.querySelector(selector);
const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={check:'<path d="m5 12 4 4L19 6"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',back:'<path d="M19 12H5m6-6-6 6 6 6"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',users:'<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8m2 4a5 5 0 0 1 3 5"/>',sparkle:'<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/>',database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',file:'<path d="M14 2H5v20h14V7Zm0 0v5h5M8 12h8m-8 4h6"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M8 16h8"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.info}</svg>`;
const brand=()=>`<div class="brand"><span class="brand-icon">${icon('check')}</span>criterio<span class="sr-only">, evaluación humana</span></div>`;
const initials=name=>String(name).split(' ').slice(0,2).map(s=>s[0]).join('');
const personColors=new Set(['coral','blue','violet','amber','teal','pink','lime','sky','peach']);
const personColorClass=person=>`person-color-${personColors.has(person?.color)?person.color:'coral'}`;
const generationFor=id=>state.data.evaluatorGenerations?.[id??state.evaluator?.id]??state.data.generation;
const ratingLabels=['Inadecuado','Deficiente','Adecuado','Óptimo'];
const criteria=[
  {key:'clinicalRelevance',label:'Pertinencia Clínica',description:'¿El argumento justifica adecuadamente por qué la frase denota conflicto severo, moderado o adaptación funcional?'},
  {key:'clarityCoherence',label:'Claridad y Coherencia',description:'¿La redacción es estructurada, utiliza lenguaje técnico psicológico apropiado, y carece de contradicciones lógicas internas?'},
  {key:'noHallucination',label:'Ausencia de Alucinación',description:'¿El modelo se ciñe estrictamente a la información proporcionada en la respuesta del evaluado, sin inferir datos clínicos inexistentes ni caer en anclajes léxicos erróneos?'}
];
const scaleDescriptions=[
  'El motivo es incoherente, alucina información clínica inexistente, asume datos fuera de contexto o se ancla erróneamente en una palabra aislada del reactivo.',
  'El motivo tiene sentido sintáctico, pero la justificación clínica es superficial, genérica o presenta discrepancias con la clasificación diagnóstica final.',
  'El motivo explica la frase completada con un lenguaje técnico correcto y pertinencia clínica, capturando el sentido general sin sobrepatologizar.',
  'El motivo es clínicamente exacto, coherente, utiliza terminología psicométrica precisa y se ciñe estrictamente a la información proporcionada por el paciente.'
];
const validRating=value=>Number.isInteger(value)&&value>=1&&value<=4;
const criterionCount=answer=>criteria.filter(c=>validRating(answer?.ratings?.[c.key])).length;
const isRated=answer=>criterionCount(answer)===criteria.length;
const isStarted=answer=>criterionCount(answer)>0;
const state={data:null,view:'entry',selected:null,evaluator:null,caseId:null,caseData:null,cache:new Map(),answers:new Map(),index:0,done:false,busy:false,note:'',dirty:false,notePromise:null,error:'',status:'idle',confirming:false,entryNotice:'',queue:null,pendingDoc:null,orphaned:[],store:new CriterioQueue.IndexedDbStore(),lastVoteAt:0,retryVote:null,activeCriterion:'clinicalRelevance',guideOpen:false,questionMapOpen:null,receiptRevisions:{}};
const mobileLayout=()=>Boolean(window.matchMedia?.('(max-width: 720px)').matches);

function apiConnection(path){
  if(typeof path!=='string'||!path.startsWith('/api/')||/[\\#\s\u0000-\u001f\u007f]/.test(path))throw new Error('La ruta de la API no es válida.');
  let decodedPath;
  try{decodedPath=decodeURIComponent(path.split('?')[0]);}catch{throw new Error('La ruta de la API no es válida.');}
  if(/[\\?#\s\u0000-\u001f\u007f]/.test(decodedPath)||decodedPath.split('/').slice(2).some(part=>!part||part==='.'||part==='..'))throw new Error('La ruta de la API no es válida.');
  const configuration=window.CRITERIO_CONNECTION;
  if(configuration!==undefined&&(configuration===null||typeof configuration!=='object'||Array.isArray(configuration)))throw new Error('La configuración de conexión no es válida.');
  const base=configuration?.apiBase===undefined?'':configuration.apiBase;
  if(typeof base!=='string')throw new Error('La dirección configurada del servidor no es válida.');
  if(!base)return {url:path,external:false};
  // El destino público es un origen ngrok completo, sin credenciales, puertos,
  // rutas ni parámetros. Nunca se obtiene de la URL de la página ni de usuarios.
  if(!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ngrok-free\.(?:app|dev)\/?$/i.test(base))throw new Error('La dirección configurada del servidor no es válida.');
  const origin=new URL(base).origin;
  return {url:origin+path,external:origin!==window.location.origin};
}
async function api(path,options={}){
  const connection=apiConnection(path);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  const request={...options,signal:controller.signal,headers:{'Content-Type':'application/json',...options.headers}};
  if(connection.external){
    for(const name of Object.keys(request.headers))if(name.toLowerCase()==='ngrok-skip-browser-warning')delete request.headers[name];
    request.headers['ngrok-skip-browser-warning']='1';
    request.credentials='omit';request.mode='cors';request.redirect='error';
  }
  try{const res=await fetch(connection.url,request);const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error||'El servidor no aceptó la solicitud.'),{status:res.status,code:data.code,conflicts:data.conflicts});return data;}
  catch(error){if(error.name==='AbortError')throw new Error('El servidor tardó demasiado. Las respuestas pendientes siguen en este dispositivo.');if(error instanceof TypeError)throw new Error('No hay conexión con el servidor. Las respuestas pendientes siguen en este dispositivo.');throw error;}finally{clearTimeout(timer);}
}
function announce(text){$('#announcer').textContent=text;}
function persistIdentity(id){try{id?sessionStorage.setItem('criterio-evaluator',id):sessionStorage.removeItem('criterio-evaluator');}catch{}}
function getIdentity(){try{return sessionStorage.getItem('criterio-evaluator');}catch{return null;}}
function current(){return state.caseData?.questions[state.index];}
function currentAnswer(){return state.answers.get(current()?.id);}
function savedNote(){return currentAnswer()?.comment||'';}
function count(){return [...state.answers.values()].filter(isRated).length;}
function total(){return state.data.totalQuestions||state.data.cases.reduce((sum,c)=>sum+c.total,0);}
function pendingItems(){return Object.values(state.pendingDoc?.pending||{});}
function pendingNewItems(){
  const flight=state.pendingDoc?.inFlight;
  // A recovered batch may already be included in bootstrap after a lost reply.
  // Keep its votes visible as pending until the same batch is acknowledged.
  const uncertain=new Set(flight&&flight.payload.batchId===state.recoveringBatchId?flight.payload.evaluations.map(CriterioQueue.answerKey):[]);
  return pendingItems().filter(a=>isRated(a)&&!a.wasRated&&!uncertain.has(CriterioQueue.answerKey(a)));
}
function overallCount(){return Math.min(total(),state.data.cases.reduce((sum,c)=>sum+Math.min(c.total,countCase(c.id)),0));}
function countCase(id){
  if(state.caseId===id&&state.caseData)return count();
  const confirmed=state.data.caseProgress?.[state.evaluator?.id]?.[id]||0,cached=state.cache.get(JSON.stringify([state.evaluator?.id,id]));
  if(cached&&cached.datasetVersion===state.data.datasetVersion&&cached.generation===generationFor(state.evaluator?.id)&&cached.rubricVersion===state.data.rubricVersion){
    const answers=new Map(cached.evaluations.map(a=>[a.questionId,a]));
    for(const a of Object.values(state.pendingDoc?.confirmed||{}))if(a.caseId===id&&(a.revision||0)>=(answers.get(a.questionId)?.revision||0))answers.set(a.questionId,a);
    const base=[...answers.values()].filter(isRated).length;
    for(const a of pendingItems())if(a.caseId===id)answers.set(a.questionId,a);
    return Math.max(0,Math.max(confirmed,base)+[...answers.values()].filter(isRated).length-base);
  }
  return Math.max(0,confirmed+pendingNewItems().filter(a=>a.caseId===id).length-pendingItems().filter(a=>a.caseId===id&&a.wasRated&&!isRated(a)).length);
}
function syntheticCountCase(id){if(state.caseId===id&&state.caseData)return [...state.answers.values()].filter(a=>a.synthetic&&isRated(a)).length;return Math.max(0,(state.data.caseSynthetic?.[state.evaluator?.id]?.[id]||0)-pendingItems().filter(a=>a.caseId===id&&a.replacesSynthetic).length);}
function exportLinkHTML(){return '';}
function setBusy(value){state.busy=value;document.querySelectorAll('[data-action],.question-dot,.vote-button,[data-person],#start,#reset-open,#case-select').forEach(b=>b.disabled=value||(b.id==='start'&&!state.selected)||(b.id==='prev'&&state.index===0)||(b.id==='continue'&&!isRated(currentAnswer()))||((b.classList?.contains('vote-button'))&&Boolean(state.pendingDoc?.blocked)));if($('#comment'))$('#comment').disabled=value||Boolean(state.pendingDoc?.blocked);paintStatus();}

function paintStatus(){
  const pending=pendingItems().length,blocked=state.pendingDoc?.blocked;
  const text=state.retryVote?'No se pudo guardar en este dispositivo':state.notePromise?'Guardando comentario en este dispositivo…':state.status==='sending'?'Enviando bloque al servidor…':state.status==='waiting'?'Esperando para reintentar el mismo bloque…':blocked?'Pendientes conservados · Requieren revisión':pending?`${pending} ${pending===1?'respuesta pendiente':'respuestas pendientes'} de enviar`:'Todo guardado en el servidor';
  for(const el of document.querySelectorAll('[data-save-status]')){el.className=`save-state ${blocked||state.error?'error':pending?'pending':''}`;el.innerHTML=`${state.status==='sending'?'<span class="spinner"></span>':icon(pending?'database':'check')}<span>${esc(text)}</span>`;}
  const error=$('#save-error');
  if(error){
    error.innerHTML=state.error||blocked?`${esc(state.error||blocked.message||'El bloque pendiente requiere revisión.')}<div class="save-error-actions">${blocked?'<button class="ghost" id="reload-pending">Recargar información</button>':'<button class="ghost" id="retry-save" data-action>Reintentar guardado</button>'}${pending?'<button class="text-link" id="error-pending-download">Descargar pendientes</button>':''}</div>`:'';
    if($('#reload-pending'))$('#reload-pending').onclick=()=>location.reload();
    if($('#retry-save'))$('#retry-save').onclick=saveNow;
    if($('#error-pending-download'))$('#error-pending-download').onclick=()=>downloadPending();
  }
  if($('#overall-count'))$('#overall-count').textContent=`${overallCount()} de ${total()}`;
  if($('#count')&&state.caseData)$('#count').textContent=`${count()} de ${state.caseData.questions.length}`;
  if($('#saved-count'))$('#saved-count').textContent=`${state.data.progress[state.evaluator?.id]||0} confirmadas por el servidor${state.data.syntheticProgress?.[state.evaluator?.id]?` · ${state.data.syntheticProgress[state.evaluator.id]} de prueba`:''}`;
  if($('#save-now'))$('#save-now').disabled=state.busy||state.status==='sending'||Boolean(blocked)||Boolean(!pending&&!state.dirty&&!state.retryVote);
  if($('#pending-download'))$('#pending-download').hidden=!pending;
  if(state.view==='cases')paintCaseMenu();
}

function mergeAnswers(){
  if(!state.caseData)return;
  state.answers=new Map(state.caseData.evaluations.map(a=>[a.questionId,{...a}]));
  for(const a of Object.values(state.pendingDoc?.confirmed||{}))if(a.caseId===state.caseId&&(a.revision||0)>=(state.answers.get(a.questionId)?.revision||0))state.answers.set(a.questionId,{...a});
  for(const a of pendingItems())if(a.caseId===state.caseId)state.answers.set(a.questionId,{...a,revision:a.expectedRevision,pending:true});
}
function applyReceiptProgress(receipt){
  const id=state.evaluator.id,revision=Number(receipt.adminRevision),baseline=Math.max(Number(state.data.adminRevision)||0,state.receiptRevisions[id]||0);
  if(Number.isFinite(revision)&&revision<baseline)return;
  if(Number.isFinite(revision))state.receiptRevisions[id]=revision;
  if(Number.isInteger(receipt.completed))state.data.progress[id]=receipt.completed;
  for(const field of ['caseProgress','caseStarted','caseSynthetic'])if(receipt[field]){state.data[field]??={};state.data[field][id]={...receipt[field]};}
  for(const [field,value]of [['realProgress',receipt.realCompleted],['syntheticProgress',receipt.syntheticCompleted]])if(Number.isInteger(value)){state.data[field]??={};state.data[field][id]=value;}
}
async function refreshLocal(){if(!state.queue)return;const queue=state.queue,doc=await queue.read();if(queue!==state.queue)return;state.pendingDoc=doc;if(doc.lastReceipt)applyReceiptProgress(doc.lastReceipt);mergeAnswers();paintStatus();}
async function sendPending({force=false,manual=false}={}){
  const queue=state.queue;if(!queue)return false;
  try{state.error='';await queue.sync({force,manual});if(queue===state.queue){await refreshLocal();state.error='';paintStatus();}return true;}
  catch(error){if(queue===state.queue){await refreshLocal().catch(()=>{});state.error=error.status===409?'Hay un cambio de versión, un reinicio de pruebas o una edición desde otra sesión. Tus pendientes siguen guardados aquí y no se enviarán automáticamente.':error.message;paintStatus();setBusy(state.busy);}return false;}
}
function makeQueue(id){state.queue?.close();state.queue=new CriterioQueue.Outbox({store:state.store,evaluatorId:id,datasetVersion:state.data.datasetVersion,generation:generationFor(id),rubricVersion:state.data.rubricVersion,send:payload=>api('/api/evaluations/batch',{method:'POST',body:JSON.stringify(payload)}),onChange:()=>{refreshLocal().catch(error=>{state.error=error.message;paintStatus();});},onAck:async response=>{if(state.evaluator?.id!==id)return;applyReceiptProgress(response);await refreshLocal();},onStatus:status=>{if(state.evaluator?.id===id){state.status=status;paintStatus();}}});}
function saveError(error){state.error=error.message;paintStatus();announce(error.message);}

function confirmAction({title,description,confirmText,danger=false}){
  if(state.confirming)return Promise.resolve(false);state.confirming=true;const previousFocus=document.activeElement,dialog=document.createElement('dialog');dialog.className='confirm-dialog';dialog.innerHTML=`<h2>${esc(title)}</h2><p>${esc(description)}</p><div class="confirm-actions"><button class="ghost" id="confirm-cancel" type="button">Cancelar</button><button class="primary ${danger?'danger-button':''}" id="confirm-accept" type="button">${esc(confirmText)}</button></div>`;document.body.append(dialog);
  return new Promise(resolve=>{const finish=value=>{dialog.close();dialog.remove();state.confirming=false;previousFocus?.focus?.();resolve(value);};dialog.querySelector('#confirm-cancel').onclick=()=>finish(false);dialog.querySelector('#confirm-accept').onclick=()=>finish(true);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.showModal();dialog.querySelector('#confirm-cancel').focus();});
}
async function downloadPending(all=false){try{const docs=all?await state.store.list():[{key:state.queue.key,...await state.queue.read()}];const content={format:'criterio-pendientes-v1',exportedAt:new Date().toISOString(),outboxes:docs.filter(doc=>Object.keys(doc.pending||{}).length)};const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Criterio-respuestas-pendientes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){saveError(error);}}
async function findOrphans(){const docs=await state.store.list();state.orphaned=docs.filter(doc=>Object.keys(doc.pending||{}).length&&(doc.scope?.datasetVersion!==state.data.datasetVersion||doc.scope?.generation!==generationFor(doc.scope?.evaluatorId)||doc.scope?.rubricVersion!==state.data.rubricVersion));}

function teamProgress(){
  const perEvaluator=total(),maximum=perEvaluator*state.data.evaluators.length;
  const completed=state.data.evaluators.reduce((sum,person)=>{const raw=Number(state.data.progress?.[person.id]);return sum+Math.max(0,Math.min(perEvaluator,Number.isFinite(raw)?Math.floor(raw):0));},0);
  return {maximum,completed,remaining:maximum-completed,percent:maximum?Math.floor(completed/maximum*100):0};
}
function teamProgressHTML(){
  const {maximum,completed,remaining,percent}=teamProgress(),number=value=>value.toLocaleString('es-CO');
  const offset=maximum?100-completed/maximum*100:100;
  return `<section class="entry-story team-overview" aria-labelledby="team-progress-title"><span class="eyebrow">Todo el equipo</span><h1 id="team-progress-title">Progreso total.</h1><div class="team-ring" role="progressbar" aria-label="Progreso total del equipo" aria-valuemin="0" aria-valuemax="${maximum||1}" aria-valuenow="${completed}" aria-valuetext="${number(completed)} de ${number(maximum)} evaluaciones completadas"><svg viewBox="0 0 220 220" aria-hidden="true" focusable="false"><circle class="team-ring-track" cx="110" cy="110" r="98"/><circle class="team-ring-fill" cx="110" cy="110" r="98" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${offset}" transform="rotate(-90 110 110)" ${completed===0?'visibility="hidden"':''}/></svg><div class="team-ring-label" aria-hidden="true"><strong>${percent}<span>%</span></strong><span>completado</span></div></div><div class="team-remaining"><strong>${number(remaining)}</strong><span>${remaining===1?'evaluación pendiente':'evaluaciones pendientes'}</span></div><p class="team-completed">${number(completed)} de ${number(maximum)} completadas</p></section>`;
}

function renderEntry(){
  state.view='entry';state.evaluator=null;state.caseData=null;state.caseId=null;
  $('#app').innerHTML=`<main class="entry-shell"><div class="entry-top">${brand()}</div><section class="entry-card">${teamProgressHTML()}<div class="entry-form"><span class="eyebrow">Cada mirada cuenta</span><h2>Elige tu perfil.</h2><p class="intro">Así va el equipo. Pulsa tu nombre para comenzar o continuar donde te quedaste.</p><div class="profiles-list" role="group" aria-label="Perfiles y progreso">${state.data.evaluators.map(profileHTML).join('')}</div>${state.entryNotice?`<p class="success-box" role="status">${esc(state.entryNotice)}</p>`:''}${state.orphaned.length?`<div class="error-box">Hay pendientes de una versión o prueba anterior en este navegador. Se conservaron aparte y no se enviarán a los casos actuales.<br><button class="ghost" id="orphan-download">Descargar pendientes anteriores</button></div>`:''}<div class="error-box" id="entry-error" role="alert">${esc(state.entryRefreshError||'')}</div></div></section></main>`;
  document.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>enter(b.dataset.person));if($('#orphan-download'))$('#orphan-download').onclick=()=>downloadPending(true);scrollByReadingOffset(-(window.scrollY||0));
}
function profileHTML(person){
  const maximum=total(),raw=Number(state.data.progress[person.id]),completed=Math.max(0,Math.min(maximum,Number.isFinite(raw)?Math.floor(raw):0)),remaining=maximum-completed,percent=maximum?Math.floor(completed/maximum*100):0;
  return `<button class="person-option ${personColorClass(person)}" type="button" data-person="${esc(person.id)}"><span class="person-avatar">${esc(initials(person.name))}</span><span class="person-info"><span class="person-heading"><span class="person-name">${esc(person.name)}</span><span class="person-percent">${percent}%</span></span><span class="person-progress">${completed} de ${maximum} completadas</span><progress class="person-progress-bar" value="${completed}" max="${maximum||1}" aria-label="Progreso de ${esc(person.name)}">${percent}%</progress>${Number(state.data.syntheticProgress?.[person.id])?`<span class="synthetic-badge">${state.data.syntheticProgress[person.id]} datos de prueba</span>`:''}<span class="person-remaining">${remaining?`Falta${remaining===1?'':'n'} ${remaining} respuesta${remaining===1?'':'s'}`:'Todas las respuestas completadas'}</span></span><span class="person-enter" aria-hidden="true">${icon('arrow')}</span></button>`;
}
function showProfileLoading(person){
  const app=$('#app'),overlay=document.createElement('div'),minimum=new Promise(resolve=>setTimeout(resolve,1000));
  overlay.className='account-loading';overlay.setAttribute('role','status');overlay.setAttribute('aria-live','polite');overlay.tabIndex=-1;
  overlay.innerHTML=`<div class="account-loading-card ${personColorClass(person)}"><span class="account-loading-avatar">${esc(initials(person.name))}</span><span class="account-loading-kicker">Un momento</span><p>Cargando el progreso de…</p><h1>${esc(person.name)}</h1><div class="account-loading-indicator" aria-hidden="true"><span></span><span></span><span></span></div><p class="account-loading-hint">Estás entrando al perfil seleccionado.</p></div>`;
  app.inert=true;document.body.append(overlay);overlay.focus({preventScroll:true});
  return async()=>{await minimum;overlay.classList.add('is-leaving');if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,200));overlay.remove();app.inert=false;};
}
async function enter(id){
  if(state.busy)return;const person=state.data.evaluators.find(p=>p.id===id);if(!person)return;setBusy(true);const finishLoading=showProfileLoading(person);
  try{state.evaluator=person;state.caseData=null;state.caseId=null;state.answers.clear();state.recoveringBatchId=null;state.data.caseProgress??={};makeQueue(id);await refreshLocal();state.recoveringBatchId=state.pendingDoc?.inFlight?.payload.batchId||null;renderCaseMenu();persistIdentity(id);announce(`Hola, ${state.evaluator.name}. Elige un caso para continuar.`);if(pendingItems().filter(isRated).length>=10||state.pendingDoc.inFlight)void sendPending();}
  catch(error){state.queue?.close();state.queue=null;renderEntry();$('#entry-error').textContent=error.message;}finally{await finishLoading();setBusy(false);if(state.evaluator)$('#case-menu-title')?.focus({preventScroll:true});else $('#entry-error').focus?.();}
}
function evaluationHeaderHTML(){
  const subject=state.view==='workspace'?state.caseData?.case:null;
  const mobileBio=subject?`<div class="mobile-case-context"><strong>${esc(subject.name)}</strong><span>${[subject.age!=null?`${esc(subject.age)} años`:'',esc(subject.gender||'')].filter(Boolean).join(' · ')}</span></div>`:'';
  return `<header class="app-header ${subject?'workspace-header':''}"><div class="header-left">${mobileBio}${brand()}<span class="header-divider"></span><span class="header-subtitle">Evaluación humana</span></div><div class="header-right"><div class="evaluator-name ${personColorClass(state.evaluator)}"><span class="person-avatar">${esc(initials(state.evaluator.name))}</span><span>${esc(state.evaluator.name)}</span></div><button class="ghost" id="change-person" data-action title="Guardar y cambiar evaluador" aria-label="Guardar y cambiar evaluador">${icon('users')} Cambiar evaluador</button></div></header>`;
}
function caseLevelState(subject){
  const completed=Math.min(subject.total,Math.max(0,countCase(subject.id))),pending=pendingItems().filter(a=>a.caseId===subject.id).length;
  const cached=state.cache.get(JSON.stringify([state.evaluator?.id,subject.id]));
  const started=Boolean(state.data.caseStarted?.[state.evaluator?.id]?.[subject.id])||cached?.evaluations.some(isStarted)||Object.values(state.pendingDoc?.confirmed||{}).some(a=>a.caseId===subject.id&&isStarted(a));
  return {completed,percent:subject.total?Math.floor(completed/subject.total*100):0,status:completed===0&&!pending&&!started?'new':completed===subject.total?'complete':'progress',pending};
}
function caseDisplayNumber(subject,index){
  const sourceNumber=Number(/^sacks-(\d+)$/.exec(subject.id)?.[1]);
  return Number.isSafeInteger(sourceNumber)&&sourceNumber>0?sourceNumber:index+1;
}
function caseLevelContents(subject,index,level=caseLevelState(subject)){
  const label={new:'Sin empezar',progress:'En curso',complete:'Completado'}[level.status],action={new:'Comenzar',progress:'Continuar',complete:'Revisar'}[level.status];
  const number=caseDisplayNumber(subject,index);
  return `<span class="level-top"><span class="level-number">${String(number).padStart(2,'0')}</span><span class="level-status">${level.status==='complete'?icon('check'):''}<span class="level-status-label">${label}</span></span></span><span class="level-name">${esc(subject.name)}</span><span class="level-bio">${[subject.age!=null?`${esc(subject.age)} años`:'',esc(subject.gender||'')].filter(Boolean).join(' · ')}</span><span class="level-progress-label"><strong>${level.completed} de ${subject.total} respuestas</strong><span>${level.percent}%</span></span><progress class="level-progress" value="${level.completed}" max="${subject.total||1}" aria-label="Progreso de ${esc(subject.name)}">${level.percent}%</progress><span class="level-bottom"><span class="level-action">${action}</span>${icon('arrow')}</span>${syntheticCountCase(subject.id)?`<span class="synthetic-badge">${syntheticCountCase(subject.id)} datos de prueba</span>`:''}${level.pending?`<span class="level-pending">${level.pending} ${level.pending===1?'pendiente':'pendientes'} de enviar</span>`:''}`;
}
function paintCaseMenu(){
  const levels=state.data.cases.map(caseLevelState);
  for(const [id,status]of [['cases-complete','complete'],['cases-started','progress'],['cases-unstarted','new']])if($('#'+id))$('#'+id).textContent=levels.filter(c=>c.status===status).length;
  for(const button of document.querySelectorAll('[data-case-open]')){
    const index=state.data.cases.findIndex(c=>c.id===button.dataset.caseOpen);if(index<0)continue;
    const level=levels[index],html=caseLevelContents(state.data.cases[index],index,level);
    button.className=`case-level is-${level.status}`;if(button.innerHTML!==html)button.innerHTML=html;
  }
}
function renderCaseMenu(){
  state.view='cases';
  $('#app').innerHTML=`${evaluationHeaderHTML()}<main class="case-menu-shell"><section class="case-menu-heading"><div><span class="eyebrow">Tu recorrido</span><h1 id="case-menu-title" tabindex="-1">Elige un caso.</h1></div><div class="case-menu-total"><small>Tu avance total</small><strong id="overall-count">${overallCount()} de ${total()}</strong><small id="saved-count">${state.data.progress[state.evaluator.id]||0} confirmadas por el servidor</small></div></section><div class="case-menu-summary"><span class="menu-stat"><strong id="cases-complete">0</strong> completados</span><span class="menu-stat"><strong id="cases-started">0</strong> en curso</span><span class="menu-stat"><strong id="cases-unstarted">0</strong> sin empezar</span></div><div class="case-legend" aria-label="Estados de los casos"><span class="legend-item"><span class="legend-swatch is-new" aria-hidden="true"></span>Sin empezar</span><span class="legend-item"><span class="legend-swatch is-progress" aria-hidden="true"></span>En curso</span><span class="legend-item"><span class="legend-swatch is-complete" aria-hidden="true"></span>Completado</span></div><div class="case-grid" role="group" aria-label="Selecciona una biografía">${state.data.cases.map((subject,index)=>`<button class="case-level is-${caseLevelState(subject).status}" type="button" data-case-open="${esc(subject.id)}" data-action>${caseLevelContents(subject,index)}</button>`).join('')}</div><div class="error-box" id="save-error" role="alert"></div><p class="menu-footer">Tu progreso corresponde a ${esc(state.evaluator.name)}.</p></main>`;
  document.querySelectorAll('[data-case-open]').forEach(button=>button.onclick=()=>openCase(button.dataset.caseOpen));
  $('#change-person').onclick=changePerson;setBusy(state.busy);scrollByReadingOffset(-(window.scrollY||0));
}
async function openCase(id){
  if(state.busy||state.view!=='cases'||!state.data.cases.some(c=>c.id===id))return;
  setBusy(true);state.error='';announce('Cargando el caso seleccionado…');
  try{await loadCase(id);}catch(error){renderCaseMenu();saveError(error);}finally{setBusy(false);}
}
async function backToCases(){
  if(state.busy||state.retryVote||state.view!=='workspace')return;
  setBusy(true);
  try{if(!(await flushNote()))return;await refreshLocal();renderCaseMenu();$('#case-menu-title')?.focus({preventScroll:true});void sendPending();}catch(error){saveError(error);}finally{setBusy(false);}
}
async function loadCase(id){
  const key=JSON.stringify([state.evaluator.id,id]),cached=state.cache.get(key);let result=cached;
  if(!result){result=await api(`/api/cases/${encodeURIComponent(id)}?evaluator=${encodeURIComponent(state.evaluator.id)}`);state.cache.set(key,result);}
  if(result.datasetVersion!==state.data.datasetVersion||result.generation!==generationFor(state.evaluator.id)||result.rubricVersion!==state.data.rubricVersion){state.cache.delete(key);throw new Error('La versión de los datos cambió. Vuelve a cargar la página; tus pendientes se conservarán aparte.');}
  state.caseId=id;state.caseData=result;state.note='';state.dirty=false;state.error='';await refreshLocal();state.index=result.questions.findIndex(q=>!isRated(state.answers.get(q.id)));state.done=state.index===-1;if(state.done)state.index=0;state.note=savedNote();resetQuestionView();state.view='workspace';renderWorkspace();focusQuestion();
}
function bioHTML(){
  const c=state.caseData.case,index=caseDisplayNumber(c,state.data.cases.findIndex(s=>s.id===c.id));
  return `<aside class="bio-panel" aria-label="Biografía del caso"><div class="bio-top"><div class="bio-case-label eyebrow">${icon('file')} Sujeto ${String(index).padStart(2,'0')} · Biografía</div><div class="bio-person"><div class="bio-avatar">${icon('user')}</div><div><h2>${esc(c.name)}</h2></div></div></div><div class="bio-content"><dl class="bio-details"><div><dt>Edad</dt><dd>${esc(c.age)} años</dd></div>${c.gender?`<div><dt>Género</dt><dd>${esc(c.gender)}</dd></div>`:''}${(c.details||[]).map(d=>`<div><dt>${esc(d.label)}</dt><dd>${esc(d.value)}</dd></div>`).join('')}</dl>${c.context?`<p class="bio-context">${esc(c.context)}</p>`:''}</div></aside>`;
}
function questionMapHTML(){
  state.questionMapOpen??=!mobileLayout();
  const n=state.caseData.questions.length;
  return `<details class="question-map sidebar-question-map" id="question-map" ${state.questionMapOpen?'open':''}><summary><span>Preguntas</span><span class="question-map-count">${count()} de ${n}</span></summary><nav class="question-nav" aria-label="Ir a una pregunta">${state.caseData.questions.map((q,i)=>{const a=state.answers.get(q.id);return `<button class="question-dot ${isRated(a)?'rated rating-4':isStarted(a)?'partial-rating':''} ${!state.done&&i===state.index?'current':''}" data-index="${i}" aria-label="Pregunta ${i+1}${isRated(a)?', tres criterios completos':isStarted(a)?`, ${criterionCount(a)} de tres criterios`: ', pendiente'}" ${!state.done&&i===state.index?'aria-current="step"':''}>${String(i+1).padStart(2,'0')}</button>`;}).join('')}</nav></details>`;
}
function renderWorkspace(){
  state.view='workspace';
  $('#app').innerHTML=`${evaluationHeaderHTML()}<main class="workspace"><div class="review-sidebar">${bioHTML()}${questionMapHTML()}</div><section class="review-column" aria-label="Evaluación de preguntas"><div class="case-nav-row"><button class="ghost" id="back-to-cases" data-action>${icon('back')} Ver casos</button></div><div id="question-container">${state.done?doneHTML():questionHTML()}</div><div class="error-box" id="save-error" role="alert"></div>${state.done?'<div class="completion-save-state" data-save-status role="status"></div>':''}${state.data.capabilities?.exportResults?`<div class="review-export">${exportLinkHTML('Exportar resultados de los evaluadores')}</div>`:''}</section></main>`;
  $('#change-person').onclick=changePerson;$('#back-to-cases').onclick=backToCases;
  const map=$('#question-map');map.ontoggle=()=>{state.questionMapOpen=map.open;};
  document.querySelectorAll('[data-index]').forEach(b=>b.onclick=()=>navigate(Number(b.dataset.index)));bindQuestion();paintStatus();setBusy(state.busy);
}
function rubricGuideHTML(){
  return `<details class="rubric-guide" ${state.guideOpen?'open':''}><summary>Consultar guía de puntuación</summary><p>Usa estos niveles para el criterio que estás calificando. En Ausencia de Alucinación, 4 significa que el motivo se ciñe a la información; 1, que inventa datos o se ancla fuera de contexto.</p><dl class="criteria-reference">${criteria.map(c=>`<div><dt>${esc(c.label)}</dt><dd>${esc(c.description)}</dd></div>`).join('')}</dl><dl class="rubric-scale">${ratingLabels.map((label,i)=>`<div><dt><strong>${i+1}</strong> ${esc(label)}</dt><dd>${esc(scaleDescriptions[i])}</dd></div>`).join('')}</dl></details>`;
}
function phraseHTML(q){
  const response=typeof q.response==='string'?q.response:'';
  const sourceDifference=typeof q.sourceResponseDifference==='string'?q.sourceResponseDifference:'';
  const responseLabel=sourceDifference?'Respuesta en el archivo de IA':`Respuesta de ${esc(state.caseData.case.name)}`;
  const sourceNote=sourceDifference?`<p class="phrase-source-note">En el archivo original: «${esc(sourceDifference)}».</p>`:'';
  if(response.trim()&&(q.promptMissing===true||q.textMode==='response-only'))return `<div class="phrase-context phrase-response-only"><div class="phrase-source-label">${responseLabel}</div><h2 class="question-prompt phrase-response" tabindex="-1">${esc(response)}</h2>${sourceNote}<p class="phrase-missing-note">Enunciado no incluido en el archivo</p></div>`;
  if(response.trim())return `<div class="phrase-context"><div class="phrase-source-label">Pregunta original</div><h2 class="question-prompt phrase-prompt" tabindex="-1">${esc(q.prompt)}</h2><div class="phrase-response-block"><div class="phrase-source-label">${responseLabel}</div><p class="phrase-response">${esc(response)}</p>${sourceNote}</div></div>`;
  return `<div class="phrase-context phrase-complete"><h2 class="question-prompt" tabindex="-1">${esc(q.prompt)}</h2></div>`;
}
function questionHTML(){
  const q=current(),a=currentAnswer(),answered=criterionCount(a);
  return `<article class="question-card"><div class="question-body"><div class="question-card-top"><span class="eyebrow">Pregunta ${String(state.index+1).padStart(2,'0')}</span>${a?.synthetic?'<span class="synthetic-badge">Datos de prueba</span>':''}</div>${phraseHTML(q)}<section class="ai-block" aria-label="Motivo de la inteligencia artificial"><div class="ai-top"><h3 class="ai-heading">${icon('sparkle')} Evaluación de la IA</h3><span class="pill classification classification-prominent ${esc(q.classification)}"><span class="dot"></span>${esc(q.classificationOriginal||q.classification)}</span></div><div class="eyebrow explanation-label">Motivo de la IA</div><p class="ai-explanation">${esc(q.justification)}</p></section></div><div class="vote-section rubric-section">${a?.synthetic?'<p class="synthetic-notice">Estas puntuaciones son artificiales. Al calificar se reemplazan por tu evaluación; completa los tres criterios.</p>':''}<div class="vote-question">Califica el motivo de la IA<span class="criteria-progress">${answered} de 3</span></div>${a?.rating&&!isStarted(a)?'<p class="legacy-notice">La puntuación anterior de 1 a 5 no se convierte a esta rúbrica. Completa los tres criterios.</p>':''}${criteria.map((criterion,i)=>`<section class="rubric-criterion ${state.activeCriterion===criterion.key?'active-criterion':''}" data-criterion-row="${criterion.key}" aria-labelledby="criterion-${criterion.key}"><h3 class="criterion-heading" id="criterion-${criterion.key}" tabindex="-1"><span>${i+1}</span> ${esc(criterion.label)}</h3><p class="criterion-description">${esc(criterion.description)}</p>${criterion.key==='noHallucination'?'<p class="criterion-direction">4: se ciñe a la frase · 1: inventa datos o se ancla fuera de contexto.</p>':''}<div class="criterion-votes" role="group" aria-label="${esc(criterion.label)}">${ratingLabels.map((label,index)=>`<button class="vote-button rubric-vote ${a?.ratings?.[criterion.key]===index+1?'selected':''}" data-criterion="${criterion.key}" data-rating="${index+1}" aria-pressed="${a?.ratings?.[criterion.key]===index+1}" aria-label="${esc(criterion.label)}: ${index+1} de 4, ${label}"><span class="rating-number" aria-hidden="true">${index+1}</span><span class="rating-label">${label}</span></button>`).join('')}</div></section>`).join('')}${rubricGuideHTML()}<div class="rubric-continue"><button class="primary" id="continue" data-action ${answered!==3?'disabled':''}>Continuar ${icon('arrow')}</button></div></div></article><div class="question-footer"><div data-save-status role="status"></div><div class="question-controls"><button class="ghost" id="prev" data-action ${state.index===0?'disabled':''}>${icon('back')} Anterior</button><button class="ghost" id="next" data-action>${state.index===state.caseData.questions.length-1?'Ver avance':'Siguiente'} ${icon('arrow')}</button></div></div><p class="keyboard-hint">${icon('keyboard')} Teclas 1 a 4: criterio activo · Enter: continuar con los 3 criterios completos</p>`;
}
function doneHTML(){
  const rated=[...state.answers.values()].filter(a=>isRated(a)&&!a.synthetic),synthetic=syntheticCountCase(state.caseId);
  return `<section class="done-card"><div class="done-icon">${icon('check')}</div><span class="eyebrow muted">${esc(state.caseData.case.name)}</span><h2 class="done-heading" tabindex="-1">Gracias por aportar tu criterio.</h2>${synthetic?`<p class="synthetic-notice">${synthetic} son datos de prueba. Las medias siguientes incluyen únicamente evaluaciones humanas.</p>`:''}<div class="done-stats rubric-done-stats">${criteria.map(c=>`<div><strong>${rated.length?(rated.reduce((sum,a)=>sum+a.ratings[c.key],0)/rated.length).toLocaleString('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1}):'—'}<small> / 4</small></strong><span>${esc(c.label)}</span></div>`).join('')}</div><div class="done-actions"><button class="primary" id="next-case" data-action>Volver a los casos ${icon('arrow')}</button></div></section>`;
}
function activateCriterion(key){
  if(!criteria.some(c=>c.key===key))return;state.activeCriterion=key;
  document.querySelectorAll('[data-criterion-row]').forEach(row=>row.classList.toggle('active-criterion',row.dataset.criterionRow===key));
}
function resetQuestionView(){
  state.activeCriterion=currentAnswer()?.synthetic?criteria[0].key:criteria.find(c=>!validRating(currentAnswer()?.ratings?.[c.key]))?.key||criteria[0].key;
}
function rememberOpenDetails(){state.guideOpen=Boolean($('.rubric-guide')?.open);const map=$('#question-map');if(map)state.questionMapOpen=map.open;}
function bindQuestion(){
  if($('#next-case'))$('#next-case').onclick=backToCases;if(state.done)return;
  document.querySelectorAll('[data-criterion][data-rating]').forEach(b=>{b.onclick=event=>{if(event.detail<2)void vote(b.dataset.criterion,Number(b.dataset.rating));};b.onfocus=()=>activateCriterion(b.dataset.criterion);});
  $('#prev').onclick=()=>navigate(state.index-1);$('#next').onclick=()=>advance(false);$('#continue').onclick=()=>advance(true);
}
async function putVote(ratings,comment){
  const a=currentAnswer(),answer={caseId:state.caseId,questionId:current().id,ratings,comment,expectedRevision:a?.revision||0,wasRated:isRated(a)&&!a?.pending,replacesSynthetic:a?.synthetic===true};
  await state.queue.put(answer);await refreshLocal();state.error='';state.retryVote=null;paintStatus();
}
function flushNote(){
  if(state.notePromise)return state.notePromise;if(!state.dirty||!isStarted(currentAnswer()))return Promise.resolve(true);
  state.notePromise=(async()=>{try{while(state.dirty&&isStarted(currentAnswer())){await putVote({...currentAnswer().ratings},state.note);state.dirty=state.note.trim()!==savedNote();}return true;}catch(error){saveError(error);return false;}})().finally(()=>{state.notePromise=null;paintStatus();});paintStatus();return state.notePromise;
}
async function vote(criterion,rating){
  if(state.view!=='workspace'||!state.caseData||!criteria.some(c=>c.key===criterion)||!validRating(rating)||state.busy||state.done||state.confirming||state.pendingDoc?.blocked)return;
  state.lastVoteAt=Date.now();setBusy(true);let focusNext=false;
  try{
    if(!(await flushNote()))return;rememberOpenDetails();
    const synthetic=currentAnswer()?.synthetic===true;
    const ratings=synthetic?{}:Object.fromEntries(criteria.filter(c=>validRating(currentAnswer()?.ratings?.[c.key])).map(c=>[c.key,currentAnswer().ratings[c.key]]));ratings[criterion]=rating;
    if(synthetic)state.note='';
    await putVote(ratings,state.note);state.dirty=false;state.note=savedNote();
    state.activeCriterion=criteria.find(c=>!validRating(ratings[c.key]))?.key||criterion;renderWorkspace();focusNext=true;
    announce(`${criteria.find(c=>c.key===criterion).label}: ${rating} de 4 guardado en este dispositivo. ${criterionCount(currentAnswer())} de 3 criterios completos.`);
  }catch(error){state.retryVote={criterion,rating};saveError(error);}
  finally{setBusy(false);if(focusNext)focusRatingControl();}
}
function readingTop(){
  const header=$('.app-header')?.getBoundingClientRect?.().height||0;
  return header+6;
}
function scrollByReadingOffset(offset){if(Math.abs(offset)>1&&window.scrollTo)window.scrollTo({top:Math.max(0,(window.scrollY||0)+offset),behavior:'instant'});}
function focusRatingControl(){
  const complete=isRated(currentAnswer());
  const button=complete?$('#continue'):$(`#criterion-${state.activeCriterion}`);
  button?.focus({preventScroll:true});
  const region=complete?button:document.querySelector(`[data-criterion-row="${state.activeCriterion}"]`);
  const rect=region?.getBoundingClientRect?.();if(!rect)return;
  const top=readingTop(),bottom=(window.innerHeight||0)-16;if(bottom<=top)return;
  // Keep a visible criterion still; otherwise reveal its title and choices together.
  if(rect.height>bottom-top||rect.top<top)scrollByReadingOffset(rect.top-top);
  else if(rect.bottom>bottom)scrollByReadingOffset(rect.bottom-bottom);
}
function focusQuestion(){
  if(mobileLayout()){state.questionMapOpen=false;const map=$('#question-map');if(map)map.open=false;}
  const heading=$(state.done?'.done-heading':'.question-prompt');heading?.focus({preventScroll:true});
  const card=$(state.done?'.done-card':'.question-card'),rect=card?.getBoundingClientRect?.();
  if(rect)scrollByReadingOffset(rect.top-readingTop());
}
function moveToNextPending(){const questions=state.caseData.questions;let index=-1;for(let step=1;step<=questions.length;step++){const next=(state.index+step)%questions.length;if(!isRated(state.answers.get(questions[next].id))){index=next;break;}}state.done=index===-1;if(!state.done)state.index=index;state.note=savedNote();state.dirty=false;resetQuestionView();renderWorkspace();focusQuestion();}
async function navigate(index){if(state.view!=='workspace'||state.busy||state.retryVote||index<0||index>=state.caseData.questions.length)return;setBusy(true);try{if(!(await flushNote()))return;state.index=index;state.done=false;state.note=savedNote();state.dirty=false;resetQuestionView();renderWorkspace();focusQuestion();void sendPending();}finally{setBusy(false);}}
async function advance(pending){if(state.view!=='workspace'||state.busy||state.retryVote)return;if(pending&&!isRated(currentAnswer())){announce('Completa los tres criterios para continuar. Puedes usar Siguiente para revisar otra pregunta y conservar el avance parcial.');return;}setBusy(true);try{if(!(await flushNote()))return;if(pending||state.index===state.caseData.questions.length-1)moveToNextPending();else{state.index++;state.note=savedNote();resetQuestionView();renderWorkspace();focusQuestion();}void sendPending({force:state.done});}finally{setBusy(false);}}
async function saveNow(){if(state.busy)return;setBusy(true);try{if(state.retryVote){const ratings={...(currentAnswer()?.synthetic?{}:currentAnswer()?.ratings||{}),[state.retryVote.criterion]:state.retryVote.rating};if(currentAnswer()?.synthetic)state.note='';await putVote(ratings,state.note);state.dirty=false;renderWorkspace();}if(await flushNote())await sendPending({force:true,manual:true});}catch(error){saveError(error);}finally{setBusy(false);paintStatus();}}
async function changeCase(id){if(state.busy||state.retryVote||id===state.caseId)return;setBusy(true);try{if(!(await flushNote()))return;await loadCase(id);void sendPending();}catch(error){saveError(error);if($('#case-select'))$('#case-select').value=state.caseId;}finally{setBusy(false);}}
async function refreshEntryProgress(){try{state.data=await api('/api/bootstrap');state.data.caseProgress??={};state.entryRefreshError='';}catch{state.entryRefreshError='No pudimos actualizar el avance del equipo. Se muestra la última información disponible; vuelve a abrir la página cuando haya conexión.';}}
async function changePerson(){if(state.busy||state.retryVote)return;setBusy(true);try{if(!(await flushNote()))return;const saved=await sendPending({force:true,manual:true});if(!saved&&!(await confirmAction({title:'Hay respuestas pendientes en este dispositivo',description:'Se conservarán asociadas a tu nombre y podrás recuperarlas aquí. Todavía no están todas en el servidor. Si el envío falla, el aviso de error permite descargar los pendientes.',confirmText:'Pausar con pendientes'})))return;state.queue?.close();state.queue=null;state.pendingDoc=null;state.cache.clear();persistIdentity(null);state.selected=null;state.entryNotice=saved?'':'Se conservaron tus respuestas pendientes en este navegador.';await refreshEntryProgress();await findOrphans();renderEntry();}catch(error){saveError(error);}finally{setBusy(false);}}


document.addEventListener('keydown',event=>{
  if(state.view!=='workspace'||!state.evaluator||state.done||state.confirming)return;
  const target=event.target,typing=['TEXTAREA','INPUT','SELECT'].includes(target.tagName)||target.isContentEditable;
  const ratingControl=target.closest?.('[data-criterion][data-rating], #continue');
  const otherControl=!ratingControl&&(target.closest?.('button, a, summary, [role="button"]')||['BUTTON','A','SUMMARY'].includes(target.tagName));
  if(event.key==='Enter'&&!typing&&!otherControl){
    // Cancel native button activation even while saving or holding down Enter.
    event.preventDefault();
    if(state.busy||state.retryVote||event.repeat||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(isRated(currentAnswer()))void advance(true);
    else announce('Completa los tres criterios para continuar.');
    return;
  }
  if(typing||state.busy||event.repeat||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(/^[1-4]$/.test(event.key)){event.preventDefault();void vote(state.activeCriterion,Number(event.key));}
},true);
window.addEventListener('beforeunload',event=>{if(state.dirty||state.notePromise||state.busy||state.retryVote){event.preventDefault();event.returnValue='';}});
window.addEventListener('online',()=>{if(state.queue&&(pendingItems().filter(isRated).length>=10||state.pendingDoc?.inFlight))void sendPending();});
let previousMobileLayout=mobileLayout();
window.addEventListener('resize',()=>{
  const mobile=mobileLayout(),enteredMobile=mobile&&!previousMobileLayout;previousMobileLayout=mobile;
  if(!enteredMobile||state.view!=='workspace'||!state.caseData)return;
  // The desktop map must not cover the question when the compact layout starts.
  state.questionMapOpen=false;const map=$('#question-map');if(map)map.open=false;
  const card=$(state.done?'.done-card':'.question-card'),rect=card?.getBoundingClientRect?.();
  if(rect)scrollByReadingOffset(rect.top-readingTop());
},{passive:true});
async function boot(){try{state.data=await api('/api/bootstrap');state.data.caseProgress??={};await findOrphans();renderEntry();}catch(error){$('#app').innerHTML=`<main class="connection-error">${brand()}<h1 class="connection-heading">No pudimos preparar la evaluación.</h1><p>${esc(error.message)}<br>Los pendientes de este navegador se conservan. Comprueba que el servidor esté abierto y vuelve a intentar.</p><button class="primary" id="reload">Volver a intentar ${icon('arrow')}</button></main>`;$('#reload').onclick=boot;}}
boot();
