// Kongrem — kongre programı planlayıcı (web + iOS/Android uygulaması).
// Program verisi kodda değil, data/v1/<kongre>.json dosyalarındadır; yeni kongre = yeni veri dosyası.
// Güvenlik: veri dosyalarındaki her metin ekrana yazılmadan önce esc() ile kaçırılır; veri biçimi okunmadan önce denetlenir.
"use strict";

// ---- Ortam: iOS/Android uygulaması içinde mi? (Capacitor). Web'de bu kısımlar devre dışıdır.
const CAP=window.Capacitor,NATIVE=!!(CAP&&CAP.isNativePlatform&&CAP.isNativePlatform());
const NP=NATIVE?Object.fromEntries(["LocalNotifications","Preferences","Share","App","SplashScreen"].map(n=>{try{return[n,CAP.registerPlugin?CAP.registerPlugin(n):CAP.Plugins&&CAP.Plugins[n]];}catch(e){return[n,null];}})):{};
if(NATIVE)document.documentElement.classList.add("native");

// Veri adresi. Uygulama içindeki kopya her zaman çalışır; uygulama buradan daha yeni programları ve yeni kongreleri alır.
const DATA_DIR="data/v1/";
const REMOTE=NATIVE?"https://babazade-a.github.io/tgk2026/"+DATA_DIR:null;
const SCHEMA=1; // bu sürümün okuyabildiği veri biçimi

// ---- Kayıt. Tarayıcı belleği + uygulamada sistemin silmediği yerel depolama (Preferences)
const lsGet=k=>{try{return localStorage.getItem(k);}catch(e){return null;}};
function store(k,v){try{localStorage.setItem(k,v)}catch(e){}if(NATIVE&&NP.Preferences)NP.Preferences.set({key:k,value:v}).catch(()=>{});}
// Anahtarlar: genel olanlar + kongre başına olanlar
const G={lang:"kongrem:dil",rem:"kongrem:hatirlatma",last:"kongrem:kongre",index:"kongrem:liste"};
const K=id=>({sel:`kongrem:${id}:secim`,notes:`kongrem:${id}:notlar`,tab:`kongrem:${id}:sekme`,data:`kongrem:${id}:veri`});
// Eski (tek kongreli) sürümün kayıtlarını bir kez taşı: o sürümü kullananların seçimleri ve notları kaybolmasın
function migrateLegacy(){
  const pairs=[[G.lang,"tgk2026-dil"],[G.rem,"tgk2026-hatirlatma"],
    [K("tgk2026").sel,"tgk2026-secim"],[K("tgk2026").notes,"tgk2026-notlar"],[K("tgk2026").tab,"tgk2026-sekme"]];
  for(const [n,o] of pairs){const v=lsGet(o);if(v!=null&&lsGet(n)==null)store(n,v);}
}
// Uygulamada: sistem depolamasındaki kayıtlar esastır (WebView belleği silinmiş olabilir)
async function prefsToLocal(){
  if(!NATIVE||!NP.Preferences)return;
  try{const {keys}=await NP.Preferences.keys();
    for(const k of keys.filter(k=>k.startsWith("kongrem:"))){const {value}=await NP.Preferences.get({key:k});if(value!=null)try{localStorage.setItem(k,value)}catch(e){}}
    // Preferences'ta olmayan ama tarayıcı belleğinde olanları da yedekle
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith("kongrem:")&&!keys.includes(k))NP.Preferences.set({key:k,value:localStorage.getItem(k)}).catch(()=>{});}
  }catch(e){console.warn("kayıtlar okunamadı",e);}
}

// ---- Durum
let IDX=[];      // kongre listesi
let C=null;      // açık kongre (veri dosyası)
let DAYS=[],M=[],BYID={},TALKS={},SESS={},ODAYS=[],ORAL_S=480,ORAL_E=530,PER=7;
let sel=new Set(),notes={},tab="",oralDay="",q="",NOW0=null;
let lang=(()=>{const v=lsGet(G.lang)||lsGet("tgk2026-dil");return v==="tr"||v==="en"?v:(/^tr/i.test(navigator.language||"tr")?"tr":"en");})();
let remOn=lsGet(G.rem)!=="0"&&lsGet("tgk2026-hatirlatma")!=="0",notifDenied=false,exactOK=true;
const ANDROID=NATIVE&&CAP.getPlatform&&CAP.getPlatform()==="android";

// ---- Yardımcılar
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const low=s=>String(s).toLocaleLowerCase("tr");
const mins=t=>{const [h,m]=t.split(":").map(Number);return h*60+m};
const hm=m=>String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
const tx=o=>o==null?"":typeof o==="string"?o:(o[lang]||o.tr||o.en||"");   // çok dilli metin
const allTx=o=>o==null?"":typeof o==="string"?o:[o.tr,o.en].filter(Boolean).join(" "); // arama: tüm diller
// Türkçe saatlere yönelme eki: 16:30'a, 14:00'e, 16:00'ya
function datTR(t){const [h,m]=t.split(":").map(Number),n=m||h;if(n===0)return "a";const u=n%10;
  return u?["","e","ye","e","e","e","ya","ye","e","a"][u]:["","a","ye","a","a","ye"][n/10];}

// ---- Veri biçimi denetimi (uzaktan gelen dosyaya güvenilmez)
const isStr=v=>typeof v==="string",isTime=v=>isStr(v)&&/^\d\d:\d\d$/.test(v),isML=v=>isStr(v)||(v&&typeof v==="object"&&(isStr(v.tr)||isStr(v.en)));
function validConf(d){
  try{
    if(!d||d.schema!==SCHEMA||!isStr(d.id)||!/^[a-z0-9-]{2,40}$/.test(d.id)||typeof d.rev!=="number")return false;
    if(!isML(d.name)||!isStr(d.short)||typeof d.utcOffsetMin!=="number"||!Array.isArray(d.days)||!d.days.length)return false;
    if(!d.days.every(x=>isStr(x.k)&&/^\d{4}-\d\d-\d\d$/.test(x.date)&&isML(x.label)&&isML(x.weekday)))return false;
    if(!Array.isArray(d.items)||!d.items.every(x=>isStr(x.id)&&isStr(x.day)&&isTime(x.start)&&isTime(x.end)&&isStr(x.type)&&isML(x.title)))return false;
    if(d.oral){const o=d.oral;if(!isTime(o.start)||!isTime(o.end)||typeof o.minutesPerTalk!=="number"||!Array.isArray(o.sessions))return false;
      if(!o.sessions.every(s=>isStr(s.day)&&isStr(s.room)&&Array.isArray(s.talks)&&s.talks.every(t=>isStr(t.id)&&isML(t.title))))return false;}
    return true;
  }catch(e){return false;}
}
const validIndex=d=>d&&d.schema===SCHEMA&&Array.isArray(d.conferences)&&d.conferences.every(c=>isStr(c.id)&&/^[a-z0-9-]{2,40}$/.test(c.id)&&isStr(c.short)&&isML(c.name));
async function getJSON(url,ms){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),ms||8000);
  try{const r=await fetch(url,{cache:"no-cache",signal:ctl.signal,credentials:"omit"});if(!r.ok)throw new Error(r.status);return await r.json();}
  finally{clearTimeout(t);}
}
const readCache=k=>{try{return JSON.parse(lsGet(k)||"null");}catch(e){return null;}};

