const crypto = require("crypto");
const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");
const USERS_FILE = path.join(ROOT, "users.json");
const NOTIFICATIONS_FILE = path.join(ROOT, "notifications.json");
const SCHEDULE_FILE = path.join(ROOT, "schedule.json");
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge_base");
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
    lastContact: student.lastContact || "???",
    status: student.status || "???",
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
      items.push({ type: "text", title: title || `????${index}`, text, createdAt: new Date().toISOString() });
    }
  }
  if (Array.isArray(body.evidence)) items.push(...body.evidence);
  return items;
}

async function saveEvidenceImage(studentName, image) {
  if (!image || !image.dataUrl) return null;
  const match = String(image.dataUrl).match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) throw new Error("??? PNG?JPG?WEBP ??");
  const buffer = Buffer.from(match[3], "base64");
  if (buffer.length > 1024 * 1024) throw new Error("?????? 1M");
  await fs.mkdir(STUDENT_ASSET_DIR, { recursive: true });
  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const safeName = String(studentName || "student").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  const fileName = `${safeName}-${Date.now()}.${ext}`;
  const relativePath = `knowledge_base/student_assets/${fileName}`;
  await fs.writeFile(path.join(STUDENT_ASSET_DIR, fileName), buffer);
  return { type: "image", title: image.title || "??????", fileName, path: relativePath, size: buffer.length, createdAt: new Date().toISOString() };
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
      "{{studentName}} 剩余 {{lessonsLeft}} 节课，风险分 {{riskScore}}。建议：{{nextAction}}",
      {
        studentName: student.name,
        lessonsLeft: student.lessonsLeft,
        riskScore: student.riskScore,
        nextAction: student.nextAction
      }
    );

    const notification = createNotificationRecord(notifications, {
      title: `高风险学员：${student.name}`,
      content,
      type: "student.renewal_risk_high",
      targetRole: "前台"
    });
    notification.studentId = student.id;
    created.push(notification);
  }

  await writeNotifications(notifications);

  if (created.length) {
    await sendWechatWorkMessage(`续费风险提醒：今日新增 ${created.length} 位高风险学员待跟进。`);
  }

  return created;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function evidenceToProof(evidence) {
  const textEvidence = (Array.isArray(evidence) ? evidence : []).filter(item => item.type !== "image");
  if (!textEvidence.length) return [["????", "??????????????????????????"]];
  return textEvidence.map(item => [item.title || "????", item.text || item.path || "?????"]);
}

async function createStudent(body, students) {
  const name = String(body.name || "").trim();
  if (!name) return { error: "????????" };
  const existing = students.find(student => normalizeStudentName(student.name) === normalizeStudentName(name));
  const evidence = await buildEvidence(body, name);
  const previousEvidence = existing?.evidence || [];
  const mergedEvidence = [...previousEvidence, ...evidence];
  const student = existing || { id: students.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1 };
  student.name = name;
  student.age = String(body.age || student.age || "").trim();
  student.course = String(body.course || student.course || "?????").trim();
  student.teacher = String(body.teacher || student.teacher || "?????").trim();
  student.paidAt = String(body.paidAt || student.paidAt || "").trim();
  student.paidAmount = toNumber(body.paidAmount, toNumber(student.paidAmount, 0));
  student.prepaidLessons = toNumber(body.prepaidLessons, toNumber(student.prepaidLessons, toNumber(student.lessonsLeft, 0)));
  student.lessonsLeft = toNumber(body.lessonsLeft, student.prepaidLessons);
  student.daysToEnd = toNumber(body.daysToEnd, toNumber(student.daysToEnd, 30));
  student.absentRate = toNumber(body.absentRate, toNumber(student.absentRate, 0));
  student.parentReplies = toNumber(body.parentReplies, toNumber(student.parentReplies, 0));
  student.homeworkMissed = toNumber(body.homeworkMissed, toNumber(student.homeworkMissed, 0));
  student.renewalValue = toNumber(body.renewalValue, student.paidAmount);
  student.lastContact = String(body.lastContact || student.lastContact || "???").trim();
  student.status = existing?.status || "???";
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
    .join("、");
}

