const https      = require("https");
const http       = require("http");
const fs         = require("fs");
const path       = require("path");
const nodemailer = require("nodemailer");
const cron       = require("node-cron");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, WidthType, ShadingType, LevelFormat,
  Footer, Header, TabStopType, TabStopPosition,
  VerticalAlign, SimpleField
} = require("docx");

// ─────────────────────────────────────────────
// KONFIG – sätts via Railway Environment Variables
// ─────────────────────────────────────────────

const KONFIG = {
  anthropicKey : process.env.ANTHROPIC_API_KEY  || "",
  gmailUser    : process.env.GMAIL_USER          || "",
  gmailPass    : process.env.GMAIL_APP_PASSWORD  || "",
  mottagare    : (process.env.MOTTAGARE          || "").split(",").map(s => s.trim()).filter(Boolean),
  port         : process.env.PORT                || 3000,
  dagar        : 7,
};

// ─────────────────────────────────────────────
// LOGG (in-memory, max 100 rader)
// ─────────────────────────────────────────────

const LOG = [];
function logg(msg, typ = "info") {
  const rad = { tid: new Date().toLocaleString("sv-SE"), msg, typ };
  LOG.unshift(rad);
  if (LOG.length > 100) LOG.pop();
  console.log(`[${rad.tid}] ${msg}`);
}

// ─────────────────────────────────────────────
// RSS & GOOGLE NEWS
// ─────────────────────────────────────────────

const RSS_FLÖDEN = [
  { url: "https://www.di.se/rss",                                               namn: "Dagens Industri" },
  { url: "http://www.dn.se/nyheter/m/rss/",                                     namn: "Dagens Nyheter" },
  { url: "http://api.sr.se/api/rss/program/83?format=145",                      namn: "SR Ekot" },
  { url: "https://feeds.expressen.se/nyheter/",                                 namn: "Expressen" },
  { url: "https://rss.aftonbladet.se/rss2/small/pages/sections/aftonbladet/",  namn: "Aftonbladet" },
  { url: "http://www.svd.se/?service=rss",                                      namn: "Svenska Dagbladet" },
  { url: "https://www.sydsvenskan.se/rss.xml?latest",                           namn: "Sydsvenskan" },
  { url: "http://www.svt.se/nyheter/rss.xml",                                   namn: "SVT Nyheter" },
  { url: "https://www.dagenssamhalle.se/feed/all",                              namn: "Dagens Samhälle" },
  { url: "https://www.breakit.se/feed/artiklar",                                namn: "Breakit" },
  { url: "https://www.nwt.se/feed/",                                            namn: "NWT" },
  { url: "https://www.vlt.se/alla.xml",                                         namn: "VLT" },
  { url: "https://www.dt.se/alla.xml",                                          namn: "DT" },
  { url: "http://na.se/alla.xml",                                               namn: "Nerikes Allehanda" },
  { url: "http://www.gd.se/alla.xml",                                           namn: "Gefle Dagblad" },
  { url: "http://www.arbetarbladet.se/alla.xml",                                namn: "Arbetarbladet" },
  { url: "https://www.barometern.se/feed/",                                     namn: "Barometern" },
  { url: "http://blt.se/feed",                                                  namn: "Blekinge Läns Tidning" },
  { url: "https://www.hd.se/rss.xml?latest=x",                                 namn: "Helsingborgs Dagblad" },
  { url: "https://www.smp.se/feed/",                                            namn: "Smålandsposten" },
  { url: "http://bt.se/feed",                                                   namn: "Borås Tidning" },
  { url: "https://www.sydostran.se/feed",                                       namn: "Sydöstran" },
  { url: "https://www.ystadsallehanda.se/feed",                                 namn: "Ystads Allehanda" },
  { url: "http://klt.nu/feed/",                                                 namn: "Kalmar Läns Tidning" },
  { url: "https://feeds.expressen.se/gt/",                                      namn: "GT" },
  { url: "http://www.helahalsingland.se/alla.xml",                              namn: "Hela Hälsingland" },
  { url: "http://www.allehanda.se/alla.xml",                                    namn: "Allehanda" },
  { url: "https://www.kristianstadsbladet.se/feed/",                            namn: "Kristianstadsbladet" },
  { url: "https://api.sr.se/api/rssfeed/rssfeed.aspx?rssfeed=103",             namn: "P4 Stockholm" },
  { url: "https://api.sr.se/api/rssfeed/rssfeed.aspx?rssfeed=104",             namn: "P4 Göteborg" },
  { url: "https://api.sr.se/api/rssfeed/rssfeed.aspx?rssfeed=96",              namn: "P4 Malmöhus" },
  { url: "https://api.sr.se/api/rssfeed/rssfeed.aspx?rssfeed=98",              namn: "P4 Norrbotten" },
  { url: "https://api.sr.se/api/rssfeed/rssfeed.aspx?rssfeed=99",              namn: "P4 Gävleborg" },
  { url: "http://svt.se/nyheter/regionalt/abc/rss.xml",                        namn: "SVT Stockholm" },
  { url: "http://svt.se/nyheter/regionalt/sydnytt/rss.xml",                    namn: "SVT Skåne" },
  { url: "http://data.riksdagen.se/dokumentlista/?avd=dokument&doktyp=ip,fr&sz=5&sort=datum&sortorder=desc&utformat=rss", namn: "Riksdagen" },
];

