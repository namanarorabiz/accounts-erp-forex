
const $=id=>document.getElementById(id);let me=null,view="self",txs=[],parties=[],clientActive=true,editingId=null;
const today=new Date().toISOString().slice(0,10);$("txDate").value=today;
async function api(path,opts={}){const r=await fetch(path,{...opts,credentials:"same-origin",headers:{"Content-Type":"application/json",...(opts.headers||{})}});let d;try{d=await r.json()}catch{d={}}if(!r.ok)throw Error(d.error||"Request failed");return d}
const post=(p,d)=>api(p,{method:"POST",body:JSON.stringify(d)});
const money=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function say(id,s){$(id).textContent=s}
function tab(t){["dashboard","transactions","parties","reports","settings"].forEach(x=>$(x).hidden=x!==t)}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>tab(b.dataset.tab));
$("loginForm").onsubmit=async e=>{e.preventDefault();try{await post("/api/login",{username:$("username").value,password:$("password").value});await start()}catch(x){say("loginMsg",x.message)}};
async function start(){me=await api("/api/me");$("login").hidden=true;$("app").hidden=false;$("role").textContent=me.role==="owner"?"Owner":"Client";$("ownerView").hidden=me.role!=="owner";document.querySelectorAll(".ownerOnly").forEach(x=>x.hidden=me.role!=="owner");$("clientAdmin").hidden=me.role!=="owner";if(me.must_change_password){tab("settings");say("settingsMsg","You must change your temporary password before using the ERP.");}await load();}
$("logout").onclick=async()=>{await post("/api/logout",{});location.reload()};
$("view").onchange=async e=>{view=e.target.value;await load()};
function qview(){return me.role==="owner"&&view==="client"?"?view=client":""}
async function load(){const q=qview();const from=$("fromDate").value,to=$("toDate").value;const params=new URLSearchParams();if(me.role==="owner"&&view==="client")params.set("view","client");if(from)params.set("from",from);if(to)params.set("to",to);const qs=params.toString()?"?"+params.toString():"";[txs,parties]=await Promise.all([api("/api/transactions"+qs),api("/api/parties"+q)]);render();}
$("applyDates").onclick=load;
function signed(t){if(["sell","income","adjustment_in"].includes(t.kind))return Number(t.inr_amount);return -Number(t.inr_amount)}
function render(){
 const readOnly=me.role==="owner"&&view==="client";$("txForm").hidden=readOnly;$("partyForm").hidden=readOnly;
 $("partyOptions").innerHTML=parties.map(p=>`<option value="${esc(p.name)}">`).join("");
 $("partyRows").innerHTML=parties.map(p=>`<div class="rowitem"><b>${esc(p.name)}</b> ${esc(p.phone||"")} ${esc(p.email||"")}<br><small>${esc(p.notes||"")}</small></div>`).join("")||"No saved parties.";
 $("txRows").innerHTML=txs.map(t=>`<tr><td>${esc(t.tx_date)}</td><td>${esc(t.party_name)}</td><td>${esc(t.kind.replaceAll("_"," "))}</td><td>${money(t.inr_amount)}</td><td>${esc(t.foreign_currency||"—")}</td><td>${t.foreign_amount==null?"—":Number(t.foreign_amount).toLocaleString("en-IN")}</td><td>${!readOnly&&Date.now()<Number(t.edit_until)?`<button class="secondary" onclick="editTx('${t.id}')">Edit</button>`:"Locked"}</td></tr>`).join("")||`<tr><td colspan="7">No transactions in this period.</td></tr>`;
 const buys=sum("buy"),sells=sum("sell"),income=sum("income")+sum("adjustment_in"),expenses=sum("expense")+sum("adjustment_out"),net=txs.reduce((s,t)=>s+signed(t),0);
 $("stats").innerHTML=stat("Transactions",txs.length)+stat("Buy INR",money(buys))+stat("Sell INR",money(sells))+stat("Other income",money(income))+stat("Expenses",money(expenses))+stat("Net cash movement",money(net));
 $("dashNote").textContent=readOnly?"Client data is displayed read-only.":"INR net cash movement is not the same as realized FX trading profit.";
 $("reportStats").innerHTML=stat("Buy INR",money(buys))+stat("Sell INR",money(sells))+stat("Income / adjustments in",money(income))+stat("Expenses / adjustments out",money(expenses))+stat("Net recorded cash movement",money(net));
 $("ledgerParty").innerHTML='<option value="">Select a party</option>'+[...new Set(txs.map(t=>t.party_name))].sort().map(n=>`<option>${esc(n)}</option>`).join("");
 $("ledgerRows").innerHTML="";
}
function stat(a,b){return `<div class="stat">${a}<strong>${b}</strong></div>`}
function sum(kind){return txs.filter(t=>t.kind===kind).reduce((s,t)=>s+Number(t.inr_amount),0)}
$("partyForm").onsubmit=async e=>{e.preventDefault();try{await post("/api/parties",{name:$("newParty").value,phone:$("partyPhone").value,email:$("partyEmail").value,notes:$("partyNotes").value});e.target.reset();await load()}catch(x){alert(x.message)}};
$("txForm").onsubmit=async e=>{e.preventDefault();const d={tx_date:$("txDate").value,party_name:$("partyName").value,kind:$("kind").value,inr_amount:$("inr").value,foreign_currency:$("currency").value,foreign_amount:$("foreign").value||null,rate:$("rate").value||null,reference:$("reference").value,notes:$("notes").value};try{if(editingId)await api("/api/transactions/"+editingId,{method:"PUT",body:JSON.stringify(d)});else await post("/api/transactions"+qview(),d);editingId=null;$("saveTx").textContent="Save transaction";e.target.reset();$("txDate").value=today;await load()}catch(x){alert(x.message)}};
window.editTx=id=>{const t=txs.find(x=>x.id===id);if(!t)return;editingId=id;$("txDate").value=t.tx_date;$("partyName").value=t.party_name;$("kind").value=t.kind;$("inr").value=t.inr_amount;$("currency").value=t.foreign_currency||"";$("foreign").value=t.foreign_amount??"";$("rate").value=t.rate??"";$("reference").value=t.reference||"";$("notes").value=t.notes||"";$("saveTx").textContent="Save changes";tab("transactions");window.scrollTo(0,0)};
$("ledgerParty").onchange=e=>{const name=e.target.value;if(!name){$("ledgerRows").innerHTML="";return}const rows=txs.filter(t=>t.party_name===name).sort((a,b)=>a.tx_date.localeCompare(b.tx_date));let bal=0;$("ledgerRows").innerHTML=rows.map(t=>{const s=signed(t);bal+=s;return `<div class="rowitem">${esc(t.tx_date)} · ${esc(t.kind)} · ${money(t.inr_amount)} · Running net ${money(bal)}</div>`}).join("")||"No entries."};
$("exportCsv").onclick=()=>{const rows=[["Date","Party","Type","INR","Currency","Foreign Amount","Rate","Reference","Notes"],...txs.map(t=>[t.tx_date,t.party_name,t.kind,t.inr_amount,t.foreign_currency||"",t.foreign_amount??"",t.rate??"",t.reference||"",t.notes||""])];const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n");download("forex-transactions.csv",csv,"text/csv")};
function download(name,data,type){const a=document.createElement("a"),blob=new Blob([data],{type});a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$("passwordForm").onsubmit=async e=>{e.preventDefault();try{await post("/api/password",{currentPassword:$("currentPassword").value,newPassword:$("newPassword").value});alert("Password changed. Please log in again.");location.reload()}catch(x){say("settingsMsg",x.message)}};
$("usernameForm").onsubmit=async e=>{e.preventDefault();try{const d=await post("/api/username",{username:$("newUsername").value});say("settingsMsg","Username changed to "+d.username)}catch(x){say("settingsMsg",x.message)}};
$("backup").onclick=async()=>{try{const r=await fetch("/api/backup",{credentials:"same-origin"});if(!r.ok)throw Error("Backup failed");download("accounts-erp-backup.json",await r.text(),"application/json")}catch(x){say("settingsMsg",x.message)}};
$("restore").onclick=async()=>{const f=$("restoreFile").files[0];if(!f){say("settingsMsg","Choose a backup JSON file first.");return}if(!confirm("Restore this backup? Current data will first be saved in Cloudflare R2."))return;try{const d=await post("/api/restore",JSON.parse(await f.text()));say("settingsMsg",d.message);await load()}catch(x){say("settingsMsg",x.message)}};
$("resetClient").onclick=async()=>{try{await post("/api/client",{username:$("clientUsername").value,temporaryPassword:$("clientTemp").value});say("settingsMsg","Client login created/reset. Share the temporary password privately; client must change it at first login.")}catch(x){say("settingsMsg",x.message)}};
$("toggleClient").onclick=async()=>{try{const c=await api("/api/client");clientActive=!c.active;await post("/api/client/active",{active:clientActive});say("settingsMsg",clientActive?"Client login enabled.":"Client login disabled.")}catch(x){say("settingsMsg",x.message)}};
start().catch(()=>{});
const $=id=>document.getElementById(id);let me=null,view="self",txs=[],parties=[],clientActive=true,editingId=null;
const today=new Date().toISOString().slice(0,10);$("txDate").value=today;
async function api(path,opts={}){const r=await fetch(path,{...opts,credentials:"same-origin",headers:{"Content-Type":"application/json",...(opts.headers||{})}});let d;try{d=await r.json()}catch{d={}}if(!r.ok)throw Error(d.error||"Request failed");return d}
const post=(p,d)=>api(p,{method:"POST",body:JSON.stringify(d)});
const money=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function say(id,s){$(id).textContent=s}
function tab(t){["dashboard","transactions","parties","reports","settings"].forEach(x=>$(x).hidden=x!==t)}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>tab(b.dataset.tab));
$("loginForm").onsubmit=async e=>{e.preventDefault();try{await post("/api/login",{username:$("username").value,password:$("password").value});await start()}catch(x){say("loginMsg",x.message)}};
async function start(){me=await api("/api/me");$("login").hidden=true;$("app").hidden=false;$("role").textContent=me.role==="owner"?"Owner":"Client";$("ownerView").hidden=me.role!=="owner";document.querySelectorAll(".ownerOnly").forEach(x=>x.hidden=me.role!=="owner");$("clientAdmin").hidden=me.role!=="owner";if(me.must_change_password){tab("settings");say("settingsMsg","You must change your temporary password before using the ERP.");}await load();}
$("logout").onclick=async()=>{await post("/api/logout",{});location.reload()};
$("view").onchange=async e=>{view=e.target.value;await load()};
function qview(){return me.role==="owner"&&view==="client"?"?view=client":""}
async function load(){const q=qview();const from=$("fromDate").value,to=$("toDate").value;const params=new URLSearchParams();if(me.role==="owner"&&view==="client")params.set("view","client");if(from)params.set("from",from);if(to)params.set("to",to);const qs=params.toString()?"?"+params.toString():"";[txs,parties]=await Promise.all([api("/api/transactions"+qs),api("/api/parties"+q)]);render();}
$("applyDates").onclick=load;
function signed(t){if(["sell","income","adjustment_in"].includes(t.kind))return Number(t.inr_amount);return -Number(t.inr_amount)}
function render(){
 const readOnly=me.role==="owner"&&view==="client";$("txForm").hidden=readOnly;$("partyForm").hidden=readOnly;
 $("partyOptions").innerHTML=parties.map(p=>`<option value="${esc(p.name)}">`).join("");
 $("partyRows").innerHTML=parties.map(p=>`<div class="rowitem"><b>${esc(p.name)}</b> ${esc(p.phone||"")} ${esc(p.email||"")}<br><small>${esc(p.notes||"")}</small></div>`).join("")||"No saved parties.";
 $("txRows").innerHTML=txs.map(t=>`<tr><td>${esc(t.tx_date)}</td><td>${esc(t.party_name)}</td><td>${esc(t.kind.replaceAll("_"," "))}</td><td>${money(t.inr_amount)}</td><td>${esc(t.foreign_currency||"—")}</td><td>${t.foreign_amount==null?"—":Number(t.foreign_amount).toLocaleString("en-IN")}</td><td>${!readOnly&&Date.now()<Number(t.edit_until)?`<button class="secondary" onclick="editTx('${t.id}')">Edit</button>`:"Locked"}</td></tr>`).join("")||`<tr><td colspan="7">No transactions in this period.</td></tr>`;
 const buys=sum("buy"),sells=sum("sell"),income=sum("income")+sum("adjustment_in"),expenses=sum("expense")+sum("adjustment_out"),net=txs.reduce((s,t)=>s+signed(t),0);
 $("stats").innerHTML=stat("Transactions",txs.length)+stat("Buy INR",money(buys))+stat("Sell INR",money(sells))+stat("Other income",money(income))+stat("Expenses",money(expenses))+stat("Net cash movement",money(net));
 $("dashNote").textContent=readOnly?"Client data is displayed read-only.":"INR net cash movement is not the same as realized FX trading profit.";
 $("reportStats").innerHTML=stat("Buy INR",money(buys))+stat("Sell INR",money(sells))+stat("Income / adjustments in",money(income))+stat("Expenses / adjustments out",money(expenses))+stat("Net recorded cash movement",money(net));
 $("ledgerParty").innerHTML='<option value="">Select a party</option>'+[...new Set(txs.map(t=>t.party_name))].sort().map(n=>`<option>${esc(n)}</option>`).join("");
 $("ledgerRows").innerHTML="";
}
function stat(a,b){return `<div class="stat">${a}<strong>${b}</strong></div>`}
function sum(kind){return txs.filter(t=>t.kind===kind).reduce((s,t)=>s+Number(t.inr_amount),0)}
$("partyForm").onsubmit=async e=>{e.preventDefault();try{await post("/api/parties",{name:$("newParty").value,phone:$("partyPhone").value,email:$("partyEmail").value,notes:$("partyNotes").value});e.target.reset();await load()}catch(x){alert(x.message)}};
$("txForm").onsubmit=async e=>{e.preventDefault();const d={tx_date:$("txDate").value,party_name:$("partyName").value,kind:$("kind").value,inr_amount:$("inr").value,foreign_currency:$("currency").value,foreign_amount:$("foreign").value||null,rate:$("rate").value||null,reference:$("reference").value,notes:$("notes").value};try{if(editingId)await api("/api/transactions/"+editingId,{method:"PUT",body:JSON.stringify(d)});else await post("/api/transactions"+qview(),d);editingId=null;$("saveTx").textContent="Save transaction";e.target.reset();$("txDate").value=today;await load()}catch(x){alert(x.message)}};
window.editTx=id=>{const t=txs.find(x=>x.id===id);if(!t)return;editingId=id;$("txDate").value=t.tx_date;$("partyName").value=t.party_name;$("kind").value=t.kind;$("inr").value=t.inr_amount;$("currency").value=t.foreign_currency||"";$("foreign").value=t.foreign_amount??"";$("rate").value=t.rate??"";$("reference").value=t.reference||"";$("notes").value=t.notes||"";$("saveTx").textContent="Save changes";tab("transactions");window.scrollTo(0,0)};
$("ledgerParty").onchange=e=>{const name=e.target.value;if(!name){$("ledgerRows").innerHTML="";return}const rows=txs.filter(t=>t.party_name===name).sort((a,b)=>a.tx_date.localeCompare(b.tx_date));let bal=0;$("ledgerRows").innerHTML=rows.map(t=>{const s=signed(t);bal+=s;return `<div class="rowitem">${esc(t.tx_date)} · ${esc(t.kind)} · ${money(t.inr_amount)} · Running net ${money(bal)}</div>`}).join("")||"No entries."};
$("exportCsv").onclick=()=>{const rows=[["Date","Party","Type","INR","Currency","Foreign Amount","Rate","Reference","Notes"],...txs.map(t=>[t.tx_date,t.party_name,t.kind,t.inr_amount,t.foreign_currency||"",t.foreign_amount??"",t.rate??"",t.reference||"",t.notes||""])];const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n");download("forex-transactions.csv",csv,"text/csv")};
function download(name,data,type){const a=document.createElement("a"),blob=new Blob([data],{type});a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$("passwordForm").onsubmit=async e=>{e.preventDefault();try{await post("/api/password",{currentPassword:$("currentPassword").value,newPassword:$("newPassword").value});alert("Password changed. Please log in again.");location.reload()}catch(x){say("settingsMsg",x.message)}};
$("usernameForm").onsubmit=async e=>{e.preventDefault();try{const d=await post("/api/username",{username:$("newUsername").value});say("settingsMsg","Username changed to "+d.username)}catch(x){say("settingsMsg",x.message)}};
$("backup").onclick=async()=>{try{const r=await fetch("/api/backup",{credentials:"same-origin"});if(!r.ok)throw Error("Backup failed");download("accounts-erp-backup.json",await r.text(),"application/json")}catch(x){say("settingsMsg",x.message)}};
$("restore").onclick=async()=>{const f=$("restoreFile").files[0];if(!f){say("settingsMsg","Choose a backup JSON file first.");return}if(!confirm("Restore this backup? Current data will first be saved in Cloudflare R2."))return;try{const d=await post("/api/restore",JSON.parse(await f.text()));say("settingsMsg",d.message);await load()}catch(x){say("settingsMsg",x.message)}};
$("resetClient").onclick=async()=>{try{await post("/api/client",{username:$("clientUsername").value,temporaryPassword:$("clientTemp").value});say("settingsMsg","Client login created/reset. Share the temporary password privately; client must change it at first login.")}catch(x){say("settingsMsg",x.message)}};
$("toggleClient").onclick=async()=>{try{const c=await api("/api/client");clientActive=!c.active;await post("/api/client/active",{active:clientActive});say("settingsMsg",clientActive?"Client login enabled.":"Client login disabled.")}catch(x){say("settingsMsg",x.message)}};
start().catch(()=>{});
