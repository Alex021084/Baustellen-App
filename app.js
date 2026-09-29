const $=x=>document.getElementById(x);
let reports=JSON.parse(localStorage.tagelohn||'[]');
let editingReportIndex=null;
let navigationHistory=[];
let archiveSelectedContractor=null;
let archiveSelectedProject=null;
const defaultCustomers=[{id:'dreyer',name:'Dreyer Hochbau GmbH & Co. KG',address:'Mühlenberg 12\n27404 Elsdorf'}];
let customers=JSON.parse(localStorage.tagelohnCustomers||'null')||defaultCustomers;
if(!Array.isArray(customers)) customers=[...defaultCustomers];
customers=customers.map(c=>({...c,projects:Array.isArray(c.projects)?c.projects:[]}));
// Bereits verwendete Bauvorhaben aus vorhandenen Nachweisen übernehmen.
reports.forEach(r=>{const c=customers.find(x=>x.name===r.contractor);const project=String(r.project||'').trim();if(c&&project&&!c.projects.some(p=>p.toLowerCase()===project.toLowerCase()))c.projects.push(project);});
let services=JSON.parse(localStorage.tagelohnServices||'null');
let employees=JSON.parse(localStorage.tagelohnEmployees||'null');
const defaultServices=[
  'Vorarbeiter',
  'Facharbeiter',
  'Minibagger',
  'Kompaktbagger',
  'Kompaktbagger mit Hydraulikmeißel',
  'Raupenbagger',
  'Radlader 1,5 cbm',
  'Radlader 3 cbm',
  'Radlader mit Planmatic',
  'LKW Solo',
  'LKW Anhängerzug',
  'LKW mit Tieflader',
  'Asphaltwalze',
  'Transporter'
];
if(!Array.isArray(services)||!services.length) services=[...defaultServices];
const defaultEmployees=[
  'Alexander Geestmann',
  'Dennis Dählmann',
  'Thorsten Dählmann',
  'Joachim Ziegler',
  'Kevin Wicke',
  'Mario Wicke-Porath',
  'Steven Jansen'
];
if(!Array.isArray(employees)||!employees.length) employees=[...defaultEmployees];


function cleanCustomerDisplayName(name){
  return String(name||'')
    .replace(/\s*,?\s+GmbH\s*&\s*Co\.\s*KG\.?$/i,'')
    .replace(/\s*,?\s+GmbH$/i,'')
    .replace(/\s*,?\s+AG$/i,'')
    .replace(/\s*,?\s+UG\s*\(haftungsbeschränkt\)$/i,'')
    .replace(/\s*,?\s+UG$/i,'')
    .replace(/\s*,?\s+e\.?\s*K\.?$/i,'')
    .trim();
}
function renderReportCustomerSelect(selectedName=''){
  const s=$('reportCustomerSelect');
  if(!s)return;
  s.innerHTML='<option value="">— Kunde auswählen —</option>'+
    customers.map(c=>`<option value="${esc(c.id)}">${esc(cleanCustomerDisplayName(c.name))}</option>`).join('');
  const c=customers.find(x=>x.name===selectedName);
  s.value=c?c.id:'';
  renderReportProjectSelect();
}
function renderReportProjectSelect(selectedProject='') {
  const s=$('reportProjectSelect');
  if(!s)return;
  const c=customers.find(x=>x.id===$('reportCustomerSelect')?.value);
  const projects=Array.isArray(c?.projects)?c.projects:[];
  s.innerHTML='<option value="">— Bauvorhaben auswählen —</option>'+
    projects.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  s.value=projects.includes(selectedProject)?selectedProject:'';
  loadReportWeather();
}
function initTagesbericht(){
  const d=$('reportDate');
  const display=$('reportDateDisplay');
  if(d){
    if(!d.value)d.value=today();
    if(display)display.value=formatLongDate(d.value);
    d.onchange=()=>{if(display)display.value=formatLongDate(d.value);loadReportWeather()};
  }
  renderReportCustomerSelect();
  const c=$('reportCustomerSelect');
  if(c)c.onchange=()=>renderReportProjectSelect();
  const p=$('reportProjectSelect');
  if(p)p.onchange=()=>loadReportWeather();
  loadReportWeather();
}

function setReportWeather(temp='—', precipitation='—', status='', wind='—', cloud='—'){
  const t=$('reportTemperature'), p=$('reportPrecipitation'), w=$('reportWind'), c=$('reportCloud'), s=$('reportWeatherStatus');
  if(t)t.textContent=temp;
  if(p)p.textContent=precipitation;
  if(w)w.textContent=wind;
  if(c)c.textContent=cloud;
  if(s)s.textContent=status;
}
function normalizeAddress(address){
  return String(address||'').replaceAll('\n',' ').replace(/\s+/g,' ').trim();
}
async function getCurrentDeviceLocation(){
  if(!('geolocation' in navigator)) throw new Error('Standort des Handys wird von diesem Browser nicht unterstützt');
  return await new Promise((resolve,reject)=>{
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({latitude:pos.coords.latitude,longitude:pos.coords.longitude}),
      err=>{
        const msg=err?.code===1?'Standortfreigabe wurde nicht erlaubt.':err?.code===2?'Standort konnte nicht ermittelt werden.':'Standortabfrage ist fehlgeschlagen.';
        reject(new Error(msg));
      },
      {enableHighAccuracy:true,timeout:12000,maximumAge:300000}
    );
  });
}
async function geocodeCustomerAddress(address){
  const q=normalizeAddress(address);
  if(!q)return null;
  const url='https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(q)+'&count=1&language=de&format=json';
  const res=await fetch(url);
  if(!res.ok)throw new Error('Geocoding fehlgeschlagen');
  const data=await res.json();
  const r=data?.results?.[0];
  return r?{latitude:r.latitude,longitude:r.longitude,name:r.name,country:r.country}:null;
}
async function fetchDailyWeather(lat,lon,date){
  const todayDate=today();
  const params=new URLSearchParams({
    latitude:String(lat),longitude:String(lon),
    daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,cloud_cover_mean',
    temperature_unit:'celsius',precipitation_unit:'mm',timezone:'auto',
    start_date:date,end_date:date
  });
  const endpoint=date < todayDate
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const res=await fetch(endpoint+'?'+params.toString());
  if(!res.ok)throw new Error('Wetterabfrage fehlgeschlagen');
  const data=await res.json();
  const idx=Array.isArray(data?.daily?.time)?data.daily.time.indexOf(date):-1;
  if(idx<0)throw new Error('Für diesen Tag liegen keine Wetterdaten vor');
  return {
    min:data.daily.temperature_2m_min?.[idx],
    max:data.daily.temperature_2m_max?.[idx],
    precipitation:data.daily.precipitation_sum?.[idx],
    windMax:data.daily.wind_speed_10m_max?.[idx],
    cloudMean:data.daily.cloud_cover_mean?.[idx]
  };
}
let weatherRequestToken=0;
async function loadReportWeather(){
  const token=++weatherRequestToken;
  const date=$('reportDate')?.value;
  const customerId=$('reportCustomerSelect')?.value;
  if(!date||!customerId){setReportWeather('—','—','','—','—');return;}
  setReportWeather('…','…','Standort des Handys wird ermittelt …','…','…');
  try{
    let geo=null;
    let locationLabel='Handy-Standort';
    try{
      geo=await getCurrentDeviceLocation();
    }catch(locationErr){
      const customer=customers.find(c=>c.id===customerId);
      if(customer?.address){
        setReportWeather('…','…','Handy-Standort nicht verfügbar – Anschrift wird versucht …','…','…');
        geo=await geocodeCustomerAddress(customer.address);
        locationLabel='Baustellenanschrift';
      }else throw locationErr;
    }
    if(token!==weatherRequestToken)return;
    if(!geo)throw new Error('Standort konnte nicht ermittelt werden');
    const weather=await fetchDailyWeather(geo.latitude,geo.longitude,date);
    if(token!==weatherRequestToken)return;
    const min=Number.isFinite(weather.min)?Math.round(weather.min):null;
    const max=Number.isFinite(weather.max)?Math.round(weather.max):null;
    const temp=min!==null&&max!==null?`${min}–${max} °C`:max!==null?`${max} °C`:min!==null?`${min} °C`:'—';
    const precip=Number.isFinite(weather.precipitation)?`${weather.precipitation.toLocaleString('de-DE',{maximumFractionDigits:1})} mm`:'—';
    const wind=Number.isFinite(weather.windMax)?`${Math.round(weather.windMax)} km/h`:'—';
    const cloud=Number.isFinite(weather.cloudMean)?`${Math.round(weather.cloudMean)} %`:'—';
    setReportWeather(temp,precip,`Automatisch über ${locationLabel} für ${date.split('-').reverse().join('.')} geladen.`,wind,cloud);
  }catch(err){
    if(token!==weatherRequestToken)return;
    setReportWeather('—','—',err?.message||'Wetterdaten konnten nicht geladen werden.','—','—');
  }
}

