const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
const { readSession } = require("../lib/auth");

function getDb(){
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is missing");
  return neon(url);
}
function clean(value,max){return String(value||"").trim().slice(0,max);}
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx ON support_tickets (created_at DESC)`;
}
module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","no-store, private");
  try{
    const sql=getDb();
    await ensureTable(sql);
    if(req.method==="POST"){
      let body=req.body;if(typeof body==="string")body=JSON.parse(body);
      const name=clean(body?.name,70),email=clean(body?.email,160).toLowerCase();
      const category=clean(body?.category,60),subject=clean(body?.subject,120),message=clean(body?.message,4000);
      if(!name||!email||!category||!subject||message.length<10)return res.status(400).json({success:false,error:"Completa todos los campos y escribe un mensaje de al menos 10 caracteres."});
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({success:false,error:"Introduce un correo electrónico válido."});
      const ticketCode="FVR-"+crypto.randomBytes(4).toString("hex").toUpperCase();
      const rows=await sql`INSERT INTO support_tickets (ticket_code,name,email,category,subject,message) VALUES (${ticketCode},${name},${email},${category},${subject},${message}) RETURNING ticket_code`;
      return res.status(201).json({success:true,ticketCode:rows[0].ticket_code});
    }
    const session=await readSession(req);
    if(!session||session.sub!=="fvrever")return res.status(401).json({success:false,error:"Unauthorized"});
    if(req.method==="GET"){
      const tickets=await sql`SELECT id,ticket_code,name,email,category,subject,message,status,admin_reply,created_at,updated_at FROM support_tickets ORDER BY created_at DESC LIMIT 200`;
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
    res.setHeader("Allow","GET, POST, PATCH");
    return res.status(405).json({success:false,error:"Method not allowed"});
  }catch(error){
    console.error("Support tickets API error:",error);
    return res.status(500).json({success:false,error:"No se pudo procesar el ticket."});
  }
};