const GOOGLE_NEWS = [
  { q: "Centerpartiet",             namn: "Google News: Centerpartiet" },
  { q: "Elisabeth+Thand+Ringqvist", namn: "Google News: ETR" },
  { q: "Centerpartiet+val+2026",    namn: "Google News: C + val 2026" },
  { q: "Centerpartiet+opinion",     namn: "Google News: C + opinion" },
  { q: "Centerpartiet+kritik",      namn: "Google News: C + kritik" },
];

const SÖKTERMER = ["centerpartiet", "elisabeth thand ringqvist", "thand ringqvist", "c-partiet"];

// ─────────────────────────────────────────────
// HJÄLPFUNKTIONER
// ─────────────────────────────────────────────

function hämtaUrl(url, timeout = 10000, redirects = 4) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith("https") ? https : http;
      const req = lib.get(url, {
        timeout,
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/rss+xml, text/xml, */*" }
      }, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          return resolve(hämtaUrl(res.headers.location, timeout, redirects - 1));
        }
        let data = ""; res.setEncoding("utf8");
        res.on("data", c => data += c);
        res.on("end", () => resolve(data));
        res.on("error", () => resolve(""));
      });
      req.on("timeout", () => { req.destroy(); resolve(""); });
      req.on("error", () => resolve(""));
    } catch { resolve(""); }
  });
}

function vänta(ms) { return new Promise(r => setTimeout(r, ms)); }

function inomPeriod(d) {
  if (!d) return true;
  try { const g = new Date(); g.setDate(g.getDate() - KONFIG.dagar); return new Date(d) >= g; }
  catch { return true; }
}

function innehållerSökterm(t) {
  const l = (t || "").toLowerCase();
  return SÖKTERMER.some(s => l.includes(s));
}

function rensa(text) {
  return (text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ")
    .replace(/\s+/g," ").trim();
}

function fält(block, tagg) {
  const m = new RegExp(`<${tagg}[^>]*>([\\s\\S]*?)<\\/${tagg}>`, "i").exec(block);
  return m ? rensa(m[1]) : "";
}

// ─────────────────────────────────────────────
// DATAINSAMLING
// ─────────────────────────────────────────────

async function hämtaRss(flöde) {
  const xml = await hämtaUrl(flöde.url);
  if (!xml) return [];
  const art = [];
  const reg = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = reg.exec(xml)) !== null) {
    const b = m[1];
    const titel = fält(b, "title").slice(0, 200);
    const beskr = fält(b, "description").slice(0, 400);
    const länk  = fält(b, "link").split(" ")[0].trim();
    const datum = fält(b, "pubDate") || fält(b, "dc:date");
    if (!inomPeriod(datum) || !innehållerSökterm(titel + " " + beskr)) continue;
    art.push({ titel, beskr, länk, datum: datum.slice(0,22), källa: flöde.namn });
  }
  return art;
}

async function hämtaGoogleNews(s) {
  const xml = await hämtaUrl(`https://news.google.com/rss/search?q=${s.q}&hl=sv&gl=SE&ceid=SE:sv`);
  if (!xml) return [];
  const art = [];
  const reg = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = reg.exec(xml)) !== null) {
    const b = m[1];
    const titel = fält(b, "title").slice(0, 200);
    const beskr = fält(b, "description").slice(0, 400);
    const länk  = fält(b, "link").split(" ")[0].trim();
    const datum = fält(b, "pubDate");
    if (!inomPeriod(datum)) continue;
    art.push({ titel, beskr, länk, datum: datum.slice(0,22), källa: s.namn });
  }
  return art;
}

async function hämtaPoddar() {
  const text = await hämtaUrl("https://politikpoddar.up.railway.app/weekly-file");
  if (!text) return [];
  const av = [];
  const reg = /=== PODCAST: (.+?) \| AVSNITT: (.+?) \| DATUM: (.+?) ===([\s\S]+?)(?====|$)/g;
  let m;
  while ((m = reg.exec(text)) !== null) {
    const datum = m[3].trim();
    if (!inomPeriod(datum)) continue;
    av.push({ podd: m[1].trim(), titel: m[2].trim(), datum,
              transkript: m[4].replace(/Speaker \d+:/g,"").replace(/\s+/g," ").trim().slice(0,3000) });
  }
  return av;
}

function dedup(art) {
  const s = new Set();
  return art.filter(a => { const k = a.titel.toLowerCase().replace(/\W+/g,"").slice(0,60); if(s.has(k)) return false; s.add(k); return true; });
}

// ─────────────────────────────────────────────
// CLAUDE API
// ─────────────────────────────────────────────

async function genereraRapport(rss, gn, poddar, start, slut) {
  const underlag = `
MEDIEBEVAKNING ${start}–${slut}
RSS: ${rss.length} | Google News: ${gn.length} | Poddar: ${poddar.length}

=== RSS ===
${rss.map((a,i) => `[${i+1}] ${a.källa} | ${a.datum}\n${a.titel}\n${a.beskr}`).join("\n\n")}

=== GOOGLE NEWS ===
${gn.map((a,i) => `[GN${i+1}] ${a.källa} | ${a.datum}\n${a.titel}`).join("\n\n")}

=== PODDAR ===
${poddar.map(p => `[${p.podd}] "${p.titel}" | ${p.datum}\n${p.transkript}`).join("\n\n")}`.trim();

  const prompt = `Du är kommunikationsstrateg för Centerpartiet inför valet 2026. Analysera medieunderlaget och skriv en strategisk veckosrapport på svenska i tre delar:

## DEL 1 – RIKSNYHETER
Vilka utspel dominerade? Hur behandlades C och ETR? Identifiera 3–5 toppämnen med analys.

## DEL 2 – LEDARSIDOR OCH KRÖNIKOR
Identifiera alla ledar- och kröniketexter. Analysera narrativ och ton. Vad är den samlade ledarbilden?

## DEL 3 – LOKALT
Lokala C-nyheter. Finns mönster? Något som riskerar bli riksnyhet?

## RISKER & MÖJLIGHETER
Max 3 punkter vardera.

## REKOMMENDATIONER
2–3 konkreta åtgärder inför kommande vecka.

Analytisk, direkt, utan floskler.

---
${underlag}`;

  const body = JSON.stringify({
    model: "claude-opus-4-5",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KONFIG.anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data).content?.[0]?.text || "Ingen rapport."); }
        catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body); req.end();
  });
}

// ─────────────────────────────────────────────
// WORD-DOKUMENT
// ─────────────────────────────────────────────

function byggWord(text, start, slut, totalt) {
  const G="009A6E", M="0F1F1A", GR="64748B", V="FFFFFF";
  const tom = (b=120) => new Paragraph({ spacing:{before:b,after:0}, children:[new TextRun("")] });
  const avd = () => new Paragraph({ spacing:{before:0,after:0}, border:{bottom:{style:BorderStyle.SINGLE,size:12,color:G,space:1}}, children:[new TextRun("")] });

  const sek = (t) => [avd(), new Paragraph({ spacing:{before:16,after:160}, children:[new TextRun({text:t,font:"Arial",size:28,bold:true,color:M})] })];
  const p   = (t, o={}) => new Paragraph({ spacing:{before:60,after:100}, children:[new TextRun({text:t,font:"Arial",size:21,color:M,...o})] });
  const bul = (t) => new Paragraph({ numbering:{reference:"bullets",level:0}, spacing:{before:60,after:80}, children:[new TextRun({text:t,font:"Arial",size:21,color:M})] });

  const sektioner = text.split(/^## /m).filter(Boolean);
  const barn = [];

  // Försättsblad
  barn.push(tom(400));
  barn.push(new Paragraph({ spacing:{before:0,after:60}, children:[new TextRun({text:"CENTERPARTIET",font:"Arial",size:18,bold:true,color:G,characterSpacing:300})] }));
  barn.push(new Paragraph({ spacing:{before:0,after:0}, border:{bottom:{style:BorderStyle.SINGLE,size:18,color:G,space:6}}, children:[new TextRun({text:"Medierapport",font:"Arial",size:72,bold:true,color:M})] }));
  barn.push(tom(140));
  barn.push(p(`Period: ${start} – ${slut}`, {size:26,color:GR}));
  barn.push(p(`${totalt} artiklar analyserade`, {size:21,color:GR}));
  barn.push(tom(600));

  // Rapport
  sektioner.forEach(sek_ => {
    const rader = sek_.split("\n");
    barn.push(...sek(rader[0].trim()));
    rader.slice(1).forEach(rad => {
      const t = rad.trim();
      if (!t) { barn.push(tom(80)); return; }
      if (t.startsWith("### ")) { barn.push(new Paragraph({ spacing:{before:200,after:60}, children:[new TextRun({text:t.slice(4),font:"Arial",size:22,bold:true,color:G})] })); }
      else if (t.startsWith("- ") || t.startsWith("• ")) { barn.push(bul(t.slice(2))); }
      else {
        const delar = t.split(/\*\*(.+?)\*\*/);
        barn.push(new Paragraph({ spacing:{before:60,after:100}, children: delar.map((d,i) => new TextRun({text:d,font:"Arial",size:21,color:M,bold:i%2===1})) }));
      }
    });
    barn.push(tom(160));
  });

  return new Document({
    numbering: { config: [{ reference:"bullets", levels:[{ level:0, format:LevelFormat.BULLET, text:"–", alignment:AlignmentType.LEFT, style:{paragraph:{indent:{left:600,hanging:300}},run:{font:"Arial",color:G,bold:true}} }] }] },
    styles: { default: { document: { run: { font:"Arial", size:21 } } } },
    sections: [{
      properties: { page: { size:{width:11906,height:16838}, margin:{top:1134,right:1134,bottom:1134,left:1134} } },
      headers: { default: new Header({ children:[new Paragraph({ border:{bottom:{style:BorderStyle.SINGLE,size:8,color:G,space:1}}, spacing:{before:0,after:100}, tabStops:[{type:TabStopType.RIGHT,position:TabStopPosition.MAX}], children:[new TextRun({text:"CENTERPARTIET  ·  MEDIEBEVAKNING",font:"Arial",size:16,color:GR,bold:true}), new TextRun({text:"\tKONFIDENTIELLT",font:"Arial",size:16,color:GR})] })] }) },
      footers: { default: new Footer({ children:[new Paragraph({ border:{top:{style:BorderStyle.SINGLE,size:6,color:G,space:1}}, spacing:{before:100}, tabStops:[{type:TabStopType.RIGHT,position:TabStopPosition.MAX}], children:[new TextRun({text:`${start} – ${slut}`,font:"Arial",size:16,color:GR}), new TextRun({text:"\tSida ",font:"Arial",size:16,color:GR}), new SimpleField("PAGE")] })] }) },
      children: barn
    }]
  });
}

