const crypto = require("crypto");
const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge_base");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";
const COOKIE_NAME = "mvp_session";
const sessions = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const publicFiles = new Set(["/login.html", "/login.js", "/styles.css"]);

async function readStudents() {
  const raw = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeStudents(students) {
  await fs.writeFile(DATA_FILE, `${JSON.stringify(students, null, 2)}\n`, "utf8");
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(part => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  return token ? sessions.get(token) : null;
}

function setSession(res, user) {
  const token = crypto.randomUUID();
  sessions.set(token, { username: user.username, role: user.role, createdAt: Date.now() });
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
}

function clearSession(req, res) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function getRiskScore(student) {
  let score = 20;
  if (student.lessonsLeft <= 3) score += 26;
  if (student.daysToEnd <= 14) score += 22;
  if (student.absentRate >= 25) score += 20;
  if (student.parentReplies <= 1) score += 16;
  if (student.homeworkMissed >= 2) score += 12;
  if (student.lastContact.includes("18") || student.lastContact.includes("21")) score += 8;
  return Math.min(score, 99);
}

function getRiskLevel(score) {
  if (score >= 72) return { text: "高风险", className: "risk-high" };
  if (score >= 50) return { text: "中风险", className: "risk-mid" };
  return { text: "低风险", className: "risk-low" };
}

function getReasons(student) {
  const reasons = [];
  if (student.daysToEnd <= 14) reasons.push(`预计 ${student.daysToEnd} 天内课消结束，需要提前锁定续费窗口。`);
  if (student.lessonsLeft <= 3) reasons.push(`剩余 ${student.lessonsLeft} 节课，已经进入续费关键期。`);
  if (student.absentRate >= 25) reasons.push(`近月缺勤率 ${student.absentRate}%，学习连续性变弱。`);
  if (student.parentReplies <= 1) reasons.push("家长近两周互动偏少，可能没有充分感知孩子进步。");
  if (student.homeworkMissed >= 2) reasons.push(`课后练习缺交 ${student.homeworkMissed} 次，需要降低家庭配合阻力。`);
  if (!reasons.length) reasons.push("学习节奏稳定，可安排常规续费沟通和下一阶段目标确认。");
  return reasons;
}

function getNextAction(student, score) {
  if (score >= 72) {
    return `今天由 ${student.teacher} 先发成长反馈，前台 24 小时内邀约家长做 10 分钟阶段沟通。`;
  }
  if (student.daysToEnd <= 14) {
    return "本周发送阶段作品/课堂表现总结，并给出下一期明确目标与名额提醒。";
  }
  return "维持每周一次高质量反馈，提前铺垫下一阶段学习目标。";
}

function enrichStudent(student) {
  const riskScore = getRiskScore(student);
  return {
    ...student,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    riskReasons: getReasons(student),
    nextAction: getNextAction(student, riskScore)
  };
}

function makeMessage(student, tone = "warm") {
  const proof = student.proof.map(item => `${item[0]}：${item[1]}`).join("\n");
  if (tone === "direct") {
    return `${student.name}家长您好，我看了一下孩子目前的学习进度，课程预计还有 ${student.daysToEnd} 天左右结束。建议我们这周确认下一阶段安排，避免中断后影响连续性。\n\n这阶段比较明显的进步：\n${proof}\n\n我建议下一期重点放在“稳定能力 + 完整作品/曲目/舞台呈现”上。您方便今天或明天抽 10 分钟，我们把续课方案和目标对齐一下吗？`;
  }
  if (tone === "premium") {
    return `${student.name}家长您好，孩子这段时间已经不只是完成课堂内容，而是进入到更需要系统打磨的阶段了。\n\n我整理了三点变化：\n${proof}\n\n如果接下来课程不断档，我们可以把下一阶段目标设计得更完整：一方面巩固基础能力，另一方面形成可展示的作品/曲目/节目成果。建议我们为孩子预留下一期名额，并安排一次阶段规划沟通。`;
  }
  return `${student.name}家长您好，今天想和您同步一下孩子最近的学习变化。孩子这段时间有几个地方进步挺明显：\n\n${proof}\n\n目前课程还剩 ${student.lessonsLeft} 节，预计 ${student.daysToEnd} 天左右进入新阶段。我建议我们提前聊一下后面的学习目标，这样孩子的状态能接得更顺。您这两天什么时候方便，我和您简单沟通 10 分钟？`;
}

function makeSummary(students) {
  const enriched = students.map(enrichStudent);
  const highRisk = enriched.filter(student => student.riskScore >= 72);
  const dueSoon = enriched.filter(student => student.daysToEnd <= 14);
  return {
    highRiskCount: highRisk.length,
    dueSoonCount: dueSoon.length,
    protectedRevenue: highRisk.reduce((sum, student) => sum + student.renewalValue, 0)
  };
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildProof(body) {
  const proof = [];
  for (let index = 1; index <= 3; index += 1) {
    const title = String(body[`proofTitle${index}`] || "").trim();
    const text = String(body[`proofText${index}`] || "").trim();
    if (title || text) proof.push([title || `成长点${index}`, text || "待补充具体课堂表现。"]);
  }
  return proof.length ? proof : [["课堂表现", "已录入基础信息，后续可补充作品、练习或测评记录。"]];
}

function createStudent(body, students) {
  const required = ["name", "course", "teacher"];
  for (const key of required) {
    if (!String(body[key] || "").trim()) {
      return { error: "姓名、课程、老师为必填项" };
    }
  }

  const nextId = students.reduce((max, student) => Math.max(max, student.id), 0) + 1;
  return {
    student: {
      id: nextId,
      name: String(body.name).trim(),
      course: String(body.course).trim(),
      teacher: String(body.teacher).trim(),
      lessonsLeft: toNumber(body.lessonsLeft, 0),
      daysToEnd: toNumber(body.daysToEnd, 30),
      absentRate: toNumber(body.absentRate, 0),
      parentReplies: toNumber(body.parentReplies, 0),
      homeworkMissed: toNumber(body.homeworkMissed, 0),
      renewalValue: toNumber(body.renewalValue, 0),
      lastContact: String(body.lastContact || "未联系").trim(),
      status: "待跟进",
      proof: buildProof(body)
    }
  };
}

async function ensureKnowledgeDir() {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
}

async function listKnowledgeFiles() {
  await ensureKnowledgeDir();
  const entries = await fs.readdir(KNOWLEDGE_DIR, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => [".txt", ".md", ".json", ".csv"].includes(path.extname(name).toLowerCase()));
}

function getFilePathInKnowledgeBase(fileName) {
  const filePath = path.resolve(KNOWLEDGE_DIR, fileName);
  if (!filePath.startsWith(KNOWLEDGE_DIR)) return null;
  return filePath;
}

function findText(content, patterns, fallback = "") {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return fallback;
}

function findNumber(content, patterns, fallback = 0) {
  const text = findText(content, patterns, "");
  return text ? toNumber(text.replace(/[^\d.]/g, ""), fallback) : fallback;
}

function parseProofFromText(content) {
  const proof = [];
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(成长证据|成长点|进步|作品|课堂表现)\s*[：:]\s*(.+)$/);
    if (match) proof.push([match[1], match[2]]);
  }

  if (proof.length) return proof.slice(0, 3);

  const summary = findText(content, [
    /(?:课堂记录|学习反馈|老师点评|阶段总结)\s*[：:]\s*([^\n\r]+)/i
  ], "");

  return summary ? [["课堂表现", summary]] : [["课堂表现", "由本地知识库自动识别，建议补充具体作品或课堂记录。"]];
}

function extractStudentFromText(content, source) {
  const candidate = {
    source,
    name: findText(content, [/(?:学员姓名|学生姓名|姓名|学生|孩子)\s*[：:]\s*([^\n\r,，]+)/i]),
    course: findText(content, [/(?:课程|报名课程|就读课程|班级)\s*[：:]\s*([^\n\r,，]+)/i]),
    teacher: findText(content, [/(?:负责老师|老师|主教|教师)\s*[：:]\s*([^\n\r,，]+)/i]),
    lessonsLeft: findNumber(content, [/(?:剩余课时|剩余|课时剩余)\s*[：:]\s*(\d+)/i], 4),
    daysToEnd: findNumber(content, [/(?:预计课消天数|课消天数|预计结束|课消)\s*[：:]\s*(\d+)/i], 14),
    absentRate: findNumber(content, [/(?:缺勤率|近月缺勤率)\s*[：:]\s*(\d+)/i], 0),
    parentReplies: findNumber(content, [/(?:家长回复次数|家长互动|回复次数)\s*[：:]\s*(\d+)/i], 1),
    homeworkMissed: findNumber(content, [/(?:作业缺交次数|缺交次数|作业缺交)\s*[：:]\s*(\d+)/i], 0),
    renewalValue: findNumber(content, [/(?:续费金额|续费|金额)\s*[：:]\s*(\d+)/i], 3980),
    lastContact: findText(content, [/(?:最近联系|上次联系|最后联系)\s*[：:]\s*([^\n\r,，]+)/i], "未联系"),
    proof: parseProofFromText(content)
  };

  if (!candidate.name || !candidate.course || !candidate.teacher) {
    candidate.missing = ["name", "course", "teacher"].filter(key => !candidate[key]);
  }

  return candidate;
}

function parseCsv(content, source) {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(item => item.trim());
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",").map(item => item.trim());
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
    return {
      source: `${source} 第${index + 2}行`,
      name: row.name || row.姓名 || row.学员姓名 || row.学生姓名 || "",
      course: row.course || row.课程 || row.报名课程 || "",
      teacher: row.teacher || row.老师 || row.负责老师 || "",
      lessonsLeft: toNumber(row.lessonsLeft || row.剩余课时, 4),
      daysToEnd: toNumber(row.daysToEnd || row.预计课消天数, 14),
      absentRate: toNumber(row.absentRate || row.缺勤率, 0),
      parentReplies: toNumber(row.parentReplies || row.家长回复次数, 1),
      homeworkMissed: toNumber(row.homeworkMissed || row.作业缺交次数, 0),
      renewalValue: toNumber(row.renewalValue || row.续费金额, 3980),
      lastContact: row.lastContact || row.最近联系 || "未联系",
      proof: [["课堂表现", row.成长证据 || row.学习反馈 || "由 CSV 知识库自动识别。"]]
    };
  });
}

