
const json=(d,s=200,h={})=>new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...h}});
const uid=()=>crypto.randomUUID(), enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function derive(p,s){const k=await crypto.subtle.importKey("raw",enc.encode(p),"PBKDF2",false,["deriveBits"]);return b64(await crypto.subtle.deriveBits({name:"PBKDF2",salt:s,iterations:310000,hash:"SHA-256"},k,256));}
async function hmac(v,secret){const k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},["sign"]);return b64(await crypto.subtle.sign("HMAC",k,enc.encode(v)));}
function getCookie(req,n){const m=(req.headers.get("Cookie")||"").match(new RegExp("(?:^|; )"+n+"=([^;]+)"));return m?decodeURIComponent(m[1]):null;}
function originOK(req,env){const o=req.headers.get("Origin");return o?o===env.APP_ORIGIN:["GET","HEAD"].includes(req.method);}
async function readBody(req){try{return await req.json()}catch{return {}}}
async function audit(env,a,target,action,record=null,details=""){await env.DB.prepare("INSERT INTO audit_log(id,actor_id,target_owner_id,action,record_id,details) VALUES(?,?,?,?,?,?)").bind(uid(),a.id,target,action,record,details).run();}
async function auth(req,env){
 const raw=getCookie(req,"sid");if(!raw)return null;
 const [id,exp,sig]=raw.split(".");if(!id||!exp||!sig||Number(exp)<Date.now()/1000)return null;
 if(await hmac(id+"."+exp,env.SESSION_SECRET)!==sig)return null;
 const r=await env.DB.prepare("SELECT s.id session_id,u.id,u.username,u.role,u.must_change_password,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?").bind(id,Math.floor(Date.now()/1000)).first();
 return r&&r.active?r:null;
}

async function bootstrap(env) {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  if (n.n) return;

  const accounts = [
    { username: "owner", role: "owner", password: "owner@123" },
    { username: "admin", role: "client", password: "admin@123" }
  ];

  for (const account of accounts) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(account.password, salt);

    await env.DB.prepare(
      "INSERT INTO users(id,username,role,password_salt,password_hash) VALUES(?,?,?,?,?)"
    ).bind(uid(), account.username, account.role, b64(salt), hash).run();
  }
}

