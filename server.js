import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
app.use(express.json({ limit: "1mb" }));

const ALLOWED_ORIGINS = [
  "https://www.aegisopentrust.com",
  "https://aegisopentrust.com"
];

app.use(cors({
  origin: function(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked"), false);
  }
}));

app.use("/evaluate", rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get("/", (_, res) => res.json({ ok: true, service: "AEGIS OpenTRUST API" }));

function isValidUrl(u) { try { new URL(u); return true; } catch { return false; } }
function verdictToTH(code){
  switch(code){
    case "MORE_RELIABLE": return "น่าเชื่อถือขึ้น (ยังควรตรวจซ้ำ)";
    case "MIXED_SIGNALS": return "ข้อมูลปะปน/สัญญาณขัดกัน";
    case "NOT_RECOMMENDED_YET": return "ยังไม่แนะนำให้เชื่อ/ใช้เป็นฐานตัดสินใจ";
    case "INSUFFICIENT_EVIDENCE": return "หลักฐานไม่เพียงพอ";
    default: return "ต้องตรวจเพิ่ม";
  }
}

function evaluateMVP(input){
  const links = (input?.evidence?.links || []).map(x=>x.url).filter(isValidUrl);
  const flags = input?.policy_gate?.auto_flags || [];
  const goal = input?.case?.goal || "verify";

  let dri = 50 + Math.min(20, links.length * 8);
  if (links.length < 1) dri -= 25;
  if (goal === "predict") dri -= 8;
  if (flags.includes("POLITICS_HIGH_IMPACT")) dri -= 10;

  dri = Math.max(0, Math.min(100, dri));
  let tier = dri >= 80 ? "Gold" : dri >= 60 ? "Silver" : "Bronze";

  let verdict = "NEEDS_MORE_CHECKS";
  if (links.length < 1 && input?.output_preferences?.require_insufficient_evidence_when_missing_sources){
    verdict = "INSUFFICIENT_EVIDENCE";
    dri = Math.min(dri, 38);
    tier = "Bronze";
  } else if (dri >= 70) verdict = "MORE_RELIABLE";
  else if (dri >= 45) verdict = "MIXED_SIGNALS";
  else verdict = "NOT_RECOMMENDED_YET";

  const confidence = verdict === "INSUFFICIENT_EVIDENCE" ? "LOW" : (dri >= 75 ? "MEDIUM" : "LOW");
  const evidenceLevel = links.length >= 3 ? "MEDIUM" : (links.length >= 1 ? "WEAK" : "MISSING");

  const reasons = verdict === "INSUFFICIENT_EVIDENCE"
    ? [
        "ยังไม่มีหลักฐานเพียงพอ (ลิงก์อ้างอิง/เอกสาร) เพื่อประเมินอย่างรับผิดชอบ",
        "ระบบหลีกเลี่ยงการฟันธงเมื่อข้อมูลไม่ครบ เพื่อคงความซื่อสัตย์ต่อความจริง",
        "แนะนำเพิ่มแหล่งข้อมูลที่ตรวจสอบย้อนกลับได้ก่อนทำการประเมินซ้ำ"
      ]
    : [
        links.length >= 2 ? "มีหลักฐานอ้างอิงมากกว่า 1 แหล่ง ทำให้ตรวจสอบย้อนกลับได้" : "หลักฐานยังน้อย ทำให้ความมั่นใจต่ำ",
        flags.includes("POLITICS_HIGH_IMPACT") ? "เป็นเรื่อง high-impact จึงต้องระบุความไม่แน่นอนและหลีกเลี่ยงการฟันธง" : "ยังไม่พบสัญญาณ high-impact ที่ต้องเพิ่มข้อจำกัดพิเศษ",
        goal === "predict" ? "โหมดคาดการณ์สื่อสารเป็นความน่าจะเป็น ไม่ใช่ผลยืนยัน" : "โหมดตรวจสอบเน้นเทียบหลักฐานและความสอดคล้อง"
      ];

  const nextChecks = [];
  if (links.length < 3) nextChecks.push("เพิ่มหลักฐานจากแหล่งที่เป็นทางการ/ต้นทางอย่างน้อย 1–2 แหล่ง");
  nextChecks.push("ตรวจสอบความสอดคล้องกับแหล่งอิสระ (cross-check)");

  return {
    schema_version: "aegis_output_v1.0",
    request_id: input?.request?.request_id || "unknown",
    as_of_date_local: input?.case?.as_of_date_local || "",
    subject: input?.subject || {},
    verdict: { code: verdict, summary_th: verdictToTH(verdict), confidence },
    score: { dri, tier },
    signals: { evidence_level: evidenceLevel, freshness: "UNKNOWN", policy_flags: flags },
    reasons: reasons.slice(0, input?.output_preferences?.max_reasons || 3),
    next_checks: nextChecks.slice(0, input?.output_preferences?.max_next_checks || 2),
    disclaimer_th:
      "ผลลัพธ์นี้เป็นการประเมินจากข้อมูลสาธารณะ ไม่ใช่คำแนะนำทางกฎหมาย การเงิน หรือการแพทย์ ผู้ใช้ต้องรับผิดชอบการตัดสินใจของตนเอง"
  };
}

function enforcePolicyGate(input){
  const pg = input?.policy_gate || {};
  if (!pg.acknowledged_limits || !pg.acknowledged_no_professional_advice || !pg.acknowledged_no_harassment){
    return { ok:false, error:"POLICY_GATE_NOT_ACKNOWLEDGED" };
  }
  return { ok:true };
}

app.post("/evaluate", (req, res) => {
  const input = req.body;
  const gate = enforcePolicyGate(input);
  if (!gate.ok) return res.status(400).json({ error: gate.error, message: "ต้องยืนยัน Policy Gate ให้ครบก่อนประเมิน" });
  res.json(evaluateMVP(input));
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log("AEGIS API listening on", PORT));
