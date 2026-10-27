'use strict';

// Each transaction reads and replaces one evaluator's outbox atomically. Network
// requests never run inside IndexedDB transactions. The frozen request remains
// untouched until the server acknowledges it, including after a page reload.
(function (root) {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const answerKey = a => JSON.stringify([a.caseId, a.questionId]);
  const RUBRIC_VERSION = 'sacks-motivo-3x4-v1';
  const CRITERIA = ['clinicalRelevance', 'clarityCoherence', 'noHallucination'];
  const validScore = value => Number.isInteger(value) && value >= 1 && value <= 4;
  const complete = answer => CRITERIA.every(key => validScore(answer?.ratings?.[key]));
  const equalRatings = (a, b) => CRITERIA.every(key => a?.[key] === b?.[key]) && Object.keys(a||{}).every(key => CRITERIA.includes(key));
  const empty = () => ({pending:{}, confirmed:{}, inFlight:null, blocked:null});
  class IndexedDbStore {
    constructor(factory = root.indexedDB) { this.factory=factory; this.opening=null; }
    open() {
      if(this.opening)return this.opening;
      this.opening=new Promise((resolve,reject)=>{
        if(!this.factory) { reject(new Error('Este navegador no permite guardar respuestas pendientes. Usa una ventana normal de un navegador actualizado.'));return; }
        const request=this.factory.open('criterio-pendientes',1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('outboxes'))request.result.createObjectStore('outboxes');};
        request.onerror=()=>reject(new Error('No se pudo abrir el almacenamiento de este navegador. No se avanzará sin guardar tu respuesta.'));
        request.onblocked=()=>reject(new Error('Otra pestaña está bloqueando el almacenamiento. Ciérrala y vuelve a intentar.'));
        request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
      }).catch(error=>{this.opening=null;throw error;});
      return this.opening;
    }
    async change(key, mutate) {
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        let tx;
        try {tx=db.transaction('outboxes','readwrite',{durability:'strict'});} catch {tx=db.transaction('outboxes','readwrite');}
        const store=tx.objectStore('outboxes');let result;let failure;
        const request=store.get(key);
        request.onsuccess=()=>{try{const doc=request.result||empty();result=mutate(doc);store.put(doc,key);}catch(error){failure=error;tx.abort();}};
        tx.oncomplete=()=>resolve(clone(result));
        tx.onabort=tx.onerror=()=>reject(failure||new Error('No se pudo guardar en este dispositivo. Libera espacio o permite el almacenamiento; tu respuesta sigue en pantalla.'));
      });
    }
    async read(key) {
      const db=await this.open();
      return new Promise((resolve,reject)=>{const tx=db.transaction('outboxes','readonly');const req=tx.objectStore('outboxes').get(key);tx.oncomplete=()=>resolve(req.result||empty());tx.onabort=tx.onerror=()=>reject(new Error('No se pudieron recuperar las respuestas pendientes.'));});
    }
    async list() {
      const db=await this.open();
      return new Promise((resolve,reject)=>{const entries=[];const tx=db.transaction('outboxes','readonly');const req=tx.objectStore('outboxes').openCursor();req.onsuccess=()=>{const cursor=req.result;if(cursor){entries.push({key:cursor.key,...cursor.value});cursor.continue();}};tx.oncomplete=()=>resolve(entries);tx.onabort=tx.onerror=()=>reject(new Error('No se pudieron recuperar los pendientes.'));});
    }
  }
  class Outbox {
    constructor({store, evaluatorId,datasetVersion,rubricVersion,generation,send,lock,uuid,sleep,onChange=()=>{},onAck=()=>{},onStatus=()=>{}}) {
      if(rubricVersion!==RUBRIC_VERSION)throw new Error('La rúbrica cambió. Recarga la página antes de continuar.');
      this.store=store||new IndexedDbStore();this.scope={evaluatorId,datasetVersion,rubricVersion,generation};
      this.key=JSON.stringify([datasetVersion,rubricVersion,generation,evaluatorId]);this.send=send;
      this.uuid=uuid||(()=>root.crypto.randomUUID());this.sleep=sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
      this.lock=lock||((name,work)=>{if(!root.navigator?.locks)throw new Error('Este navegador no permite coordinar el envío seguro entre pestañas. Abre el enlace HTTPS en Chrome, Edge o Firefox actualizado. Tus pendientes siguen guardados aquí.');return root.navigator.locks.request(name,work);});
      this.onChange=onChange;this.onAck=onAck;this.onStatus=onStatus;this.syncPromise=null;this.forceRequested=false;this.manualRequested=false;
      if(root.BroadcastChannel){this.channel=new root.BroadcastChannel('criterio-outbox');this.channel.onmessage=event=>{if(event.data===this.key)this.onChange();};}
    }
    notify(){try{this.onChange();}catch{}try{this.channel?.postMessage(this.key);}catch{}}
    close(){this.channel?.close();this.channel=null;}
    read(){return this.store.read(this.key);}
    async put(answer) {
      const ratings=answer.ratings;
      if(!ratings||typeof ratings!=='object'||Array.isArray(ratings)||!Object.keys(ratings).length||Object.entries(ratings).some(([key,value])=>!CRITERIA.includes(key)||!validScore(value)))throw new Error('Califica cada criterio con un número entero de 1 a 4.');
      if(answer.comment!==undefined&&(typeof answer.comment!=='string'||answer.comment.length>4000))throw new Error('El comentario debe ser texto de hasta 4000 caracteres.');
      const result=await this.store.change(this.key,doc=>{
        if(doc.blocked)throw new Error('Hay respuestas pendientes que requieren revisión antes de continuar.');
        const key=answerKey(answer), previous=doc.pending[key], confirmed=doc.confirmed[key];
        const item={caseId:answer.caseId,questionId:answer.questionId,ratings:clone(ratings),
          expectedRevision:previous?.expectedRevision??Math.max(answer.expectedRevision||0,confirmed?.revision||0),
          wasRated:previous?.wasRated??Boolean(answer.wasRated||complete(confirmed)),
          replacesSynthetic:previous?.replacesSynthetic??Boolean(answer.replacesSynthetic),opId:this.uuid(),localUpdatedAt:new Date().toISOString()};
        if(answer.comment?.trim())item.comment=answer.comment.trim();
        doc.pending[key]=item;doc.scope={...this.scope};return item;
      });this.notify();return result;
    }
    async freeze(force) {
      return this.store.change(this.key,doc=>{
        if(doc.blocked)return {blocked:doc.blocked};
        if(doc.inFlight)return doc.inFlight;
        // Automatic batches contain ten complete questions (thirty scores).
        // Explicit save/pause also sends unfinished questions, without counting
        // them as completed. Every click is already durable in IndexedDB.
        const values=Object.values(doc.pending).filter(a=>force||complete(a));
        if(!values.length||(!force&&values.length<10))return null;
        const chosen=values.slice(0,10), tokens={};
        const evaluations=chosen.map(a=>{tokens[answerKey(a)]=a.opId;const {caseId,questionId,ratings,expectedRevision,comment}=a;return {caseId,questionId,ratings:clone(ratings),expectedRevision,...(comment?{comment}:{})};});
        const payload={...this.scope,batchId:this.uuid(),evaluations};
        doc.inFlight={payload,tokens,attempts:0};return doc.inFlight;
      });
    }
    async acknowledge(frozen,response) {
      const submitted=frozen.payload.evaluations;
      if(response?.saved!==true||response.batchId!==frozen.payload.batchId||response.datasetVersion!==this.scope.datasetVersion||response.rubricVersion!==this.scope.rubricVersion||response.generation!==this.scope.generation||!Array.isArray(response.evaluations)||response.evaluations.length!==submitted.length)throw new Error('El servidor no confirmó el bloque completo. Las respuestas siguen pendientes en este dispositivo.');
      for(const sent of submitted){const ack=response.evaluations.find(a=>answerKey(a)===answerKey(sent));if(!ack||!equalRatings(ack.ratings,sent.ratings)||(ack.comment||'')!==(sent.comment||'')||!Number.isInteger(ack.revision)||ack.revision<1)throw new Error('La confirmación del servidor no coincide con el bloque. Conservamos las respuestas pendientes.');}
      await this.store.change(this.key,doc=>{
        if(doc.inFlight?.payload.batchId!==frozen.payload.batchId)throw new Error('El bloque cambió antes de confirmar.');
        for(const ack of response.evaluations){const key=answerKey(ack);doc.confirmed[key]=ack;const pending=doc.pending[key];if(pending?.opId===frozen.tokens[key])delete doc.pending[key];else if(pending){pending.expectedRevision=ack.revision;pending.wasRated=complete(ack);pending.replacesSynthetic=Boolean(ack.synthetic);}}
        doc.inFlight=null;doc.lastReceipt={batchId:response.batchId,completed:response.completed,total:response.total,caseProgress:response.caseProgress,caseStarted:response.caseStarted,
          adminRevision:response.adminRevision,realCompleted:response.realCompleted,syntheticCompleted:response.syntheticCompleted,caseSynthetic:response.caseSynthetic,
          generation:response.generation,evaluatorId:this.scope.evaluatorId};
      });this.notify();try{await this.onAck(response);}catch{}
    }
    sync({force=false,manual=false}={}) {
      this.forceRequested ||= force;this.manualRequested ||= manual;
      if(this.syncPromise)return this.syncPromise;
      this.syncPromise=this.lock(`criterio-sync:${this.key}`,async()=>{
        let forceAll=this.forceRequested;this.forceRequested=false;
        if(this.manualRequested){this.manualRequested=false;await this.store.change(this.key,doc=>{if(doc.inFlight)doc.inFlight.attempts=0;});}
        while(true){
          forceAll ||= this.forceRequested;this.forceRequested=false;
          const frozen=await this.freeze(forceAll);
          if(!frozen)return {saved:true};
          if(frozen.blocked){const error=Object.assign(new Error('El servidor detectó un cambio de datos o una edición desde otra sesión. Los pendientes se conservaron y no se reenviarán automáticamente.'),{status:409,...frozen.blocked});throw error;}
          if(frozen.attempts>=3)throw new Error('El bloque sigue guardado en este dispositivo. Pulsa Guardar ahora para volver a intentar cuando haya conexión.');
          this.onStatus('sending');
          while(true){
            const attempts=await this.store.change(this.key,doc=>{if(doc.inFlight?.payload.batchId!==frozen.payload.batchId)throw new Error('El bloque pendiente cambió.');return ++doc.inFlight.attempts;});
            try {const response=await this.send(clone(frozen.payload));await this.acknowledge(frozen,response);break;}
            catch(error){
              if(error.status===409||error.status===400||error.status===413){await this.store.change(this.key,doc=>{doc.blocked={code:error.code||'REJECTED_BATCH',message:error.message,conflicts:error.conflicts||[]};});this.notify();throw error;}
              if(attempts>=3)throw error;
              this.onStatus('waiting');await this.sleep(attempts===1?2000:8000);
            }
          }
        }
      }).finally(()=>{this.syncPromise=null;this.onStatus('idle');});
      return this.syncPromise;
    }
  }
  const exported={IndexedDbStore,Outbox,answerKey,complete,CRITERIA,RUBRIC_VERSION};
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
  root.CriterioQueue=exported;
})(typeof window!=='undefined'?window:globalThis);