let reportEmployeeEntries=[];
const reportEmployeeRoles=['Vorarbeiter','Facharbeiter','Maschinist','LKW','Praktikant'];
function reportEmployeeOptions(selected=''){
  return '<option value="">— Mitarbeiter auswählen —</option>'+employees.map(e=>`<option value="${esc(e)}"${e===selected?' selected':''}>${esc(e)}</option>`).join('');
}
function reportRoleOptions(selected=''){
  return '<option value="">— Funktion auswählen —</option>'+reportEmployeeRoles.map(r=>`<option value="${esc(r)}"${r===selected?' selected':''}>${esc(r)}</option>`).join('');
}
function reportTimeOptions(selected=''){
  return timeOptions(selected);
}
function reportPauseOptions(selected=0){
  return pauseOptions(selected);
}
function calcReportEmployeeCard(card){
  const s=card.querySelector('.reportStart')?.value||'', e=card.querySelector('.reportEnd')?.value||'', p=+(card.querySelector('.reportPause')?.value||0);
  const out=card.querySelector('.reportHours');
  if(!out)return;
  if(s&&e){
    const a=s.split(':').map(Number), b=e.split(':').map(Number);
    const m=b[0]*60+b[1]-a[0]*60-a[1]-p;
    out.value=m>=0?(m/60).toFixed(2):'';
  }else out.value='';
}
function addReportEmployee(entry={}){
  const wrap=$('reportEmployeeEntries');
  if(!wrap)return;
  const d=document.createElement('div'); d.className='reportEmployeeCard';
  d.innerHTML=`<button type="button" class="reportEmployeeDelete" aria-label="Mitarbeiter entfernen">×</button>
    <div class="reportEmployeeTitle">Mitarbeiter</div>
    <label>Mitarbeiter<select class="reportName" aria-label="Mitarbeiter auswählen">${reportEmployeeOptions(entry.name||'')}</select></label>
    <label>Funktion<select class="reportRole" aria-label="Funktion auswählen">${reportRoleOptions(entry.role||'')}</select></label>
    <div class="grid grid3 reportTimeGrid">
      <label>Arbeitsbeginn<select class="reportStart timeSelect" aria-label="Arbeitsbeginn auswählen">${reportTimeOptions(entry.start||'')}</select></label>
      <label>Arbeitsende<select class="reportEnd timeSelect" aria-label="Arbeitsende auswählen">${reportTimeOptions(entry.end||'')}</select></label>
      <label>Pause<select class="reportPause" aria-label="Pause auswählen">${reportPauseOptions(entry.pause??0)}</select></label>
    </div>
    <label class="reportHoursLabel">Gesamt (Std.)<input class="reportHours" type="number" step="0.25" readonly value="${entry.hours??''}"></label>`;
  d.querySelector('.reportEmployeeDelete').onclick=()=>{d.remove(); if(!document.querySelector('#reportEmployeeEntries .reportEmployeeCard')) addReportEmployee();};
  ['reportStart','reportEnd','reportPause'].forEach(c=>d.querySelector('.'+c).oninput=()=>calcReportEmployeeCard(d));
  wrap.appendChild(d);
  calcReportEmployeeCard(d);
}
function initTagesberichtEmployees(){
  const wrap=$('reportEmployeeEntries');
  if(!wrap)return;
  wrap.innerHTML='';
  reportEmployeeEntries=[];
  addReportEmployee();
}

let reportWorkEntries=[];
let reportMaterialEntries=[];
function addReportListEntry(containerId, value=''){
  const wrap=$(containerId);
  if(!wrap)return;
  const row=document.createElement('div');
  row.className='reportListEntry';
  row.innerHTML=`<input type="text" value="${esc(value)}" placeholder="Eintrag eingeben..." aria-label="Eintrag"><button type="button" class="reportListDelete" aria-label="Eintrag entfernen">×</button>`;
  row.querySelector('.reportListDelete').onclick=()=>row.remove();
  wrap.appendChild(row);
  row.querySelector('input').focus();
}
function initTagesberichtWorks(){
  const works=$('reportWorksEntries'), materials=$('reportMaterialsEntries');
  if(!works||!materials)return;
  works.innerHTML=''; materials.innerHTML='';
  (reportWorkEntries.length?reportWorkEntries:['']).forEach(v=>addReportListEntry('reportWorksEntries',v));
  (reportMaterialEntries.length?reportMaterialEntries:['']).forEach(v=>addReportListEntry('reportMaterialsEntries',v));
}
function collectReportList(containerId){
  return [...document.querySelectorAll(`#${containerId} input`)].map(x=>x.value.trim()).filter(Boolean);
}
function collectReportEmployees(){
  return [...document.querySelectorAll('#reportEmployeeEntries .reportEmployeeCard')].map(d=>({
    name:d.querySelector('.reportName')?.value||'',
    role:d.querySelector('.reportRole')?.value||'',
    start:d.querySelector('.reportStart')?.value||'',
    end:d.querySelector('.reportEnd')?.value||'',
    pause:+(d.querySelector('.reportPause')?.value||0),
    hours:+(d.querySelector('.reportHours')?.value||0)
  })).filter(e=>e.name||e.role||e.start||e.end);
}

function persistCustomers(){localStorage.tagelohnCustomers=JSON.stringify(customers)}
function persistServices(){localStorage.tagelohnServices=JSON.stringify(services)}
function persistEmployees(){localStorage.tagelohnEmployees=JSON.stringify(employees)}
function openServices(){renderServices();show('services')}
function renderServices(){
  const l=$('serviceList'); l.innerHTML='';
  services.forEach((name,i)=>{
    const d=document.createElement('div'); d.className='serviceRow';
    d.innerHTML=`<input class="serviceEdit" value="${esc(name)}" aria-label="Leistung">`;
    const input=d.querySelector('.serviceEdit');
    const saveEdit=()=>{
      const value=input.value.trim();
      if(!value || value===services[i]) return;
      if(services.some((x,j)=>j!==i&&x.toLowerCase()===value.toLowerCase())){input.value=services[i];alert('Diese Leistung gibt es bereits.');return;}
      services[i]=value; persistServices();
    };
    input.addEventListener('change',saveEdit);
    input.addEventListener('blur',saveEdit);
    enableSwipeDelete(d,()=>{services.splice(i,1);persistServices();renderServices();});
    l.append(d);
  });
  if(!services.length)l.innerHTML='<div class="empty">Noch keine Leistungen angelegt.</div>';
}
function addService(){
  const value=$('serviceName').value.trim();
  if(!value){alert('Bitte eine Bezeichnung eingeben.');return}
  if(services.some(s=>s.toLowerCase()===value.toLowerCase())){alert('Diese Leistung gibt es bereits.');return}
  services.push(value);persistServices();$('serviceName').value='';renderServices();
}
let previousScreen='home';
function show(id, options={}){
  const current=document.querySelector('.screen.active')?.id;
  if(current && current!==id){
    if(options.replaceHistory){
      navigationHistory=navigationHistory.slice(0,-1);
    }else{
      navigationHistory.push(current);
    }
    previousScreen=current;
  }
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  const screen=$(id);
  if(screen) screen.classList.add('active');

  const nav=document.getElementById('appNav');
  if(nav) nav.style.display=(id==='home')?'none':'flex';

  document.body.classList.toggle('home-screen',id==='home');
  const tagelohnIds=['tagelohnHome','archive','customers','services','employeeManager','editor','summaryScreen','signatureScreen'];
  document.body.classList.toggle('tagelohn-clean',tagelohnIds.includes(id));
  scrollTo(0,0);
}

function goBackOneStep(){
  const current=document.querySelector('.screen.active')?.id;

  // Tagesbericht hat seinen eigenen, festen Schrittverlauf.
  // Dadurch kann die globale Tagelohn-Historie nicht mehr dazwischenfunken.
  if(current==='pdfAlignerScreen'){ show('tagesberichtSummary',{replaceHistory:true}); return; }
  if(current==='tagesberichtSummary'){ show('tagesberichtWorks',{replaceHistory:true}); return; }
  if(current==='tagesberichtWorks'){ show('tagesberichtEmployees',{replaceHistory:true}); return; }
  if(current==='tagesberichtEmployees'){ show('tagesbericht',{replaceHistory:true}); return; }
  if(current==='tagesbericht'){ navigationHistory=[]; show('home',{replaceHistory:true}); return; }

  // Im Archiv immer genau eine Ebene zurück.
  if(current==='archive'){
    if(archiveSelectedProject){
      archiveSelectedProject=null;
      render();
      return;
    }
    if(archiveSelectedContractor){
      archiveSelectedContractor=null;
      render();
      return;
    }
    show('tagelohnHome');
    return;
  }

  // Beim Öffnen eines vorhandenen Nachweises zurück zum selben
  // Bauvorhaben-Archiv – nicht zurück zur Startseite.
  if(current==='editor'){
    if(editingReportIndex!==null){
      render();
      show('archive');
    }else{
      show('tagelohnHome');
    }
    return;
  }

  const target=navigationHistory.pop();
  if(target){
    show(target,{replaceHistory:true});
    return;
  }

  if(current==='tagelohnHome') show('home');
  else show('tagelohnHome');
}
function today(){return new Date().toISOString().slice(0,10)}
function formatLongDate(value){
  if(!value)return '';
  const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return formatDate(value)||value;
  const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
  const weekdays=['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  return `${weekdays[d.getDay()]}, ${m[3]}.${m[2]}.${m[1]}`;
}
function syncDateDisplay(){
  const date=$('date'), display=$('dateDisplay');
  if(date&&display) display.value=formatLongDate(date.value);
}
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}

