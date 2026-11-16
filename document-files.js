/* Baustellen-App – Export/Import einzelner Tagelohnnachweise */
(() => {
  'use strict';
  const KEY='tagelohn';
  const $=id=>document.getElementById(id);
  const read=()=>{try{const v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
  const write=v=>localStorage.setItem(KEY,JSON.stringify(v));
  const stableId=()=>`xfer_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
  function exportSelected(type='tagelohn'){
    if(type!=='tagelohn'){alert('Der Datei-Export ist derzeit für Tagelohnnachweise verfügbar.');return;}
    const checked=[...document.querySelectorAll('.shareDocumentCheck:checked')];
    const indexes=[...new Set(checked.map(x=>Number(x.dataset.shareIndex)).filter(Number.isInteger))];
    if(!indexes.length){alert('Bitte zuerst die Tagelohnnachweise mit Häkchen auswählen.');return;}
    const all=read();
    const documents=indexes.map(i=>all[i]).filter(Boolean).map(item=>{
      const copy={...item};
      if(!copy._transferId) copy._transferId=stableId();
      return copy;
    });
    // Die IDs auch im lokalen Original speichern, damit ein späterer Import nicht dupliziert.
    indexes.forEach((i,n)=>{if(all[i]&&!all[i]._transferId)all[i]._transferId=documents[n]._transferId;});
    write(all);
    const bundle={format:'baustellen-tagelohn-export',version:1,createdAt:new Date().toISOString(),documents};
    const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;
    a.download=`Tagelohnnachweise-${new Date().toISOString().slice(0,10)}.baustelle.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    alert(`${documents.length} Tagelohnnachweis${documents.length===1?'':'e'} exportiert. Die Datei kannst du jetzt per E-Mail verschicken.`);
  }
  function openImport(){
    let input=$('tagelohnFileImportInput');
    if(!input){
      input=document.createElement('input');input.type='file';input.accept='.json,.baustelle,application/json';
      input.id='tagelohnFileImportInput';input.hidden=true;document.body.appendChild(input);
      input.addEventListener('change',async()=>{
        const file=input.files?.[0];input.value='';if(!file)return;
        try{
          const text=await file.text();const bundle=JSON.parse(text);
          if(bundle?.format!=='baustellen-tagelohn-export'||bundle?.version!==1||!Array.isArray(bundle.documents))
            throw new Error('Diese Datei ist kein gültiger Tagelohn-Export der Baustellen-App.');
          if(!bundle.documents.length)throw new Error('Die Datei enthält keine Tagelohnnachweise.');
          const current=read();const known=new Set(current.map(x=>x?._transferId).filter(Boolean));
          let added=0,skipped=0;
          for(const raw of bundle.documents){
            if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
            const item={...raw};
            if(item._transferId&&known.has(item._transferId)){skipped++;continue;}
            // Fremde Cloud-Zuordnungen niemals in die lokale App übernehmen.
            delete item._cloudId;delete item._sharedOwnerId;delete item._isShared;
            item._transferId=item._transferId||stableId();
            current.unshift(item);known.add(item._transferId);added++;
          }
          if(!added){alert(`Keine neuen Nachweise importiert. ${skipped} waren bereits vorhanden.`);return;}
          write(current);
          alert(`${added} Tagelohnnachweis${added===1?'':'e'} importiert.${skipped?` ${skipped} bereits vorhandene übersprungen.`:''}`);
          location.reload();
        }catch(err){alert(err.message||'Die Datei konnte nicht importiert werden.');}
      });
    }
    input.click();
  }
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-import-tagelohn]'))openImport();
  });
  window.BaustellenDocumentFiles={exportSelected,openImport};
})();
