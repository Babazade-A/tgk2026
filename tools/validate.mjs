#!/usr/bin/env node
// Kongre veri dosyalarını yayına almadan önce denetler.
// Kullanım:  node tools/validate.mjs            (yalnızca yerel denetim)
//            node tools/validate.mjs --canli    (yayındaki sürümle de karşılaştırır: rev artırılmış mı, silinen kod var mı)
// Hata varsa çıkış kodu 1 olur; bu durumda yayına alma.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = process.env.KONGREM_DATA || join(ROOT, "data/v1");
const LIVE = "https://babazade-a.github.io/tgk2026/data/v1/";
const compareLive = process.argv.includes("--canli");
const TYPES = new Set(["cer", "conf", "talk", "sym", "sel", "course", "panel", "break"]);
let errors = 0, warnings = 0;
const err = (f, m) => { errors++; console.log(`  HATA   ${f}: ${m}`); };
const warn = (f, m) => { warnings++; console.log(`  uyarı  ${f}: ${m}`); };

const isStr = v => typeof v === "string" && v.trim() !== "";
const isML = v => isStr(v) || (v && typeof v === "object" && (isStr(v.tr) || isStr(v.en)));
const isTime = v => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const mins = t => +t.slice(0, 2) * 60 + +t.slice(3);
const texts = v => (v == null ? [] : typeof v === "string" ? [v] : [v.tr, v.en].filter(Boolean));
const readJSON = f => { try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { err(f, "JSON okunamadı: " + e.message); return null; } };

function checkConf(file, d) {
  const f = file.replace(ROOT + "/", "");
  if (d.schema !== 1) return err(f, `schema 1 olmalı (şu an ${d.schema})`);
  if (!/^[a-z0-9-]{2,40}$/.test(d.id || "")) err(f, "id yalnızca küçük harf, rakam ve tire olmalı (2–40 karakter)");
  if (!Number.isInteger(d.rev) || d.rev < 1) err(f, "rev pozitif tam sayı olmalı");
  for (const k of ["name", "dates"]) if (!isML(d[k])) err(f, `${k} eksik`);
  if (!isStr(d.short)) err(f, "short eksik");
  if (typeof d.utcOffsetMin !== "number" || Math.abs(d.utcOffsetMin) > 840) err(f, "utcOffsetMin geçersiz (Türkiye için 180)");
  if (!Array.isArray(d.days) || !d.days.length) return err(f, "days boş");
  const dayKeys = new Set();
  for (const x of d.days) {
    if (!isStr(x.k) || dayKeys.has(x.k)) err(f, `gün anahtarı eksik ya da tekrar: ${x.k}`);
    dayKeys.add(x.k);
    if (!/^\d{4}-\d\d-\d\d$/.test(x.date || "") || isNaN(Date.parse(x.date))) err(f, `gün ${x.k}: tarih YYYY-AA-GG olmalı`);
    if (!isML(x.label) || !isML(x.weekday)) err(f, `gün ${x.k}: label/weekday eksik`);
  }
  const ids = new Set(), rooms = d.rooms || {};
  const useRoom = (r, where) => { if (r && r !== d.mainRoom && !rooms[r]) warn(f, `${where}: "${r}" salonu rooms içinde yok (İngilizce adı gösterilemez)`); };
  for (const x of d.items || []) {
    const w = `program ${x.id}`;
    if (!isStr(x.id)) { err(f, "kimliği olmayan program öğesi"); continue; }
    if (ids.has(x.id)) err(f, `${w}: kimlik tekrar ediyor`); ids.add(x.id);
    if (!dayKeys.has(x.day)) err(f, `${w}: gün "${x.day}" days içinde yok`);
    if (!isTime(x.start) || !isTime(x.end)) err(f, `${w}: saat SS:DD olmalı`);
    else if (mins(x.end) <= mins(x.start)) err(f, `${w}: bitiş başlangıçtan sonra olmalı`);
    if (!TYPES.has(x.type)) warn(f, `${w}: bilinmeyen tür "${x.type}" (etiketsiz gösterilir)`);
    if (!isML(x.title)) err(f, `${w}: başlık eksik`);
    else if (typeof x.title === "object" && !x.title.en && x.type !== "break") warn(f, `${w}: İngilizce başlık yok (Türkçesi gösterilir)`);
    useRoom(x.room, w);
  }
  const o = d.oral;
  if (o) {
    if (!isTime(o.start) || !isTime(o.end) || !(o.minutesPerTalk > 0)) err(f, "oral: start/end/minutesPerTalk geçersiz");
    const nos = new Set();
    (o.sessions || []).forEach((s, i) => {
      const w = `sözlü oturum ${s.no || i + 1}`;
      if (s.no != null && nos.has(s.no)) err(f, `${w}: oturum numarası tekrar ediyor`); nos.add(s.no);
      if (!dayKeys.has(s.day)) err(f, `${w}: gün "${s.day}" days içinde yok`);
      useRoom(s.room, w);
      for (const t of s.talks || []) {
        if (!isStr(t.id)) { err(f, `${w}: kimliği olmayan bildiri`); continue; }
        if (ids.has(t.id)) err(f, `bildiri ${t.id}: kimlik tekrar ediyor`); ids.add(t.id);
        if (!isML(t.title)) err(f, `bildiri ${t.id}: başlık eksik`);
      }
      const end = mins(o.start) + (s.talks || []).length * o.minutesPerTalk;
      if (isTime(o.end) && end > mins(o.end) + 30) warn(f, `${w}: ${s.talks.length} bildiri ${o.minutesPerTalk} dk ile ${o.end}'i epey aşıyor`);
    });
  }
  // HTML benzeri içerik ekranda düz metin görünür; büyük olasılıkla kopyalama hatasıdır
  const all = [d.name, d.dates, d.note, ...(d.items || []).flatMap(x => [x.title, x.sub, x.speakers, x.chairs]),
    ...((o && o.sessions) || []).flatMap(s => [s.chairs, ...s.talks.flatMap(t => [t.title, t.presenter])])].flatMap(texts);
  const html = all.filter(t => /<[a-z/!]/i.test(t));
  if (html.length) warn(f, `${html.length} metinde HTML etiketi var (düz metin olarak görünecek): ${html[0].slice(0, 60)}`);
  const dbl = all.filter(t => /\s{2,}|^\s|\s$/.test(t));
  if (dbl.length) warn(f, `${dbl.length} metinde fazladan boşluk var: "${dbl[0].slice(0, 50)}"`);
  return ids;
}