function renderCustomerSelect(selectedName=''){
  const s=$('contractorSelect');
  s.innerHTML='<option value="">— Kunde auswählen —</option>'+customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')+'<option value="__manual__">Manuell / anderer Auftraggeber</option>';
  const match=customers.find(c=>c.name===selectedName);
  s.value=match?match.id:(selectedName?'__manual__':'');
  customerChanged();
}
function renderProjectSelect(selectedProject=''){
  const select=$('projectSelect'), manual=$('project');
  if(!select||!manual)return;
  const id=$('contractorSelect')?.value;
  const c=customers.find(x=>x.id===id);
  const projects=Array.isArray(c?.projects)?c.projects:[];
  select.innerHTML='<option value=""></option>'+projects.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')+'<option value="__manual__">＋ Neues Bauvorhaben eingeben</option>';
  if(selectedProject&&projects.includes(selectedProject)){select.value=selectedProject;manual.value=selectedProject;manual.style.display='none';}
  else if(selectedProject){select.value='__manual__';manual.value=selectedProject;manual.style.display='block';}
  else {select.value='';manual.value='';manual.style.display=projects.length?'none':'block';}
}
function projectChanged(){
  const v=$('projectSelect').value;
  if(v==='__manual__'){$('project').style.display='block';$('project').focus();return;}
  $('project').value=v; $('project').style.display='none';
}
function customerChanged(){
  const id=$('contractorSelect').value;
  if(!id)return;
  if(id==='__manual__'){
    const current=$('contractorSelect').dataset.manualName||'';
    $('contractorSelect').dataset.manualName=current;
    renderProjectSelect($('project')?.value||'');
    return;
  }
  const c=customers.find(x=>x.id===id); if(!c)return;
  $('contractorSelect').dataset.manualName=c.name;
  $('address').value=c.address;
  renderProjectSelect('');
}
function contractorName(){
  const id=$('contractorSelect').value;
  if(id==='__manual__')return $('contractorSelect').dataset.manualName||'';
  const c=customers.find(x=>x.id===id); return c?.name||'';
}
function openCustomers(){renderCustomers();renderProjectCustomerSelect();show('customers')}
function renderProjectCustomerSelect(selectedId=''){
  const s=$('projectCustomerSelect'); if(!s)return;
  s.innerHTML=customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if(selectedId)s.value=selectedId;
  renderProjectList();
}
function renderProjectList(){
  const l=$('projectList'); if(!l)return; l.innerHTML='';
  const id=$('projectCustomerSelect').value, c=customers.find(x=>x.id===id);
  if(!c){return;}
  const projects=c.projects||[];
  if(!projects.length){l.innerHTML='<div class="empty">Noch keine Bauvorhaben angelegt.</div>';return;}
  projects.forEach((name,i)=>{
    const d=document.createElement('div'); d.className='projectManageRow';
    d.innerHTML=`<span>${esc(name)}</span><button type="button" aria-label="Bauvorhaben löschen">×</button>`;
    d.querySelector('button').onclick=()=>{if(confirm('Bauvorhaben wirklich löschen?')){c.projects.splice(i,1);persistCustomers();renderProjectList();renderProjectSelect($('project').value||'');}};
    l.append(d);
  });
}
function addProject(){
  const id=$('projectCustomerSelect').value, value=$('projectName').value.trim(), c=customers.find(x=>x.id===id);
  if(!c){alert('Bitte zuerst einen Auftraggeber auswählen.');return}
  if(!value){alert('Bitte ein Bauvorhaben eingeben.');return}
  c.projects=c.projects||[];
  if(c.projects.some(p=>p.toLowerCase()===value.toLowerCase())){alert('Dieses Bauvorhaben gibt es bereits.');return}
  c.projects.push(value);persistCustomers();$('projectName').value='';renderProjectList();
}
function renderCustomers(){
  const l=$('customerList');
  l.innerHTML='';
  if(!customers.length){l.innerHTML='<div class="panel">Noch keine Kunden angelegt.</div>';return}
  customers.forEach(c=>{
    const d=document.createElement('div');d.className='archive';
    const projects=(c.projects||[]);
    d.innerHTML=`<b>${esc(c.name)}</b><small>${esc(c.address).replaceAll('\n','<br>')}</small><small>${projects.length} ${projects.length===1?'Bauvorhaben':'Bauvorhaben'}</small><button class="del customerDel">Löschen</button>`;
    d.querySelector('.customerDel').onclick=()=>{if(confirm('Kunden wirklich löschen?')){customers=customers.filter(x=>x.id!==c.id);persistCustomers();renderCustomers();renderProjectCustomerSelect();renderCustomerSelect($('contractorSelect').dataset.manualName||'')}};
    l.append(d);
  });
}
function addCustomer(){
  const name=$('customerName').value.trim(),address=$('customerAddress').value.trim();
  if(!name||!address){alert('Bitte Kundenname und Anschrift eingeben.');return}
  const existing=customers.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(existing){existing.address=address}else customers.push({id:'c_'+Date.now(),name,address,projects:[]});
  persistCustomers();
  $('customerName').value='';$('customerAddress').value='';
  renderCustomers();renderCustomerSelect(name);renderProjectCustomerSelect(existing?.id||customers.find(c=>c.name===name)?.id||'');
  $('contractorSelect').dataset.manualName=name;
  $('address').value=address;
  alert('Kunde gespeichert.');
}


function openEmployees(){renderEmployees();show('employeeManager')}
function renderEmployees(){
  const l=$('employeeList'); l.innerHTML='';
  employees.forEach((name,i)=>{
    const d=document.createElement('div'); d.className='serviceRow';
    d.innerHTML=`<input class="employeeEdit" value="${esc(name)}" aria-label="Mitarbeiter">`;
    const input=d.querySelector('.employeeEdit');
    const saveEdit=()=>{
      const value=input.value.trim();
      if(!value || value===employees[i]) return;
      if(employees.some((x,j)=>j!==i&&x.toLowerCase()===value.toLowerCase())){input.value=employees[i];alert('Diesen Mitarbeiter gibt es bereits.');return;}
      employees[i]=value; persistEmployees();
    };
    input.addEventListener('change',saveEdit);
    input.addEventListener('blur',saveEdit);
    enableSwipeDelete(d,()=>{employees.splice(i,1);persistEmployees();renderEmployees();});
    l.append(d);
  });
  if(!employees.length)l.innerHTML='<div class="empty">Noch keine Mitarbeiter angelegt.</div>';
}
function addEmployee(){
  const value=$('employeeName').value.trim();
  if(!value){alert('Bitte einen Namen eingeben.');return}
  if(employees.some(e=>e.toLowerCase()===value.toLowerCase())){alert('Diesen Mitarbeiter gibt es bereits.');return}
  employees.push(value);persistEmployees();$('employeeName').value='';renderEmployees();
}
function employeeOptions(selected=''){
  const current=String(selected||'');
  const options=employees.map(n=>`<option value="${esc(n)}"${n===current?' selected':''}>${esc(n)}</option>`).join('');
  return '<option value="">— Mitarbeiter auswählen —</option>'+options;
}

function serviceOptions(selected=''){
  const current=String(selected||'');
  const options=services.map(s=>`<option value="${esc(s)}"${s===current?' selected':''}>${esc(s)}</option>`).join('');
  return '<option value="">'+'- Leistung -'+'</option>'+options;
}
function timeOptions(selected=''){
  let value=String(selected||'');
  if(value){
    const m=value.match(/^(\d{1,2}):(\d{2})$/);
    if(m){
      let total=Number(m[1])*60+Number(m[2]);
      total=Math.round(total/15)*15;
      if(total>=1440) total=1425;
      value=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
    }
  }
  // Arbeitszeiten sind in allen Bereichen auf 04:00 bis 22:00 Uhr begrenzt.
  // Werte außerhalb dieses Bereichs werden nicht vorausgewählt.
  const selectedMinutes = value ? (() => { const [h,m]=value.split(':').map(Number); return h*60+m; })() : -1;
  if(selectedMinutes < 240 || selectedMinutes > 1320) value='';
  let html='<option value="">— Uhrzeit —</option>';
  for(let total=240; total<=1320; total+=15){
    const h=Math.floor(total/60), min=total%60;
    const v=String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');
    html+=`<option value="${v}"${v===value?' selected':''}>${v}</option>`;
  }
  return html;
}
function pauseOptions(selected=0){
  const value=String(selected ?? 0);
  return `<option value="0"${value==='0'?' selected':''}>Keine Pause</option><option value="15"${value==='15'?' selected':''}>15 Minuten</option><option value="30"${value==='30'?' selected':''}>30 Minuten</option><option value="45"${value==='45'?' selected':''}>45 Minuten</option>`;
}
function addEmp(e={}){
  const selectedService=e.service||e.activity||'';
  const d=document.createElement('div'); d.className='employee';
  d.innerHTML=`<button type="button" class="del">Löschen</button><b>Mitarbeiter</b>
  <label>Name des Mitarbeiters<select class="name" aria-label="Mitarbeiter auswählen">${employeeOptions(e.name||'')}</select></label>
  <div class="grid"><label>Leistung<select class="service" aria-label="Leistung für Mitarbeiter auswählen">${serviceOptions(selectedService)}</select></label>
  <label>Stunden<input class="hours" type="number" step=".25" value="${e.hours??0}"></label></div>
  <div class="grid grid3"><label>Anfang<select class="start timeSelect" aria-label="Anfang auswählen">${timeOptions(e.start||'')}</select></label><label>Ende<select class="end timeSelect" aria-label="Ende auswählen">${timeOptions(e.end||'')}</select></label><label>Pause<select class="pause" aria-label="Pause auswählen">${pauseOptions(e.pause??0)}</select></label></div>`;
  d.querySelector('.del').onclick=()=>d.remove();
  ['start','end','pause'].forEach(c=>d.querySelector('.'+c).oninput=()=>calc(d));
  $('employees').append(d);
}
function calc(d){let s=d.querySelector('.start').value,e=d.querySelector('.end').value,p=+(d.querySelector('.pause').value||0);if(s&&e){let a=s.split(':').map(Number),b=e.split(':').map(Number),m=b[0]*60+b[1]-a[0]*60-a[1]-p;if(m>=0)d.querySelector('.hours').value=(m/60).toFixed(2)}}
function item(id,v=''){let d=document.createElement('div');d.className='item';d.innerHTML=`<input value="${esc(v)}"><button class="del">×</button>`;d.querySelector('button').onclick=()=>d.remove();$(id).append(d)}