// ---- Kongre listesi ve kongre verisi
async function loadIndex(){
  let idx=null;try{const d=await getJSON(DATA_DIR+"conferences.json",5000);if(validIndex(d))idx=d;}catch(e){}
  const c=readCache(G.index);if(validIndex(c)&&(!idx||c.conferences.length>=idx.conferences.length))idx=c;
  IDX=idx?idx.conferences:[];
  if(REMOTE)getJSON(REMOTE+"conferences.json",8000).then(d=>{if(validIndex(d)){store(G.index,JSON.stringify(d));IDX=d.conferences;if(tab==="home")render();updateHeader();}}).catch(()=>{});
}
async function loadConfData(id){
  let best=null;
  const cached=readCache(K(id).data);if(validConf(cached)&&cached.id===id)best=cached;
  try{const d=await getJSON(DATA_DIR+id+".json",6000);if(validConf(d)&&d.id===id&&(!best||d.rev>=best.rev))best=d;}catch(e){}
  if(!best&&REMOTE){try{const d=await getJSON(REMOTE+id+".json",10000);if(validConf(d)&&d.id===id){best=d;store(K(id).data,JSON.stringify(d));}}catch(e){}}
  return best;
}
// Uygulamada: arka planda daha yeni program var mı? Varsa kaydet ve ekranı yenile.
function checkRemote(id){
  if(!REMOTE)return;
  getJSON(REMOTE+id+".json",10000).then(d=>{
    if(validConf(d)&&d.id===id&&C&&C.id===id&&d.rev>C.rev){store(K(id).data,JSON.stringify(d));setConf(d);render();planNotifs();}
  }).catch(()=>{});
}
// Veri dosyasını uygulamanın kullandığı yapılara çevirir
function setConf(d){
  C=d;
  DAYS=d.days.map(x=>({k:x.k,date:x.date,label:x.label,weekday:x.weekday}));
  M=d.items.map(x=>({id:x.id,d:x.day,s:x.start,e:x.end,t:x.type,title:x.title,sp:x.speakers||"",mod:x.chairs||"",room:x.room||d.mainRoom||"",sub:x.sub||null}));
  BYID={};M.forEach(x=>BYID[x.id]=x);
  TALKS={};SESS={};
  const o=d.oral;
  if(o){ORAL_S=mins(o.start);ORAL_E=mins(o.end);PER=o.minutesPerTalk;
    o.sessions.forEach((s,i)=>{const no=s.no||i+1;SESS[no]={no,d:s.day,salon:s.room,chair:s.chairs||"",ids:[]};
      s.talks.forEach((t,pos)=>{TALKS[t.id]={id:t.id,no,d:s.day,salon:s.room,title:t.title,pn:t.presenter||"",pos};SESS[no].ids.push(t.id);});});}
  ODAYS=DAYS.map(x=>x.k).filter(k=>Object.values(SESS).some(s=>s.d===k));
  if(d.theme&&isStr(d.theme.accent)&&/^#[0-9a-f]{6}$/i.test(d.theme.accent))document.documentElement.style.setProperty("--accent",d.theme.accent);
  else document.documentElement.style.removeProperty("--accent");
}
// Bir kongreyi aç: veriyi yükle, o kongreye ait seçim/not/sekme kayıtlarını oku
async function openConf(id){
  const d=await loadConfData(id);
  if(!d)return false;
  setConf(d);store(G.last,id);
  sel=new Set();try{const r=JSON.parse(lsGet(K(id).sel)||"[]");if(Array.isArray(r))r.forEach(i=>{if(BYID[i]||TALKS[i])sel.add(i)});}catch(e){}
  notes={};try{const r=JSON.parse(lsGet(K(id).notes)||"{}");if(r&&typeof r==="object"&&!Array.isArray(r))for(const [k,v] of Object.entries(r))if(isStr(v))notes[k]=v;}catch(e){}
  const t=lsGet(K(id).tab);tab=t&&(t==="mine"||(t==="oral"&&ODAYS.length)||DAYS.some(x=>x.k===t))?t:DAYS[0].k;
  oralDay=ODAYS[0]||"";q="";const qi=document.getElementById("q");if(qi)qi.value="";
  // Kongre günlerinde uygulama o günün programıyla açılır
  NOW0=nowConf();
  if(NOW0){if(tab==="oral"&&ODAYS.includes(NOW0.d))oralDay=NOW0.d;else if(tab!=="mine")tab=NOW0.d;}
  checkRemote(id);
  return true;
}

// ---- Seçim ve not kayıtları
let persistAsked=false;
const askPersist=()=>{if(persistAsked)return;persistAsked=true;
  try{const s=navigator.storage;if(s&&s.persist&&s.persisted)s.persisted().then(p=>p||s.persist()).catch(()=>{});}catch(e){}};
const save=()=>{store(K(C.id).sel,JSON.stringify([...sel]));if(sel.size)askPersist();planNotifs();};
const saveNotes=()=>{store(K(C.id).notes,JSON.stringify(notes));askPersist();};
function setNote(id,v){v=String(v).trim().slice(0,5000);if(v)notes[id]=v;else delete notes[id];saveNotes();}
const saveTab=()=>{if(C&&tab!=="home")store(K(C.id).tab,tab);};

// ---- Zaman: kongrenin yerel saati. Kongre günü değilse null. Test için: ?now=3T09:10
function nowConf(){
  if(!C)return null;
  const p=new URLSearchParams(location.search).get("now");
  if(p){const m=p.match(/^(\w+)T(\d\d):(\d\d)$/);if(m&&DAYS.some(x=>x.k===m[1]))return{d:m[1],m:+m[2]*60+ +m[3]};}
  const t=new Date(Date.now()+C.utcOffsetMin*60000),ds=t.toISOString().slice(0,10);
  const D=DAYS.find(x=>x.date===ds);return D?{d:D.k,m:t.getUTCHours()*60+t.getUTCMinutes()}:null;
}
const dayOf=k=>DAYS.find(x=>x.k===k);
// Oturum başlangıcı → zaman damgası (UTC)
const startMs=e=>{const [y,mo,dd]=dayOf(e.d).date.split("-").map(Number);return Date.UTC(y,mo-1,dd,0,e.s-C.utcOffsetMin);};

// ---- Arayüz metinleri
const UI={
tr:{
  brand:"Kongrem",planner:"Planlayıcı",mine:"Programım",mineAria:n=>`Programım, ${n} seçim`,langAria:"Dil / Language",
  search:"Başlık, konuşmacı, bildiri kodu (ör. S-018) ara",
  footBase:"Seçimleriniz ve notlarınız yalnızca bu cihazda saklanır; kimseyle paylaşılmaz.",
  tag:{cer:"Tören",sym:"Uydu sempozyumu",sel:"Sözlü bildiri",course:"Kurs",panel:"Panel",conf:"Konferans",talk:"",break:""},
  sessionL:"Oturum: ",chairsL:"Moderatör: ",hasNote:"Notunuz var",
  oralTag:"Sözlü bildiriler",oralCard:n=>`${n} salonda aynı anda sözlü bildiri oturumları`,oralTap:"Salonları yan yana görmek ve seçmek için dokunun",
  until:t=>`${t}'${datTR(t)} kadar`,
  oralHead:"Sözlü bildiriler",
  oralNote:p=>`Her sütun bir salon, her satır sunum sırası. Aynı satırdaki bildiriler yaklaşık aynı saatte sunulur, bu yüzden bir satırdan tek bildiri seçerseniz salon değiştirerek hepsine yetişebilirsiniz. Saatler, bildiri başına ${p} dakika varsayımıyla yaklaşıktır.`,
  order:"Sıra",sessN:n=>`Oturum ${n}`,
  empty:"Henüz bir şey seçmediniz. Gün sekmelerinden ya da Sözlü bildiriler sekmesinden bir oturuma dokunun; seçtikleriniz burada gün gün listelenir.",
  cal:"Takvime ekle (10 dk önce hatırlatır)",share:"Listeyi paylaş",clear:"Tümünü temizle",clearSure:"Emin misiniz? Tekrar dokunun",
  cx:n=>`${n} seçim başka bir salonla aynı saate denk geliyor. Turuncu çerçeveli satırlara bakın.`,
  slot:p=>`${p}. sırada`,overlaps:"Çakışıyor: ",
  addNote:"Not ekle",editNote:"Notu düzenle",remove:"Kaldır",done:"Bitti",notePh:"Notunuz: soru, makale, kişi… Yalnızca bu cihazda saklanır.",
  noteL:"Not",icsDesc:(no,p)=>`Oturum ${no}, ${p}. sunum (saat yaklaşık)`,icsFile:s=>`${s}-programim.ics`,
  now:"Şimdi",next:"Sıradaki",today:"Bugün",
  inMin:m=>m<60?`${m} dk sonra`:`${Math.floor(m/60)} sa ${m%60?m%60+" dk ":""}sonra`,
  doneToday:"Bugünkü seçimleriniz bitti.",noneToday:"Henüz seçiminiz yok. Programa bakmak için dokunun.",
  nSel:k=>`${k} seçili`,nTalks:k=>`${k} bildiri seçili`,noSel:"Henüz seçim yok",
  calOk:"Takvim dosyası açıldı. Telefonunuz sorarsa \"Tümünü ekle\" deyin.",calErr:"Takvim dosyası bu görünümde açılamadı.",
  shareTitle:s=>`${s} programım`,copied:"Liste kopyalandı. WhatsApp ya da e-postaya yapıştırabilirsiniz.",copyManual:"Aşağıdaki metni seçip kopyalayın.",
  privacy:"Gizlilik politikası",
  remOn:"Hatırlatma açık · 10 dk önce",remOff:"Hatırlatma kapalı",remDenied:"Bildirim izni kapalı. Hatırlatmalar için: Ayarlar › Kongrem › Bildirimler.",
  nTitle:(r,tm)=>`${tm} · ${r} · 10 dk sonra`,
  confs:"Kongreler",confsSub:"Programını görmek istediğiniz kongreyi seçin.",nPicked:k=>`${k} seçim`,loading:"Yükleniyor…",
  loadErr:"Program yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.",retry:"Tekrar dene",
  exactHint:"Android hatırlatmaları bir saate kadar geciktirebilir. Oturumdan 10 dakika önce gelmeleri için \"Alarmlar ve hatırlatıcılar\" iznini verin.",exactBtn:"İzin ver"
},
en:{
  brand:"Kongrem",planner:"Planner",mine:"My Program",mineAria:n=>`My Program, ${n} selected`,langAria:"Language / Dil",
  search:"Search by title, speaker or abstract code (e.g. S-018)",
  footBase:"Your selections and notes are stored only on this device and are not shared with anyone.",
  tag:{cer:"Ceremony",sym:"Satellite symposium",sel:"Oral session",course:"Course",panel:"Panel",conf:"Lecture",talk:"",break:""},
  sessionL:"Session: ",chairsL:"Chairs: ",hasNote:"You have a note",
  oralTag:"Oral presentations",oralCard:n=>`Oral presentation sessions in ${n} halls at the same time`,oralTap:"Tap to see the halls side by side and pick talks",
  until:t=>`until ${t}`,
  oralHead:"Oral presentations",
  oralNote:p=>`Each column is a hall and each row is a presentation slot. Talks in the same row are given at about the same time, so if you pick one talk per row you can switch halls and catch all of them. Times are approximate, assuming ${p} minutes per talk.`,
  order:"Slot",sessN:n=>`Session ${n}`,
  empty:"You haven't selected anything yet. Tap a session in a day tab or in the Oral presentations tab; your selections will be listed here day by day.",
  cal:"Add to calendar (reminds you 10 min before)",share:"Share list",clear:"Clear all",clearSure:"Are you sure? Tap again",
  cx:n=>`${n} ${n===1?"selection overlaps":"selections overlap"} with a talk in another hall. Check the rows with an orange border.`,
  slot:p=>`slot ${p}`,overlaps:"Overlaps with: ",
  addNote:"Add note",editNote:"Edit note",remove:"Remove",done:"Done",notePh:"Your note: a question, a paper, a contact… Stored only on this device.",
  noteL:"Note",icsDesc:(no,p)=>`Session ${no}, talk ${p} (approximate time)`,icsFile:s=>`${s}-my-program.ics`,
  now:"Now",next:"Next",today:"Today",
  inMin:m=>m<60?`in ${m} min`:`in ${Math.floor(m/60)} h${m%60?" "+m%60+" min":""}`,
  doneToday:"Your selections for today are over.",noneToday:"No selections yet. Tap to see the program.",
  nSel:k=>`${k} selected`,nTalks:k=>`${k} ${k===1?"talk":"talks"} selected`,noSel:"Nothing selected yet",
  calOk:"Calendar file opened. If your phone asks, choose “Add All”.",calErr:"The calendar file couldn't be opened here.",
  shareTitle:s=>`My ${s} program`,copied:"List copied. You can paste it into WhatsApp or an email.",copyManual:"Select and copy the text below.",
  privacy:"Privacy policy",
  remOn:"Reminders on · 10 min before",remOff:"Reminders off",remDenied:"Notifications are turned off. To get reminders: Settings › Kongrem › Notifications.",
  nTitle:(r,tm)=>`${tm} · ${r} · in 10 min`,
  confs:"Congresses",confsSub:"Choose the congress whose program you want to see.",nPicked:k=>`${k} selected`,loading:"Loading…",
  loadErr:"The program couldn't be loaded. Check your internet connection and try again.",retry:"Try again",
  exactHint:"Android may deliver reminders up to an hour late. To get them 10 minutes before each session, allow \"Alarms & reminders\".",exactBtn:"Allow"
}};
const T=k=>UI[lang][k];
// İçerik: başlıklar, salonlar, roller, günler
const mTitle=x=>tx(x.title);
const mSub=x=>tx(x.sub);
const tTitle=t=>tx(t.title);
const roomN=r=>{if(lang==="tr"||!C||!C.rooms||!C.rooms[r])return r;return C.rooms[r].en||r;};
const ppl=s=>lang==="tr"?s:s.replace(/\(Kurs Başkanı\)/g,"(Course Chair)").replace(/Panelistler:/g,"Panelists:").replace(/Vaka sunumları:/g,"Case presentations:");
const dayL=D=>tx(D.label),dayW=D=>tx(D.weekday);
const DAYNAME=k=>{const D=dayOf(k);return lang==="tr"?dayL(D)+" "+dayW(D):dayW(D)+", "+dayL(D);};
const isMain=r=>!r||r===C.mainRoom;

// Programda bildiri başına PER dakika verildiği için saatler sıraya göre yaklaşık hesaplanır
function entry(id){
  if(TALKS[id]){const t=TALKS[id],s=ORAL_S+PER*t.pos;return{id,d:t.d,s,e:s+PER,room:t.salon,approx:true};}
  const x=BYID[id];return{id,d:x.d,s:mins(x.s),e:mins(x.e),room:x.room};
}
function conflicts(){
  const es=[...sel].map(entry),cx=new Map();
  for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++){
    const a=es[i],b=es[j];
    if(a.d===b.d&&a.room!==b.room&&a.s<b.e&&b.s<a.e){
      (cx.get(a.id)||cx.set(a.id,new Set()).get(a.id)).add(b.id);
      (cx.get(b.id)||cx.set(b.id,new Set()).get(b.id)).add(a.id);
    }}
  return cx;
}
function label(id){if(TALKS[id])return roomN(TALKS[id].salon)+" "+id;const x=BYID[id];return isMain(x.room)?mTitle(x):roomN(x.room);}
const sorted=d=>[...sel].map(entry).filter(e=>e.d===d).sort((a,b)=>a.s-b.s||a.room.localeCompare(b.room,"tr")||a.id.localeCompare(b.id));

