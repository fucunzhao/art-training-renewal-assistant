const crypto = require("crypto");
const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "storage");
const SEED_DATA_FILE = path.join(ROOT, "data.json");
const SEED_USERS_FILE = path.join(ROOT, "users.json");
const SEED_NOTIFICATIONS_FILE = path.join(ROOT, "notifications.json");
const SEED_SCHEDULE_FILE = path.join(ROOT, "schedule.json");
const SEED_KNOWLEDGE_DIR = path.join(ROOT, "knowledge_base");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const NOTIFICATIONS_FILE = path.join(DATA_DIR, "notifications.json");
const SCHEDULE_FILE = path.join(DATA_DIR, "schedule.json");
const KNOWLEDGE_DIR = path.join(DATA_DIR, "knowledge_base");
const TEACHERS_KB_FILE = path.join(KNOWLEDGE_DIR, "teachers.json");
const STUDENTS_KB_FILE = path.join(KNOWLEDGE_DIR, "students.json");
const STUDENT_ASSET_DIR = path.join(KNOWLEDGE_DIR, "student_assets");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";
const COOKIE_NAME = "mvp_session";
const sessions = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const publicFiles = new Set(["/login.html", "/login.js", "/styles.css"]);

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copySeedFileIfMissing(seedPath, targetPath, fallbackContent) {
  if (await pathExists(targetPath)) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.copyFile(seedPath, targetPath);
  } catch {
    await fs.writeFile(targetPath, fallbackContent, "utf8");
  }
}

async function copySeedDirectoryIfMissing(seedPath, targetPath) {
  if (await pathExists(targetPath)) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.cp(seedPath, targetPath, { recursive: true });
  } catch {
    await fs.mkdir(targetPath, { recursive: true });
  }
}

async function ensureRuntimeStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await copySeedFileIfMissing(SEED_DATA_FILE, DATA_FILE, "[]\n");
  await copySeedFileIfMissing(SEED_USERS_FILE, USERS_FILE, "[]\n");
  await copySeedFileIfMissing(SEED_NOTIFICATIONS_FILE, NOTIFICATIONS_FILE, "[]\n");
  await copySeedFileIfMissing(SEED_SCHEDULE_FILE, SCHEDULE_FILE, JSON.stringify({
    courseTypes: [],
    classes: [],
    teachers: [],
    rooms: [],
    teacherAvailability: [],
    studentAvailability: [],
    lessons: []
  }, null, 2) + "\n");
  await copySeedDirectoryIfMissing(SEED_KNOWLEDGE_DIR, KNOWLEDGE_DIR);
}

