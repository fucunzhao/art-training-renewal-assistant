const state = {
  students: [],
  knowledgeCandidates: [],
  notifications: [],
  scheduleMeta: null,
  lessons: [],
  recommendations: [],
  selectedTeacherDates: new Set(),
  lookupTimer: null,
  selectedId: null,
  filter: "all",
  tone: "warm",
  query: ""
};

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 0
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (response.status === 401) {
    window.location.href = "/login.html";
    throw new Error("未登录");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function loadSession() {
  const data = await api("/api/session");
  document.getElementById("currentUser").textContent = `${data.user.role}：${data.user.username}`;
}

async function loadStudents() {
  const data = await api("/api/students");
  state.students = data.students || [];
  if (!state.selectedId && state.students[0]) state.selectedId = state.students[0].id;
  renderSummary(data.summary || {});
  render();
}

async function loadNotifications() {
  const data = await api("/api/notifications");
  state.notifications = data.notifications || [];
  renderNotifications(data.unreadCount || 0);
}

async function loadScheduleMeta() {
  const data = await api("/api/schedule/meta");
  state.scheduleMeta = data;
  renderScheduleOptions();
}

async function loadLessons() {
  const data = await api("/api/schedule/lessons");
  state.lessons = data.lessons || [];
  renderLessons();
}

function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function renderSummary(summary) {
  document.getElementById("summaryRisk").textContent = summary.highRiskCount || 0;
  document.getElementById("summaryDue").textContent = summary.dueSoonCount || 0;
  document.getElementById("summaryValue").textContent = currency.format(summary.protectedRevenue || 0);
}

function filteredStudents() {
  const query = state.query.trim().toLowerCase();
  return state.students.filter(student => {
    const values = [student.name, student.course, student.teacher].map(item => String(item || "").toLowerCase());
    const matchesQuery = !query || values.some(value => value.includes(query));
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "high" && student.riskScore >= 72) ||
      (state.filter === "due" && student.daysToEnd <= 14) ||
      (state.filter === "quiet" && student.parentReplies <= 1);
    return matchesQuery && matchesFilter;
  });
}

function dayName(day) {
  return ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"][Number(day)] || "-";
}

function formatTeacherSlot(slot) {
  const date = slot.date ? `${slot.date} ` : "";
  const period = slot.periodName && slot.periodName !== "自定义" ? `${slot.periodName} ` : "";
  return `${date}${dayName(slot.dayOfWeek)} ${period}${slot.startTime}-${slot.endTime}`;
}