function enrichLesson(lesson, schedule, students) {
  const teacher = schedule.teachers.find(item => item.id === Number(lesson.teacherId));
  const room = schedule.rooms.find(item => item.id === Number(lesson.roomId));
  const course = schedule.courses.find(item => item.id === Number(lesson.courseId));
  return {
    ...lesson,
    teacherName: teacher?.name || "未分配老师",
    roomName: room?.name || "未分配教室",
    courseName: course?.name || "未设置课程",
    studentNames: getStudentNames(students, lesson.studentIds || [])
  };
}

function detectLessonConflicts(candidate, schedule) {
  const conflicts = [];
  const activeLessons = schedule.lessons.filter(lesson => lesson.status !== "cancelled" && lesson.id !== candidate.id);
  const room = schedule.rooms.find(item => item.id === Number(candidate.roomId));
  const course = schedule.courses.find(item => item.id === Number(candidate.courseId));
  const teacher = schedule.teachers.find(item => item.id === Number(candidate.teacherId));
  const studentIds = (candidate.studentIds || []).map(Number);

  for (const lesson of activeLessons) {
    if (!dateRangeOverlaps(candidate.startTime, candidate.endTime, lesson.startTime, lesson.endTime)) continue;
    if (Number(lesson.teacherId) === Number(candidate.teacherId)) conflicts.push("老师同一时间已有课程");
    if (Number(lesson.roomId) === Number(candidate.roomId)) conflicts.push("教室同一时间已被占用");
    if ((lesson.studentIds || []).some(id => studentIds.includes(Number(id)))) conflicts.push("学员同一时间已有课程");
  }

  if (room && studentIds.length > room.capacity) conflicts.push(`教室容量不足，最多 ${room.capacity} 人`);
  if (room && course && !room.courseTypes.includes(course.name)) conflicts.push("课程类型与教室不匹配");
  if (teacher && course && teacher.courses.length && !teacher.courses.includes(course.name)) conflicts.push("老师不具备该课程授课资格");

  return [...new Set(conflicts)];
}