async function readStudents() {
  const raw = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeStudents(students) {
  await fs.writeFile(DATA_FILE, `${JSON.stringify(students, null, 2)}\n`, "utf8");
}

async function readUsers() {
  try {
    const raw = await fs.readFile(USERS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`, "utf8");
}

async function readNotifications() {
  try {
    const raw = await fs.readFile(NOTIFICATIONS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeNotifications(notifications) {
  await fs.writeFile(NOTIFICATIONS_FILE, `${JSON.stringify(notifications, null, 2)}\n`, "utf8");
}

async function readTeachersKnowledge(fallback = []) {
  try {
    const raw = await fs.readFile(TEACHERS_KB_FILE, "utf8");
    const teachers = JSON.parse(raw);
    return Array.isArray(teachers) ? teachers : fallback;
  } catch {
    return fallback;
  }
}

async function writeTeachersKnowledge(teachers) {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  await fs.writeFile(TEACHERS_KB_FILE, JSON.stringify(teachers, null, 2) + "\n", "utf8");
}


async function readStudentsKnowledge(fallback = []) {
  try {
    const raw = await fs.readFile(STUDENTS_KB_FILE, "utf8");
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : fallback;
  } catch {
    return fallback;
  }
}

async function writeStudentsKnowledge(records) {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  await fs.writeFile(STUDENTS_KB_FILE, JSON.stringify(records, null, 2) + "\n", "utf8");
}

function normalizeStudentName(name) {
  return String(name || "").trim().toLowerCase();
}

function studentKnowledgeFromStudent(student) {
  return {
    id: student.id,
    name: student.name,
    age: student.age || "",
    teacher: student.teacher || "",
    course: student.course || "",
    paidAt: student.paidAt || "",
    paidAmount: Number(student.paidAmount ?? student.renewalValue ?? 0),
    prepaidLessons: Number(student.prepaidLessons ?? student.lessonsLeft ?? 0),
    lessonsLeft: Number(student.lessonsLeft ?? student.prepaidLessons ?? 0),
    daysToEnd: Number(student.daysToEnd ?? 30),
    renewalValue: Number(student.renewalValue ?? student.paidAmount ?? 0),
    lastContact: student.lastContact || "\u672a\u8054\u7cfb",
    status: student.status || "\u5f85\u8ddf\u8fdb",
    proof: Array.isArray(student.proof) ? student.proof : [],
    evidence: Array.isArray(student.evidence) ? student.evidence : [],
    updatedAt: new Date().toISOString()
  };
}

async function syncStudentKnowledge(student) {
  const records = await readStudentsKnowledge([]);
  const key = normalizeStudentName(student.name);
  const index = records.findIndex(item => normalizeStudentName(item.name) === key);
  const next = { ...(index >= 0 ? records[index] : {}), ...studentKnowledgeFromStudent(student) };
  if (index >= 0) records[index] = next; else records.unshift(next);
  await writeStudentsKnowledge(records);
  return next;
}

function normalizeEvidenceItems(body) {
  const items = [];
  for (let index = 1; index <= 3; index += 1) {
    const title = String(body[`proofTitle${index}`] || "").trim();
    const text = String(body[`proofText${index}`] || "").trim();
    if (title || text) {
      items.push({ type: "text", title: title || `\u6210\u957f\u8bc1\u636e${index}`, text, createdAt: new Date().toISOString() });
    }
  }
  if (Array.isArray(body.evidence)) items.push(...body.evidence);
  return items;
}

async function saveEvidenceImage(studentName, image) {
  if (!image || !image.dataUrl) return null;
  const match = String(image.dataUrl).match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) throw new Error("\u53ea\u652f\u6301 PNG\u3001JPG\u3001WEBP \u56fe\u7247");
  const buffer = Buffer.from(match[3], "base64");
  if (buffer.length > 1024 * 1024) throw new Error("\u56fe\u7247\u4e0d\u80fd\u8d85\u8fc7 1M");
  await fs.mkdir(STUDENT_ASSET_DIR, { recursive: true });
  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const safeName = String(studentName || "student").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  const fileName = `${safeName}-${Date.now()}.${ext}`;
  const relativePath = `knowledge_base/student_assets/${fileName}`;
  await fs.writeFile(path.join(STUDENT_ASSET_DIR, fileName), buffer);
  return { type: "image", title: image.title || "\u6210\u957f\u8bc1\u636e\u56fe\u7247", fileName, path: relativePath, size: buffer.length, createdAt: new Date().toISOString() };
}

async function buildEvidence(body, studentName) {
  const evidence = normalizeEvidenceItems(body);
  const image = await saveEvidenceImage(studentName, body.evidenceImage);
  if (image) evidence.push(image);
  return evidence;
}
async function readSchedule() {
  try {
    const raw = await fs.readFile(SCHEDULE_FILE, "utf8");
    const schedule = JSON.parse(raw);
    const teachers = await readTeachersKnowledge(schedule.teachers || []);
    return {
      courseTypes: schedule.courseTypes || schedule.courses || [],
      classes: schedule.classes || [],
      teachers,
      rooms: schedule.rooms || [],
      teacherAvailability: schedule.teacherAvailability || [],
      studentAvailability: schedule.studentAvailability || [],
      lessons: schedule.lessons || []
    };
  } catch {
    const teachers = await readTeachersKnowledge([]);
    return { courseTypes: [], classes: [], teachers, rooms: [], teacherAvailability: [], studentAvailability: [], lessons: [] };
  }
}

async function writeSchedule(schedule) {
  await writeTeachersKnowledge(schedule.teachers || []);
  await fs.writeFile(SCHEDULE_FILE, JSON.stringify(schedule, null, 2) + "\n", "utf8");
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
  if (score >= 72) return { text: "\u9ad8\u98ce\u9669", className: "risk-high" };
  if (score >= 50) return { text: "\u4e2d\u98ce\u9669", className: "risk-mid" };
  return { text: "\u4f4e\u98ce\u9669", className: "risk-low" };
}

function getReasons(student) {
  const reasons = [];
  if (student.daysToEnd <= 14) reasons.push(`\u8ddd\u79bb\u8bfe\u5305\u7ed3\u675f\u8fd8\u6709 ${student.daysToEnd} \u5929\uff0c\u9700\u8981\u63d0\u524d\u8fdb\u5165\u7eed\u8d39\u6c9f\u901a\u3002`);
  if (student.lessonsLeft <= 3) reasons.push(`\u5269\u4f59\u8bfe\u65f6\u4ec5 ${student.lessonsLeft} \u8282\uff0c\u5df2\u63a5\u8fd1\u8bfe\u5305\u672b\u7aef\u3002`);
  if (student.absentRate >= 25) reasons.push(`\u8fd1\u6708\u7f3a\u52e4\u7387 ${student.absentRate}%\uff0c\u9700\u5173\u6ce8\u5b66\u4e60\u7a33\u5b9a\u6027\u3002`);
  if (student.parentReplies <= 1) reasons.push("\u5bb6\u957f\u8fd1\u671f\u4e92\u52a8\u504f\u5c11\uff0c\u5efa\u8bae\u8865\u5145\u6210\u957f\u8bc1\u636e\u540e\u56de\u8bbf\u3002");
  if (student.homeworkMissed >= 2) reasons.push(`\u4f5c\u4e1a\u7f3a\u4ea4 ${student.homeworkMissed} \u6b21\uff0c\u53ef\u80fd\u5f71\u54cd\u5bb6\u957f\u5bf9\u6548\u679c\u7684\u611f\u77e5\u3002`);
  if (!reasons.length) reasons.push("\u5f53\u524d\u7eed\u8d39\u98ce\u9669\u8f83\u4f4e\uff0c\u4fdd\u6301\u5e38\u89c4\u5b66\u60c5\u7ef4\u62a4\u3002");
  return reasons;
}

function getNextAction(student, score) {
  if (score >= 72) {
    return `\u5efa\u8bae ${student.teacher} \u548c\u8fd0\u8425\u5728 24 \u5c0f\u65f6\u5185\u5b8c\u6210\u8054\u5408\u56de\u8bbf\uff0c\u5148\u8865\u5145\u6210\u957f\u8bc1\u636e\uff0c\u518d\u63d0\u51fa\u7eed\u8d39\u65b9\u6848\u3002`;
  }
  if (student.daysToEnd <= 14) {
    return "\u672c\u5468\u5b89\u6392\u4e00\u6b21\u5b66\u60c5\u56de\u8bbf\uff0c\u540c\u6b65\u786e\u8ba4\u4e0b\u9636\u6bb5\u8bfe\u7a0b\u76ee\u6807\u3002";
  }
  return "\u7ee7\u7eed\u7ef4\u62a4\u5b66\u60c5\u8bb0\u5f55\uff0c\u6bcf\u5468\u8865\u5145\u4e00\u6b21\u6210\u957f\u8bc1\u636e\u3002";
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
  const proof = student.proof.map(item => `${item[0]}\uff1a${item[1]}`).join("\n");
  if (tone === "direct") {
    return `${student.name}\u5bb6\u957f\u60a8\u597d\uff0c\u6211\u4eec\u6574\u7406\u4e86\u5b69\u5b50\u8fd1\u671f\u7684\u5b66\u4e60\u60c5\u51b5\uff1a\n${proof}\n\n\u76ee\u524d\u5269\u4f59 ${student.lessonsLeft} \u8282\u8bfe\uff0c\u5efa\u8bae\u63d0\u524d\u786e\u8ba4\u4e0b\u4e00\u9636\u6bb5\u5b66\u4e60\u5b89\u6392\u3002`;
  }
  if (tone === "premium") {
    return `${student.name}\u5bb6\u957f\u60a8\u597d\uff0c\u8fd9\u6bb5\u65f6\u95f4\u5b69\u5b50\u5df2\u7ecf\u8fdb\u5165\u66f4\u9700\u8981\u7cfb\u7edf\u6253\u78e8\u7684\u9636\u6bb5\u3002\n\n\u6211\u4eec\u6574\u7406\u4e86\u51e0\u70b9\u53d8\u5316\uff1a\n${proof}\n\n\u63a5\u4e0b\u6765\u53ef\u4ee5\u4e3a\u5b69\u5b50\u8bbe\u8ba1\u66f4\u5b8c\u6574\u7684\u9636\u6bb5\u76ee\u6807\uff0c\u5efa\u8bae\u9884\u7559\u4e0b\u4e00\u671f\u540d\u989d\u5e76\u5b89\u6392\u4e00\u6b21\u89c4\u5212\u6c9f\u901a\u3002`;
  }
  return `${student.name}\u5bb6\u957f\u60a8\u597d\uff0c\u548c\u60a8\u540c\u6b65\u4e00\u4e0b\u5b69\u5b50\u8fd1\u671f\u7684\u5b66\u4e60\u60c5\u51b5\uff1a\n\n${proof}\n\n\u76ee\u524d\u8fd8\u6709 ${student.lessonsLeft} \u8282\u8bfe\uff0c\u8ddd\u79bb\u8bfe\u5305\u7ed3\u675f\u7ea6 ${student.daysToEnd} \u5929\u3002\u6211\u4eec\u5efa\u8bae\u63d0\u524d\u89c4\u5212\u4e0b\u4e00\u9636\u6bb5\u7684\u5b66\u4e60\u76ee\u6807\uff0c\u8ba9\u8bfe\u7a0b\u8854\u63a5\u66f4\u987a\u3002`;
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

function renderTemplate(template, payload) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => payload[key] ?? "");
}

function createNotificationRecord(notifications, payload) {
  const nextId = notifications.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  const notification = {
    id: nextId,
    title: payload.title,
    content: payload.content,
    type: payload.type || "system",
    targetRole: payload.targetRole || "all",
    status: "unread",
    createdAt: new Date().toISOString(),
    readAt: null
  };
  notifications.unshift(notification);
  return notification;
}

async function sendWechatWorkMessage(content) {
  if (!process.env.WECHAT_WORK_BOT_URL) return { skipped: true };

  const response = await fetch(process.env.WECHAT_WORK_BOT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content }
    })
  });

  return { ok: response.ok, status: response.status };
}

async function createHighRiskNotifications(students) {
  const notifications = await readNotifications();
  const highRiskStudents = students.map(enrichStudent).filter(student => student.riskScore >= 72);
  const created = [];

  for (const student of highRiskStudents) {
    const duplicate = notifications.some(item =>
      item.type === "student.renewal_risk_high" &&
      item.studentId === student.id &&
      item.status === "unread"
    );
    if (duplicate) continue;

    const content = renderTemplate(
      "{{studentName}} \u5269\u4f59 {{lessonsLeft}} \u8282\u8bfe\uff0c\u98ce\u9669\u5206 {{riskScore}}\u3002{{nextAction}}",
      {
        studentName: student.name,
        lessonsLeft: student.lessonsLeft,
        riskScore: student.riskScore,
        nextAction: student.nextAction
      }
    );

    const notification = createNotificationRecord(notifications, {
      title: `\u9ad8\u98ce\u9669\u7eed\u8d39\u63d0\u9192\uff1a${student.name}`,
      content,
      type: "student.renewal_risk_high",
      targetRole: "\u8fd0\u8425"
    });
    notification.studentId = student.id;
    created.push(notification);
  }

  await writeNotifications(notifications);

  if (created.length) {
    await sendWechatWorkMessage(`\u7eed\u8d39\u98ce\u9669\u63d0\u9192\uff1a\u4eca\u65e5\u65b0\u589e ${created.length} \u4f4d\u9ad8\u98ce\u9669\u5b66\u5458\u5f85\u8ddf\u8fdb\u3002`);
  }

  return created;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function evidenceToProof(evidence) {
  const textEvidence = (Array.isArray(evidence) ? evidence : []).filter(item => item.type !== "image");
  if (!textEvidence.length) return [["\u8bfe\u5802\u8868\u73b0", "\u5df2\u5f55\u5165\u57fa\u7840\u4fe1\u606f\uff0c\u540e\u7eed\u53ef\u7ee7\u7eed\u8865\u5145\u4f5c\u54c1\u3001\u7ec3\u4e60\u6216\u6d4b\u8bc4\u8bb0\u5f55\u3002"]];
  return textEvidence.map(item => [item.title || "\u6210\u957f\u8bc1\u636e", item.text || item.path || "\u5df2\u4e0a\u4f20\u8bc1\u636e"]);
}

async function createStudent(body, students) {
  const name = String(body.name || "").trim();
  if (!name) return { error: "\u5b66\u5458\u59d3\u540d\u4e0d\u80fd\u4e3a\u7a7a" };
  const existing = students.find(student => normalizeStudentName(student.name) === normalizeStudentName(name));
  const evidence = await buildEvidence(body, name);
  const previousEvidence = existing?.evidence || [];
  const mergedEvidence = [...previousEvidence, ...evidence];
  const student = existing || { id: students.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1 };
  student.name = name;
  student.age = String(body.age || student.age || "").trim();
  student.course = String(body.course || student.course || "\u5f85\u8bbe\u7f6e\u8bfe\u7a0b").trim();
  student.teacher = String(body.teacher || student.teacher || "\u5f85\u5206\u914d\u8001\u5e08").trim();
  student.paidAt = String(body.paidAt || student.paidAt || "").trim();
  student.paidAmount = toNumber(body.paidAmount, toNumber(student.paidAmount, 0));
  student.prepaidLessons = toNumber(body.prepaidLessons, toNumber(student.prepaidLessons, toNumber(student.lessonsLeft, 0)));
  student.lessonsLeft = toNumber(body.lessonsLeft, student.prepaidLessons);
  student.daysToEnd = toNumber(body.daysToEnd, toNumber(student.daysToEnd, 30));
  student.absentRate = toNumber(body.absentRate, toNumber(student.absentRate, 0));
  student.parentReplies = toNumber(body.parentReplies, toNumber(student.parentReplies, 0));
  student.homeworkMissed = toNumber(body.homeworkMissed, toNumber(student.homeworkMissed, 0));
  student.renewalValue = toNumber(body.renewalValue, student.paidAmount);
  student.lastContact = String(body.lastContact || student.lastContact || "\u672a\u8054\u7cfb").trim();
  student.status = existing?.status || "\u5f85\u8ddf\u8fdb";
  student.evidence = mergedEvidence;
  student.proof = evidenceToProof(mergedEvidence);
  student.updatedAt = new Date().toISOString();
  return { student, isUpdate: Boolean(existing) };
}

function dateRangeOverlaps(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(startB) < new Date(endA);
}

function getStudentNames(students, studentIds) {
  return studentIds
    .map(id => students.find(student => student.id === Number(id))?.name)
    .filter(Boolean)
    .join("\u3001");
}

function enrichLesson(lesson, schedule, students) {
  const teacher = schedule.teachers.find(item => item.id === Number(lesson.teacherId));
  const room = schedule.rooms.find(item => item.id === Number(lesson.roomId));
  const course = (schedule.courseTypes || schedule.courses || []).find(item => item.id === Number(lesson.courseId));
  return {
    ...lesson,
    teacherName: teacher?.name || "\u672a\u5206\u914d\u8001\u5e08",
    roomName: room?.name || "\u672a\u5206\u914d\u6559\u5ba4",
    courseName: course?.name || "\u672a\u8bbe\u7f6e\u8bfe\u7a0b",
    studentNames: getStudentNames(students, lesson.studentIds || [])
  };
}


function detectLessonConflicts(candidate, schedule) {
  const conflicts = [];
  const activeLessons = schedule.lessons.filter(lesson => lesson.status !== "cancelled" && lesson.id !== candidate.id);
  const room = schedule.rooms.find(item => item.id === Number(candidate.roomId));
  const course = (schedule.courseTypes || schedule.courses || []).find(item => item.id === Number(candidate.courseId));
  const teacher = schedule.teachers.find(item => item.id === Number(candidate.teacherId));
  const studentIds = (candidate.studentIds || []).map(Number);

  for (const lesson of activeLessons) {
    if (!dateRangeOverlaps(candidate.startTime, candidate.endTime, lesson.startTime, lesson.endTime)) continue;
    if (Number(lesson.teacherId) === Number(candidate.teacherId)) conflicts.push("\u8001\u5e08\u540c\u4e00\u65f6\u95f4\u5df2\u6709\u8bfe");
    if (Number(lesson.roomId) === Number(candidate.roomId)) conflicts.push("\u6559\u5ba4\u540c\u4e00\u65f6\u95f4\u5df2\u88ab\u5360\u7528");
    if ((lesson.studentIds || []).some(id => studentIds.includes(Number(id)))) conflicts.push("\u5b66\u5458\u540c\u4e00\u65f6\u95f4\u5df2\u6709\u8bfe");
  }

  if (room && studentIds.length > room.capacity) conflicts.push(`\u6559\u5ba4\u5bb9\u91cf\u4e0d\u8db3\uff0c\u6700\u591a ${room.capacity} \u4eba`);
  if (room && course && !roomFitsCourse(room, course)) conflicts.push("\u8bfe\u7a0b\u7c7b\u578b\u4e0e\u6559\u5ba4\u4e0d\u5339\u914d");
  if (teacher && course && Array.isArray(teacher.courseTypeIds) && teacher.courseTypeIds.length && !teacher.courseTypeIds.map(Number).includes(Number(course.id))) conflicts.push("\u8001\u5e08\u672a\u7ed1\u5b9a\u8be5\u8bfe\u7a0b\u7c7b\u578b");

  return [...new Set(conflicts)];
}

function createLesson(body, schedule) {
  const course = (schedule.courseTypes || schedule.courses || []).find(item => item.id === Number(body.courseId));
  const startTime = String(body.startTime || "");
  const endTime = body.endTime
    ? String(body.endTime)
    : new Date(new Date(startTime).getTime() + (course?.durationMinutes || 60) * 60_000).toISOString();

  if (!body.courseId || !body.teacherId || !body.roomId || !startTime) return { error: "\u8bfe\u7a0b\u3001\u8001\u5e08\u3001\u6559\u5ba4\u548c\u4e0a\u8bfe\u65f6\u95f4\u4e3a\u5fc5\u586b\u9879" };

  const studentIds = Array.isArray(body.studentIds)
    ? body.studentIds.map(Number).filter(Boolean)
    : String(body.studentIds || "").split(",").map(item => Number(item.trim())).filter(Boolean);

  const lesson = {
    id: nextId(schedule.lessons),
    courseId: Number(body.courseId),
    teacherId: Number(body.teacherId),
    roomId: Number(body.roomId),
    studentIds,
    startTime,
    endTime,
    status: "scheduled",
    createdAt: new Date().toISOString()
  };

  return { lesson, conflicts: detectLessonConflicts(lesson, schedule) };
}


const PERIOD_RULES = {
  morning: { name: "\u4e0a\u5348", startTime: "08:30", endTime: "12:00", firstLessonIndex: 1 },
  afternoon: { name: "\u4e0b\u5348", startTime: "14:00", endTime: "17:30", firstLessonIndex: 3 },
  evening: { name: "\u665a\u4e0a", startTime: "18:30", endTime: "20:30", firstLessonIndex: 5 }
};

function dayOfWeekFromDate(dateText) {
  const day = new Date(String(dateText) + "T00:00:00").getDay();
  return day || 7;
}

function dateTimeIso(dateText, time) {
  return new Date(String(dateText) + "T" + String(time) + ":00").toISOString();
}

function lessonIndexForSlot(slot, startTime, durationMinutes) {
  const period = PERIOD_RULES[slot.period] || null;
  if (!period) return null;
  return period.firstLessonIndex + Math.floor((minutesOf(startTime) - minutesOf(period.startTime)) / Math.max(1, durationMinutes));
}

function expandDatePeriods(dates, periods) {
  const selectedDates = Array.isArray(dates) ? dates : [];
  const selectedPeriods = Array.isArray(periods) ? periods : [];
  const slots = [];
  for (const date of selectedDates) {
    for (const periodKey of selectedPeriods) {
      const period = PERIOD_RULES[periodKey];
      if (!period) continue;
      slots.push({
        date,
        dayOfWeek: dayOfWeekFromDate(date),
        period: periodKey,
        periodName: period.name,
        startTime: period.startTime,
        endTime: period.endTime
      });
    }
  }
  return slots;
}

function normalizeAvailabilitySlots(slots) {
  return (Array.isArray(slots) ? slots : [])
    .map(slot => {
      const period = PERIOD_RULES[slot.period] || null;
      const date = String(slot.date || "").trim();
      const dayOfWeek = Number(slot.dayOfWeek || (date ? dayOfWeekFromDate(date) : 0));
      const startTime = String(slot.startTime || period?.startTime || "").trim();
      const endTime = String(slot.endTime || period?.endTime || "").trim();

      if (!dayOfWeek || !startTime || !endTime) return null;

      return {
        ...(date ? { date } : {}),
        dayOfWeek,
        period: slot.period || "custom",
        periodName: slot.periodName || period?.name || "\u81ea\u5b9a\u4e49",
        startTime,
        endTime
      };
    })
    .filter(Boolean);
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
}

function minutesOf(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function timeWindowContains(outer, start, durationMinutes) {
  const startMinutes = minutesOf(start);
  return startMinutes >= minutesOf(outer.startTime) && startMinutes + durationMinutes <= minutesOf(outer.endTime);
}

function addMinutesToTime(time, durationMinutes) {
  const total = minutesOf(time) + durationMinutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function nextDateForDay(dayOfWeek, time) {
  const now = new Date();
  const current = now.getDay() || 7;
  let diff = Number(dayOfWeek) - current;
  if (diff < 0) diff += 7;
  const date = new Date(now);
  date.setDate(now.getDate() + diff);
  const [hours, minutes] = String(time).split(":").map(Number);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function courseById(schedule, id) {
  return (schedule.courseTypes || schedule.courses || []).find(item => item.id === Number(id));
}

function roomFitsCourse(room, course) {
  if (!room || !course) return false;
  if (room.roomType && course.roomTypes) return course.roomTypes.includes(room.roomType);
  if (room.courseTypes) return room.courseTypes.includes(course.name);
  return true;
}

function teacherFitsCourse(teacher, course) {
  if (!teacher || !course) return false;
  if (teacher.courseTypeIds) return teacher.courseTypeIds.includes(Number(course.id));
  if (teacher.courses) return teacher.courses.includes(course.name);
  return true;
}

function enrichClass(classItem, schedule, students) {
  const course = courseById(schedule, classItem.courseTypeId);
  const teacher = schedule.teachers.find(item => item.id === Number(classItem.teacherId));
  const hasLesson = schedule.lessons.some(lesson => Number(lesson.classId) === Number(classItem.id));
  return {
    ...classItem,
    courseName: course?.name || "\u672a\u8bbe\u7f6e\u8bfe\u7a0b",
    teacherName: teacher?.name || "\u672a\u5206\u914d\u8001\u5e08",
    status: hasLesson ? "\u5df2\u6392\u8bfe" : "\u5f85\u6392\u8bfe",
    studentNames: getStudentNames(students, classItem.studentIds || [])
  };
}

function buildScheduleRecommendation(classItem, schedule, students) {
  const course = courseById(schedule, classItem.courseTypeId);
  const teacher = schedule.teachers.find(item => item.id === Number(classItem.teacherId));
  if (!classItem || !course || !teacher) return [];

  const duration = Number(course.durationMinutes || 60);
  const teacherSlots = schedule.teacherAvailability.filter(slot => Number(slot.teacherId) === Number(classItem.teacherId));
  const rooms = schedule.rooms.filter(room => roomFitsCourse(room, course) && room.capacity >= (classItem.studentIds || []).length);
  const recommendations = [];

  for (const teacherSlot of teacherSlots) {
    for (const room of rooms) {
      let startMinutes = minutesOf(teacherSlot.startTime);
      const endLimit = minutesOf(teacherSlot.endTime) - duration;

      while (startMinutes <= endLimit) {
        const startTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
        const endTime = addMinutesToTime(startTime, duration);
        const availableStudents = (classItem.studentIds || []).filter(studentId =>
          schedule.studentAvailability.some(slot =>
            Number(slot.studentId) === Number(studentId) &&
            Number(slot.dayOfWeek) === Number(teacherSlot.dayOfWeek) &&
            timeWindowContains(slot, startTime, duration)
          )
        );
        const unavailableStudents = (classItem.studentIds || []).filter(studentId => !availableStudents.includes(studentId));
        const lessonStart = teacherSlot.date ? dateTimeIso(teacherSlot.date, startTime) : nextDateForDay(teacherSlot.dayOfWeek, startTime).toISOString();
        const lessonEnd = teacherSlot.date ? dateTimeIso(teacherSlot.date, endTime) : nextDateForDay(teacherSlot.dayOfWeek, endTime).toISOString();
        const candidate = {
          id: recommendations.length + 1,
          classId: classItem.id,
          courseId: course.id,
          teacherId: teacher.id,
          roomId: room.id,
          studentIds: availableStudents,
          startTime: lessonStart,
          endTime: lessonEnd
        };
        const conflicts = detectLessonConflicts(candidate, schedule);

        recommendations.push({
          id: recommendations.length + 1,
          date: teacherSlot.date || "",
          dayOfWeek: teacherSlot.dayOfWeek,
          period: teacherSlot.period || "custom",
          periodName: teacherSlot.periodName || (PERIOD_RULES[teacherSlot.period]?.name || "\u81ea\u5b9a\u4e49"),
          lessonIndex: lessonIndexForSlot(teacherSlot, startTime, duration),
          startTime,
          endTime,
          roomId: room.id,
          roomName: room.name,
          teacherName: teacher.name,
          courseName: course.name,
          availableCount: availableStudents.length,
          totalCount: (classItem.studentIds || []).length,
          availableStudentIds: availableStudents,
          unavailableStudentNames: getStudentNames(students, unavailableStudents),
          conflicts
        });

        startMinutes += 30;
      }
    }
  }

  return recommendations
    .sort((a, b) => b.availableCount - a.availableCount || a.conflicts.length - b.conflicts.length)
    .slice(0, 8);
}

function createLessonFromRecommendation(classItem, recommendation, schedule) {
  const course = courseById(schedule, classItem.courseTypeId);
  const startDate = recommendation.date ? new Date(String(recommendation.date) + "T" + String(recommendation.startTime) + ":00") : nextDateForDay(recommendation.dayOfWeek, recommendation.startTime);
  const endDate = recommendation.date ? new Date(String(recommendation.date) + "T" + String(recommendation.endTime) + ":00") : nextDateForDay(recommendation.dayOfWeek, recommendation.endTime);
  return {
    id: nextId(schedule.lessons),
    classId: classItem.id,
    courseId: course.id,
    teacherId: classItem.teacherId,
    roomId: recommendation.roomId,
    studentIds: recommendation.availableStudentIds,
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    date: recommendation.date || "",
    periodName: recommendation.periodName || "",
    lessonIndex: recommendation.lessonIndex || null,
    status: "scheduled",
    createdAt: new Date().toISOString()
  };
}

function enrichLesson(lesson, schedule, students) {
  const teacher = schedule.teachers.find(item => item.id === Number(lesson.teacherId));
  const room = schedule.rooms.find(item => item.id === Number(lesson.roomId));
  const course = courseById(schedule, lesson.courseId);
  const classItem = schedule.classes.find(item => item.id === Number(lesson.classId));
  return {
    ...lesson,
    teacherName: teacher?.name || "\u672a\u5206\u914d\u8001\u5e08",
    roomName: room?.name || "\u672a\u5206\u914d\u6559\u5ba4",
    courseName: course?.name || "\u672a\u8bbe\u7f6e\u8bfe\u7a0b",
    className: classItem?.name || "",
    studentNames: getStudentNames(students, lesson.studentIds || [])
  };
}

function enrichTeacher(teacher, schedule) {
  const courseMap = Object.fromEntries(schedule.courseTypes.map(course => [course.id, course.name]));
  const availability = schedule.teacherAvailability
    .filter(slot => Number(slot.teacherId) === Number(teacher.id))
    .map(slot => ({
      date: slot.date || "",
      dayOfWeek: slot.dayOfWeek,
      period: slot.period || "custom",
      periodName: slot.periodName || (PERIOD_RULES[slot.period]?.name || "\u81ea\u5b9a\u4e49"),
      startTime: slot.startTime,
      endTime: slot.endTime
    }));
  return {
    ...teacher,
    courseNames: (teacher.courseTypeIds || []).map(id => courseMap[Number(id)]).filter(Boolean).join("\u3001"),
    availableTimes: availability.length ? availability : (teacher.availableTimes || [])
  };
}

function createTeacherRecord(body, schedule) {
  const name = String(body.name || "").trim();
  if (!name) return { error: "\u6559\u5e08\u59d3\u540d\u4e0d\u80fd\u4e3a\u7a7a" };
  const courseTypeIds = Array.isArray(body.courseTypeIds)
    ? body.courseTypeIds.map(Number).filter(Boolean)
    : String(body.courseTypeIds || "").split(",").map(Number).filter(Boolean);
  const dateSlots = expandDatePeriods(body.availableDates, body.periods);
  const availableTimes = normalizeAvailabilitySlots(dateSlots.length ? dateSlots : body.availableTimes);
  const teacher = {
    id: nextId(schedule.teachers),
    name,
    phone: String(body.phone || "").trim(),
    employmentType: ["\u5168\u804c", "\u517c\u804c"].includes(body.employmentType) ? body.employmentType : "\u5168\u804c",
    courseTypeIds,
    maxDailyLessons: toNumber(body.maxDailyLessons, 6),
    notes: String(body.notes || "").trim(),
    availableDates: Array.isArray(body.availableDates) ? body.availableDates : [],
    periods: Array.isArray(body.periods) ? body.periods : [],
    availableTimes,
    source: "\u540e\u53f0\u6559\u5e08\u5f55\u5165",
    createdAt: new Date().toISOString()
  };
  return { teacher };
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
  const filePath = path.resolve(KNOWLEDGE_DIR, path.basename(fileName));
  if (!filePath.startsWith(KNOWLEDGE_DIR)) return null;
  return filePath;
}

function isSupportedKnowledgeFile(fileName) {
  return [".txt", ".md", ".json", ".csv"].includes(path.extname(fileName).toLowerCase());
}

function safeKnowledgeFileName(fileName) {
  const baseName = path.basename(String(fileName || "").trim());
  const fallback = `upload-${Date.now()}.txt`;
  return baseName || fallback;
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

function matchField(content, keys, fallback = "") {
  for (const key of keys) {
    const pattern = new RegExp(`${key}\\s*[:\\uff1a]\\s*([^\\n\\r,\\uff0c]+)`, "i");
    const match = content.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return fallback;
}

function matchNumberField(content, keys, fallback = 0) {
  const text = matchField(content, keys, "");
  return text ? toNumber(text.replace(/[^\d.]/g, ""), fallback) : fallback;
}

function parseProofFromText(content) {
  const proof = [];
  const keys = ["\u6210\u957f\u8bc1\u636e", "\u8bc1\u636e", "\u8868\u73b0", "\u4f5c\u54c1", "\u4f5c\u4e1a"];
  for (const line of content.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    const text = matchField(line, keys, "");
    if (text) proof.push(["\u6210\u957f\u8bc1\u636e", text]);
  }
  if (proof.length) return proof.slice(0, 3);
  const summary = matchField(content, ["\u6458\u8981", "\u60c5\u51b5", "\u5907\u6ce8"], "");
  return summary ? [["\u6210\u957f\u8bc1\u636e", summary]] : [["\u6210\u957f\u8bc1\u636e", "\u5df2\u4ece\u77e5\u8bc6\u5e93\u5b8c\u6210\u57fa\u7840\u4fe1\u606f\u91c7\u96c6\uff0c\u53ef\u540e\u7eed\u8865\u5145\u4f5c\u54c1\u6216\u8bfe\u5802\u8bb0\u5f55\u3002"]];
}

function extractStudentFromText(content, source) {
  return normalizeCandidate({
    source,
    name: matchField(content, ["\u59d3\u540d", "\u5b66\u5458", "\u5b66\u751f"]),
    course: matchField(content, ["\u8bfe\u7a0b", "\u62a5\u540d\u8bfe\u7a0b", "\u5728\u8bfb\u8bfe\u7a0b"]),
    teacher: matchField(content, ["\u8001\u5e08", "\u6559\u5e08", "\u4e0a\u8bfe\u8001\u5e08", "\u6388\u8bfe\u8001\u5e08"]),
    lessonsLeft: matchNumberField(content, ["\u5269\u4f59\u8bfe\u65f6", "\u5269\u4f59\u8282\u6570", "\u5269\u4f59\u8bfe\u7a0b"], 4),
    daysToEnd: matchNumberField(content, ["\u5230\u671f\u5929\u6570", "\u9884\u8ba1\u8bfe\u6d88\u5929\u6570", "\u5269\u4f59\u5929\u6570"], 14),
    absentRate: matchNumberField(content, ["\u7f3a\u52e4\u7387", "\u8fd1\u6708\u7f3a\u52e4\u7387"], 0),
    parentReplies: matchNumberField(content, ["\u5bb6\u957f\u56de\u590d", "\u56de\u590d\u6b21\u6570", "\u6c9f\u901a\u6b21\u6570"], 1),
    homeworkMissed: matchNumberField(content, ["\u4f5c\u4e1a\u7f3a\u4ea4", "\u7f3a\u4ea4\u6b21\u6570"], 0),
    renewalValue: matchNumberField(content, ["\u7eed\u8d39\u91d1\u989d", "\u7f34\u8d39\u91d1\u989d", "\u91d1\u989d"], 3980),
    lastContact: matchField(content, ["\u6700\u8fd1\u8054\u7cfb", "\u4e0a\u6b21\u8054\u7cfb", "\u8054\u7cfb\u65f6\u95f4"], "\u672a\u8054\u7cfb"),
    proof: parseProofFromText(content)
  });
}

function parseCsv(content, source) {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(item => item.trim());
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",").map(item => item.trim());
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
    return normalizeCandidate({
      source: `${source}#${index + 1}`,
      name: row.name || row["\u59d3\u540d"] || row["\u5b66\u5458"],
      course: row.course || row["\u8bfe\u7a0b"],
      teacher: row.teacher || row["\u8001\u5e08"] || row["\u6559\u5e08"],
      lessonsLeft: toNumber(row.lessonsLeft || row["\u5269\u4f59\u8bfe\u65f6"], 4),
      daysToEnd: toNumber(row.daysToEnd || row["\u5230\u671f\u5929\u6570"], 14),
      absentRate: toNumber(row.absentRate || row["\u7f3a\u52e4\u7387"], 0),
      parentReplies: toNumber(row.parentReplies || row["\u5bb6\u957f\u56de\u590d"], 1),
      homeworkMissed: toNumber(row.homeworkMissed || row["\u4f5c\u4e1a\u7f3a\u4ea4"], 0),
      renewalValue: toNumber(row.renewalValue || row["\u7eed\u8d39\u91d1\u989d"] || row["\u7f34\u8d39\u91d1\u989d"], 3980),
      lastContact: row.lastContact || row["\u6700\u8fd1\u8054\u7cfb"] || "\u672a\u8054\u7cfb",
      proof: [["\u6210\u957f\u8bc1\u636e", row.proof || row["\u6210\u957f\u8bc1\u636e"] || "\u6765\u81ea CSV \u77e5\u8bc6\u5e93\u5bfc\u5165"]]
    });
  }).filter(item => item.name);
}