function normalizeCandidate(candidate) {
  return {
    name: candidate.name || "",
    course: candidate.course || "",
    teacher: candidate.teacher || "",
    lessonsLeft: toNumber(candidate.lessonsLeft, 4),
    daysToEnd: toNumber(candidate.daysToEnd, 14),
    absentRate: toNumber(candidate.absentRate, 0),
    parentReplies: toNumber(candidate.parentReplies, 1),
    homeworkMissed: toNumber(candidate.homeworkMissed, 0),
    renewalValue: toNumber(candidate.renewalValue, 3980),
    lastContact: candidate.lastContact || "未联系",
    proof: Array.isArray(candidate.proof) && candidate.proof.length ? candidate.proof : [["课堂表现", "由本地知识库自动识别。"]],
    source: candidate.source || "本地知识库",
    missing: candidate.missing || []
  };
}

async function extractFromKnowledgeFile(fileName) {
  const filePath = getFilePathInKnowledgeBase(fileName);
  if (!filePath) return [];

  const ext = path.extname(fileName).toLowerCase();
  const content = await fs.readFile(filePath, "utf8");

  if (ext === ".csv") return parseCsv(content, fileName).map(normalizeCandidate);

  if (ext === ".json") {
    const parsed = JSON.parse(content);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row, index) => normalizeCandidate({ ...row, source: `${fileName} #${index + 1}` }));
  }

  return [normalizeCandidate(extractStudentFromText(content, fileName))];
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
      const user = { username: ADMIN_USER, role: "校长" };
      setSession(res, user);
      sendJson(res, 200, { user });
      return;
    }
    sendJson(res, 401, { error: "账号或密码错误" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    clearSession(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }

  const user = currentUser(req);
  if (req.method === "GET" && url.pathname === "/api/session") {
    if (!user) return sendJson(res, 401, { error: "未登录" });
    sendJson(res, 200, { user });
    return;
  }

  if (!user) {
    sendJson(res, 401, { error: "未登录" });
    return;
  }

  const students = await readStudents();

  if (req.method === "GET" && url.pathname === "/api/knowledge/files") {
    sendJson(res, 200, { files: await listKnowledgeFiles() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge/extract") {
    const body = await readBody(req);
    const files = body.fileName ? [body.fileName] : await listKnowledgeFiles();
    const candidates = [];
    for (const fileName of files) {
      candidates.push(...await extractFromKnowledgeFile(fileName));
    }
    sendJson(res, 200, { candidates });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge/import") {
    const body = await readBody(req);
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const imported = [];

    for (const candidate of candidates) {
      const result = createStudent({
        ...candidate,
        proofTitle1: candidate.proof?.[0]?.[0],
        proofText1: candidate.proof?.[0]?.[1],
        proofTitle2: candidate.proof?.[1]?.[0],
        proofText2: candidate.proof?.[1]?.[1],
        proofTitle3: candidate.proof?.[2]?.[0],
        proofText3: candidate.proof?.[2]?.[1]
      }, students);
      if (!result.error) {
        students.push(result.student);
        imported.push(enrichStudent(result.student));
      }
    }

    await writeStudents(students);
    sendJson(res, 201, { imported, summary: makeSummary(students) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/students") {
    const enriched = students.map(enrichStudent).sort((a, b) => b.riskScore - a.riskScore);
    sendJson(res, 200, { students: enriched, summary: makeSummary(students) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/students") {
    const body = await readBody(req);
    const result = createStudent(body, students);
    if (result.error) return sendJson(res, 400, { error: result.error });

    students.push(result.student);
    await writeStudents(students);
    sendJson(res, 201, { student: enrichStudent(result.student), summary: makeSummary(students) });
    return;
  }

  const studentMatch = url.pathname.match(/^\/api\/students\/(\d+)$/);
  const messageMatch = url.pathname.match(/^\/api\/students\/(\d+)\/message$/);

  if (req.method === "GET" && messageMatch) {
    const student = students.find(item => item.id === Number(messageMatch[1]));
    if (!student) return sendJson(res, 404, { error: "Student not found" });
    sendJson(res, 200, { message: makeMessage(student, url.searchParams.get("tone") || "warm") });
    return;
  }

  if (req.method === "PATCH" && studentMatch) {
    const body = await readBody(req);
    const student = students.find(item => item.id === Number(studentMatch[1]));
    if (!student) return sendJson(res, 404, { error: "Student not found" });

    if (body.status === "已跟进") {
      student.status = "已跟进";
      student.lastContact = "刚刚";
    }

    if (body.status === "已续费") {
      student.status = "已续费";
      student.lessonsLeft = 24;
      student.daysToEnd = 80;
      student.lastContact = "刚刚";
    }

    await writeStudents(students);
    sendJson(res, 200, { student: enrichStudent(student), summary: makeSummary(students) });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

async function serveStatic(req, res, url) {
  if (url.pathname === "/") {
    if (!currentUser(req)) {
      res.writeHead(302, { Location: "/login.html" });
      res.end();
      return;
    }
  }

  if (!publicFiles.has(url.pathname) && url.pathname !== "/" && !currentUser(req)) {
    res.writeHead(302, { Location: "/login.html" });
    res.end();
    return;
  }

  const safePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

global.__mvpServer = server;

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MVP running at http://127.0.0.1:${PORT}/`);
  console.log(`Login: ${ADMIN_USER} / ${ADMIN_PASS}`);
});