function hasSignature(){
  const data=ctx.getImageData(0,0,c.width,c.height).data;
  for(let i=3;i<data.length;i+=4) if(data[i]>10) return true;
  return false;
}
function updateSignatureStatus(){
  const s=$('signatureStatus');
  if(!s)return;
  const signed=hasSignature();
  s.textContent=signed?'✓ Unterschrift vorhanden':'Noch nicht unterschrieben';
  s.classList.toggle('signed',signed);
}
function summaryMoneyHours(){
  return [...document.querySelectorAll('.employee')].reduce((sum,d)=>sum+(Number(d.querySelector('.hours')?.value)||0),0);
}
function renderSummary(){
  const data=collect();
  const rows=data.employees.filter(e=>e.name||e.service||e.hours||e.start||e.end||e.pause).map(e=>`
    <tr><td>${esc(e.name||'—')}</td><td>${esc(e.service||'—')}</td><td>${(Number(e.hours)||0).toFixed(2).replace('.',',')} Std.</td><td>${esc(e.start||'—')}</td><td>${esc(e.end||'—')}</td><td>${e.pause?esc(String(e.pause))+' min':'—'}</td></tr>`).join('');
  $('summaryContent').innerHTML=`
    <div class="summaryBlock"><h3>Tagelohnnachweis</h3><div class="summaryMeta">
      <div><b>Datum</b>${esc(formatDate(data.date)||'—')}</div>
      <div><b>Auftraggeber</b>${esc(data.contractor||'—')}</div>
      <div><b>Bauvorhaben</b>${esc(data.project||'—')}</div>
      <div><b>Anschrift</b>${esc(data.address||'—').replaceAll('\n','<br>')}</div>
    </div></div>
    <div class="summaryBlock"><h3>Mitarbeiter und Leistungen</h3>
      ${rows?`<div style="overflow:auto"><table class="summaryTable"><thead><tr><th>Mitarbeiter</th><th>Leistung</th><th>Stunden</th><th>Anfang</th><th>Ende</th><th>Pause</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty">Keine Mitarbeiter eingetragen.</div>'}
    </div>
    <div class="summaryBlock"><h3>Ausgeführte Arbeiten</h3>${data.works.length?`<ul class="summaryList">${data.works.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:'<div class="empty">Keine Angaben.</div>'}</div>
    <div class="summaryBlock"><h3>Material / sonstige Leistungen</h3>${data.materials.length?`<ul class="summaryList">${data.materials.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:'<div class="empty">Keine Angaben.</div>'}</div>
    <div class="summaryBlock"><h3>Unterschrift Auftraggeber</h3><div class="hint">Mit der Unterschrift bestätigt der Auftraggeber die oben angezeigten Angaben.</div></div>`;
}

function clearSignature(){ctx.clearRect(0,0,c.width,c.height); updateSignatureStatus()}
function fill(r){
  // Neuer Tagelohn muss IMMER mit einem komplett leeren Formular starten.
  // Die gespeicherten Kunden/Projekte bleiben erhalten, werden aber nicht als
  // zuletzt verwendete Auswahl in einen neuen Nachweis übernommen.
  const isNew=!r || Object.keys(r).length===0;
  $('date').value=isNew?today():(r.date||today());
  syncDateDisplay();

  if(isNew){
    renderCustomerSelect('');
    const contractor=$('contractorSelect');
    contractor.value='';
    contractor.dataset.manualName='';
    $('address').value='';
    $('project').value='';
    $('client').value='';
    $('employees').innerHTML='';
    $('works').innerHTML='';
    $('materials').innerHTML='';
    // Kein alter Bauvorhaben-Text und keine alte Auswahl übernehmen.
    const projectSelect=$('projectSelect');
    if(projectSelect){
      projectSelect.innerHTML='<option value=""></option><option value="__manual__">＋ Neues Bauvorhaben eingeben</option>';
      projectSelect.value='';
    }
    $('project').style.display='block';
    clearSignature();
    updateSignatureStatus();
    return;
  }

  renderCustomerSelect(r.contractor||'');
  $('contractorSelect').dataset.manualName=r.contractor||'';
  $('address').value=r.address||'';
  $('project').value=r.project||'';
  renderProjectSelect(r.project||'');
  $('client').value=r.client||'';
  $('employees').innerHTML='';(r.employees||[]).forEach(addEmp);
  $('works').innerHTML='';(r.works||[]).forEach(v=>item('works',v));
  $('materials').innerHTML='';(r.materials||[]).forEach(v=>item('materials',v));
  clearSignature();
  if(r.signature){let img=new Image();img.onload=()=>{ctx.drawImage(img,0,0,c.width,c.height);updateSignatureStatus()};img.src=r.signature;} else updateSignatureStatus();
}
function collect(){return{date:$('date').value,contractor:contractorName(),address:$('address').value,project:$('project').value,client:$('client').value,employees:[...document.querySelectorAll('.employee')].map(d=>{const service=d.querySelector('.service').value;return {hours:+d.querySelector('.hours').value||0,service,activity:service,name:d.querySelector('.name').value,start:d.querySelector('.start').value,end:d.querySelector('.end').value,pause:+d.querySelector('.pause').value||0}}),works:[...document.querySelectorAll('#works input')].map(x=>x.value).filter(Boolean),materials:[...document.querySelectorAll('#materials input')].map(x=>x.value).filter(Boolean),signature:$('sig').toDataURL()}}
function save(){localStorage.tagelohn=JSON.stringify(reports);$('count').textContent=reports.length+' Nachweis'+(reports.length==1?'':'e')}

// Merkt sich den zuletzt geöffneten/geschlossenen Zustand der Auftraggeber- und Baustellenordner.
const archiveStateKey='tagelohnArchiveState';
function getArchiveState(){
  try{return JSON.parse(localStorage.getItem(archiveStateKey)||'{}')||{};}catch(e){return {};}
}
function setArchiveState(key,isOpen){
  const state=getArchiveState();
  state[key]=!!isOpen;
  localStorage.setItem(archiveStateKey,JSON.stringify(state));
}
function archiveKey(type,contractor,project=''){
  return type+'|'+String(contractor||'').trim()+'|'+String(project||'').trim();
}

// iPhone-/Touch-freundliches Wischen zum Löschen.
// Die rote Löschen-Aktion erscheint ERST nach einem echten Wisch nach links.
// Es werden keine permanent sichtbaren Löschen-Buttons unter den Einträgen angezeigt.
let activeSwipeClose=null;
function enableSwipeDelete(target,onDelete){
  if(!target)return;
  target.classList.add('swipeTarget');
  const wrap=document.createElement('div'); wrap.className='swipeWrap';
  const content=document.createElement('div'); content.className='swipeContent';
  while(target.firstChild) content.appendChild(target.firstChild);
  const del=document.createElement('button');
  del.type='button'; del.className='swipeDelete'; del.setAttribute('aria-label','Löschen');
  del.innerHTML='<span class="swipeDeleteIcon" aria-hidden="true">×</span>';
  wrap.append(content,del); target.appendChild(wrap);

  const max=64;
  let startX=0,startY=0,startOffset=0,currentX=0,dragging=false,horizontal=false,moved=false,suppressClick=false;
  const setX=x=>{currentX=Math.max(-max,Math.min(0,x));content.style.transform=`translate3d(${currentX}px,0,0)`};
  const close=()=>{setX(0);target.classList.remove('swipeOpen');if(activeSwipeClose===close)activeSwipeClose=null};
  const open=()=>{if(activeSwipeClose&&activeSwipeClose!==close)activeSwipeClose();setX(-max);target.classList.add('swipeOpen');activeSwipeClose=close};

  content.addEventListener('touchstart',e=>{
    if(activeSwipeClose&&activeSwipeClose!==close)activeSwipeClose();
    const t=e.touches?.[0]; if(!t)return;
    startX=t.clientX; startY=t.clientY; startOffset=currentX; dragging=true; horizontal=false; moved=false;
  },{passive:true});
  content.addEventListener('touchmove',e=>{
    if(!dragging)return; const t=e.touches?.[0]; if(!t)return;
    const dx=t.clientX-startX,dy=t.clientY-startY;
    if(!horizontal){
      if(Math.abs(dx)<6&&Math.abs(dy)<6)return;
      if(Math.abs(dy)>Math.abs(dx)){dragging=false;return;}
      horizontal=true;
    }
    if(horizontal){e.preventDefault();moved=true;setX(startOffset+dx)}
  },{passive:false});
  const finish=()=>{
    if(!dragging)return; dragging=false;
    if(horizontal&&moved){suppressClick=true;currentX < -max/2 ? open() : close();setTimeout(()=>suppressClick=false,300)}
  };
  content.addEventListener('touchend',finish,{passive:true});
  content.addEventListener('touchcancel',()=>{dragging=false;currentX<-max/2?open():close()},{passive:true});

  content.addEventListener('click',e=>{
    if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;return}
    if(target.classList.contains('swipeOpen')){close();e.preventDefault();e.stopPropagation()}
  },true);
  del.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(confirm('Wirklich löschen?')){close();onDelete()}});
  target._closeSwipe=close;
  return {close};
}

function removeReport(index){
  if(index<0||index>=reports.length)return;
  reports.splice(index,1);save();render();
}
function removeProject(contractor,project){
  reports=reports.filter(r=>(r.contractor||'Unbekannter Auftraggeber').trim()!==contractor || (r.project||'Ohne Bauvorhaben').trim()!==project);
  save();render();
}
function removeContractor(contractor){
  reports=reports.filter(r=>(r.contractor||'Unbekannter Auftraggeber').trim()!==contractor);
  save();render();
}
function render(){
  const l=$('list');
  const title=$('archiveTitle'), hint=$('archiveHint'), back=$('homeBtn');

  if(title){
    title.textContent = archiveSelectedProject
      ? archiveSelectedProject
      : (archiveSelectedContractor ? archiveSelectedContractor : 'Kunden');
  }

  if(hint){ hint.textContent = ''; }

  if(back){
    back.textContent = archiveSelectedProject
      ? 'Bauvorhaben'
      : (archiveSelectedContractor ? 'Kunden' : 'Tagelohn');
  }

  if(!reports.length){
    l.innerHTML='<div class="panel emptyState"><div class="emptyIcon">▤</div><b>Noch keine Nachweise</b><small>Gespeicherte Tagelohnnachweise erscheinen hier.</small></div>';
    return;
  }

  const groups=new Map();
  reports.forEach((r,i)=>{
    const contractor=(r.contractor||'Unbekannter Auftraggeber').trim()||'Unbekannter Auftraggeber';
    const project=(r.project||'Ohne Bauvorhaben').trim()||'Ohne Bauvorhaben';
    if(!groups.has(contractor))groups.set(contractor,new Map());
    if(!groups.get(contractor).has(project))groups.get(contractor).set(project,[]);
    groups.get(contractor).get(project).push({r,i});
  });

  l.innerHTML='';

  /* Ebene 1: Nur Kunden */
  if(!archiveSelectedContractor){
    [...groups.entries()]
      .sort((a,b)=>a[0].localeCompare(b[0],'de'))
      .forEach(([contractor,projects])=>{
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='customerArchiveButton';
        btn.innerHTML=`<span><strong>${esc(contractor)}</strong></span><b>›</b>`;
        btn.onclick=()=>{
          archiveSelectedContractor=contractor;
          archiveSelectedProject=null;
          render();
          show('archive');
        };
        l.append(btn);
      });
    return;
  }

  const projects=groups.get(archiveSelectedContractor);
  if(!projects){
    archiveSelectedContractor=null;
    archiveSelectedProject=null;
    render();
    return;
  }

  /* Ebene 2: Bauvorhaben des gewählten Kunden */
  if(!archiveSelectedProject){
    [...projects.entries()]
      .sort((a,b)=>a[0].localeCompare(b[0],'de'))
      .forEach(([project,items])=>{
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='projectSelectButton';
        btn.innerHTML=`<span class="projectSelectIcon">▣</span><span><strong>${esc(project)}</strong><small>${items.length} ${items.length===1?'Nachweis':'Nachweise'}</small></span><b>›</b>`;
        btn.onclick=()=>{
          archiveSelectedProject=project;
          render();
          show('archive');
        };
        l.append(btn);
      });
    return;
  }

  /* Ebene 3: Nachweise des Bauvorhabens – neueste zuerst */
  const items=projects.get(archiveSelectedProject)||[];
  items
    .slice()
    .sort((a,b)=>String(b.r.date||'').localeCompare(String(a.r.date||'')))
    .forEach(({r,i})=>{
      const row=document.createElement('div');
      row.className='reportRow';
      const signed=!!r.signed;
      row.innerHTML=`<div class="reportMain"><strong>${esc(formatDate(r.date)||'Ohne Datum')}</strong><span class="reportStatus ${signed?'isSigned':'isDraft'}">${signed?'✓ Unterschrieben':'Nicht unterschrieben'}</span></div><button type="button" class="openReport">Öffnen</button>`;
      row.querySelector('.openReport').onclick=()=>{
        editingReportIndex=i;
        fill(r);
        show('editor');
      };
      enableSwipeDelete(row,()=>removeReport(i));
      l.append(row);
    });

  if(!items.length){
    l.innerHTML='<div class="panel emptyState"><div class="emptyIcon">▤</div><b>Noch keine Nachweise</b><small>Für dieses Bauvorhaben wurden noch keine Nachweise erstellt.</small></div>';
  }
}

function formatDate(iso){if(!iso)return '';let d=new Date(iso+'T12:00:00');return new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(d).replace(/^./,m=>m.toUpperCase())}
function shortDate(iso){if(!iso)return '';let d=new Date(iso+'T12:00:00');return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`}

function splitLines(text){return String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)}
function fitText(font,text,maxWidth,startSize=10,minSize=7){let size=startSize;while(size>minSize && font.widthOfTextAtSize(text,size)>maxWidth)size-=.25;return size}
function drawWrapped(page,font,text,x,y,maxWidth,size=9,lineGap=2,maxLines=8){let words=String(text||'').split(/\s+/).filter(Boolean),line='',lines=[];for(const word of words){let test=line?line+' '+word:word;if(font.widthOfTextAtSize(test,size)<=maxWidth)line=test;else{if(line)lines.push(line);line=word}}if(line)lines.push(line);lines=lines.slice(0,maxLines);lines.forEach((ln,i)=>page.drawText(ln,{x,y:y-i*(size+lineGap),size,font}));}