function normalizeCandidate(candidate) {
  return {
    source: candidate.source || "knowledge_base",
    name: String(candidate.name || "").trim(),
    course: String(candidate.course || "\u5f85\u8bbe\u7f6e\u8bfe\u7a0b").trim(),
    teacher: String(candidate.teacher || "\u5f85\u5206\u914d\u8001\u5e08").trim(),
    lessonsLeft: toNumber(candidate.lessonsLeft, 4),
    daysToEnd: toNumber(candidate.daysToEnd, 14),
    absentRate: toNumber(candidate.absentRate, 0),
    parentReplies: toNumber(candidate.parentReplies, 1),
    homeworkMissed: toNumber(candidate.homeworkMissed, 0),
    renewalValue: toNumber(candidate.renewalValue, 3980),
    lastContact: String(candidate.lastContact || "\u672a\u8054\u7cfb").trim(),
    proof: Array.isArray(candidate.proof) ? candidate.proof : [["\u6210\u957f\u8bc1\u636e", "\u5df2\u4ece\u77e5\u8bc6\u5e93\u91c7\u96c6"]]
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
    const users = await readUsers();
    const account = users.find(user => user.username === body.username && user.password === body.password);
    const fallbackAdmin = body.username === ADMIN_USER && body.password === ADMIN_PASS;

    if (account || fallbackAdmin) {
      const user = account
        ? { id: account.id, username: account.username, role: account.role }
        : { username: ADMIN_USER, role: "\u8d85\u7ea7\u7ba1\u7406\u5458" };
      setSession(res, user);
      sendJson(res, 200, { user });
      return;
    }
    sendJson(res, 401, { error: "\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    clearSession(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const role = String(body.role || "\u8fd0\u8425").trim();

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      sendJson(res, 400, { error: "\u8d26\u53f7\u9700\u4e3a 3-24 \u4f4d\u5b57\u6bcd\u3001\u6570\u5b57\u6216\u4e0b\u5212\u7ebf" });
      return;
    }

    if (password.length < 6) {
      sendJson(res, 400, { error: "\u5bc6\u7801\u81f3\u5c11 6 \u4f4d" });
      return;
    }

    const users = await readUsers();
    if (users.some(user => user.username === username)) {
      sendJson(res, 409, { error: "\u8d26\u53f7\u5df2\u5b58\u5728" });
      return;
    }

    const nextId = users.reduce((max, user) => Math.max(max, user.id || 0), 0) + 1;
    const account = {
      id: nextId,
      username,
      password,
      role: ["\u6821\u957f", "\u8001\u5e08", "\u8fd0\u8425"].includes(role) ? role : "\u8fd0\u8425",
      createdAt: new Date().toISOString()
    };
    users.push(account);
    await writeUsers(users);

    const user = { id: account.id, username: account.username, role: account.role };
    setSession(res, user);
    sendJson(res, 201, { user });
    return;
  }


  const user = currentUser(req);
  if (req.method === "GET" && url.pathname === "/api/session") {
    if (!user) return sendJson(res, 401, { error: "\u672a\u767b\u5f55" });
    sendJson(res, 200, { user });
    return;
  }

  if (!user) {
    sendJson(res, 401, { error: "\u672a\u767b\u5f55" });
    return;
  }

  const students = await readStudents();
  const schedule = await readSchedule();

  if (req.method === "GET" && url.pathname === "/api/teachers") {
    sendJson(res, 200, { teachers: schedule.teachers.map(teacher => enrichTeacher(teacher, schedule)) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teachers") {
    const body = await readBody(req);
    const result = createTeacherRecord(body, schedule);
    if (result.error) return sendJson(res, 400, { error: result.error });
    schedule.teachers.push(result.teacher);
    for (const slot of result.teacher.availableTimes || []) {
      schedule.teacherAvailability.push({
        id: nextId(schedule.teacherAvailability),
        teacherId: result.teacher.id,
        date: slot.date || "",
        dayOfWeek: slot.dayOfWeek,
        period: slot.period || "custom",
        periodName: slot.periodName || "\u81ea\u5b9a\u4e49",
        startTime: slot.startTime,
        endTime: slot.endTime
      });
    }
    await writeSchedule(schedule);
    sendJson(res, 201, { teacher: enrichTeacher(result.teacher, schedule) });
    return;
  }

  const teacherMatch = url.pathname.match(/^\/api\/teachers\/(\d+)$/);
  if (req.method === "DELETE" && teacherMatch) {
    const id = Number(teacherMatch[1]);
    if (schedule.classes.some(item => Number(item.teacherId) === id)) {
      return sendJson(res, 409, { error: "\u8be5\u6559\u5e08\u5df2\u88ab\u73ed\u7ea7\u4f7f\u7528\uff0c\u8bf7\u5148\u8c03\u6574\u73ed\u7ea7\u6388\u8bfe\u8001\u5e08" });
    }
    schedule.teachers = schedule.teachers.filter(item => Number(item.id) !== id);
    schedule.teacherAvailability = schedule.teacherAvailability.filter(item => Number(item.teacherId) !== id);
    await writeSchedule(schedule);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/schedule/meta") {
    sendJson(res, 200, {
      courseTypes: schedule.courseTypes,
      classes: schedule.classes.map(item => enrichClass(item, schedule, students)),
      teachers: schedule.teachers,
      rooms: schedule.rooms,
      courses: schedule.courseTypes,
      teacherAvailability: schedule.teacherAvailability,
      studentAvailability: schedule.studentAvailability,
      students: students.map(student => ({
        id: student.id,
        name: student.name,
        course: student.course,
        lessonsLeft: student.lessonsLeft
      }))
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/schedule/course-types") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "\u8bfe\u7a0b\u7c7b\u578b\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a" });
    const courseType = {
      id: nextId(schedule.courseTypes),
      name,
      category: String(body.category || "\u672a\u5206\u7c7b").trim(),
      durationMinutes: toNumber(body.durationMinutes, 60),
      defaultCapacity: toNumber(body.defaultCapacity, 10),
      roomTypes: String(body.roomTypes || "").split(",").map(item => item.trim()).filter(Boolean),
      enabled: true
    };
    schedule.courseTypes.push(courseType);
    await writeSchedule(schedule);
    sendJson(res, 201, { courseType });
    return;
  }

  const courseTypeMatch = url.pathname.match(/^\/api\/schedule\/course-types\/(\d+)$/);
  if (req.method === "DELETE" && courseTypeMatch) {
    const id = Number(courseTypeMatch[1]);
    schedule.courseTypes = schedule.courseTypes.filter(item => item.id !== id);
    schedule.classes = schedule.classes.filter(item => item.courseTypeId !== id);
    await writeSchedule(schedule);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/schedule/classes") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    if (!name || !body.courseTypeId || !body.teacherId) return sendJson(res, 400, { error: "\u73ed\u7ea7\u540d\u79f0\u3001\u8bfe\u7a0b\u7c7b\u578b\u548c\u8001\u5e08\u4e3a\u5fc5\u586b\u9879" });
    const classItem = {
      id: nextId(schedule.classes),
      name,
      courseTypeId: Number(body.courseTypeId),
      teacherId: Number(body.teacherId),
      studentIds: Array.isArray(body.studentIds) ? body.studentIds.map(Number).filter(Boolean) : [],
      capacity: toNumber(body.capacity, courseById(schedule, body.courseTypeId)?.defaultCapacity || 10),
      status: "\u5f85\u6392\u8bfe"
    };
    schedule.classes.push(classItem);
    await writeSchedule(schedule);
    sendJson(res, 201, { classItem: enrichClass(classItem, schedule, students) });
    return;
  }

  const classMatch = url.pathname.match(/^\/api\/schedule\/classes\/(\d+)$/);
  if (req.method === "DELETE" && classMatch) {
    const id = Number(classMatch[1]);
    schedule.classes = schedule.classes.filter(item => item.id !== id);
    schedule.lessons = schedule.lessons.filter(item => item.classId !== id);
    await writeSchedule(schedule);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/schedule/teacher-availability") {
    const body = await readBody(req);
    const slot = {
      id: nextId(schedule.teacherAvailability),
      teacherId: Number(body.teacherId),
      dayOfWeek: Number(body.dayOfWeek),
      startTime: String(body.startTime || ""),
      endTime: String(body.endTime || "")
    };
    if (!slot.teacherId || !slot.dayOfWeek || !slot.startTime || !slot.endTime) return sendJson(res, 400, { error: "\u8001\u5e08\u548c\u53ef\u6388\u8bfe\u65f6\u95f4\u4e3a\u5fc5\u586b\u9879" });
    schedule.teacherAvailability.push(slot);
    const teacher = schedule.teachers.find(item => Number(item.id) === slot.teacherId);
    if (teacher) {
      teacher.availableTimes = normalizeAvailabilitySlots([...(teacher.availableTimes || []), slot]);
      teacher.updatedAt = new Date().toISOString();
    }
    await writeSchedule(schedule);
    sendJson(res, 201, { slot });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/schedule/student-availability") {
    const body = await readBody(req);
    const slot = {
      id: nextId(schedule.studentAvailability),
      studentId: Number(body.studentId),
      dayOfWeek: Number(body.dayOfWeek),
      startTime: String(body.startTime || ""),
      endTime: String(body.endTime || "")
    };
    if (!slot.studentId || !slot.dayOfWeek || !slot.startTime || !slot.endTime) return sendJson(res, 400, { error: "\u5b66\u5458\u548c\u53ef\u4e0a\u8bfe\u65f6\u95f4\u4e3a\u5fc5\u586b\u9879" });
    schedule.studentAvailability.push(slot);
    await writeSchedule(schedule);
    sendJson(res, 201, { slot });
    return;
  }

  const recommendationMatch = url.pathname.match(/^\/api\/schedule\/classes\/(\d+)\/recommendations$/);
  if (req.method === "GET" && recommendationMatch) {
    const classItem = schedule.classes.find(item => item.id === Number(recommendationMatch[1]));
    if (!classItem) return sendJson(res, 404, { error: "Class not found" });
    sendJson(res, 200, { recommendations: buildScheduleRecommendation(classItem, schedule, students) });
    return;
  }

  const generateMatch = url.pathname.match(/^\/api\/schedule\/classes\/(\d+)\/generate$/);
  if (req.method === "POST" && generateMatch) {
    const body = await readBody(req);
    const classItem = schedule.classes.find(item => item.id === Number(generateMatch[1]));
    if (!classItem) return sendJson(res, 404, { error: "Class not found" });
    const recommendations = buildScheduleRecommendation(classItem, schedule, students);
    const recommendation = recommendations.find(item => item.id === Number(body.recommendationId)) || recommendations[0];
    if (!recommendation) return sendJson(res, 400, { error: "\u6682\u65e0\u53ef\u7528\u63a8\u8350\u6392\u8bfe" });
    if (recommendation.conflicts.length && !body.force) return sendJson(res, 409, { error: "\u5b58\u5728\u6392\u8bfe\u51b2\u7a81", conflicts: recommendation.conflicts });
    const lesson = createLessonFromRecommendation(classItem, recommendation, schedule);
    schedule.lessons.push(lesson);
    classItem.status = "\u5df2\u6392\u8bfe";
    await writeSchedule(schedule);
    sendJson(res, 201, { lesson: enrichLesson(lesson, schedule, students), classItem: enrichClass(classItem, schedule, students) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/schedule/lessons") {
    const lessons = schedule.lessons
      .map(lesson => enrichLesson(lesson, schedule, students))
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    sendJson(res, 200, { lessons });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/schedule/conflicts") {
    const body = await readBody(req);
    const result = createLesson(body, schedule);
    if (result.error) return sendJson(res, 400, { error: result.error });
    sendJson(res, 200, { conflicts: result.conflicts });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/schedule/lessons") {
    const body = await readBody(req);
    const result = createLesson(body, schedule);
    if (result.error) return sendJson(res, 400, { error: result.error });
    if (result.conflicts.length && !body.force) {
      sendJson(res, 409, { error: "\u5b58\u5728\u6392\u8bfe\u51b2\u7a81", conflicts: result.conflicts });
      return;
    }
    schedule.lessons.push(result.lesson);
    await writeSchedule(schedule);
    sendJson(res, 201, {
      lesson: enrichLesson(result.lesson, schedule, students),
      conflicts: result.conflicts
    });
    return;
  }

  const lessonCompleteMatch = url.pathname.match(/^\/api\/schedule\/lessons\/(\d+)\/complete$/);
  if (req.method === "POST" && lessonCompleteMatch) {
    const lesson = schedule.lessons.find(item => item.id === Number(lessonCompleteMatch[1]));
    if (!lesson) return sendJson(res, 404, { error: "Lesson not found" });
    if (lesson.status === "completed") return sendJson(res, 400, { error: "\u8be5\u8bfe\u8282\u5df2\u5b8c\u6210\u8bfe\u6d88" });

    const consumed = [];
    for (const studentId of lesson.studentIds || []) {
      const student = students.find(item => item.id === Number(studentId));
      if (!student) continue;
      student.lessonsLeft = Math.max(0, Number(student.lessonsLeft || 0) - 1);
      consumed.push({ studentId: student.id, studentName: student.name, lessonsLeft: student.lessonsLeft });
    }

    lesson.status = "completed";
    lesson.completedAt = new Date().toISOString();
    await writeStudents(students);
    for (const item of consumed) {
      const student = students.find(entry => entry.id === item.studentId);
      if (student) await syncStudentKnowledge(student);
    }
    await writeSchedule(schedule);
    sendJson(res, 200, {
      lesson: enrichLesson(lesson, schedule, students),
      consumed,
      students: students.map(enrichStudent).sort((a, b) => b.riskScore - a.riskScore),
      summary: makeSummary(students)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/notifications") {
    const notifications = await readNotifications();
    sendJson(res, 200, {
      notifications,
      unreadCount: notifications.filter(item => item.status === "unread").length
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/high-risk") {
    const created = await createHighRiskNotifications(students);
    const notifications = await readNotifications();
    sendJson(res, 201, {
      created,
      notifications,
      unreadCount: notifications.filter(item => item.status === "unread").length
    });
    return;
  }

  const notificationReadMatch = url.pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (req.method === "POST" && notificationReadMatch) {
    const notifications = await readNotifications();
    const notification = notifications.find(item => item.id === Number(notificationReadMatch[1]));
    if (!notification) return sendJson(res, 404, { error: "Notification not found" });
    notification.status = "read";
    notification.readAt = new Date().toISOString();
    await writeNotifications(notifications);
    sendJson(res, 200, {
      notification,
      unreadCount: notifications.filter(item => item.status === "unread").length
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/read-all") {
    const notifications = await readNotifications();
    const now = new Date().toISOString();
    notifications.forEach(item => {
      if (item.status === "unread") {
        item.status = "read";
        item.readAt = now;
      }
    });
    await writeNotifications(notifications);
    sendJson(res, 200, { notifications, unreadCount: 0 });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/knowledge/files") {
    sendJson(res, 200, { files: await listKnowledgeFiles() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge/upload") {
    const body = await readBody(req);
    const fileName = safeKnowledgeFileName(body.fileName);
    const content = String(body.content || "");

    if (!isSupportedKnowledgeFile(fileName)) {
      sendJson(res, 400, { error: "\u4ec5\u652f\u6301 txt\u3001md\u3001json\u3001csv \u6587\u4ef6" });
      return;
    }

    if (!content.trim()) {
      sendJson(res, 400, { error: "\u6587\u4ef6\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a" });
      return;
    }

    await ensureKnowledgeDir();
    const filePath = getFilePathInKnowledgeBase(fileName);
    await fs.writeFile(filePath, content, "utf8");
    sendJson(res, 201, { fileName });
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
      const result = await createStudent({
        ...candidate,
        proofTitle1: candidate.proof?.[0]?.[0],
        proofText1: candidate.proof?.[0]?.[1],
        proofTitle2: candidate.proof?.[1]?.[0],
        proofText2: candidate.proof?.[1]?.[1],
        proofTitle3: candidate.proof?.[2]?.[0],
        proofText3: candidate.proof?.[2]?.[1]
      }, students);
      if (!result.error) {
        if (!result.isUpdate) students.push(result.student);
        await syncStudentKnowledge(result.student);
        imported.push(enrichStudent(result.student));
      }
    }

    await writeStudents(students);
    sendJson(res, 201, { imported, summary: makeSummary(students) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/students/lookup") {
    const name = normalizeStudentName(url.searchParams.get("name") || "");
    if (!name) return sendJson(res, 200, { matches: [] });
    const knowledge = await readStudentsKnowledge(students.map(studentKnowledgeFromStudent));
    const matches = knowledge
      .filter(item => normalizeStudentName(item.name).includes(name))
      .slice(0, 8);
    sendJson(res, 200, { matches });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/students") {
    const enriched = students.map(enrichStudent).sort((a, b) => b.riskScore - a.riskScore);
    sendJson(res, 200, { students: enriched, summary: makeSummary(students) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/students") {
    const body = await readBody(req);
    try {
      const result = await createStudent(body, students);
      if (result.error) return sendJson(res, 400, { error: result.error });
      if (!result.isUpdate) students.push(result.student);
      await writeStudents(students);
      await syncStudentKnowledge(result.student);
      sendJson(res, result.isUpdate ? 200 : 201, { student: enrichStudent(result.student), summary: makeSummary(students), isUpdate: result.isUpdate });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
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

    if (body.status === "\u5df2\u8ddf\u8fdb") {
      student.status = "\u5df2\u8ddf\u8fdb";
      student.lastContact = "\u4eca\u5929";
    }

    if (body.status === "\u5df2\u7eed\u8d39") {
      student.status = "\u5df2\u7eed\u8d39";
      student.lessonsLeft = 24;
      student.daysToEnd = 80;
      student.lastContact = "\u4eca\u5929";
    }

    await writeStudents(students);
    await syncStudentKnowledge(student);
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

  if (url.pathname.startsWith("/knowledge_base/")) {
    const relativePath = decodeURIComponent(url.pathname.slice(1));
    const filePath = path.resolve(DATA_DIR, relativePath);

    if (!filePath.startsWith(KNOWLEDGE_DIR)) {
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

ensureRuntimeStorage()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`MVP running at http://${HOST}:${PORT}/`);
      console.log(`Login: ${ADMIN_USER} / ${ADMIN_PASS}`);
      console.log(`Data directory: ${DATA_DIR}`);
    });
  })
  .catch(error => {
    console.error("Failed to initialize data directory:", error);
    process.exit(1);
  });