async function rateLimit(env,key){
 const now=Math.floor(Date.now()/1000),r=await env.DB.prepare("SELECT * FROM login_attempts WHERE attempt_key=?").bind(key).first();
 if(r&&r.blocked_until>now)return false;
 if(!r||now-r.window_started>900){await env.DB.prepare("INSERT OR REPLACE INTO login_attempts(attempt_key,failures,window_started,blocked_until) VALUES(?,0,?,0)").bind(key,now).run();}
 return true;
}
async function failedLogin(env,key){
 const now=Math.floor(Date.now()/1000),r=await env.DB.prepare("SELECT * FROM login_attempts WHERE attempt_key=?").bind(key).first();
 const f=(r&&now-r.window_started<=900?r.failures:0)+1,blocked=f>=7?now+900:0;
 await env.DB.prepare("INSERT OR REPLACE INTO login_attempts(attempt_key,failures,window_started,blocked_until) VALUES(?,?,?,?)").bind(key,f,(r&&now-r.window_started<=900)?r.window_started:now,blocked).run();
}
async function clearLogin(env,key){await env.DB.prepare("DELETE FROM login_attempts WHERE attempt_key=?").bind(key).run();}
async function getTarget(env,a,view){if(a.role==="owner"&&view==="client"){const c=await env.DB.prepare("SELECT id FROM users WHERE role='client' AND active=1").first();return c?.id||null;}return a.id;}
async function handle(req,env){
 const u=new URL(req.url),p=u.pathname;
 if(p.startsWith("/api/")&&!originOK(req,env))return json({error:"Request origin not allowed."},403);
 if(p==="/api/setup"&&req.method==="POST"){try{await bootstrap(env);return json({ok:true,message:"Owner account initialized."})}catch(e){return json({error:e.message},500)}}
 if(p==="/api/login"&&req.method==="POST"){
  const b=await readBody(req),username=String(b.username||"").trim(),key=(username.toLowerCase()+"|"+(req.headers.get("CF-Connecting-IP")||"unknown")).slice(0,180);
  if(!await rateLimit(env,key))return json({error:"Too many attempts. Try again in 15 minutes."},429);
  const user=await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1").bind(username).first();
  const ok=user&&await derive(String(b.password||""),unb64(user.password_salt))===user.password_hash;
  if(!ok){await failedLogin(env,key);return json({error:"Invalid username or password."},401);}
  await clearLogin(env,key);const id=uid(),exp=Math.floor(Date.now()/1000)+43200,sig=await hmac(id+"."+exp,env.SESSION_SECRET);
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)").bind(id,user.id,exp).run();
  return json({ok:true,username:user.username,role:user.role,must_change_password:!!user.must_change_password},200,{"Set-Cookie":`sid=${encodeURIComponent(id+"."+exp+"."+sig)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`});
 }
 if(p==="/api/logout"&&req.method==="POST"){const a=await auth(req,env);if(a)await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(a.session_id).run();return json({ok:true},200,{"Set-Cookie":"sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});}
 const a=await auth(req,env);if(!a)return json({error:"Please log in."},401);
 if(p==="/api/me")return json({id:a.id,username:a.username,role:a.role,must_change_password:!!a.must_change_password});
 if(p==="/api/password"&&req.method==="POST"){
  const b=await readBody(req),u0=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(a.id).first();
  if(await derive(String(b.currentPassword||""),unb64(u0.password_salt))!==u0.password_hash)return json({error:"Current password is incorrect."},403);
  const pw=String(b.newPassword||"");if(pw.length<5)return json({error:"Use at least 14 characters."},400);
  const salt=crypto.getRandomValues(new Uint8Array(16)),hash=await derive(pw,salt);
  await env.DB.prepare("UPDATE users SET password_salt=?,password_hash=?,must_change_password=0 WHERE id=?").bind(b64(salt),hash,a.id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(a.id).run();await audit(env,a,a.id,"password_changed");
  return json({ok:true,loginAgain:true},200,{"Set-Cookie":"sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
 }
 if(p==="/api/username"&&req.method==="POST"){
  const b=await readBody(req),name=String(b.username||"").trim();
  if(!/^[A-Za-z0-9._@-]{3,40}$/.test(name))return json({error:"Username must be 3–40 characters."},400);
  try{await env.DB.prepare("UPDATE users SET username=? WHERE id=?").bind(name,a.id).run();await audit(env,a,a.id,"username_changed",null,name);return json({ok:true,username:name});}catch{return json({error:"That username is already in use."},409);}
 }
 if(p==="/api/client"&&a.role==="owner"){
  if(req.method==="GET"){const c=await env.DB.prepare("SELECT id,username,active FROM users WHERE role='client'").first();return json(c||{});}
  if(req.method==="POST"){
   const b=await readBody(req),name=String(b.username||"admin@123").trim(),pw=String(b.temporaryPassword||"");
   if(!/^[A-Za-z0-9._@-]{3,40}$/.test(name)||pw.length<14)return json({error:"Provide a valid username and a temporary password of at least 14 characters."},400);
   const old=await env.DB.prepare("SELECT id FROM users WHERE role='client'").first(),salt=crypto.getRandomValues(new Uint8Array(16)),hash=await derive(pw,salt);
   try{
    if(old){await env.DB.prepare("UPDATE users SET username=?,password_salt=?,password_hash=?,must_change_password=1,active=1 WHERE id=?").bind(name,b64(salt),hash,old.id).run();await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(old.id).run();}
    else await env.DB.prepare("INSERT INTO users(id,username,role,password_salt,password_hash,must_change_password) VALUES(?,?,?,?,?,1)").bind(uid(),name,"client",b64(salt),hash).run();
    await audit(env,a,old?.id||null,"client_credentials_reset");return json({ok:true,username:name});
   }catch{return json({error:"Username already exists."},409);}
  }
 }
 if(p==="/api/client/active"&&a.role==="owner"&&req.method==="POST"){const b=await readBody(req),active=b.active?1:0;const c=await env.DB.prepare("SELECT id FROM users WHERE role='client'").first();if(!c)return json({error:"No client account."},404);await env.DB.prepare("UPDATE users SET active=? WHERE id=?").bind(active,c.id).run();await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(c.id).run();await audit(env,a,c.id,active?"client_enabled":"client_disabled");return json({ok:true});}
 if(p==="/api/parties"&&req.method==="GET"){const target=await getTarget(env,a,u.searchParams.get("view"));if(!target)return json([]);return json((await env.DB.prepare("SELECT * FROM parties WHERE owner_id=? ORDER BY name").bind(target).all()).results);}
 if(p==="/api/parties"&&req.method==="POST"){
  if(a.role==="owner"&&u.searchParams.get("view")==="client")return json({error:"Read-only view."},403);
  const b=await readBody(req),name=String(b.name||"").trim();if(!name)return json({error:"Party name is required."},400);
  try{await env.DB.prepare("INSERT INTO parties(id,owner_id,name,phone,email,notes) VALUES(?,?,?,?,?,?)").bind(uid(),a.id,name,String(b.phone||""),String(b.email||""),String(b.notes||"")).run();return json({ok:true});}catch{return json({error:"Party already exists."},409);}
 }
 if(p==="/api/transactions"&&req.method==="GET"){const target=await getTarget(env,a,u.searchParams.get("view"));if(!target)return json([]);const from=u.searchParams.get("from"),to=u.searchParams.get("to");let q="SELECT * FROM transactions WHERE owner_id=?";const args=[target];if(from){q+=" AND tx_date>=?";args.push(from)}if(to){q+=" AND tx_date<=?";args.push(to)}q+=" ORDER BY tx_date DESC,created_at DESC";return json((await env.DB.prepare(q).bind(...args).all()).results);}
 if(p==="/api/transactions"&&req.method==="POST"){
  if(a.role==="owner"&&u.searchParams.get("view")==="client")return json({error:"Read-only view."},403);
  const b=await readBody(req),kind=String(b.kind||"");if(!["buy","sell","income","expense","adjustment_in","adjustment_out"].includes(kind))return json({error:"Invalid transaction type."},400);
  const amount=Number(b.inr_amount),foreign=b.foreign_amount===""||b.foreign_amount==null?null:Number(b.foreign_amount),rate=b.rate===""||b.rate==null?null:Number(b.rate);
  if(!Number.isFinite(amount)||amount<=0|| (foreign!==null&&(!Number.isFinite(foreign)||foreign<0)) || (rate!==null&&(!Number.isFinite(rate)||rate<0)))return json({error:"Enter valid positive amounts."},400);
  const id=uid(),date=/^\d{4}-\d{2}-\d{2}$/.test(b.tx_date||"")?b.tx_date:new Date().toISOString().slice(0,10);
  await env.DB.prepare("INSERT INTO transactions(id,owner_id,party_id,party_name,kind,tx_date,foreign_currency,inr_amount,foreign_amount,rate,reference,notes,edit_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
   .bind(id,a.id,b.party_id||null,String(b.party_name||"Walk-in"),kind,date,b.foreign_currency||null,amount,foreign,rate,String(b.reference||""),String(b.notes||""),Date.now()+30*60*1000).run();
  await audit(env,a,a.id,"transaction_created",id);return json({ok:true,id});
 }
 const tx=p.match(/^\/api\/transactions\/([a-f0-9-]+)$/i);
 if(tx&&req.method==="PUT"){
  if(a.role==="owner"&&u.searchParams.get("view")==="client")return json({error:"Read-only view."},403);
  const r=await env.DB.prepare("SELECT * FROM transactions WHERE id=? AND owner_id=?").bind(tx[1],a.id).first();if(!r)return json({error:"Not found."},404);
  if(Date.now()>r.edit_until)return json({error:"The 30-minute edit window has expired. Record a correcting adjustment instead."},423);
  const b=await readBody(req),amount=Number(b.inr_amount);if(!Number.isFinite(amount)||amount<=0)return json({error:"Invalid INR amount."},400);
  await env.DB.prepare("UPDATE transactions SET party_name=?,kind=?,tx_date=?,foreign_currency=?,inr_amount=?,foreign_amount=?,rate=?,reference=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
   .bind(String(b.party_name||r.party_name),String(b.kind||r.kind),String(b.tx_date||r.tx_date),b.foreign_currency||null,amount,b.foreign_amount==null?null:Number(b.foreign_amount),b.rate==null?null:Number(b.rate),String(b.reference||""),String(b.notes||""),tx[1],a.id).run();
  await audit(env,a,a.id,"transaction_updated",tx[1]);return json({ok:true});
 }
 if(p==="/api/backup"&&req.method==="GET"&&a.role==="owner"){
  const snap=await makeSnapshot(env);return new Response(JSON.stringify(snap),{headers:{"Content-Type":"application/json","Content-Disposition":`attachment; filename=accounts-erp-backup-${new Date().toISOString().slice(0,10)}.json`,"Cache-Control":"no-store"}});
 }
 if(p==="/api/restore"&&req.method==="POST"&&a.role==="owner"){
  const b=await readBody(req);if(!b||!b.tables||!Array.isArray(b.tables.transactions)||!Array.isArray(b.tables.parties)||!Array.isArray(b.tables.users))return json({error:"Backup file format is invalid."},400);
  const current=await makeSnapshot(env);await env.BACKUPS.put(`pre-restore/${new Date().toISOString()}.json`,JSON.stringify(current));
  // Restore only records belonging to the already configured owner/client IDs; never restore password hashes or sessions.
  const existing=(await env.DB.prepare("SELECT id,role FROM users").all()).results,allowed=new Set(existing.map(x=>x.id));
  const stmts=[env.DB.prepare("DELETE FROM transactions"),env.DB.prepare("DELETE FROM parties"),env.DB.prepare("DELETE FROM audit_log")];
  for(const r of b.tables.parties){if(allowed.has(r.owner_id))stmts.push(env.DB.prepare("INSERT INTO parties(id,owner_id,name,phone,email,notes,created_at) VALUES(?,?,?,?,?,?,?)").bind(r.id,r.owner_id,r.name,r.phone||"",r.email||"",r.notes||"",r.created_at||new Date().toISOString()));}
  for(const r of b.tables.transactions){if(allowed.has(r.owner_id))stmts.push(env.DB.prepare("INSERT INTO transactions(id,owner_id,party_id,party_name,kind,tx_date,base_currency,foreign_currency,inr_amount,foreign_amount,rate,reference,notes,created_at,updated_at,edit_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(r.id,r.owner_id,r.party_id,r.party_name,r.kind,r.tx_date||new Date().toISOString().slice(0,10),r.base_currency||"INR",r.foreign_currency,r.inr_amount,r.foreign_amount,r.rate,r.reference||"",r.notes||"",r.created_at||new Date().toISOString(),r.updated_at||new Date().toISOString(),r.edit_until||0));}
  for(const r of (b.tables.audit_log||[])){stmts.push(env.DB.prepare("INSERT INTO audit_log(id,actor_id,target_owner_id,action,record_id,details,created_at) VALUES(?,?,?,?,?,?,?)").bind(r.id,r.actor_id,r.target_owner_id,r.action,r.record_id,r.details,r.created_at));}
  await env.DB.batch(stmts);await audit(env,a,a.id,"database_restored");return json({ok:true,message:"Data restored. Existing login credentials were preserved."});
 }
 return json({error:"Not found."},404);
}
async function makeSnapshot(env){
 const tables={users:(await env.DB.prepare("SELECT id,username,role,active,created_at FROM users").all()).results,
 parties:(await env.DB.prepare("SELECT * FROM parties").all()).results,
 transactions:(await env.DB.prepare("SELECT * FROM transactions").all()).results,
 audit_log:(await env.DB.prepare("SELECT * FROM audit_log").all()).results};
 return {format:"accounts-erp-forex-backup-v1",created_at:new Date().toISOString(),tables};
}
export default {
  fetch: async (req, env) => handle(req, env),
  scheduled: async (event, env) => {
    const now = new Date();
    const snap = JSON.stringify(await makeSnapshot(env));
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const month = now.toISOString().slice(0, 7);

    await env.BACKUPS.put(`daily/${stamp}.json`, snap);

    if (now.getUTCDate() === 1) {
      await env.BACKUPS.put(`monthly/${month}.json`, snap);
    }

    const cutoff = Date.now() - 90 * 86400000;
    let cursor;

    do {
      const page = await env.BACKUPS.list({ prefix: "daily/", cursor });
      for (const obj of page.objects) {
        if (new Date(obj.uploaded).getTime() < cutoff) {
          await env.BACKUPS.delete(obj.key);
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
};