// ─────────────────────────────────────────────
// MEJL
// ─────────────────────────────────────────────

async function skickaMejl(buf, start, slut, totalt) {
  const transport = nodemailer.createTransport({ service:"gmail", auth:{ user:KONFIG.gmailUser, pass:KONFIG.gmailPass } });
  const fil = `medierapport-${new Date().toISOString().slice(0,10)}.docx`;
  await transport.sendMail({
    from: `"C Mediebevakning" <${KONFIG.gmailUser}>`,
    to: KONFIG.mottagare.join(", "),
    subject: `Medierapport Centerpartiet – ${start} – ${slut}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:580px">
      <div style="background:#0F1F1A;padding:28px;border-bottom:4px solid #009A6E">
        <p style="color:#009A6E;font-size:11px;margin:0 0 8px;letter-spacing:2px">CENTERPARTIET · MEDIEBEVAKNING</p>
        <h1 style="color:white;margin:0;font-size:26px">Medierapport</h1>
        <p style="color:rgba(255,255,255,0.55);margin:6px 0 0;font-size:14px">${start} – ${slut}</p>
      </div>
      <div style="padding:24px;background:#f8fafc;border:1px solid #e2e8f0">
        <p style="color:#334155;margin:0 0 16px">Veckans medierapport är bifogad som Word-dokument.</p>
        <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:16px;font-size:13px;color:#64748b">
          📊 <strong>${totalt} artiklar</strong> analyserade<br>
          📅 Period: ${start} – ${slut}<br>
          🕒 Genererad: ${new Date().toLocaleString("sv-SE")}
        </div>
      </div>
      <div style="padding:14px 24px;background:#f1f5f9;font-size:11px;color:#94a3b8">
        Automatisk rapport · Centerpartiet Kampanjstab · Konfidentiellt
      </div>
    </div>`,
    attachments: [{ filename:fil, content:buf, contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" }]
  });
}

// ─────────────────────────────────────────────
// RAPPORT-KÖRNING
// ─────────────────────────────────────────────

let körsNu = false;

async function körRapport(källa = "cron") {
  if (körsNu) {
    logg("Körning redan pågår – hoppar över.", "warn");
    return { ok: false, msg: "Körning pågår redan." };
  }
  körsNu = true;
  const start = new Date();
  const nu = new Date();
  const slut = nu.toLocaleDateString("sv-SE");
  const gräns = new Date(); gräns.setDate(gräns.getDate() - KONFIG.dagar);
  const periodStart = gräns.toLocaleDateString("sv-SE");

  try {
    logg(`Startar rapport (${källa})…`);

    // RSS
    logg("Hämtar RSS…");
    const rss = [];
    for (const f of RSS_FLÖDEN) { rss.push(...await hämtaRss(f)); await vänta(100); }
    logg(`RSS: ${rss.length} träffar`);

    // Google News
    logg("Hämtar Google News…");
    const gn = [];
    for (const s of GOOGLE_NEWS) { gn.push(...await hämtaGoogleNews(s)); await vänta(500); }
    logg(`Google News: ${gn.length} träffar`);

    // Poddar
    logg("Hämtar poddar…");
    const poddar = await hämtaPoddar();
    logg(`Poddar: ${poddar.length} avsnitt`);

    const alleArt = dedup([...rss, ...gn]);
    logg(`Totalt: ${alleArt.length} unika artiklar`);

    // Claude
    logg("Genererar rapport via Claude…");
    const rapport = await genereraRapport(rss, gn, poddar, periodStart, slut);
    logg("Rapport genererad");

    // Word
    logg("Bygger Word-dokument…");
    const doc = byggWord(rapport, periodStart, slut, alleArt.length);
    const buf = await Packer.toBuffer(doc);
    logg("Word klart");

    // Mejl
    logg("Skickar mejl…");
    await skickaMejl(buf, periodStart, slut, alleArt.length);
    logg(`✅ Mejl skickat till: ${KONFIG.mottagare.join(", ")}`, "success");

    const sek = Math.round((Date.now() - start) / 1000);
    logg(`Rapport klar på ${sek}s`, "success");
    return { ok: true, msg: `Rapport skickad på ${sek}s. ${alleArt.length} artiklar analyserade.` };

  } catch (e) {
    logg(`❌ Fel: ${e.message}`, "error");
    return { ok: false, msg: e.message };
  } finally {
    körsNu = false;
  }
}

// ─────────────────────────────────────────────
// CRON – varje söndag kl 15:00
// ─────────────────────────────────────────────

cron.schedule("0 15 * * 0", () => {
  logg("Cron triggar söndagsrapport…");
  körRapport("cron-söndag");
}, { timezone: "Europe/Stockholm" });

logg("Cron schemalagd: söndagar kl 15:00 (Europe/Stockholm)");

// ─────────────────────────────────────────────
// WEBB-UI + API
// ─────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>C Mediebevakning</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --gron: #009A6E;
    --gron2: #007a57;
    --mork: #0F1F1A;
    --gra: #64748b;
    --ljus: #f0f7f5;
    --vit: #ffffff;
    --rod: #ef4444;
    --gul: #f59e0b;
  }

  body {
    font-family: 'DM Sans', sans-serif;
    background: var(--mork);
    min-height: 100vh;
    color: var(--vit);
  }

  .topbar {
    background: rgba(0,0,0,0.3);
    border-bottom: 1px solid rgba(0,154,110,0.3);
    padding: 14px 32px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .topbar-dot { width: 8px; height: 8px; background: var(--gron); border-radius: 50%; }
  .topbar-text { font-size: 11px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: var(--gron); }

  .hero {
    padding: 60px 32px 40px;
    max-width: 800px;
    margin: 0 auto;
  }

  .hero h1 {
    font-family: 'Playfair Display', serif;
    font-size: clamp(36px, 6vw, 64px);
    font-weight: 900;
    line-height: 1.05;
    margin-bottom: 16px;
  }
  .hero h1 span { color: var(--gron); }
  .hero p { color: rgba(255,255,255,0.55); font-size: 16px; line-height: 1.6; max-width: 520px; }

  .main { max-width: 800px; margin: 0 auto; padding: 0 32px 60px; }

  /* STATUS */
  .status-card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .status-icon {
    width: 48px; height: 48px;
    border-radius: 12px;
    background: rgba(0,154,110,0.15);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
  }
  .status-label { font-size: 12px; color: var(--gra); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .status-value { font-size: 18px; font-weight: 600; }

  /* KNAPP */
  .btn-wrap { margin-bottom: 32px; }

  .btn-kör {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: var(--gron);
    color: white;
    border: none;
    border-radius: 12px;
    padding: 18px 32px;
    font-family: 'DM Sans', sans-serif;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
    overflow: hidden;
  }
  .btn-kör:hover:not(:disabled) { background: var(--gron2); transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,154,110,0.3); }
  .btn-kör:active:not(:disabled) { transform: translateY(0); }
  .btn-kör:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  .btn-icon { font-size: 20px; }

  .btn-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: snurra 0.8s linear infinite;
    display: none;
  }
  .btn-kör.laddar .btn-spinner { display: block; }
  .btn-kör.laddar .btn-icon { display: none; }

  @keyframes snurra { to { transform: rotate(360deg); } }

  .btn-result {
    margin-top: 12px;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    display: none;
  }
  .btn-result.ok { background: rgba(0,154,110,0.15); border: 1px solid rgba(0,154,110,0.3); color: #6ee7b7; }
  .btn-result.fel { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; }

  /* NÄSTA KÖRNING */
  .nästa {
    background: rgba(0,154,110,0.08);
    border: 1px solid rgba(0,154,110,0.2);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 32px;
    font-size: 14px;
    color: rgba(255,255,255,0.6);
  }
  .nästa strong { color: var(--gron); }

  /* LOGG */
  .logg-rubrik {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--gra);
    margin-bottom: 12px;
  }

  .logg {
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    overflow: hidden;
    max-height: 400px;
    overflow-y: auto;
  }

  .logg-rad {
    padding: 10px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 12px;
    font-size: 13px;
    line-height: 1.4;
  }
  .logg-rad:last-child { border-bottom: none; }
  .logg-tid { color: var(--gra); font-size: 12px; font-variant-numeric: tabular-nums; }
  .logg-rad.success .logg-msg { color: #6ee7b7; }
  .logg-rad.error .logg-msg { color: #fca5a5; }
  .logg-rad.warn .logg-msg { color: #fde68a; }
  .logg-rad.info .logg-msg { color: rgba(255,255,255,0.8); }
  .logg-tom { padding: 24px; text-align: center; color: var(--gra); font-size: 13px; }
</style>
</head>
<body>

<div class="topbar">
  <div class="topbar-dot"></div>
  <div class="topbar-text">Centerpartiet · Mediebevakning</div>
</div>

<div class="hero">
  <h1>Medie<span>rapport</span></h1>
  <p>Automatisk bevakning av Centerpartiet och Elisabeth Thand Ringqvist i riksmedia, ledarsidor och poddar.</p>
</div>

<div class="main">

  <div class="status-card">
    <div class="status-icon">📅</div>
    <div>
      <div class="status-label">Automatisk körning</div>
      <div class="status-value">Söndagar kl 15:00</div>
    </div>
  </div>

  <div class="nästa" id="nästa-text">
    Nästa automatiska rapport: beräknar…
  </div>

  <div class="btn-wrap">
    <button class="btn-kör" id="btn" onclick="körNu()">
      <span class="btn-icon">▶</span>
      <div class="btn-spinner"></div>
      Gör rapport direkt
    </button>
    <div class="btn-result" id="result"></div>
  </div>

  <div class="logg-rubrik">Körningslogg</div>
  <div class="logg" id="logg">
    <div class="logg-tom">Ingen aktivitet ännu</div>
  </div>

</div>

<script>
  // Beräkna nästa söndag kl 15:00
  function nästa() {
    const nu = new Date();
    const d = new Date(nu);
    const dagIVecka = d.getDay(); // 0=sön
    const dagarTill = dagIVecka === 0 ? 0 : 7 - dagIVecka;
    d.setDate(d.getDate() + dagarTill);
    d.setHours(15, 0, 0, 0);
    if (d <= nu) d.setDate(d.getDate() + 7);
    const diff = d - nu;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return { datum: d.toLocaleDateString("sv-SE", { weekday:"long", day:"numeric", month:"long" }), h, m };
  }

  function uppdateraNästa() {
    const { datum, h, m } = nästa();
    document.getElementById("nästa-text").innerHTML =
      \`Nästa automatiska rapport: <strong>\${datum} kl 15:00</strong> · om \${h}h \${m}min\`;
  }
  uppdateraNästa();
  setInterval(uppdateraNästa, 60000);

  async function körNu() {
    const btn = document.getElementById("btn");
    const result = document.getElementById("result");
    btn.disabled = true;
    btn.classList.add("laddar");
    btn.lastChild.textContent = " Genererar rapport…";
    result.style.display = "none";

    try {
      const svar = await fetch("/kör", { method: "POST" });
      const data = await svar.json();
      result.textContent = data.msg;
      result.className = "btn-result " + (data.ok ? "ok" : "fel");
      result.style.display = "block";
      hämtaLogg();
    } catch(e) {
      result.textContent = "Nätverksfel: " + e.message;
      result.className = "btn-result fel";
      result.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.classList.remove("laddar");
    }
  }

  async function hämtaLogg() {
    try {
      const svar = await fetch("/logg");
      const rader = await svar.json();
      const el = document.getElementById("logg");
      if (!rader.length) { el.innerHTML = '<div class="logg-tom">Ingen aktivitet ännu</div>'; return; }
      el.innerHTML = rader.map(r =>
        \`<div class="logg-rad \${r.typ}">
          <span class="logg-tid">\${r.tid}</span>
          <span class="logg-msg">\${r.msg}</span>
        </div>\`
      ).join("");
    } catch {}
  }

  hämtaLogg();
  setInterval(hämtaLogg, 5000);
</script>
</body>
</html>`;

// ─────────────────────────────────────────────
// HTTP-SERVER
// ─────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (req.method === "GET" && url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);

  } else if (req.method === "POST" && url === "/kör") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    // Svara direkt och kör i bakgrunden
    const result = await körRapport("manuell");
    res.end(JSON.stringify(result));

  } else if (req.method === "GET" && url === "/logg") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(LOG));

  } else if (req.method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, körsNu, loggrader: LOG.length }));

  } else {
    res.writeHead(404); res.end("404");
  }
});

server.listen(KONFIG.port, () => {
  logg(`Server startad på port ${KONFIG.port}`, "success");
  logg(`Mottagare: ${KONFIG.mottagare.join(", ") || "(ej konfigurerat)"}`);
});