// ---- Görünümler
function cardHTML(x){
  const tg=T("tag")[x.t];
  const tag=x.sub?`<span class="tag conf">${esc(mSub(x))}</span>`:(tg?`<span class="tag">${esc(tg)}</span>`:"");
  const room=!isMain(x.room)?`<span class="tag">${esc(roomN(x.room))}</span>`:"";
  const ml=x.t==="course"?"":(x.t==="talk"&&!x.sp?T("sessionL"):T("chairsL"));
  // Arama iki dilde de çalışsın
  const srch=low([allTx(x.title),x.sp,x.mod,allTx(x.sub),x.room,roomN(x.room)].join(" "));
  return `<button class="card k-${esc(x.t)}" data-id="${esc(x.id)}" data-s="${esc(srch)}" aria-pressed="false">
    ${tag||room?`<span class="tags">${tag}${room}</span>`:""}
    <span class="ttl">${esc(mTitle(x))}</span>
    ${x.sp?`<span class="sp">${esc(ppl(x.sp))}</span>`:""}
    ${x.mod?`<span class="mod">${esc(ml+ppl(x.mod))}</span>`:""}
    <span class="nflag" hidden>${esc(T("hasNote"))}</span><span class="cflag" hidden></span><span class="chk" aria-hidden="true"></span></button>`;
}
function talkHTML(id){
  const t=TALKS[id];
  const srch=low([id,allTx(t.title),t.pn,t.salon,roomN(t.salon)].join(" "));
  return `<button class="talk" data-id="${esc(id)}" data-s="${esc(srch)}" aria-pressed="false"><span class="code">${esc(id)}</span><span class="tt">${esc(tTitle(t))}</span><span class="pn">${esc(t.pn)}</span><span class="nflag" hidden>${esc(T("hasNote"))}</span><span class="cflag" hidden></span><span class="chk" aria-hidden="true"></span></button>`;
}
function dayHTML(d){
  let h=`<h2 class="dayhead">${esc(DAYNAME(d))}</h2>`;
  if(ODAYS.includes(d)){
    const n=Object.values(SESS).filter(s=>s.d===d).length;
    h+=`<div class="row" data-se="${esc(d)}|${ORAL_S}|${ORAL_E}"><div class="tm">${hm(ORAL_S)}<small>${hm(ORAL_E)}</small></div><div class="cards"><button class="card gocard" data-go="${esc(d)}"><span class="tags"><span class="tag conf">${esc(T("oralTag"))}</span></span><span class="ttl">${esc(T("oralCard")(n))}</span><span class="sp" data-oc="${esc(d)}"></span><span class="mod">${esc(T("oralTap"))}</span></button></div></div>`;
  }
  const items=M.filter(x=>x.d===d);
  for(let i=0;i<items.length;){
    const x=items[i];
    if(x.t==="break"){h+=`<div class="brk" data-brk><span>${esc(x.s)}</span>${esc(mTitle(x)+" · "+T("until")(x.e))}</div>`;i++;continue;}
    const grp=[x];let j=i+1;while(j<items.length&&items[j].s===x.s&&items[j].t!=="break")grp.push(items[j++]);
    h+=`<div class="row" data-row data-se="${esc(d)}|${mins(x.s)}|${mins(x.e)}"><div class="tm">${esc(x.s)}<small>${esc(x.e)}</small></div><div class="cards">${grp.map(cardHTML).join("")}</div></div>`;
    i=j;
  }
  return h;
}
function oralHTML(){
  const ss=Object.values(SESS).filter(s=>s.d===oralDay);
  const maxN=Math.max(0,...ss.map(s=>s.ids.length));
  let h=`<h2 class="dayhead">${esc(T("oralHead"))}</h2>
  <div class="daysw">${ODAYS.map(k=>{const D=dayOf(k);return `<button class="tab" data-oday="${esc(k)}" aria-selected="${k===oralDay}"><small>${esc(dayW(D))}</small><b>${esc(dayL(D))}</b></button>`;}).join("")}</div>
  <p class="ognote">${esc(T("oralNote")(PER))}</p>
  <div class="ogwrap"><div class="og" style="grid-template-columns:var(--otw) repeat(${ss.length},minmax(var(--ocw),1fr))">
  <div class="oh corner">${esc(T("order"))}</div>`;
  for(const s of ss)h+=`<div class="oh"><b>${esc(roomN(s.salon))}</b><small>${esc(T("sessN")(s.no)+" · "+s.chair)}</small><span class="scount" data-sc="${esc(s.no)}"></span></div>`;
  for(let i=0;i<maxN;i++){
    h+=`<div class="ot" data-se="${esc(oralDay)}|${ORAL_S+PER*i}|${ORAL_S+PER*(i+1)}">${i+1}.<small>~${hm(ORAL_S+PER*i)}</small></div>`;
    for(const s of ss)h+=s.ids[i]?`<div>${talkHTML(s.ids[i])}</div>`:`<div></div>`;
  }
  return h+`</div></div>`;
}
function mineHTML(){
  const cx=conflicts();
  if(!sel.size)return `<h2 class="dayhead">${esc(T("mine"))}</h2><div class="empty">${esc(T("empty"))}</div>`;
  let h=`<h2 class="dayhead">${esc(T("mine"))}</h2><div class="actions">
    ${NATIVE?`<button class="btn${remOn?" primary":""}" id="rem" aria-pressed="${remOn}">${esc(remOn?T("remOn"):T("remOff"))}</button>`:`<button class="btn primary" id="cal">${esc(T("cal"))}</button>`}
    <button class="btn" id="share">${esc(T("share"))}</button>
    <button class="btn danger" id="clear">${esc(T("clear"))}</button><span class="note" id="msg">${NATIVE&&remOn&&notifDenied?esc(T("remDenied")):""}</span></div>`;
  if(cx.size)h+=`<div class="cxsum">${esc(T("cx")(cx.size))}</div>`;
  for(const D of DAYS){
    const rows=sorted(D.k);if(!rows.length)continue;
    h+=`<section class="mine-day"><h3 class="dayhead" style="font-size:19px">${esc(DAYNAME(D.k))}</h3>`;
    for(const e of rows){
      let tm,title,meta;
      if(TALKS[e.id]){const t=TALKS[e.id];tm="~"+hm(e.s);title=tTitle(t);meta=`${roomN(t.salon)} · ${t.id} · ${T("slot")(t.pos+1)} · ${t.pn}`;}
      else{const x=BYID[e.id];tm=x.s+"–"+x.e;title=mTitle(x);meta=[roomN(x.room),ppl(x.sp)].filter(Boolean).join(" · ");}
      const c=cx.get(e.id),nt=notes[e.id],id=esc(e.id);
      h+=`<div class="mine-row${c?" cx":""}" data-mrow="${id}" data-se="${esc(e.d)}|${e.s}|${e.e}"><span class="t">${esc(tm)}</span><div class="mm"><b>${esc(title)}</b><span class="m">${esc(meta)}</span>${c?`<span class="cflag">${esc(T("overlaps")+[...c].map(label).join(", "))}</span>`:""}${nt?`<span class="ntx" data-edit="${id}">${esc(nt)}</span>`:""}</div><div class="racts"><button class="rm" data-note="${id}">${esc(nt?T("editNote"):T("addNote"))}</button><button class="rm" data-rm="${id}">${esc(T("remove"))}</button></div></div>`;
    }
    h+=`</section>`;
  }
  return h;
}
// Kongre listesi
function homeHTML(){
  let h=`<h2 class="dayhead">${esc(T("confs"))}</h2><p class="ognote">${esc(T("confsSub"))}</p><div class="clist">`;
  for(const c of IDX){
    let k=0;try{k=(JSON.parse(lsGet(K(c.id).sel)||"[]")||[]).length;}catch(e){}
    h+=`<button class="card cpick" data-conf="${esc(c.id)}"><span class="tags"><span class="tag conf">${esc(c.short)}</span>${k?`<span class="tag">${esc(T("nPicked")(k))}</span>`:""}</span><span class="ttl">${esc(tx(c.name))}</span><span class="mod">${esc([tx(c.dates),c.venue].filter(Boolean).join(" · "))}</span></button>`;
  }
  return h+`</div>`;
}
// Android: tam zamanlı alarm izni yoksa hatırlatmalar bir saate kadar gecikebilir; seçim varsa her görünümün üstünde uyar
function exactHTML(){
  return ANDROID&&remOn&&sel.size&&!notifDenied&&!exactOK?`<div class="cxsum">${esc(T("exactHint"))} <button class="btn" id="exact">${esc(T("exactBtn"))}</button></div>`:"";
}
function textList(){
  let out=tx(C.name)+" · "+T("mine")+"\n";
  for(const D of DAYS){
    const rows=sorted(D.k);if(!rows.length)continue;
    out+=`\n${DAYNAME(D.k)}\n`;
    for(const e of rows){
      if(TALKS[e.id]){const t=TALKS[e.id];out+=`~${hm(e.s)}  ${roomN(t.salon)} · ${t.id} ${tTitle(t)} (${t.pn})\n`;}
      else{const x=BYID[e.id];out+=`${x.s}–${x.e}  ${!isMain(x.room)?roomN(x.room)+" · ":""}${mTitle(x)}${x.sp?" ("+ppl(x.sp)+")":""}\n`;}
      if(notes[e.id])out+=`   ${T("noteL")}: ${notes[e.id].replace(/\n/g,"\n   ")}\n`;
    }
  }
  return out;
}
// Takvim dosyası: olaylar UTC olarak yazılır
function icsText(){
  const ie=s=>String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
  const fold=l=>{let o="",i=0;while(l.length-i>73){o+=l.slice(i,i+73)+"\r\n ";i+=73;}return o+l.slice(i);};
  const z=ms=>new Date(ms).toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");
  const stamp=z(Date.now());
  const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Kongrem//TR","CALSCALE:GREGORIAN","METHOD:PUBLISH",fold("X-WR-CALNAME:"+ie(C.short))];
  for(const e of [...sel].map(entry)){
    const st=startMs(e);
    let sum,desc;
    if(TALKS[e.id]){const t=TALKS[e.id];sum=`${t.id} · ${tTitle(t)}`;desc=`${t.pn} · ${roomN(t.salon)}, ${T("icsDesc")(t.no,t.pos+1)}`;}
    else{const x=BYID[e.id];sum=mTitle(x);desc=[ppl(x.sp),x.mod?T("chairsL")+ppl(x.mod):""].filter(Boolean).join("\n");}
    if(notes[e.id])desc+=`\n\n${T("noteL")}: `+notes[e.id];
    // UID biçimi eski sürümle aynı: daha önce takvime ekleyenlerde kayıtlar çoğalmaz
    L.push("BEGIN:VEVENT",fold(`UID:${e.id}@${C.id}-planlayici`),`DTSTAMP:${stamp}`,`DTSTART:${z(st)}`,`DTEND:${z(st+(e.e-e.s)*60000)}`,
      fold("SUMMARY:"+ie(sum)),fold("LOCATION:"+ie(roomN(e.room)+(C.venue?" · "+C.venue:""))),fold("DESCRIPTION:"+ie(desc)),
      "BEGIN:VALARM","ACTION:DISPLAY","TRIGGER:-PT10M",fold("DESCRIPTION:"+ie(sum)),"END:VALARM","END:VEVENT");
  }
  L.push("END:VCALENDAR");return L.join("\r\n")+"\r\n";
}