function summarizeTeacherSlots(slots = []) {
  const uniqueSlots = [];
  const seen = new Set();

  for (const slot of slots) {
    const key = `${slot.date || ""}|${slot.dayOfWeek}|${slot.period || ""}|${slot.startTime}|${slot.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSlots.push(slot);
  }

  if (!uniqueSlots.length) {
    return {
      countText: "未录入可授课时间",
      previewText: "建议先补充可授课时间，否则无法参与推荐排课。"
    };
  }

  const preview = uniqueSlots.slice(0, 3).map(formatTeacherSlot);
  const extra = uniqueSlots.length > preview.length ? `，还有 ${uniqueSlots.length - preview.length} 个时段` : "";
  return {
    countText: `${uniqueSlots.length} 个可授课时段`,
    previewText: `${preview.join("、")}${extra}`
  };
}

function compactAvailabilitySlots(slots = []) {
  const uniqueSlots = [];
  const seen = new Set();

  for (const slot of slots) {
    const key = `${slot.date || ""}|${slot.dayOfWeek}|${slot.period || ""}|${slot.startTime}|${slot.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSlots.push(slot);
  }

  return uniqueSlots;
}

function renderGroupedTeacherAvailability() {
  const groups = new Map();

  for (const slot of state.scheduleMeta.teacherAvailability) {
    const teacherId = Number(slot.teacherId);
    if (!groups.has(teacherId)) groups.set(teacherId, []);
    groups.get(teacherId).push(slot);
  }

  if (!groups.size) return "<p class=\"empty-state\">\u6682\u65e0\u8001\u5e08\u53ef\u6388\u8bfe\u65f6\u95f4</p>";

  const teacherMap = Object.fromEntries(state.scheduleMeta.teachers.map(item => [Number(item.id), item.name]));
  return [...groups.entries()].map(([teacherId, slots]) => {
    const uniqueSlots = compactAvailabilitySlots(slots);
    const preview = uniqueSlots.slice(0, 3).map(formatTeacherSlot);
    const extra = uniqueSlots.length > preview.length ? `\uff0c\u8fd8\u6709 ${uniqueSlots.length - preview.length} \u4e2a\u65f6\u6bb5` : "";
    return `
      <div class="compact-item availability-summary-item">
        <span class="teacher-summary">
          <strong>${teacherMap[teacherId] || "-"}</strong>
          <span class="teacher-meta">${uniqueSlots.length} \u4e2a\u53ef\u6388\u8bfe\u65f6\u6bb5</span>
          <small>${preview.join("\u3001")}${extra}</small>
        </span>
      </div>
    `;
  }).join("");
}

function renderNotifications(unreadCount) {
  document.getElementById("notificationBadge").textContent = unreadCount;
  const list = document.getElementById("notificationList");
  if (!state.notifications.length) {
    list.innerHTML = "<p class=\"empty-state\">暂无通知</p>";
    return;
  }
  list.innerHTML = state.notifications.map(item => `
    <article class="notification-item ${item.status === "unread" ? "unread" : ""}">
      <div>
        <strong>${item.title}</strong>
        <p>${item.content}</p>
        <small>${new Date(item.createdAt).toLocaleString("zh-CN")} · ${item.status === "unread" ? "未读" : "已读"}</small>
      </div>
      ${item.status === "unread" ? `<button type="button" data-read-notification="${item.id}">已读</button>` : ""}
    </article>
  `).join("");
}

function renderScheduleOptions() {
  if (!state.scheduleMeta) return;
  const courseOptions = state.scheduleMeta.courseTypes.map(course => `<option value="${course.id}">${course.name}</option>`).join("");
  const teacherOptions = state.scheduleMeta.teachers.map(teacher => `<option value="${teacher.id}">${teacher.name} · ${teacher.employmentType || "教师"}</option>`).join("");
  const studentOptions = state.scheduleMeta.students.map(student => `<option value="${student.id}">${student.name} · 剩 ${student.lessonsLeft} 节</option>`).join("");

  document.getElementById("classCourseType").innerHTML = courseOptions;
  document.getElementById("classTeacher").innerHTML = teacherOptions;
  document.getElementById("classStudents").innerHTML = studentOptions;
  document.getElementById("availabilityTeacher").innerHTML = teacherOptions;
  document.getElementById("availabilityStudent").innerHTML = studentOptions;
  document.getElementById("teacherCourseTypes").innerHTML = courseOptions;
  document.getElementById("recommendClass").innerHTML = state.scheduleMeta.classes.map(item => `<option value="${item.id}">${item.name} · ${item.courseName}</option>`).join("");

  renderCourseTypes();
  renderTeachers();
  renderTeacherCalendar();
  renderClasses();
  renderAvailability();
  renderRecommendations();
}

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function renderTeacherCalendar() {
  const monthInput = document.getElementById("teacherMonth");
  const calendar = document.getElementById("teacherCalendar");
  const selected = document.getElementById("selectedTeacherDates");
  if (!monthInput || !calendar || !selected) return;
  if (!monthInput.value) monthInput.value = monthValue();
  const [year, month] = monthInput.value.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const days = new Date(year, month, 0).getDate();
  const offset = (first.getDay() || 7) - 1;
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push("<span></span>");
  for (let day = 1; day <= days; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push(`<button type="button" class="calendar-day ${state.selectedTeacherDates.has(date) ? "selected" : ""}" data-date="${date}">${day}</button>`);
  }
  calendar.innerHTML = cells.join("");
  selected.textContent = state.selectedTeacherDates.size ? [...state.selectedTeacherDates].sort().join("\u3001") : "\u6682\u672a\u9009\u62e9\u65e5\u671f";
}

function shiftTeacherMonth(delta) {
  const input = document.getElementById("teacherMonth");
  const [year, month] = (input.value || monthValue()).split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  input.value = monthValue(date);
  renderTeacherCalendar();
}

function selectCurrentTeacherMonth() {
  const input = document.getElementById("teacherMonth");
  if (!input.value) input.value = monthValue();
  const [year, month] = input.value.split("-").map(Number);
  const days = new Date(year, month, 0).getDate();
  for (let day = 1; day <= days; day += 1) {
    state.selectedTeacherDates.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  renderTeacherCalendar();
}
function renderCourseTypes() {
  document.getElementById("courseTypeList").innerHTML = state.scheduleMeta.courseTypes.map(item => `
    <div class="compact-item">
      <span>${item.name} \u00b7 ${item.category} \u00b7 ${item.durationMinutes} \u5206\u949f \u00b7 ${item.defaultCapacity} \u4eba</span>
      <button type="button" data-delete-course-type="${item.id}">\u5220\u9664</button>
    </div>
  `).join("") || "<p class=\"empty-state\">\u6682\u65e0\u8bfe\u7a0b\u7c7b\u578b</p>";
}

function renderTeachers() {
  document.getElementById("teacherList").innerHTML = state.scheduleMeta.teachers.map(teacher => {
    const slots = summarizeTeacherSlots(teacher.availableTimes || []);
    return `
      <div class="compact-item teacher-item">
        <span class="teacher-summary">
          <strong>${teacher.name}</strong>
          <span class="teacher-meta">${teacher.employmentType || "\u672a\u8bbe\u7f6e"} \u00b7 ${teacher.courseNames || "\u672a\u7ed1\u5b9a\u8bfe\u7a0b"} \u00b7 ${slots.countText}</span>
          <small>${teacher.phone || "\u672a\u586b\u7535\u8bdd"} \u00b7 ${slots.previewText}</small>
        </span>
        <button type="button" data-delete-teacher="${teacher.id}">\u5220\u9664</button>
      </div>
    `;
  }).join("") || "<p class=\"empty-state\">\u6682\u65e0\u6559\u5e08\u8d44\u6599</p>";
}

function renderClasses() {
  document.getElementById("classList").innerHTML = state.scheduleMeta.classes.map(item => `
    <div class="compact-item">
      <span>${item.name} \u00b7 ${item.courseName} \u00b7 ${item.teacherName}<br><small>${item.studentNames || "\u672a\u6dfb\u52a0\u5b66\u5458"} \u00b7 ${item.status}</small></span>
      <button type="button" data-delete-class="${item.id}">\u5220\u9664</button>
    </div>
  `).join("") || "<p class=\"empty-state\">\u6682\u65e0\u73ed\u7ea7</p>";
}

function renderAvailability() {
  const studentMap = Object.fromEntries(state.scheduleMeta.students.map(item => [item.id, item.name]));
  document.getElementById("teacherAvailabilityList").innerHTML = renderGroupedTeacherAvailability();
  document.getElementById("studentAvailabilityList").innerHTML = state.scheduleMeta.studentAvailability.map(slot => `
    <div class="compact-item"><span>${studentMap[slot.studentId] || "-"} \u00b7 ${dayName(slot.dayOfWeek)} ${slot.startTime}-${slot.endTime}</span></div>
  `).join("") || "<p class=\"empty-state\">\u6682\u65e0\u5b66\u751f\u53ef\u4e0a\u8bfe\u65f6\u95f4</p>";
}

function renderRecommendations() {
  const container = document.getElementById("recommendationList");
  if (!state.recommendations.length) {
    container.innerHTML = "<p class=\"empty-state\">\u6682\u65e0\u63a8\u8350\uff0c\u8bf7\u5148\u9009\u62e9\u73ed\u7ea7\u751f\u6210\u63a8\u8350\u6392\u8bfe\u3002</p>";
    return;
  }
  container.innerHTML = state.recommendations.map(item => `
    <article class="recommendation-card">
      <div>
        <strong>${dayName(item.dayOfWeek)} ${item.startTime}-${item.endTime} \u00b7 ${item.roomName}</strong>
        <p>${item.courseName} \u00b7 ${item.teacherName} \u00b7 \u53ef\u6392 ${item.availableCount}/${item.totalCount} \u4eba</p>
        ${item.unavailableStudentNames ? `<p class="candidate-warning">\u4e0d\u53ef\u6392\uff1a${item.unavailableStudentNames}</p>` : ""}
        ${item.conflicts.length ? `<p class="candidate-warning">\u51b2\u7a81\uff1a${item.conflicts.join("\u3001")}</p>` : "<p class=\"candidate-proof\">\u65e0\u51b2\u7a81</p>"}
      </div>
      <button type="button" data-generate-lesson="${item.id}">\u751f\u6210\u8bfe\u8868</button>
    </article>
  `).join("");
}

function renderLessons() {
  const list = document.getElementById("lessonList");
  if (!state.lessons.length) {
    list.innerHTML = "<tr><td colspan=\"8\">\u6682\u65e0\u5df2\u751f\u6210\u8bfe\u8868</td></tr>";
    return;
  }
  list.innerHTML = state.lessons.map(lesson => `
    <tr>
      <td>${new Date(lesson.startTime).toLocaleString("zh-CN")}<br><small>\u81f3 ${new Date(lesson.endTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></td>
      <td>${lesson.className || "-"}</td>
      <td>${lesson.courseName}</td>
      <td>${lesson.teacherName}</td>
      <td>${lesson.roomName}</td>
      <td>${lesson.studentNames || "\u672a\u6dfb\u52a0\u5b66\u5458"}</td>
      <td>${lesson.status === "completed" ? "\u5df2\u8bfe\u6d88" : "\u5df2\u6392\u8bfe"}</td>
      <td>${lesson.status === "completed" ? "" : `<button type="button" data-complete-lesson="${lesson.id}">\u5b8c\u6210\u8bfe\u6d88</button>`}</td>
    </tr>
  `).join("");
}

function renderList() {
  const list = filteredStudents();
  const container = document.getElementById("studentList");
  document.getElementById("resultCount").textContent = `${list.length}人`;
  container.innerHTML = "";
  if (!list.some(student => student.id === state.selectedId) && list[0]) state.selectedId = list[0].id;
  list.forEach(student => {
    const button = document.createElement("button");
    button.className = `student-card ${student.id === state.selectedId ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <div class="student-card-top"><strong>${student.name}</strong><span class="risk-pill ${student.riskLevel.className}">${student.riskLevel.text}</span></div>
      <div class="student-meta">${student.course} · ${student.teacher}</div>
      <div class="student-meta">剩 ${student.lessonsLeft} 节 · ${student.lastContact}联系 · ${student.status}</div>
    `;
    button.addEventListener("click", () => { state.selectedId = student.id; render(); });
    container.appendChild(button);
  });
}

function selectedStudent() {
  return state.students.find(item => item.id === state.selectedId);
}

async function renderMessage(student) {
  const data = await api(`/api/students/${student.id}/message?tone=${state.tone}`);
  document.getElementById("messageBox").value = data.message;
}

function renderDetail() {
  const student = selectedStudent() || filteredStudents()[0];
  if (!student) return;
  state.selectedId = student.id;
  const riskBadge = document.getElementById("riskBadge");
  document.getElementById("studentCourse").textContent = `${student.course} · ${student.teacher}`;
  document.getElementById("studentName").textContent = student.name;
  riskBadge.textContent = student.riskLevel.text;
  riskBadge.className = `risk-badge ${student.riskLevel.className}`;
  document.getElementById("riskScore").textContent = student.riskScore;
  document.getElementById("lessonsLeft").textContent = student.lessonsLeft;
  document.getElementById("daysToEnd").textContent = student.daysToEnd;
  document.getElementById("renewalValue").textContent = currency.format(student.renewalValue);
  document.getElementById("nextAction").textContent = student.nextAction;
  document.getElementById("riskReasons").innerHTML = student.riskReasons.map(reason => `<li>${reason}</li>`).join("");
  document.getElementById("growthTimeline").innerHTML = student.proof.map(item => `<article class="proof-card"><strong>${item[0]}</strong><p>${item[1]}</p></article>`).join("");
  renderMessage(student).catch(error => showToast(error.message));
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label}已复制`);
  } catch {
    showToast("浏览器不允许复制，请手动选中文本");
  }
}


function fillStudentForm(record) {
  const form = document.getElementById("studentForm");
  if (!record || !form) return;
  const fields = ["age", "teacher", "course", "paidAt", "paidAmount", "prepaidLessons", "lessonsLeft", "daysToEnd", "absentRate", "parentReplies", "homeworkMissed", "lastContact"];
  fields.forEach(name => {
    if (form[name] && record[name] !== undefined && record[name] !== null && record[name] !== "") form[name].value = record[name];
  });
  if (form.renewalValue && record.renewalValue) form.renewalValue.value = record.renewalValue;
  const latest = [...(record.evidence || [])].reverse().find(item => item.type !== "image") || null;
  if (latest) {
    form.proofTitle1.value = latest.title || "";
    form.proofText1.value = "";
  }
}

async function lookupStudentByName(name) {
  const hint = document.getElementById("studentLookupHint");
  const query = String(name || "").trim();
  if (!query) { hint.textContent = "\u8f93\u5165\u59d3\u540d\u540e\uff0c\u5c06\u81ea\u52a8\u4ece\u77e5\u8bc6\u5e93\u7b5b\u9009\u5e76\u56de\u586b\u9ed8\u8ba4\u4fe1\u606f\u3002"; return; }
  const data = await api(`/api/students/lookup?name=${encodeURIComponent(query)}`);
  if (!data.matches.length) { hint.textContent = "\u77e5\u8bc6\u5e93\u4e2d\u6682\u65e0\u8be5\u5b66\u5458\uff0c\u53ef\u7ee7\u7eed\u9996\u6b21\u5f55\u5165\u3002"; return; }
  const exact = data.matches.find(item => item.name === query) || data.matches[0];
  fillStudentForm(exact);
  hint.textContent = `\u5df2\u4ece\u77e5\u8bc6\u5e93\u5339\u914d\uff1a${exact.name}\uff0c\u53ef\u76f4\u63a5\u7ef4\u62a4\u5e76\u8ffd\u52a0\u6210\u957f\u8bc1\u636e\u3002`;
}

function evidenceImagePayload(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > 1024 * 1024) return reject(new Error("\u6210\u957f\u8bc1\u636e\u56fe\u7247\u4e0d\u80fd\u8d85\u8fc7 1M"));
    const reader = new FileReader();
    reader.onload = () => resolve({ title: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(new Error("\u56fe\u7247\u8bfb\u53d6\u5931\u8d25"));
    reader.readAsDataURL(file);
  });
}
async function updateStatus(status) {
  const student = selectedStudent();
  if (!student) return;
  const data = await api(`/api/students/${student.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  state.students = state.students.map(item => item.id === data.student.id ? data.student : item).sort((a, b) => b.riskScore - a.riskScore);
  renderSummary(data.summary);
  render();
  showToast(status === "已续费" ? "已记录续费结果" : "已记录跟进状态");
}

async function createStudent(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  body.evidenceImage = await evidenceImagePayload(form.evidenceImage.files?.[0]);
  body.renewalValue = body.paidAmount;
  if (!body.lessonsLeft && body.prepaidLessons) body.lessonsLeft = body.prepaidLessons;
  const data = await api("/api/students", { method: "POST", body: JSON.stringify(body) });
  state.students = data.isUpdate
    ? state.students.map(item => item.id === data.student.id ? data.student : item)
    : [data.student, ...state.students];
  state.students = state.students.sort((a, b) => b.riskScore - a.riskScore);
  state.selectedId = data.student.id;
  renderSummary(data.summary);
  render();
  form.reset();
  form.paidAmount.value = 3980;
  form.prepaidLessons.value = 24;
  form.lessonsLeft.value = 24;
  form.daysToEnd.value = 60;
  form.absentRate.value = 0;
  form.parentReplies.value = 1;
  form.homeworkMissed.value = 0;
  form.lastContact.value = "\u672a\u8054\u7cfb";
  document.getElementById("studentLookupHint").textContent = "\u8f93\u5165\u59d3\u540d\u540e\uff0c\u5c06\u81ea\u52a8\u4ece\u77e5\u8bc6\u5e93\u7b5b\u9009\u5e76\u56de\u586b\u9ed8\u8ba4\u4fe1\u606f\u3002";
  showToast(data.isUpdate ? "\u5b66\u5458\u6863\u6848\u5df2\u66f4\u65b0\uff0c\u6210\u957f\u8bc1\u636e\u5df2\u8ffd\u52a0" : "\u5b66\u5458\u6863\u6848\u5df2\u4fdd\u5b58\u5230\u77e5\u8bc6\u5e93");
}

function teacherPayload(form) {
  const periods = [...form.querySelectorAll("[name=periods]:checked")].map(input => input.value);
  return {
    name: form.name.value,
    phone: form.phone.value,
    employmentType: form.employmentType.value,
    maxDailyLessons: form.maxDailyLessons.value,
    notes: form.notes.value,
    courseTypeIds: [...form.courseTypeIds.selectedOptions].map(option => Number(option.value)),
    availableDates: [...state.selectedTeacherDates].sort(),
    periods
  };
}

async function createTeacher(form) {
  const payload = teacherPayload(form);
  if (!payload.availableDates.length) return showToast("\u8bf7\u5148\u5728\u65e5\u5386\u4e2d\u9009\u62e9\u53ef\u6388\u8bfe\u65e5\u671f");
  if (!payload.periods.length) return showToast("\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u65f6\u6bb5");
  await api("/api/teachers", { method: "POST", body: JSON.stringify(payload) });
  form.reset();
  form.maxDailyLessons.value = 6;
  state.selectedTeacherDates.clear();
  form.querySelectorAll("[name=periods]").forEach(input => { input.checked = input.value === "morning"; });
  renderTeacherCalendar();
  await loadScheduleMeta();
  await scanKnowledgeFiles();
  showToast("教师资料已保存到知识库");
}

async function deleteTeacher(id) {
  await api(`/api/teachers/${id}`, { method: "DELETE" });
  await loadScheduleMeta();
  await scanKnowledgeFiles();
  showToast("教师资料已删除");
}

async function scanKnowledgeFiles() {
  const data = await api("/api/knowledge/files");
  const container = document.getElementById("knowledgeFiles");
  container.innerHTML = data.files.length ? data.files.map(file => `<span>${file}</span>`).join("") : "<span>没有找到知识库文件</span>";
}

async function uploadKnowledgeFile() {
  const input = document.getElementById("knowledgeUpload");
  const file = input.files?.[0];
  if (!file) return showToast("请选择一个知识库文件");
  await api("/api/knowledge/upload", { method: "POST", body: JSON.stringify({ fileName: file.name, content: await file.text() }) });
  input.value = "";
  await scanKnowledgeFiles();
  showToast("文件已上传到知识库");
}

async function extractKnowledgeCandidates() {
  const data = await api("/api/knowledge/extract", { method: "POST", body: JSON.stringify({}) });
  state.knowledgeCandidates = data.candidates || [];
  renderKnowledgeCandidates();
  showToast(`识别到 ${state.knowledgeCandidates.length} 条候选记录`);
}

function renderKnowledgeCandidates() {
  const container = document.getElementById("knowledgeCandidates");
  if (!state.knowledgeCandidates.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = state.knowledgeCandidates.map((candidate, index) => {
    const missing = candidate.missing?.length ? `<p class="candidate-warning">缺少必填项：${candidate.missing.join("、")}</p>` : "";
    const proof = candidate.proof?.map(item => `${item[0]}：${item[1]}`).join("<br>") || "";
    return `<label class="candidate-card"><input type="checkbox" data-candidate-index="${index}" ${candidate.missing?.length ? "" : "checked"}><div><strong>${candidate.name || "未识别姓名"}</strong><p>${candidate.course || "未识别课程"} · ${candidate.teacher || "未识别老师"} · 来源：${candidate.source}</p><p>剩 ${candidate.lessonsLeft} 节 · ${candidate.daysToEnd} 天课消 · 续费 ${currency.format(candidate.renewalValue)}</p><p class="candidate-proof">${proof}</p>${missing}</div></label>`;
  }).join("");
}

async function importKnowledgeCandidates() {
  const checked = [...document.querySelectorAll("[data-candidate-index]:checked")];
  const candidates = checked.map(input => state.knowledgeCandidates[Number(input.dataset.candidateIndex)]);
  if (!candidates.length) return showToast("请选择要导入的记录");
  const data = await api("/api/knowledge/import", { method: "POST", body: JSON.stringify({ candidates }) });
  if (!data.imported.length) return showToast("没有可导入的完整记录");
  state.students = [...data.imported, ...state.students].sort((a, b) => b.riskScore - a.riskScore);
  state.selectedId = data.imported[0].id;
  renderSummary(data.summary);
  render();
  await loadScheduleMeta();
  showToast(`已导入 ${data.imported.length} 位学员`);
}

async function triggerRiskNotifications() {
  const data = await api("/api/notifications/high-risk", { method: "POST" });
  state.notifications = data.notifications || [];
  renderNotifications(data.unreadCount || 0);
  showToast(data.created?.length ? `已生成 ${data.created.length} 条提醒` : "暂无新的高风险提醒");
}

async function markNotificationRead(id) {
  const data = await api(`/api/notifications/${id}/read`, { method: "POST" });
  state.notifications = state.notifications.map(item => item.id === data.notification.id ? data.notification : item);
  renderNotifications(data.unreadCount);
}

async function markAllNotificationsRead() {
  const data = await api("/api/notifications/read-all", { method: "POST" });
  state.notifications = data.notifications || [];
  renderNotifications(data.unreadCount || 0);
}

async function createCourseType(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  await api("/api/schedule/course-types", { method: "POST", body: JSON.stringify(body) });
  form.reset();
  await loadScheduleMeta();
  showToast("\u8bfe\u7a0b\u7c7b\u578b\u5df2\u65b0\u589e");
}

async function deleteCourseType(id) {
  await api(`/api/schedule/course-types/${id}`, { method: "DELETE" });
  state.recommendations = [];
  await Promise.all([loadScheduleMeta(), loadLessons()]);
  showToast("\u8bfe\u7a0b\u7c7b\u578b\u5df2\u5220\u9664");
}

async function createClass(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  body.studentIds = [...form.studentIds.selectedOptions].map(option => Number(option.value));
  await api("/api/schedule/classes", { method: "POST", body: JSON.stringify(body) });
  form.reset();
  await loadScheduleMeta();
  showToast("\u73ed\u7ea7\u5df2\u65b0\u589e");
}

async function deleteClass(id) {
  await api(`/api/schedule/classes/${id}`, { method: "DELETE" });
  state.recommendations = [];
  await Promise.all([loadScheduleMeta(), loadLessons()]);
  showToast("\u73ed\u7ea7\u5df2\u5220\u9664");
}

async function createTeacherAvailability(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  await api("/api/schedule/teacher-availability", { method: "POST", body: JSON.stringify(body) });
  await loadScheduleMeta();
  showToast("\u8001\u5e08\u53ef\u6388\u8bfe\u65f6\u95f4\u5df2\u4fdd\u5b58");
}

async function createStudentAvailability(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  await api("/api/schedule/student-availability", { method: "POST", body: JSON.stringify(body) });
  await loadScheduleMeta();
  showToast("\u5b66\u751f\u53ef\u4e0a\u8bfe\u65f6\u95f4\u5df2\u4fdd\u5b58");
}

async function recommendSchedule() {
  const classId = document.getElementById("recommendClass").value;
  if (!classId) return showToast("\u8bf7\u5148\u521b\u5efa\u73ed\u7ea7");
  const data = await api(`/api/schedule/classes/${classId}/recommendations`);
  state.recommendations = data.recommendations || [];
  renderRecommendations();
}

async function generateLesson(recommendationId) {
  const classId = document.getElementById("recommendClass").value;
  const data = await api(`/api/schedule/classes/${classId}/generate`, { method: "POST", body: JSON.stringify({ recommendationId: Number(recommendationId) }) });
  state.lessons = [...state.lessons, data.lesson].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  state.recommendations = [];
  await Promise.all([loadScheduleMeta(), loadLessons()]);
  showToast("\u8bfe\u8868\u5df2\u751f\u6210");
}

async function completeLesson(id) {
  const data = await api(`/api/schedule/lessons/${id}/complete`, { method: "POST" });
  state.lessons = state.lessons.map(lesson => lesson.id === data.lesson.id ? data.lesson : lesson);
  state.students = data.students;
  renderLessons();
  renderSummary(data.summary);
  render();
  showToast(`\u5df2\u5b8c\u6210\u8bfe\u6d88\uff1a${data.consumed.length} \u4f4d\u5b66\u5458\u6263\u8bfe`);
}

function bindEvents() {
  document.querySelectorAll(".fold-header").forEach(header => {
    header.addEventListener("click", () => {
      const section = header.closest(".fold-section");
      const collapsed = section.classList.toggle("collapsed");
      header.setAttribute("aria-expanded", String(!collapsed));
    });
  });

  document.getElementById("notificationButton").addEventListener("click", () => { document.getElementById("notificationDrawer").classList.add("open"); loadNotifications().catch(error => showToast(error.message)); });
  document.getElementById("closeNotificationButton").addEventListener("click", () => document.getElementById("notificationDrawer").classList.remove("open"));
  document.getElementById("triggerRiskNotificationsButton").addEventListener("click", () => triggerRiskNotifications().catch(error => showToast(error.message)));
  document.getElementById("markAllNotificationsButton").addEventListener("click", () => markAllNotificationsRead().catch(error => showToast(error.message)));
  document.getElementById("notificationList").addEventListener("click", event => { const button = event.target.closest("[data-read-notification]"); if (button) markNotificationRead(button.dataset.readNotification).catch(error => showToast(error.message)); });

  document.getElementById("teacherForm").addEventListener("submit", event => { event.preventDefault(); createTeacher(event.currentTarget).catch(error => showToast(error.message)); });
  document.getElementById("teacherMonth").addEventListener("change", renderTeacherCalendar);
  document.getElementById("prevTeacherMonth").addEventListener("click", () => shiftTeacherMonth(-1));
  document.getElementById("nextTeacherMonth").addEventListener("click", () => shiftTeacherMonth(1));
  document.getElementById("selectTeacherMonth").addEventListener("click", selectCurrentTeacherMonth);
  document.getElementById("teacherCalendar").addEventListener("click", event => { const button = event.target.closest("[data-date]"); if (!button) return; const date = button.dataset.date; state.selectedTeacherDates.has(date) ? state.selectedTeacherDates.delete(date) : state.selectedTeacherDates.add(date); renderTeacherCalendar(); });
  document.getElementById("teacherList").addEventListener("click", event => { const button = event.target.closest("[data-delete-teacher]"); if (button) deleteTeacher(button.dataset.deleteTeacher).catch(error => showToast(error.message)); });
  document.getElementById("refreshScheduleButton").addEventListener("click", () => Promise.all([loadScheduleMeta(), loadLessons()]).then(() => showToast("排课数据已刷新")).catch(error => showToast(error.message)));
  document.getElementById("courseTypeForm").addEventListener("submit", event => { event.preventDefault(); createCourseType(event.currentTarget).catch(error => showToast(error.message)); });
  document.getElementById("courseTypeList").addEventListener("click", event => { const button = event.target.closest("[data-delete-course-type]"); if (button) deleteCourseType(button.dataset.deleteCourseType).catch(error => showToast(error.message)); });
  document.getElementById("classForm").addEventListener("submit", event => { event.preventDefault(); createClass(event.currentTarget).catch(error => showToast(error.message)); });
  document.getElementById("classList").addEventListener("click", event => { const button = event.target.closest("[data-delete-class]"); if (button) deleteClass(button.dataset.deleteClass).catch(error => showToast(error.message)); });
  document.getElementById("teacherAvailabilityForm").addEventListener("submit", event => { event.preventDefault(); createTeacherAvailability(event.currentTarget).catch(error => showToast(error.message)); });
  document.getElementById("studentAvailabilityForm").addEventListener("submit", event => { event.preventDefault(); createStudentAvailability(event.currentTarget).catch(error => showToast(error.message)); });
  document.getElementById("recommendScheduleButton").addEventListener("click", () => recommendSchedule().catch(error => showToast(error.message)));
  document.getElementById("recommendationList").addEventListener("click", event => { const button = event.target.closest("[data-generate-lesson]"); if (button) generateLesson(button.dataset.generateLesson).catch(error => showToast(error.message)); });
  document.getElementById("lessonList").addEventListener("click", event => { const button = event.target.closest("[data-complete-lesson]"); if (button) completeLesson(button.dataset.completeLesson).catch(error => showToast(error.message)); });

  document.getElementById("searchInput").addEventListener("input", event => { state.query = event.target.value; render(); });
  document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => { document.querySelectorAll(".filter-button").forEach(item => item.classList.remove("active")); button.classList.add("active"); state.filter = button.dataset.filter; render(); }));
  document.querySelectorAll(".tone-button").forEach(button => button.addEventListener("click", () => { document.querySelectorAll(".tone-button").forEach(item => item.classList.remove("active")); button.classList.add("active"); state.tone = button.dataset.tone; renderDetail(); }));
  document.getElementById("copyMessageButton").addEventListener("click", () => copyText(document.getElementById("messageBox").value, "话术"));
  document.getElementById("copyProofButton").addEventListener("click", () => { const student = selectedStudent(); if (!student) return; const proof = student.proof.map(item => `${item[0]}：${item[1]}`).join("\n"); copyText(`${student.name}成长证据\n${proof}`, "成长证据"); });
  document.getElementById("markContactedButton").addEventListener("click", () => updateStatus("已跟进"));
  document.getElementById("markRenewedButton").addEventListener("click", () => updateStatus("已续费"));
  document.getElementById("studentForm").addEventListener("submit", event => { event.preventDefault(); createStudent(event.currentTarget).catch(error => showToast(error.message)); });
  document.getElementById("studentNameInput").addEventListener("input", event => { clearTimeout(state.lookupTimer); state.lookupTimer = setTimeout(() => lookupStudentByName(event.target.value).catch(error => showToast(error.message)), 350); });
  document.getElementById("resetStudentForm").addEventListener("click", () => document.getElementById("studentForm").reset());
  document.getElementById("scanKnowledgeButton").addEventListener("click", () => scanKnowledgeFiles().catch(error => showToast(error.message)));
  document.getElementById("uploadKnowledgeButton").addEventListener("click", () => uploadKnowledgeFile().catch(error => showToast(error.message)));
  document.getElementById("extractKnowledgeButton").addEventListener("click", () => extractKnowledgeCandidates().catch(error => showToast(error.message)));
  document.getElementById("importKnowledgeButton").addEventListener("click", () => importKnowledgeCandidates().catch(error => showToast(error.message)));
  document.getElementById("logoutButton").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); window.location.href = "/login.html"; });
}

function render() {
  renderList();
  renderDetail();
}

bindEvents();
renderTeacherCalendar();
Promise.all([loadSession(), loadStudents(), loadNotifications(), loadScheduleMeta(), loadLessons()]).catch(() => showToast("请先登录"));
scanKnowledgeFiles().catch(() => {});