function createLesson(body, schedule) {
  const course = (schedule.courseTypes || schedule.courses || []).find(item => item.id === Number(body.courseId));
  const startTime = String(body.startTime || "");
  const endTime = body.endTime
    ? String(body.endTime)
    : new Date(new Date(startTime).getTime() + (course?.durationMinutes || 60) * 60_000).toISOString();

  if (!body.courseId || !body.teacherId || !body.roomId || !startTime) return { error: "课程、老师、教室和上课时间为必填项" };

  const studentIds = Array.isArray(body.studentIds)
    ? body.studentIds.map(Number).filter(Boolean)
    : String(body.studentIds || "").split(",").map(item => Number(item.trim())).filter(Boolean);

  const nextId = schedule.lessons.reduce((max, lesson) => Math.max(max, lesson.id || 0), 0) + 1;
  const lesson = {
    id: nextId,
    courseId: Number(body.courseId),
    teacherId: Number(body.teacherId),
    roomId: Number(body.roomId),
    studentIds,
    startTime,
    endTime,
    status: "scheduled",
    date: recommendation.date || "",
    periodName: recommendation.periodName || "",
    lessonIndex: recommendation.lessonIndex || null,
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
  return {
    ...classItem,
    courseName: course?.name || "未设置课程",
    teacherName: teacher?.name || "未分配老师",
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
    status: "scheduled",
    createdAt: new Date().toISOString()
  };
}

function getStudentNames(students, studentIds) {
  return (studentIds || [])
    .map(id => students.find(student => student.id === Number(id))?.name)
    .filter(Boolean)
    .join("、");
}

function enrichClass(classItem, schedule, students) {
  const course = courseById(schedule, classItem.courseTypeId);
  const teacher = schedule.teachers.find(item => item.id === Number(classItem.teacherId));
  const hasLesson = schedule.lessons.some(lesson => Number(lesson.classId) === Number(classItem.id));
  return {
    ...classItem,
    courseName: course?.name || "未设置课程",
    teacherName: teacher?.name || "未分配老师",
    status: hasLesson ? "已排课" : "待排课",
    studentNames: getStudentNames(students, classItem.studentIds || [])
  };
}

function enrichLesson(lesson, schedule, students) {
  const teacher = schedule.teachers.find(item => item.id === Number(lesson.teacherId));
  const room = schedule.rooms.find(item => item.id === Number(lesson.roomId));
  const course = courseById(schedule, lesson.courseId);
  const classItem = schedule.classes.find(item => item.id === Number(lesson.classId));
  return {
    ...lesson,
    teacherName: teacher?.name || "未分配老师",
    roomName: room?.name || "未分配教室",
    courseName: course?.name || "未设置课程",
    className: classItem?.name || "",
    studentNames: getStudentNames(students, lesson.studentIds || [])
  };
}

function detectLessonConflicts(candidate, schedule) {
  const conflicts = [];
  const activeLessons = schedule.lessons.filter(lesson => lesson.status !== "cancelled" && lesson.id !== candidate.id);
  const room = schedule.rooms.find(item => item.id === Number(candidate.roomId));
  const course = courseById(schedule, candidate.courseId);
  const teacher = schedule.teachers.find(item => item.id === Number(candidate.teacherId));
  const studentIds = (candidate.studentIds || []).map(Number);

  for (const lesson of activeLessons) {
    if (!dateRangeOverlaps(candidate.startTime, candidate.endTime, lesson.startTime, lesson.endTime)) continue;
    if (Number(lesson.teacherId) === Number(candidate.teacherId)) conflicts.push("老师同一时间已有课程");
    if (Number(lesson.roomId) === Number(candidate.roomId)) conflicts.push("教室同一时间已被占用");
    if ((lesson.studentIds || []).some(id => studentIds.includes(Number(id)))) conflicts.push("学员同一时间已有课程");
  }

  if (room && studentIds.length > room.capacity) conflicts.push(`教室容量不足，最多 ${room.capacity} 人`);
  if (room && course && !roomFitsCourse(room, course)) conflicts.push("课程类型与教室不匹配");
  if (teacher && course && !teacherFitsCourse(teacher, course)) conflicts.push("老师不具备该课程授课资格");

  return [...new Set(conflicts)];
}

function getStudentNames(students, studentIds) {
  return (studentIds || [])
    .map(id => students.find(student => student.id === Number(id))?.name)
    .filter(Boolean)
    .join("、");
}

function enrichLesson(lesson, schedule, students) {
  const teacher = schedule.teachers.find(item => item.id === Number(lesson.teacherId));
  const room = schedule.rooms.find(item => item.id === Number(lesson.roomId));
  const course = courseById(schedule, lesson.courseId);
  const classItem = schedule.classes.find(item => item.id === Number(lesson.classId));
  return {
    ...lesson,
    teacherName: teacher?.name || "未分配老师",
    roomName: room?.name || "未分配教室",
    courseName: course?.name || "未设置课程",
    className: classItem?.name || "",
    studentNames: getStudentNames(students, lesson.studentIds || [])
  };
}

function detectLessonConflicts(candidate, schedule) {
  const conflicts = [];
  const activeLessons = schedule.lessons.filter(lesson => lesson.status !== "cancelled" && lesson.id !== candidate.id);
  const room = schedule.rooms.find(item => item.id === Number(candidate.roomId));
  const course = courseById(schedule, candidate.courseId);
  const teacher = schedule.teachers.find(item => item.id === Number(candidate.teacherId));
  const studentIds = (candidate.studentIds || []).map(Number);

  for (const lesson of activeLessons) {
    if (!dateRangeOverlaps(candidate.startTime, candidate.endTime, lesson.startTime, lesson.endTime)) continue;
    if (Number(lesson.teacherId) === Number(candidate.teacherId)) conflicts.push("老师同一时间已有课程");
    if (Number(lesson.roomId) === Number(candidate.roomId)) conflicts.push("教室同一时间已被占用");
    if ((lesson.studentIds || []).some(id => studentIds.includes(Number(id)))) conflicts.push("学员同一时间已有课程");
  }

  if (room && studentIds.length > room.capacity) conflicts.push(`教室容量不足，最多 ${room.capacity} 人`);
  if (room && course && !roomFitsCourse(room, course)) conflicts.push("课程类型与教室不匹配");
  if (teacher && course && !teacherFitsCourse(teacher, course)) conflicts.push("老师不具备该课程授课资格");

  return [...new Set(conflicts)];
}

function normalizeAvailabilitySlots(slots) {
  return (Array.isArray(slots) ? slots : [])
    .map(slot => ({
      date: slot.date || "",
      dayOfWeek: Number(slot.dayOfWeek || (slot.date ? dayOfWeekFromDate(slot.date) : 0)),
      period: slot.period || "custom",
      periodName: slot.periodName || (PERIOD_RULES[slot.period]?.name || "\u81ea\u5b9a\u4e49"),
      startTime: String(slot.startTime || ""),
      endTime: String(slot.endTime || "")
    }))
    .filter(slot => slot.dayOfWeek && slot.startTime && slot.endTime);
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
    employmentType: ["??", "??"].includes(body.employmentType) ? body.employmentType : "??",
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
    const users = await readUsers();
    const account = users.find(user => user.username === body.username && user.password === body.password);
    const fallbackAdmin = body.username === ADMIN_USER && body.password === ADMIN_PASS;

    if (account || fallbackAdmin) {
      const user = account
        ? { id: account.id, username: account.username, role: account.role }
        : { username: ADMIN_USER, role: "校长" };
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

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const role = String(body.role || "老师").trim();

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      sendJson(res, 400, { error: "账号需为3-24位字母、数字或下划线" });
      return;
    }

    if (password.length < 6) {
      sendJson(res, 400, { error: "密码至少6位" });
      return;
    }

    const users = await readUsers();
    if (users.some(user => user.username === username)) {
      sendJson(res, 409, { error: "账号已存在" });
      return;
    }

    const nextId = users.reduce((max, user) => Math.max(max, user.id || 0), 0) + 1;
    const account = {
      id: nextId,
      username,
      password,
      role: ["校长", "前台", "老师"].includes(role) ? role : "老师",
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
    if (!user) return sendJson(res, 401, { error: "未登录" });
    sendJson(res, 200, { user });
    return;
  }

  if (!user) {
    sendJson(res, 401, { error: "未登录" });
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
    if (!name) return sendJson(res, 400, { error: "课程类型名称不能为空" });
    const courseType = {
      id: nextId(schedule.courseTypes),
      name,
      category: String(body.category || "未分类").trim(),
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
    if (!name || !body.courseTypeId || !body.teacherId) return sendJson(res, 400, { error: "班级名称、课程类型和老师为必填项" });
    const classItem = {
      id: nextId(schedule.classes),
      name,
      courseTypeId: Number(body.courseTypeId),
      teacherId: Number(body.teacherId),
      studentIds: Array.isArray(body.studentIds) ? body.studentIds.map(Number).filter(Boolean) : [],
      capacity: toNumber(body.capacity, courseById(schedule, body.courseTypeId)?.defaultCapacity || 10),
      status: "待排课"
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
    if (!slot.studentId || !slot.dayOfWeek || !slot.startTime || !slot.endTime) return sendJson(res, 400, { error: "学生和可上课时间为必填项" });
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
    if (!recommendation) return sendJson(res, 400, { error: "暂无可生成的推荐课表" });
    if (recommendation.conflicts.length && !body.force) return sendJson(res, 409, { error: "推荐时间存在冲突", conflicts: recommendation.conflicts });
    const lesson = createLessonFromRecommendation(classItem, recommendation, schedule);
    schedule.lessons.push(lesson);
    classItem.status = "已排课";
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
      sendJson(res, 409, { error: "存在排课冲突", conflicts: result.conflicts });
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
    if (lesson.status === "completed") return sendJson(res, 400, { error: "该课节已完成" });

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
      sendJson(res, 400, { error: "只支持 txt、md、json、csv 文件" });
      return;
    }

    if (!content.trim()) {
      sendJson(res, 400, { error: "文件内容为空" });
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

server.listen(PORT, HOST, () => {
  console.log(`MVP running at http://${HOST}:${PORT}/`);
  console.log(`Login: ${ADMIN_USER} / ${ADMIN_PASS}`);
});