async function compare(id, local, ids) {
  let live;
  try { const r = await fetch(LIVE + id + ".json", { cache: "no-store" }); if (r.status === 404) { console.log(`  bilgi  ${id}: yayında henüz yok (yeni kongre)`); return; } live = await r.json(); }
  catch (e) { warn(id, "yayındaki sürüm alınamadı: " + e.message); return; }
  const same = JSON.stringify({ ...live, rev: 0, updated: 0 }) === JSON.stringify({ ...local, rev: 0, updated: 0 });
  if (!same && local.rev <= live.rev) err(id, `içerik değişmiş ama rev artırılmamış (yayında ${live.rev}, yerelde ${local.rev}). Uygulamalar güncellemeyi almaz.`);
  if (same && local.rev !== live.rev) warn(id, "içerik aynı ama rev farklı");
  const liveIds = [...(live.items || []).map(x => x.id), ...((live.oral && live.oral.sessions) || []).flatMap(s => s.talks.map(t => t.id))];
  const gone = liveIds.filter(x => !ids.has(x));
  if (gone.length) warn(id, `${gone.length} kod kaldırılmış (${gone.slice(0, 5).join(", ")}…): bunları seçmiş kişilerin seçimleri kaybolur. Kodları değiştirmek yerine yeni kod ekleyin.`);
}

const idxFile = join(DIR, "conferences.json");
console.log("Kongre verisi denetleniyor: " + DIR);
const idx = readJSON(idxFile);
if (idx) {
  if (idx.schema !== 1 || !Array.isArray(idx.conferences)) err("conferences.json", "schema 1 ve conferences listesi olmalı");
  const seen = new Set();
  for (const c of idx.conferences || []) {
    if (seen.has(c.id)) err("conferences.json", `tekrar eden kongre: ${c.id}`); seen.add(c.id);
    if (!isStr(c.short) || !isML(c.name)) err("conferences.json", `${c.id}: short/name eksik`);
    const file = join(DIR, c.id + ".json");
    if (!existsSync(file)) { err("conferences.json", `${c.id}.json dosyası yok`); continue; }
    const d = readJSON(file); if (!d) continue;
    if (d.id !== c.id) err(c.id + ".json", `dosyadaki id (${d.id}) listedekiyle aynı değil`);
    if (c.rev != null && c.rev !== d.rev) warn("conferences.json", `${c.id}: listedeki rev (${c.rev}) dosyadakinden (${d.rev}) farklı`);
    const ids = checkConf(file, d);
    if (ids) console.log(`  özet   ${c.id}: ${d.days.length} gün, ${(d.items || []).length} program öğesi, ${ids.size} kod, rev ${d.rev}`);
    if (compareLive && ids) await compare(c.id, d, ids);
  }
}
console.log(errors ? `\n${errors} hata, ${warnings} uyarı. Yayına almayın.` : `\nHata yok (${warnings} uyarı).`);
process.exit(errors ? 1 : 0);