function cleanFilenamePart(value){
  return String(value||'')
    .replace(/\\/g,'-').replace(/[\\/:*?"<>|]/g,'-')
    .replace(/\s+/g,' ').replace(/\s*-\s*/g,' - ')
    .trim().replace(/^[.\s]+|[.\s]+$/g,'');
}
function cleanContractorName(value){
  let s=String(value||'').trim();
  // Rechtsformen nur am Ende entfernen.
  s=s.replace(/\s*(GmbH\s*&\s*Co\.\s*KG|GmbH\s*&\s*Co\s*KG|GmbH|AG|UG(?:\s*\(haftungsbeschränkt\))?|e\.\s*K\.?|eK|KG|OHG|GbR|SE)\s*$/i,'');
  return s.trim().replace(/[,&.\-\s]+$/,'');
}
function pdfFilename(data){
  const customer=cleanFilenamePart(cleanContractorName(data.contractor))||'Auftraggeber';
  const raw=String(data.date||'').trim();
  // HTML-Datumsfeld: YYYY-MM-DD. Das Jahr wird vollständig aus dem ausgewählten Datum gelesen.
  let date='';
  const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){date=`${m[3]}.${m[2]}.${m[1].slice(-2)}`;}
  else {
    const fullDate=shortDate(raw);
    const parts=fullDate.split('.');
    date=parts.length===3 ? `${parts[0]}.${parts[1]}.${parts[2].slice(-2)}` : fullDate;
  }
  const project=cleanFilenamePart(data.project)||'Bauvorhaben';
  return `${customer} - ${date} - ${project}.pdf`;
}

async function createPdf(options={}){
  const data=collect();
  // Den aktuellen Bericht beim PDF-Export immer speichern.
  if(options.saveReport!==false){
    if(editingReportIndex!==null && reports[editingReportIndex]){
      const previous=reports[editingReportIndex];
      reports[editingReportIndex]={...previous,...data};
    }else{
      reports.unshift(data);
      editingReportIndex=0;
    }
    save();
    render();
  }
  if(!window.PDFLib){alert('PDF-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.');return false}
  const btn=$('pdf');btn.disabled=true;btn.textContent='PDF wird erstellt …';
  let fileHandle=null;
  try{
    if(options.askLocation && 'showSaveFilePicker' in window){
      fileHandle=await window.showSaveFilePicker({
        suggestedName:pdfFilename(data),
        types:[{description:'PDF-Datei',accept:{'application/pdf':['.pdf']}}]
      });
    }

    const {PDFDocument,StandardFonts,rgb}=PDFLib;
    // Die PDF wird jetzt wirklich auf der neuen Baustellentagesbericht-Skizze
    // aufgebaut. Die Vorlage enthält nur das feste Layout; alle veränderlichen
    // Angaben werden hier exakt in die dafür vorgesehenen Felder geschrieben.
    const templateBytes=await fetch('template-bg-exact-clean-v2.png',{cache:'no-store'})
      .then(r=>{if(!r.ok)throw new Error('PDF-Vorlage nicht gefunden');return r.arrayBuffer()});
    const pdf=await PDFDocument.create();
    const W=668.539,H=946.067;
    const page=pdf.addPage([W,H]);
    const bg=await pdf.embedPng(templateBytes);
    page.drawImage(bg,{x:0,y:0,width:W,height:H});

    const normal=await pdf.embedFont(StandardFonts.Helvetica);
    const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    const sx=W/1055, sy=H/1491;

    // Bildkoordinaten (oben links) -> PDF-Koordinaten.
    function drawImgText(value, px, py, size=9, font=normal, maxPx=null){
      if(value===undefined||value===null||String(value)==='')return;
      let str=String(value);
      let fs=size;
      if(maxPx){
        const maxW=maxPx*sx;
        while(fs>5.5 && font.widthOfTextAtSize(str,fs)>maxW)fs-=0.2;
      }
      page.drawText(str,{
        x:px*sx,
        y:H-(py+fs)*sy,
        size:fs,
        font,
        color:rgb(0.06,0.06,0.06)
      });
    }
    function drawFitImg(value,px,py,maxPx,size=9,font=normal){
      if(value===undefined||value===null||String(value).trim()==='')return;
      drawImgText(String(value),px,py,size,font,maxPx);
    }

    // Kopf
    const dateText=formatDate(data.date);
    drawFitImg(dateText,45,113,360,10,normal);

    // Bauvorhaben: Kunde + Bauvorhaben, exakt in der grauen Zeile.
    const projectLabel=[cleanContractorName(data.contractor),data.project].filter(Boolean).join(' – ');
    drawFitImg(projectLabel,326,296,635,10,normal);

    // Wetterwerte
    drawFitImg(data.temperature,126,401,145,9.5,normal);
    drawFitImg(data.wind,620,401,300,9.5,normal);
    drawFitImg(data.precipitation,126,478,145,9.5,normal);
    drawFitImg(data.cloud,620,478,300,9.5,normal);

    // Mitarbeiter: eine Zeile pro Mitarbeiter, ohne zusätzliche Aufzählungszeichen.
    // Die Spalten entsprechen der neuen Vorlage.
    const employeeRows=(data.employees||[]).slice(0,5);
    employeeRows.forEach((e,i)=>{
      const top=614+i*48;
      drawFitImg(e.name,47,top,205,8.7,normal);
      drawFitImg(e.role,281,top,110,8.7,normal);
      drawFitImg(e.start,404,top,115,8.7,normal);
      drawFitImg(e.end,565,top,115,8.7,normal);
      if(Number(e.pause)>0)drawFitImg(`${e.pause} min`,738,top,90,8.7,normal);
      if(Number(e.hours)>0)drawFitImg((Number(e.hours)||0).toFixed(2).replace('.',',')+' Std.',875,top,105,8.7,normal);
    });

    // Ausgeführte Arbeiten – kein Punkt vor dem Eintrag.
    (data.works||[]).slice(0,7).forEach((v,i)=>{
      drawFitImg(v,48,908+i*29,450,8.4,normal);
    });

    // Materiallieferung – kein Punkt vor dem Eintrag.
    (data.materials||[]).slice(0,7).forEach((v,i)=>{
      drawFitImg(v,540,908+i*29,450,8.4,normal);
    });

    // Unterschrift liegt auf der vorhandenen Linie der Vorlage.
    if(data.signature&&data.signature.length>100){
      const sig=await pdf.embedPng(data.signature);
      page.drawImage(sig,{x:45*sx,y:H-(1260+80)*sy,width:230*sx,height:70*sy});
    }

    const out=await pdf.save({useObjectStreams:false});
    if(fileHandle){
      const writable=await fileHandle.createWritable();
      await writable.write(new Blob([out],{type:'application/pdf'}));
      await writable.close();
    }else{
      const blob=new Blob([out],{type:'application/pdf'});
      const filename=pdfFilename(data);
      if(options.askLocation && navigator.share && navigator.canShare){
        const file=new File([blob],filename,{type:'application/pdf'});
        if(navigator.canShare({files:[file]})){
          await navigator.share({files:[file]});
          return true;
        }
      }
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=filename;a.style.display='none';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    return true;
  }catch(err){
    if(err?.name==='AbortError') return false;
    console.error(err);
    alert('PDF konnte nicht erstellt/gespeichert werden: '+err.message);
    return false;
  }finally{
    btn.disabled=false;btn.textContent='PDF erstellen';
  }
}

let reportSignatureCanvas, reportSignatureCtx, reportSignatureDown=false;
let reportSignatureReady=false;
function initReportSignature(){
  reportSignatureCanvas=$('reportSig');
  if(!reportSignatureCanvas)return;
  reportSignatureCtx=reportSignatureCanvas.getContext('2d');
  reportSignatureCtx.lineWidth=4; reportSignatureCtx.lineCap='round'; reportSignatureCtx.lineJoin='round';
  const pos=e=>{const r=reportSignatureCanvas.getBoundingClientRect();return{x:(e.clientX-r.left)*reportSignatureCanvas.width/r.width,y:(e.clientY-r.top)*reportSignatureCanvas.height/r.height}};
  reportSignatureCanvas.onpointerdown=e=>{reportSignatureDown=true;reportSignatureCanvas.setPointerCapture?.(e.pointerId);const q=pos(e);reportSignatureCtx.beginPath();reportSignatureCtx.moveTo(q.x,q.y)};
  reportSignatureCanvas.onpointermove=e=>{if(!reportSignatureDown)return;const q=pos(e);reportSignatureCtx.lineTo(q.x,q.y);reportSignatureCtx.stroke()};
  reportSignatureCanvas.onpointerup=()=>reportSignatureDown=false;
  reportSignatureCanvas.onpointercancel=()=>reportSignatureDown=false;
}
function clearReportSignature(){if(reportSignatureCtx){reportSignatureCtx.clearRect(0,0,reportSignatureCanvas.width,reportSignatureCanvas.height)}reportSignatureReady=false}
function hasReportSignature(){if(!reportSignatureCtx)return false;const d=reportSignatureCtx.getImageData(0,0,reportSignatureCanvas.width,reportSignatureCanvas.height).data;for(let i=3;i<d.length;i+=4)if(d[i]>10)return true;return false}
function collectTagesbericht(){
  return {
    type:'tagesbericht',
    date:$('reportDate')?.value||today(),
    customer:$('reportCustomerSelect')?.selectedOptions?.[0]?.textContent?.trim()||'',
    project:$('reportProjectSelect')?.selectedOptions?.[0]?.textContent?.trim()||'',
    temperature:$('reportTemperature')?.textContent?.trim()||'—',
    precipitation:$('reportPrecipitation')?.textContent?.trim()||'—',
    wind:$('reportWind')?.textContent?.trim()||'—',
    cloud:$('reportCloud')?.textContent?.trim()||'—',
    employees:collectReportEmployees(),
    works:collectReportList('reportWorksEntries'),
    materials:collectReportList('reportMaterialsEntries'),
    signerName:$('reportSignerName')?.value?.trim()||'',
    signature:reportSignatureCanvas?.toDataURL('image/png')||''
  };
}
function renderTagesberichtSummary(){
  const d=collectTagesbericht();
  const date=formatDate(d.date)||'—';
  const projectLabel=[d.customer,d.project].filter(Boolean).join(' – ')||'—';
  const rows=(d.employees||[]).map(e=>`<tr><td>${esc(e.name||'—')}</td><td>${esc(e.role||'—')}</td><td>${esc(e.start||'—')}</td><td>${esc(e.end||'—')}</td><td>${e.pause?esc(String(e.pause))+' min':'—'}</td><td>${(Number(e.hours)||0).toFixed(2).replace('.',',')} Std.</td></tr>`).join('');
  const lineRows=arr=>{const values=(arr||[]).slice(0,6);return Array.from({length:6},(_,i)=>`<div class="reportEntryLine">${values[i]?esc(values[i]):''}</div>`).join('')};
  const sig=hasReportSignature()?`<img class="reportPreviewSignature" src="${reportSignatureCanvas.toDataURL('image/png')}" alt="">`:'';
  $('reportSummaryContent').innerHTML=`
    <div class="reportPaperHeader"><div class="reportHeaderLeft"><h1>Baustellentagesbericht</h1><div class="reportRedRule"></div><div class="reportDate">${esc(date)}</div><div class="reportCompany">Dählmann Erdbau GmbH</div><div>Südring 11</div><div>27404 Zeven</div></div><img class="reportLogo" src="dahlmann-erdbau-logo.jpg" alt="Dählmann Erdbau GmbH"></div>
    <div class="reportInfoBox"><div class="reportProjectRow"><span class="reportDocIcon" aria-hidden="true">▤</span><b>Bauvorhaben:</b><span class="reportProjectValue">${esc(projectLabel)}</span></div><div class="reportWeatherRows"><div><b>Temperatur:</b><span>${esc(d.temperature)}</span></div><div><b>Wind:</b><span>${esc(d.wind)}</span></div><div><b>Niederschlag:</b><span>${esc(d.precipitation)}</span></div><div><b>Bewölkung:</b><span>${esc(d.cloud)}</span></div></div></div>
    <div class="reportEmployeeTableWrap"><table class="reportEmployeeTable"><thead><tr><th>Mitarbeiter</th><th>Funktion</th><th>Arbeitsbeginn</th><th>Arbeitsende</th><th>Pause</th><th>Gesamt</th></tr></thead><tbody>${rows}${Array.from({length:Math.max(0,5-(d.employees||[]).length)},()=>'<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}</tbody></table></div>
    <div class="reportTwoCols"><section class="reportListBox"><h3><span class="gearIcon">⚙</span>Ausgeführte Arbeiten:</h3><div class="reportLines">${lineRows(d.works)}</div></section><section class="reportListBox"><h3><span class="truckIcon">▰</span>Materiallieferung:</h3><div class="reportLines">${lineRows(d.materials)}</div></section></div>
    <div class="reportSignaturePreview"><h3>Unterschrift Auftraggeber</h3><div class="signatureLine">${sig}</div></div>
    <div class="reportFooter"><div><b>Dählmann Erdbau GmbH</b><br>Südring 11 · 27404 Zeven</div><div><b>Telefon: 04281/5179</b><br>E-Mail: info@daeh­lmann-erdbau.de</div><div>www.daeh­lmann-erdbau.de</div></div>`;
}
function saveTagesbericht(){
  const data=collectTagesbericht();
  const reportsSaved=JSON.parse(localStorage.getItem('tagesberichte')||'[]');
  const key=(data.date||'')+'|'+(data.customer||'')+'|'+(data.project||'');
  const idx=reportsSaved.findIndex(r=>((r.date||'')+'|'+(r.customer||'')+'|'+(r.project||''))===key);
  const signed=hasReportSignature();
  const saved={...data,signed,signedAt:signed?new Date().toISOString():''};
  if(idx>=0) reportsSaved[idx]=saved; else reportsSaved.unshift(saved);
  localStorage.setItem('tagesberichte',JSON.stringify(reportsSaved));
  return true;
}
let tagesberichtPdfBusy=false;
let tagesberichtShareBusy=false;
function saveTagesberichtAndPdf(){
  if(tagesberichtPdfBusy || tagesberichtShareBusy) return;
  if(!saveTagesbericht()) return;
  createTagesberichtPdf(collectTagesbericht()).then(ok=>{if(ok)alert('PDF erstellt.');});
}
function tagesberichtPdfFilename(data){
  const customer=cleanFilenamePart(data.customer)||'Kunde', project=cleanFilenamePart(data.project)||'Bauvorhaben';
  return `${customer} - ${shortDate(data.date).replaceAll('.','.') } - Tagesbericht - ${project}.pdf`;
}
const PDF_TEMPLATE_W=668.539;
const PDF_TEMPLATE_H=946.067;
const PDF_COORDS_KEY='tagesberichtPdfCoordinatesV1';
const DEFAULT_PDF_COORDS={
  date:{x:500,y:82,w:120,size:10},
  project:{x:64,y:284,w:540,size:9.5},
  temperature:{x:72,y:329,w:170,size:9.2},
  wind:{x:337,y:329,w:170,size:9.2},
  precipitation:{x:72,y:356,w:170,size:9.2},
  cloud:{x:337,y:356,w:170,size:9.2},
  employeeName:{x:64,y:314,w:125,size:7.8},
  employeeRole:{x:64,y:329,w:125,size:7.4},
  employeeStart:{x:248,y:314,w:75,size:7.8},
  employeeEnd:{x:339,y:314,w:75,size:7.8},
  employeePause:{x:430,y:314,w:65,size:7.8},
  employeeHours:{x:514,y:314,w:90,size:7.8},
  employeeRowGap:22,
  works:{x:64,y:451,w:355,size:8.5},
  materials:{x:425,y:451,w:170,size:8.5},
  textRowGap:14,
  signature:{x:60,y:625,w:220,h:72}
};
function loadPdfCoords(){
  try{
    const saved=JSON.parse(localStorage.getItem(PDF_COORDS_KEY)||'null');
    return {...DEFAULT_PDF_COORDS,...(saved||{}),signature:{...DEFAULT_PDF_COORDS.signature,...(saved?.signature||{})}};
  }catch(e){return JSON.parse(JSON.stringify(DEFAULT_PDF_COORDS))}
}
function savePdfCoords(coords){localStorage.setItem(PDF_COORDS_KEY,JSON.stringify(coords));}
function resetPdfCoords(){localStorage.removeItem(PDF_COORDS_KEY);return loadPdfCoords()}

const ALIGN_FIELDS=[
  ['date','Datum','Datum'],
  ['project','Bauvorhaben','Bauvorhaben'],
  ['temperature','Temperatur','Temperatur'],
  ['wind','Wind','Wind'],
  ['precipitation','Niederschlag','Niederschlag'],
  ['cloud','Bewölkung','Bewölkung'],
  ['employeeName','Mitarbeiter','Mitarbeiter'],
  ['employeeRole','Vorarbeiter / Leistung','Vorarbeiter / Leistung'],
  ['employeeStart','Arbeitsbeginn','Arbeitsbeginn'],
  ['employeeEnd','Arbeitsende','Arbeitsende'],
  ['employeePause','Pause','Pause'],
  ['employeeHours','Gesamt','Gesamt'],
  ['works','Ausgeführte Arbeiten','Ausgeführte Arbeiten'],
  ['materials','Materiallieferung','Materiallieferung'],
  ['signature','Unterschrift','Unterschrift']
];
let pdfAlignCoords=loadPdfCoords();
let pdfAlignPointer=null;
function pdfAlignSampleData(data){
  const emp=(data?.employees||[])[0]||{};
  return {
    date:formatDate(data?.date)||'24.09.2026',
    project:[data?.customer,data?.project].filter(Boolean).join(' – ')||'Bauvorhaben',
    temperature:data?.temperature||'18 °C', wind:data?.wind||'12 km/h',
    precipitation:data?.precipitation||'0,0 mm', cloud:data?.cloud||'35 %',
    employeeName:emp.name||'Max Mustermann', employeeRole:emp.role||'Vorarbeiter', employeeStart:emp.start||'07:00',
    employeeEnd:emp.end||'16:00', employeePause:emp.pause?`${emp.pause} min`:'30 min',
    employeeHours:Number(emp.hours)?`${Number(emp.hours).toFixed(2).replace('.',',')} Std.`:'8,50 Std.',
    works:(data?.works||[])[0]||'Ausgeführte Arbeiten',
    materials:(data?.materials||[])[0]||'Material / sonstige Leistungen',
    signature:'Unterschrift'
  };
}
async function renderPdfTemplateBackground(){
  const stage=$('pdfAlignStage');
  if(!stage) return;
  stage.classList.add('pdfTemplateLoading');
  let canvas=stage.querySelector('.pdfAlignTemplateCanvas');
  if(!canvas){
    canvas=document.createElement('canvas');
    canvas.className='pdfAlignTemplateCanvas';
    canvas.setAttribute('aria-label','Originale Blanko-PDF');
    stage.prepend(canvas);
  }
  const ctx=canvas.getContext('2d',{alpha:false});
  try{
    if(!window.pdfjsLib) throw new Error('PDF.js konnte nicht geladen werden');
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loading=pdfjsLib.getDocument({url:'OriginalTemplate.pdf',cacheKey:Date.now()});
    const pdf=await loading.promise;
    const page=await pdf.getPage(1);
    const cssWidth=Math.max(1,stage.clientWidth);
    const baseViewport=page.getViewport({scale:1});
    const scale=(cssWidth/baseViewport.width)*2;
    const viewport=page.getViewport({scale});
    canvas.width=Math.ceil(viewport.width);
    canvas.height=Math.ceil(viewport.height);
    canvas.style.aspectRatio=`${baseViewport.width}/${baseViewport.height}`;
    await page.render({canvasContext:ctx,viewport}).promise;
    stage.classList.remove('pdfTemplateLoading');
    stage.classList.add('pdfTemplateReady');
  }catch(err){
    stage.classList.remove('pdfTemplateLoading');
    stage.classList.remove('pdfTemplateReady');
    console.error('OriginalTemplate.pdf konnte nicht angezeigt werden',err);
    canvas.width=10; canvas.height=10;
    ctx.clearRect(0,0,10,10);
    const msg=document.createElement('div');
    msg.className='pdfAlignPdfError';
    msg.textContent='Die Original-PDF konnte hier nicht geladen werden. Bitte Seite neu laden.';
    stage.appendChild(msg);
  }
}

async function renderPdfAligner(data=collectTagesbericht()){
  const stage=$('pdfAlignStage'); if(!stage)return;
  pdfAlignCoords=loadPdfCoords();
  const sample=pdfAlignSampleData(data);
  stage.querySelectorAll('.pdfAlignField,.pdfAlignPdfError').forEach(el=>el.remove());
  await renderPdfTemplateBackground();
  ALIGN_FIELDS.forEach(([key,label])=>{
    const el=document.createElement('div');
    el.className='pdfAlignField'; el.dataset.field=key; el.title=`${label} – ziehen`;
    el.textContent=sample[key];
    const c=pdfAlignCoords[key];
    el.style.left=`${(c.x/PDF_TEMPLATE_W)*100}%`;
    el.style.top=`${(c.y/PDF_TEMPLATE_H)*100}%`;
    el.style.maxWidth=`${Math.max(45,c.w||100)/PDF_TEMPLATE_W*100}%`;
    if(c.size)el.style.fontSize=`${Math.max(7,c.size*1.0)}px`;
    el.addEventListener('pointerdown',e=>startPdfAlignDrag(e,el));
    stage.appendChild(el);
  });
  const gap=$('pdfEmployeeGap'); if(gap)gap.value=pdfAlignCoords.employeeRowGap||22;
  const textGap=$('pdfTextGap'); if(textGap)textGap.value=pdfAlignCoords.textRowGap||14;
}
function startPdfAlignDrag(e,el){
  e.preventDefault();
  const stage=$('pdfAlignStage'); if(!stage)return;
  const rect=stage.getBoundingClientRect();
  const field=el.dataset.field;
  const c=pdfAlignCoords[field];
  pdfAlignPointer={field,el,rect,startX:e.clientX,startY:e.clientY,x:c.x,y:c.y};
  el.setPointerCapture?.(e.pointerId);
  el.classList.add('dragging');
  const move=ev=>{
    if(!pdfAlignPointer)return;
    const dx=(ev.clientX-pdfAlignPointer.startX)/rect.width*PDF_TEMPLATE_W;
    const dy=(ev.clientY-pdfAlignPointer.startY)/rect.height*PDF_TEMPLATE_H;
    const nc=pdfAlignCoords[field];
    nc.x=Math.max(0,Math.min(PDF_TEMPLATE_W-10,pdfAlignPointer.x+dx));
    nc.y=Math.max(0,Math.min(PDF_TEMPLATE_H-10,pdfAlignPointer.y+dy));
    el.style.left=`${nc.x/PDF_TEMPLATE_W*100}%`;
    el.style.top=`${nc.y/PDF_TEMPLATE_H*100}%`;
    updatePdfCoordReadout(field);
  };
  const up=()=>{
    el.classList.remove('dragging');
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
    pdfAlignPointer=null;
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up,{once:true});
}
function updatePdfCoordReadout(field){
  const c=pdfAlignCoords[field]; const out=$('pdfCoordReadout');
  if(out&&c)out.textContent=`${field}: X ${c.x.toFixed(1)} pt · Y ${c.y.toFixed(1)} pt`;
}
async function openPdfAligner(){
  show('pdfAlignerScreen');
  await new Promise(r=>requestAnimationFrame(r));
  await renderPdfAligner(collectTagesbericht());
}
function savePdfAlignment(){
  const gap=Number($('pdfEmployeeGap')?.value); if(Number.isFinite(gap)&&gap>0)pdfAlignCoords.employeeRowGap=gap;
  const textGap=Number($('pdfTextGap')?.value); if(Number.isFinite(textGap)&&textGap>0)pdfAlignCoords.textRowGap=textGap;
  savePdfCoords(pdfAlignCoords);
  alert('PDF-Positionen gespeichert. Diese Koordinaten werden ab jetzt für alle Tagesberichte verwendet.');
}
async function resetPdfAlignment(){
  pdfAlignCoords=resetPdfCoords();
  await renderPdfAligner(collectTagesbericht());
}
function wrapPdfLines(font,text,size,maxW,maxLines){
  const words=String(text||'').split(/\s+/).filter(Boolean); let line=''; const lines=[];
  for(const word of words){
    const test=line?`${line} ${word}`:word;
    if(font.widthOfTextAtSize(test,size)<=maxW)line=test;
    else{if(line)lines.push(line);line=word;}
  }
  if(line)lines.push(line);
  return lines.slice(0,maxLines);
}

async function createTagesberichtPdf(data){
  if(tagesberichtPdfBusy || tagesberichtShareBusy) return false;
  tagesberichtPdfBusy=true;
  if(!window.PDFLib){tagesberichtPdfBusy=false;alert('PDF-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.');return false}
  const {PDFDocument,StandardFonts,rgb}=PDFLib;
  try{
    // WICHTIG: Die hochgeladene Blanko-PDF bleibt die echte PDF-Seite.
    // Es wird nichts gerastert oder neu gezeichnet. Dadurch bleibt die Vorlage
    // beim starken Hineinzoomen scharf und exakt erhalten.
    const templateBytes=await fetch('OriginalTemplate.pdf',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('OriginalTemplate.pdf nicht gefunden');return r.arrayBuffer()});
    const pdf=await PDFDocument.load(templateBytes);
    const page=pdf.getPages()[0];
    const normal=await pdf.embedFont(StandardFonts.Helvetica);
    const black=rgb(0.06,0.06,0.06);
    const coords=loadPdfCoords();
    const drawFit=(txt,c,opts={})=>{
      txt=String(txt??'').trim(); if(!txt)return;
      const maxW=(c.w||160); let size=c.size||opts.size||9;
      while(size>5.5 && normal.widthOfTextAtSize(txt,size)>maxW)size-=0.2;
      page.drawText(txt,{x:c.x,y:PDF_TEMPLATE_H-(c.y+size),size,font:normal,color:black});
    };
    const dateText=formatDate(data.date);
    drawFit(dateText,coords.date);
    const project=[data.customer,data.project].filter(Boolean).join(' – ');
    drawFit(project,coords.project);
    drawFit(data.temperature,coords.temperature);
    drawFit(data.wind,coords.wind);
    drawFit(data.precipitation,coords.precipitation);
    drawFit(data.cloud,coords.cloud);

    const employees=(data.employees||[]).slice(0,7);
    employees.forEach((e,i)=>{
      const yOffset=i*(coords.employeeRowGap||22);
      for(const key of ['employeeName','employeeRole','employeeStart','employeeEnd','employeePause','employeeHours']){
        const base=coords[key]; const c={...base,y:base.y+yOffset};
        let value='';
        if(key==='employeeName')value=e.name||'';
        if(key==='employeeRole')value=e.role||'';
        if(key==='employeeStart')value=e.start||'';
        if(key==='employeeEnd')value=e.end||'';
        if(key==='employeePause')value=Number(e.pause)>0?`${e.pause} min`:'';
        if(key==='employeeHours')value=Number(e.hours)>0?`${Number(e.hours).toFixed(2).replace('.',',')} Std.`:'';
        drawFit(value,c);
      }
    });

    const drawWrappedField=(values,c,gap,maxLines)=>{
      const items=(values||[]).filter(v=>String(v||'').trim()).slice(0,maxLines);
      items.forEach((v,i)=>{
        const lines=wrapPdfLines(normal,v,c.size||8.5,c.w||150,2);
        lines.forEach((line,j)=>drawFit(line,{...c,y:c.y+(i*gap)+(j*(c.size||8.5)+3),w:c.w,size:c.size}));
      });
    };
    drawWrappedField(data.works,coords.works,coords.textRowGap||14,7);
    drawWrappedField(data.materials,coords.materials,coords.textRowGap||14,7);

    if(data.signature&&data.signature.length>100){
      const sig=await pdf.embedPng(data.signature);
      const c=coords.signature;
      page.drawImage(sig,{x:c.x,y:PDF_TEMPLATE_H-(c.y+c.h),width:c.w,height:c.h});
    }

    const out=await pdf.save({useObjectStreams:false});
    const blob=new Blob([out],{type:'application/pdf'});
    const filename=tagesberichtPdfFilename(data);
    if(navigator.share&&navigator.canShare){
      const file=new File([blob],filename,{type:'application/pdf'});
      if(navigator.canShare({files:[file]})){
        if(tagesberichtShareBusy)return false;
        tagesberichtShareBusy=true;
        try{await navigator.share({files:[file]});return true}
        catch(err){if(err?.name==='AbortError')return false;throw err}
        finally{tagesberichtShareBusy=false}
      }
    }
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    return true;
  }catch(err){
    console.error(err); if(err?.name==='AbortError')return false;
    alert('PDF konnte nicht erstellt werden: '+err.message); return false;
  }finally{tagesberichtPdfBusy=false}
}

$('new').onclick=$('new2').onclick=()=>{editingReportIndex=null;fill({});show('editor')};
$('openTagelohn').onclick=()=>show('tagelohnHome');
$('openCustomersGlobal').onclick=openCustomers;
$('openEmployeesGlobal').onclick=openEmployees;
$('openTagesbericht').onclick=()=>{navigationHistory=[];initTagesbericht();show('tagesbericht');navigationHistory=[]};
$('reportNext')?.addEventListener('click',()=>{initTagesberichtEmployees();show('tagesberichtEmployees')});
$('reportAddEmployee')?.addEventListener('click',()=>addReportEmployee());
function continueTagesberichtEmployees(){
  const entries=collectReportEmployees();
  if(!entries.length){ alert('Bitte mindestens einen Mitarbeiter auswählen.'); return; }
  const incomplete=entries.some(e=>!e.name||!e.role);
  if(incomplete){ alert('Bitte Mitarbeiter und Funktion auswählen. Arbeitszeiten sind optional.'); return; }
  reportEmployeeEntries=entries;
  initTagesberichtWorks();
  show('tagesberichtWorks',{replaceHistory:false});
}
$('reportEmployeeNext')?.addEventListener('click',continueTagesberichtEmployees);
$('reportAddWork')?.addEventListener('click',()=>addReportListEntry('reportWorksEntries'));
$('reportAddMaterial')?.addEventListener('click',()=>addReportListEntry('reportMaterialsEntries'));
$('reportWorksNext')?.addEventListener('click',()=>{renderTagesberichtSummary();clearReportSignature();$('reportSignerName').value='';show('tagesberichtSummary',{replaceHistory:false})});
$('clearReportSig')?.addEventListener('click',clearReportSignature);
$('saveReport')?.addEventListener('click',()=>{if(saveTagesbericht())alert('Bericht gespeichert.');});
$('saveReportAndPdf')?.addEventListener('click',saveTagesberichtAndPdf);
$('openPdfAligner')?.addEventListener('click',openPdfAligner);
$('savePdfAlignment')?.addEventListener('click',savePdfAlignment);
$('resetPdfAlignment')?.addEventListener('click',resetPdfAlignment);
$('backFromPdfAligner')?.addEventListener('click',()=>{renderTagesberichtSummary();show('tagesberichtSummary',{replaceHistory:true})});
$('backToStartFromTagelohn').onclick=()=>show('home');
$('backToStartFromTagesbericht')?.addEventListener('click',()=>show('home'));
initTagesbericht();
initReportSignature();
$('addEmp').onclick=()=>addEmp();$('addWork').onclick=()=>item('works');$('addMat').onclick=()=>item('materials');
$('archiveBtn').onclick=()=>{archiveSelectedContractor=null;archiveSelectedProject=null;render();show('archive')};$('homeBtn').onclick=()=>{if(archiveSelectedProject){archiveSelectedProject=null;render();return;}if(archiveSelectedContractor){archiveSelectedContractor=null;render();return;}show('tagelohnHome')};$('homeFromCustomers').onclick=()=>show('home');
$('manageCustomers').onclick=openCustomers;$('addCustomer').onclick=addCustomer;$('contractorSelect').onchange=customerChanged;$('projectSelect').onchange=projectChanged;$('projectCustomerSelect').onchange=renderProjectList;$('addProject').onclick=addProject;$('servicesBtn').onclick=openServices;
$('customersBtn')?.addEventListener('click',openCustomers);
$('employeesBtn')?.addEventListener('click',openEmployees);$('homeFromServices').onclick=()=>show('tagelohnHome');$('addService').onclick=addService;$('homeFromEmployees').onclick=()=>show('home');$('addEmployee').onclick=addEmployee;
$('save').onclick=()=>{reports.unshift(collect());save();render();show('archive')};$('pdf').onclick=()=>createPdf({askLocation:true,saveReport:true});
$('date').addEventListener('change',syncDateDisplay);
syncDateDisplay();
persistCustomers();persistServices();persistEmployees();renderCustomerSelect('');save();

let c=$('sig'),ctx=c.getContext('2d'),down=false;
c.onpointerdown=e=>{down=true;ctx.beginPath();let p=pos(e);ctx.moveTo(p.x,p.y)};c.onpointermove=e=>{if(!down)return;let p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke()};window.onpointerup=()=>down=false;
function pos(e){let r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height}}
$('clear').onclick=()=>{clearSignature();updateSignatureStatus()};
$('review').onclick=()=>{renderSummary();show('summaryScreen')};
$('backToEditorFromSummary').onclick=()=>show('editor');
$('signNow').onclick=()=>{show('signatureScreen');updateSignatureStatus()};
$('backToSummary').onclick=()=>{renderSummary();show('summaryScreen')};
$('cancelSignature').onclick=()=>show('summaryScreen');
$('saveSignature').onclick=async()=>{
  if(!hasSignature()){alert('Bitte zuerst unterschreiben.');return}
  const btn=$('saveSignature');
  btn.disabled=true; btn.textContent='✓';
  try{
    const signed=collect();
    signed.signed=true;
    signed.signedAt=new Date().toISOString();
    if(editingReportIndex!==null && reports[editingReportIndex]) reports[editingReportIndex]=signed;
    else {reports.unshift(signed); editingReportIndex=0;}
    save(); render(); updateSignatureStatus();
    navigationHistory=[];
    const pdfSaved=await createPdf({askLocation:true});
    if(pdfSaved) alert('Unterschrieben gespeichert und PDF gespeichert.');
    show('archive');
  }catch(err){console.error(err);alert('Der unterschriebene Nachweis konnte nicht vollständig gespeichert werden: '+err.message)}
  finally{btn.disabled=false;btn.textContent='➜'}
};

window.addEventListener('DOMContentLoaded',()=>{const nav=document.querySelector('nav');if(nav)nav.style.display=document.getElementById('home')?.classList.contains('active')?'none':'flex';document.body.classList.toggle('home-screen',document.getElementById('home')?.classList.contains('active'));
  const tagelohnIds=['tagelohnHome','archive','customers','services','employeeManager','editor','summaryScreen','signatureScreen'];
  document.body.classList.toggle('tagelohn-clean', tagelohnIds.some(id=>document.getElementById(id)?.classList.contains('active')));
});

document.getElementById('navStart')?.addEventListener('click',()=>show('home'));
document.getElementById('navBack')?.addEventListener('click',goBackOneStep);