const view=document.getElementById("view");
function tabsRender(){
  const tb=document.getElementById("tabs");
  if(!C||tab==="home"){tb.innerHTML="";}
  else tb.innerHTML=DAYS.map(D=>`<button class="tab" role="tab" data-tab="${esc(D.k)}" aria-selected="${tab===D.k}"><small>${esc(dayW(D))}</small><b>${esc(dayL(D))}</b></button>`).join("")
   +(ODAYS.length?`<button class="tab mine" role="tab" data-tab="oral" aria-selected="${tab==="oral"}"><b>${esc(T("oralHead"))}</b></button>`:"");
  document.getElementById("minebtn").setAttribute("aria-pressed",tab==="mine");
  document.getElementById("minebtn").hidden=!C||tab==="home";
}
function render(){
  tabsRender();
  if(tab==="home"||!C)view.innerHTML=homeHTML();
  else view.innerHTML=exactHTML()+(tab==="mine"?mineHTML():tab==="oral"?oralHTML():dayHTML(tab));
  const wide=tab==="oral";view.classList.toggle("wide",wide);document.getElementById("hwrap").classList.toggle("wide",wide);
  document.querySelector(".search").hidden=tab==="mine"||tab==="home"||!C;
  if(C&&tab!=="home"){marks();applyFilter();liveMarks();}else document.getElementById("nowbar").hidden=true;
  updateHeader();
}
// Başlık: kongre adı, tarih, Kongrem markası
function updateHeader(){
  const R=document.documentElement;R.lang=lang;
  const home=!C||tab==="home";
  document.title=home?T("brand"):`${C.short} · ${T("brand")}`;
  document.getElementById("h1").textContent=home?T("brand"):tx(C.name);
  document.getElementById("sub").textContent=home?T("confs"):[tx(C.dates),C.venue].filter(Boolean).join(" · ");
  const km=document.getElementById("kmark");km.textContent=T("brand")+(IDX.length>1&&!home?" · "+T("confs"):"");
  km.disabled=!(IDX.length>1&&!home);
}
// Sayfadaki sabit metinleri seçili dile göre yazar
function applyLang(){
  const R=document.documentElement;R.lang=lang;
  R.style.setProperty("--nowl",JSON.stringify(T("now")));
  document.getElementById("minelbl").textContent=T("mine");
  document.getElementById("q").placeholder=T("search");
  const ft=document.getElementById("foot");
  ft.textContent=[T("footBase"),C?tx(C.note):""].filter(Boolean).join(" ")+" ";
  if(NATIVE){const a=document.createElement("a");a.href="https://babazade-a.github.io/tgk2026/privacy.html";a.textContent=T("privacy");a.target="_blank";a.rel="noopener";ft.appendChild(a);}
  const lg=document.getElementById("lang");lg.setAttribute("aria-label",T("langAria"));
  lg.querySelectorAll("[data-lang]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.lang===lang));
  updateHeader();
}
// O an süren satırlara "Şimdi" etiketi
function liveMarks(){
  const n=nowConf();
  document.querySelectorAll("[data-se]").forEach(el=>{const [d,s,e]=el.dataset.se.split("|");el.classList.toggle("live",!!n&&n.d===d&&+s<=n.m&&n.m<+e);});
}
function nowbar(){
  const bar=document.getElementById("nowbar"),n=nowConf();
  if(!n||tab==="home"){bar.hidden=true;return;}
  const es=sorted(n.d),cur=es.filter(e=>e.s<=n.m&&n.m<e.e),nx=es.find(e=>e.s>n.m);
  const nm=e=>{const t=TALKS[e.id];return roomN(e.room)+" · "+(t?t.id+" "+tTitle(t):mTitle(BYID[e.id]));};
  const L=[];
  if(cur.length)L.push(`<span class="nl"><b>${esc(T("now"))}</b>${esc(nm(cur[0]))}${cur.length>1?` (+${cur.length-1})`:""}</span>`);
  if(nx)L.push(`<span class="nl"><b>${esc(T("next"))}</b>${esc((nx.approx?"~":"")+hm(nx.s)+" · "+T("inMin")(nx.s-n.m)+" · "+nm(nx))}</span>`);
  if(!L.length)L.push(`<span class="nl"><b>${esc(T("today"))}</b>${esc(es.length?T("doneToday"):T("noneToday"))}</span>`);
  bar.innerHTML=L.join("");bar.dataset.target=(cur[0]||nx||{}).id||"";bar.hidden=false;
}
function tick(){if(C&&tab!=="home"){nowbar();liveMarks();}}
// Not düzenleyici (Programım sekmesinde)
let lastClose={id:"",t:0};
function openNote(id){
  const row=[...view.querySelectorAll("[data-mrow]")].find(r=>r.dataset.mrow===id);if(!row)return;
  let ta=row.querySelector(".ntin");if(ta){ta.focus();return;}
  const mm=row.querySelector(".mm"),x=mm.querySelector(".ntx");if(x)x.remove();
  ta=document.createElement("textarea");ta.className="ntin";ta.dataset.nid=id;ta.value=notes[id]||"";ta.maxLength=5000;
  ta.placeholder=T("notePh");
  mm.appendChild(ta);ta.focus();row.querySelector("[data-note]").textContent=T("done");
}
function closeNote(ta){
  const id=ta.dataset.nid,mm=ta.parentNode,row=ta.closest("[data-mrow]");
  setNote(id,ta.value);ta.remove();
  if(notes[id]){const s=document.createElement("span");s.className="ntx";s.dataset.edit=id;s.textContent=notes[id];mm.appendChild(s);}
  if(row)row.querySelector("[data-note]").textContent=notes[id]?T("editNote"):T("addNote");
  lastClose={id,t:Date.now()};
}
function marks(){
  const cx=conflicts();
  const cnt=document.getElementById("count");cnt.textContent=sel.size;cnt.hidden=!sel.size;
  document.getElementById("minebtn").setAttribute("aria-label",T("mineAria")(sel.size));
  view.querySelectorAll("[data-id]").forEach(el=>{
    const id=el.dataset.id;el.setAttribute("aria-pressed",sel.has(id));
    const f=el.querySelector(".cflag"),c=cx.get(id);
    if(f){f.hidden=!c;if(c)f.textContent=T("overlaps")+[...c].map(label).join(", ");}
    const nf=el.querySelector(".nflag");if(nf)nf.hidden=!notes[id];
  });
  view.querySelectorAll("[data-sc]").forEach(el=>{
    const s=SESS[el.dataset.sc],k=s.ids.filter(i=>sel.has(i)).length;
    el.textContent=k?T("nSel")(k):"";el.classList.toggle("warn",s.ids.some(i=>cx.has(i)));
  });
  view.querySelectorAll("[data-oc]").forEach(el=>{
    const k=Object.keys(TALKS).filter(i=>TALKS[i].d===el.dataset.oc&&sel.has(i)).length;
    el.textContent=k?T("nTalks")(k):T("noSel");
  });
  nowbar();
}
function applyFilter(){
  if(tab==="mine"||tab==="home")return;
  const s=low(q.trim());
  const hit=el=>!s||el.dataset.s.includes(s);
  if(tab==="oral"){view.querySelectorAll("[data-id]").forEach(el=>el.classList.toggle("dim",!hit(el)));return;}
  view.querySelectorAll("[data-id]").forEach(el=>{el.hidden=!hit(el);});
  view.querySelectorAll("[data-row]").forEach(r=>{r.hidden=![...r.querySelectorAll("[data-id]")].some(e=>!e.hidden);});
  view.querySelectorAll("[data-brk]").forEach(b=>b.hidden=!!s);
}
function say(t){const m=document.getElementById("msg");if(m)m.textContent=t;}
function fallbackText(txt,anchor){
  if(document.querySelector("textarea.fallback"))return;
  const ta=document.createElement("textarea");ta.className="fallback";ta.value=txt;ta.readOnly=true;anchor.after(ta);ta.select();
}


// ---- Uygulama: yerel hatırlatma bildirimleri (seçilen her oturumdan 10 dk önce)
// Bildirimler kongreye göre etiketlenir; başka kongrelerin hatırlatmalarına dokunulmaz.
const notifId=key=>{let h=7;for(const c of key)h=(h*31+c.charCodeAt(0))|0;return Math.abs(h)%2000000000+1;};
let planT=null;
function planNotifs(now){if(!NATIVE||!NP.LocalNotifications||!C)return;clearTimeout(planT);planT=setTimeout(doPlan,now?0:700);}
async function doPlan(){
  const LN=NP.LocalNotifications,cid=C.id;
  try{
    const pend=(await LN.getPending()).notifications||[];
    const mine=pend.filter(n=>n.extra&&n.extra.k===cid),others=pend.length-mine.length;
    if(mine.length)await LN.cancel({notifications:mine.map(n=>({id:n.id}))});
    if(!remOn||!sel.size)return;
    let perm=await LN.checkPermissions();
    if(perm.display!=="granted"&&perm.display!=="denied")perm=await LN.requestPermissions();
    const denied=perm.display!=="granted";
    if(denied!==notifDenied){notifDenied=denied;if(tab==="mine")render();}
    if(denied)return;
    // Android 12+: tam zamanlı alarm izni yoksa eklenti her planlamada ayarlar ekranını açar. Önce denetle;
    // izin yoksa sessizce yaklaşık zamanlı planla ve Programım'da tek seferlik bir "İzin ver" düğmesi göster.
    let exact=true;
    if(ANDROID&&LN.checkExactNotificationSetting){try{exact=(await LN.checkExactNotificationSetting()).exact_alarm==="granted";}catch(e){}}
    if(exact!==exactOK){exactOK=exact;if(tab!=="home")render();}
    // iOS en fazla 64 bekleyen bildirime izin verir: en yakın olanlar planlanır, kalanlar uygulama açıldıkça eklenir
    const room=Math.max(0,60-others);
    const soon=[...sel].map(entry).map(e=>({e,at:startMs(e)-600000})).filter(x=>x.at>Date.now()+5000).sort((a,b)=>a.at-b.at).slice(0,room);
    if(!soon.length)return;
    await LN.schedule({notifications:soon.map(({e,at})=>{const t=TALKS[e.id];
      return{id:notifId(cid+":"+e.id),title:T("nTitle")(roomN(e.room),(e.approx?"~":"")+hm(e.s)),
        body:t?t.id+" · "+tTitle(t):mTitle(BYID[e.id]),schedule:{at:new Date(at),allowWhileIdle:true},isExactNotification:exact,extra:{k:cid,tgk:e.id}};})});
  }catch(err){console.warn("bildirim planlanamadı",err);}
}
async function openItem(k,id){
  if(k&&(!C||C.id!==k)){if(!(await openConf(k)))return;applyLang();}
  if(!id||!(BYID[id]||TALKS[id]))return;
  tab="mine";saveTab();render();
  const r=[...view.querySelectorAll("[data-mrow]")].find(r=>r.dataset.mrow===id);if(r){r.scrollIntoView({block:"center"});r.classList.add("flash");}
}

// ---- Olaylar
async function switchConf(id){
  view.innerHTML=`<p class="ognote">${esc(T("loading"))}</p>`;
  if(await openConf(id)){applyLang();render();window.scrollTo(0,0);planNotifs();}
  else view.innerHTML=`<div class="empty">${esc(T("loadErr"))}<br><br><button class="btn" data-conf="${esc(id)}">${esc(T("retry"))}</button></div>`;
}
document.getElementById("kmark").addEventListener("click",()=>{if(IDX.length>1){tab="home";render();window.scrollTo(0,0);}});
document.getElementById("lang").addEventListener("click",e=>{
  const b=e.target.closest("[data-lang]");if(!b||b.dataset.lang===lang)return;
  lang=b.dataset.lang;store(G.lang,lang);
  applyLang();render();planNotifs();
});
document.getElementById("tabs").addEventListener("click",e=>{
  const b=e.target.closest("[data-tab]");if(!b)return;tab=b.dataset.tab;saveTab();
  render();window.scrollTo(0,0);
});
document.getElementById("minebtn").addEventListener("click",()=>{tab="mine";saveTab();render();window.scrollTo(0,0);});
view.addEventListener("click",e=>{
  const cp=e.target.closest("[data-conf]");
  if(cp){switchConf(cp.dataset.conf);return;}
  const go=e.target.closest("[data-go]");
  if(go){oralDay=go.dataset.go;tab="oral";saveTab();render();window.scrollTo(0,0);return;}
  const od=e.target.closest("[data-oday]");
  if(od){oralDay=od.dataset.oday;render();return;}
  const rm=e.target.closest("[data-rm]");
  if(rm){sel.delete(rm.dataset.rm);save();render();return;}
  const ne=e.target.closest("[data-note],[data-edit]");
  if(ne){const id=ne.dataset.note||ne.dataset.edit;
    // "Bitti"ye basınca düzenleyici zaten odak kaybıyla kapandı; yeniden açma
    if(!(lastClose.id===id&&Date.now()-lastClose.t<500))openNote(id);return;}
  const b=e.target.closest("[data-id]");
  if(b){const id=b.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);save();marks();return;}
  const act=e.target.closest(".actions");
  if(e.target.id==="exact"&&NP.LocalNotifications&&NP.LocalNotifications.changeExactNotificationSetting){
    NP.LocalNotifications.changeExactNotificationSetting().then(()=>planNotifs(true)).catch(()=>{});return;}
  if(e.target.id==="rem"){remOn=!remOn;store(G.rem,remOn?"1":"0");planNotifs(true);render();return;}
  if(e.target.id==="cal"){
    try{
      const blob=new Blob([icsText()],{type:"text/calendar;charset=utf-8"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=T("icsFile")(C.short.replace(/[^\w-]+/g,""));
      document.body.appendChild(a);a.click();a.remove();
      say(T("calOk"));
    }catch(_){say(T("calErr"));}
    return;
  }
  if(e.target.id==="share"){
    const txt=textList(),title=T("shareTitle")(C.short);
    if(NATIVE&&NP.Share){NP.Share.share({title,text:txt,dialogTitle:T("share")}).catch(()=>{});return;}
    if(navigator.share){navigator.share({title,text:txt}).catch(()=>{});return;}
    try{navigator.clipboard.writeText(txt).then(()=>say(T("copied")),()=>{say(T("copyManual"));fallbackText(txt,act);});}
    catch(_){say(T("copyManual"));fallbackText(txt,act);}
    return;
  }
  if(e.target.id==="clear"){
    const b2=e.target;
    if(b2.dataset.arm){sel.clear();save();render();return;}
    b2.dataset.arm="1";b2.textContent=T("clearSure");
    setTimeout(()=>{if(b2.isConnected){delete b2.dataset.arm;b2.textContent=T("clear");}},3500);
  }
});
document.getElementById("q").addEventListener("input",e=>{q=e.target.value;applyFilter();});
view.addEventListener("input",e=>{if(e.target.classList.contains("ntin"))setNote(e.target.dataset.nid,e.target.value);});
view.addEventListener("focusout",e=>{if(e.target.classList.contains("ntin"))closeNote(e.target);});
document.getElementById("nowbar").addEventListener("click",e=>{
  const id=e.currentTarget.dataset.target,n=nowConf();
  if(id)tab="mine";else if(n)tab=n.d;
  saveTab();render();
  const r=id&&[...view.querySelectorAll("[data-mrow]")].find(r=>r.dataset.mrow===id);
  if(r){r.scrollIntoView({block:"center"});r.classList.add("flash");}else window.scrollTo(0,0);
});

// ---- Açılış
(async function boot(){
  view.innerHTML=`<p class="ognote">${esc(T("loading"))}</p>`;
  await prefsToLocal();
  migrateLegacy();
  {const v=lsGet(G.lang);if(v==="tr"||v==="en")lang=v;remOn=lsGet(G.rem)!=="0";}
  applyLang();
  await loadIndex();
  // Hangi kongre açılacak: adres (?k=), son açılan, tek kongre varsa o
  const want=new URLSearchParams(location.search).get("k"),last=lsGet(G.last);
  const ids=IDX.map(c=>c.id);
  const id=(want&&/^[a-z0-9-]{2,40}$/.test(want)&&want)||(last&&ids.includes(last)&&last)||(ids.length===1?ids[0]:null)||(ids.length?null:"tgk2026");
  if(id&&await openConf(id)){applyLang();render();}
  else{C=null;tab="home";applyLang();render();}
  // Uygulama: açılış ekranını sayfa çizildikten sonra kapat (yapılandırmada 4 sn'lik güvenlik süresi var)
  if(NATIVE&&NP.SplashScreen)requestAnimationFrame(()=>NP.SplashScreen.hide({fadeOutDuration:200}).catch(()=>{}));
  // Kongre gününde açılışta o an süren (ya da sıradaki) oturuma kaydır
  if(C&&NOW0&&tab===NOW0.d){
    const r=view.querySelector(".row.live")||[...view.querySelectorAll("[data-row]")].find(el=>+el.dataset.se.split("|")[1]>NOW0.m);
    if(r)r.scrollIntoView({block:"center"});
  }
  setInterval(tick,30000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick();});
  if(NATIVE){
    const LN=NP.LocalNotifications;
    if(LN)LN.addListener("localNotificationActionPerformed",ev=>{const x=ev&&ev.notification&&ev.notification.extra;if(x)openItem(x.k,x.tgk);});
    if(NP.App){
      NP.App.addListener("appStateChange",st=>{if(st.isActive){tick();planNotifs();if(C)checkRemote(C.id);}});
      // Android geri tuşu: Programım/Sözlü bildirilerden güne, gün sekmesinden kongre listesine (birden çok kongre varsa), sonra çıkış
      NP.App.addListener("backButton",()=>{
        if(C&&(tab==="mine"||tab==="oral")){tab=(NOW0&&NOW0.d)||DAYS[0].k;saveTab();render();window.scrollTo(0,0);}
        else if(C&&tab!=="home"&&IDX.length>1){tab="home";render();window.scrollTo(0,0);}
        else NP.App.exitApp();});
    }
    planNotifs(true);
  }
  if(!NATIVE&&"serviceWorker" in navigator&&location.protocol==="https:"&&!/claude/.test(location.hostname)){
    try{navigator.serviceWorker.register("sw.js").catch(()=>{});}catch(_){}
  }
})();
