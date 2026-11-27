const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
const { readSession } = require("../lib/auth");

const COOLDOWN_HOURS = 24;

function getDb(){
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is missing");
  return neon(url);
}
function clean(value,max){return String(value||"").trim().slice(0,max);}
function getClientIp(req){
  const forwarded=req.headers["x-forwarded-for"];
  const real=req.headers["x-real-ip"];
  const value=Array.isArray(forwarded)?forwarded[0]:forwarded;
  const ip=String(value||real||"").split(",")[0].trim();
  return ip;
}
function getClientKey(req){
  const ip=getClientIp(req);
  if(!ip)return null;
  const secret=process.env.SESSION_SECRET||process.env.GIFT_KEY_SECRET;
  if(!secret)throw new Error("A server secret is required for ticket rate limiting");
  return crypto.createHmac("sha256",secret).update(ip).digest("hex");
}
function getCountryCode(req){
  const raw=req.headers["x-vercel-ip-country"];
  const value=clean(Array.isArray(raw)?raw[0]:raw,2).toUpperCase();
  return /^[A-Z]{2}$/.test(value)?value:null;
}
async function ensureTable(sql){
  await sql`CREATE TABLE IF NOT EXISTS support_tickets (
    id BIGSERIAL PRIMARY KEY,
    ticket_code VARCHAR(24) NOT NULL UNIQUE,
    name VARCHAR(70) NOT NULL,
    email VARCHAR(160) NOT NULL,
    category VARCHAR(60) NOT NULL,
    subject VARCHAR(120) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    admin_reply TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    country_code VARCHAR(2)
  )`;
  await sql`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS country_code VARCHAR(2)`;
  await sql`CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx ON support_tickets (created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS support_ticket_rate_limits (
    client_key CHAR(64) PRIMARY KEY,
    last_ticket_at TIMESTAMPTZ NOT NULL
  )`;
}
function remainingFrom(lastTicketAt){
  const retryAt=new Date(new Date(lastTicketAt).getTime()+COOLDOWN_HOURS*60*60*1000);
  return {retryAt:retryAt.toISOString(),remainingSeconds:Math.max(0,Math.ceil((retryAt.getTime()-Date.now())/1000))};
}

module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","no-store, private");
  try{
    const sql=getDb();
    await ensureTable(sql);

    // Public status check so the form can display the remaining cooldown.
    if(req.method==="GET" && req.query?.action==="limit"){
      const clientKey=getClientKey(req);
      if(!clientKey)return res.status(400).json({success:false,error:"No se pudo identificar la conexión."});
      const rows=await sql`SELECT last_ticket_at FROM support_ticket_rate_limits WHERE client_key=${clientKey} LIMIT 1`;
      if(!rows.length)return res.status(200).json({success:true,allowed:true});
      const state=remainingFrom(rows[0].last_ticket_at);
      return res.status(200).json({success:true,allowed:state.remainingSeconds===0,...(state.remainingSeconds>0?state:{})});
    }

    if(req.method==="POST"){
      let body=req.body;if(typeof body==="string")body=JSON.parse(body);
      const name=clean(body?.name,70),email=clean(body?.email,160).toLowerCase();
      const category=clean(body?.category,60),subject=clean(body?.subject,120),message=clean(body?.message,4000);
      if(!name||!email||!category||!subject||message.length<10)return res.status(400).json({success:false,error:"Completa todos los campos y escribe un mensaje de al menos 10 caracteres."});
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({success:false,error:"Introduce un correo electrónico válido."});

      const clientKey=getClientKey(req);
      if(!clientKey)return res.status(400).json({success:false,error:"No se pudo identificar la conexión."});
      const ticketCode="FVR-"+crypto.randomBytes(4).toString("hex").toUpperCase();
      const countryCode=getCountryCode(req);

      // Atomic gate + insert: simultaneous requests from the same IP cannot bypass the 24h limit.
      const rows=await sql`
        WITH allowed AS (
          INSERT INTO support_ticket_rate_limits (client_key,last_ticket_at)
          VALUES (${clientKey},NOW())
          ON CONFLICT (client_key) DO UPDATE
            SET last_ticket_at=NOW()
            WHERE support_ticket_rate_limits.last_ticket_at <= NOW() - INTERVAL '24 hours'
          RETURNING client_key
        )
        INSERT INTO support_tickets
          (ticket_code,name,email,category,subject,message,country_code)
        SELECT ${ticketCode},${name},${email},${category},${subject},${message},${countryCode}
        FROM allowed
        RETURNING ticket_code
      `;
      if(!rows.length){
        const current=await sql`SELECT last_ticket_at FROM support_ticket_rate_limits WHERE client_key=${clientKey} LIMIT 1`;
        const state=current.length?remainingFrom(current[0].last_ticket_at):{retryAt:new Date(Date.now()+24*60*60*1000).toISOString(),remainingSeconds:86400};
        return res.status(429).json({success:false,error:"Ya enviaste un ticket desde esta conexión. Espera a que termine el cooldown de 24 horas.",...state});
      }
      const current=await sql`SELECT last_ticket_at FROM support_ticket_rate_limits WHERE client_key=${clientKey} LIMIT 1`;
      const state=remainingFrom(current[0].last_ticket_at);
      return res.status(201).json({success:true,ticketCode:rows[0].ticket_code,...state});
    }

    const session=await readSession(req);
    if(!session||session.sub!=="fvrever")return res.status(401).json({success:false,error:"Unauthorized"});

    if(req.method==="GET"){
      const tickets=await sql`SELECT id,ticket_code,name,email,category,subject,message,status,admin_reply,created_at,updated_at,country_code FROM support_tickets ORDER BY created_at DESC LIMIT 200`;
      return res.status(200).json({success:true,tickets});
    }
    if(req.method==="PATCH"){
      let body=req.body;if(typeof body==="string")body=JSON.parse(body);
      const id=Number(body?.id),status=clean(body?.status,20),adminReply=clean(body?.adminReply,4000);
      if(!Number.isSafeInteger(id)||id<1||!["open","in_progress","closed"].includes(status))return res.status(400).json({success:false,error:"Invalid ticket update."});
      const rows=await sql`UPDATE support_tickets SET status=${status},admin_reply=${adminReply},updated_at=NOW() WHERE id=${id} RETURNING id,ticket_code,status,admin_reply,updated_at`;
      if(!rows.length)return res.status(404).json({success:false,error:"Ticket not found."});
      return res.status(200).json({success:true,ticket:rows[0]});
    }
    if(req.method==="DELETE"){
      let body=req.body;if(typeof body==="string")body=JSON.parse(body);
      const id=Number(body?.id);
      if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({success:false,error:"Invalid ticket ID."});
      const rows=await sql`DELETE FROM support_tickets WHERE id=${id} RETURNING id,ticket_code`;
      if(!rows.length)return res.status(404).json({success:false,error:"Ticket not found."});
      return res.status(200).json({success:true,deleted:rows[0]});
    }
    res.setHeader("Allow","GET, POST, PATCH, DELETE");
    return res.status(405).json({success:false,error:"Method not allowed"});
  }catch(error){
    console.error("Support tickets API error:",error);
    return res.status(500).json({success:false,error:"No se pudo procesar el ticket."});
  }
};
