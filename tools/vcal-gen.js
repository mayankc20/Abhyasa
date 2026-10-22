const A = require('astronomy-engine');
const obs = new A.Observer(23.4234, 88.3881, 15); // Śrī Māyāpur
const IST = 5.5*3600e3;
const lahiri = d => 23.85 + (d.getUTCFullYear()+d.getUTCMonth()/12-2000)*0.01397; // ayanāṁśa, deg
const sunLon = t => A.SunPosition(t).elon;
const moonLon = t => A.EclipticGeoMoon(t).lon;
const elong = t => ((moonLon(t)-sunLon(t))%360+360)%360;
const tithi = t => Math.floor(elong(t)/12)+1; // 1..30
const MONTHS = ["Caitra","Vaiśākha","Jyeṣṭha","Āṣāḍha","Śrāvaṇa","Bhādra","Āśvina","Kārtika","Mārgaśīrṣa","Pauṣa","Māgha","Phālguna"];
function amantaMonth(t){ // month named from sidereal sun sign at the new moon that began it
  const nm = A.SearchMoonPhase(0, t.AddDays(-31), 32); // last new moon before t
  let last = nm, s = nm;
  while(true){ const n = A.SearchMoonPhase(0, last.AddDays(1), 31); if(n.date > t.date) break; last = n; }
  const next = A.SearchMoonPhase(0, last.AddDays(1), 31);
  const sign = d => Math.floor((((sunLon(d)-lahiri(d.date))%360)+360)%360/30); // 0 = Meṣa
  const s1 = sign(last), s2 = sign(next);
  return {m:(s1+1)%12, adhika: s1===s2}; // sun in Mīna(11) at new moon -> Caitra(0)
}
const SHUKLA_EK = {0:"Kāmadā",1:"Mohinī",2:"Pāṇḍava Nirjalā",3:"Śayana",4:"Pavitrāropaṇī",5:"Pārśva",6:"Pāśāṅkuśā",7:"Utthāna",8:"Mokṣadā",9:"Putradā",10:"Bhaimī",11:"Āmalakī-vrata"};
const FEST = [ // [month, tithi (1-30 amanta), name]
 [0,9,"Rāma-navamī"],[1,14,"Śrī Nṛsiṁha Caturdaśī"],[3,2,"Ratha-yātrā"],[4,15,"Balarāma Pūrṇimā"],[4,23,"Śrī Kṛṣṇa Janmāṣṭamī"],[4,24,"Nandotsava · Śrīla Prabhupāda Vyāsa-pūjā"],
 [5,8,"Rādhāṣṭamī"],[6,15,"Kārtika (Dāmodara) month begins"],[6,30,"Dīpāvalī"],[7,1,"Govardhana-pūjā"],[7,4,"Śrīla Prabhupāda disappearance"],[7,15,"Kārtika ends · Rāsa-yātrā"],
 [8,11,"Gītā-jayantī"],[10,5,"Vasanta-pañcamī"],[10,7,"Advaita Saptamī"],[10,13,"Nityānanda Trayodaśī"],[11,15,"Gaura Pūrṇimā"]];
const out = {}, add = (d,o) => { out[d] = Object.assign(out[d]||{}, o); };
const start = new Date(Date.UTC(2026,8,1)), end = new Date(Date.UTC(2028,0,1));
const days = [];
for(let d = new Date(start); d < end; d = new Date(d.getTime()+864e5)){
  const midnightIST = new A.AstroTime(new Date(d.getTime()-IST));
  const sr = A.SearchRiseSet(A.Body.Sun, obs, +1, midnightIST, 1);
  const aru = sr.AddDays(-96/1440);
  const ds = d.toISOString().slice(0,10);
  const mm = amantaMonth(sr);
  days.push({ds, t:tithi(sr), ta:tithi(aru), m:mm.m, adh:mm.adhika});
}
for(let i=0;i<days.length;i++){
  const x = days[i], prev = days[i-1], nx = days[i+1];
  for(const ek of [11,26]){
    // Ekādaśī tithi at sunrise and not touched by Daśamī at aruṇodaya
    if(x.t===ek && x.ta!==ek-1) add(x.ds,{e:(ek===11 && !x.adh ? SHUKLA_EK[x.m]+" Ekādaśī" : "Ekādaśī")});
    // viddha: Daśamī at aruṇodaya -> fast on the next day (Dvādaśī)
    if(x.t===ek && x.ta===ek-1 && nx) add(nx.ds,{e:(ek===11 && !x.adh ? SHUKLA_EK[x.m]+" Ekādaśī" : "Ekādaśī")+" (fast on Dvādaśī)"});
    // kṣaya: Ekādaśī never at sunrise
    if(prev && prev.t===ek-1 && x.t===ek+1) add(x.ds,{e:"Ekādaśī (fast on Dvādaśī)"});
  }
  if(!x.adh) for(const [m,t,n] of FEST){
    if(x.m===m && (x.t===t || (prev && prev.t===t-1 && x.t===t+1))) { if(!(prev && out[prev.ds]?.f?.includes(n))) add(x.ds,{f:[...(out[x.ds]?.f||[]),n]}); }
  }
  if(x.adh && (!prev || !prev.adh)) add(x.ds,{f:[...(out[x.ds]?.f||[]),"Puruṣottama (adhika) month begins"]});
}
require('fs').writeFileSync('vcal.json', JSON.stringify(out));
for(const [k,v] of Object.entries(out)) if(k<'2027-04-01') console.log(k, JSON.stringify(v));
