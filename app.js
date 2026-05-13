const state = {
  students: [],
  knowledgeCandidates: [],
  notifications: [],
  scheduleMeta: null,
  lessons: [],
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

  if (!response.ok) throw new Error("请求失败");
  return response.json();
}

async function loadSession() {
  const data = await api("/api/session");
  document.getElementById("currentUser").textContent = `${data.user.role}：${data.user.username}`;
}

async function loadStudents() {
  const data = await api("/api/students");
  state.students = data.students;
  if (!state.selectedId && state.students[0]) state.selectedId = state.students[0].id;
  renderSummary(data.summary);
  render();
}

async function loadNotifications() {
  const data = await api("/api/notifications");
  state.notifications = data.notifications;
  renderNotifications(data.unreadCount);
}

async function loadScheduleMeta() {
  const data = await api("/api/schedule/meta");
  state.scheduleMeta = data;
  renderScheduleOptions();
}

async function loadLessons() {
  const data = await api("/api/schedule/lessons");
  state.lessons = data.lessons;
  renderLessons();
}

function filteredStudents() {
  const query = state.query.trim().toLowerCase();
  return state.students.filter(student => {
    const matchesQuery = !query || [student.name, student.course, student.teacher].some(value => value.toLowerCase().includes(query));
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "high" && student.riskScore >= 72) ||
      (state.filter === "due" && student.daysToEnd <= 14) ||
      (state.filter === "quiet" && student.parentReplies <= 1);
    return matchesQuery && matchesFilter;
  });
}

function renderSummary(summary) {
  document.getElementById("summaryRisk").textContent = summary.highRiskCount;
  document.getElementById("summaryDue").textContent = summary.dueSoonCount;
  document.getElementById("summaryValue").textContent = currency.format(summary.protectedRevenue);
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
  document.getElementById("lessonCourse").innerHTML = state.scheduleMeta.courses.map(course => `<option value="${course.id}">${course.name}</option>`).join("");
  document.getElementById("lessonTeacher").innerHTML = state.scheduleMeta.teachers.map(teacher => `<option value="${teacher.id}">${teacher.name}</option>`).join("");
  document.getElementById("lessonRoom").innerHTML = state.scheduleMeta.rooms.map(room => `<option value="${room.id}">${room.name} · ${room.capacity}人</option>`).join("");
  document.getElementById("lessonStudents").innerHTML = state.scheduleMeta.students.map(student => `<option value="${student.id}">${student.name} · 剩${student.lessonsLeft}节</option>`).join("");
}

function renderLessons() {
  const list = document.getElementById("lessonList");
  if (!state.lessons.length) {
    list.innerHTML = "<tr><td colspan=\"7\">暂无课节</td></tr>";
    return;
  }

  list.innerHTML = state.lessons.map(lesson => `
    <tr>
      <td>${new Date(lesson.startTime).toLocaleString("zh-CN")}<br><small>至 ${new Date(lesson.endTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></td>
      <td>${lesson.courseName}</td>
      <td>${lesson.teacherName}</td>
      <td>${lesson.roomName}</td>
      <td>${lesson.studentNames || "未添加学员"}</td>
      <td>${lesson.status === "completed" ? "已完成" : "已排课"}</td>
      <td>${lesson.status === "completed" ? "" : `<button type="button" data-complete-lesson="${lesson.id}">完成课消</button>`}</td>
    </tr>
  `).join("");
}

function renderList() {
  const list = filteredStudents();
  const container = document.getElementById("studentList");
  document.getElementById("resultCount").textContent = `${list.length}人`;
  container.innerHTML = "";

  if (!list.some(student => student.id === state.selectedId) && list[0]) {
    state.selectedId = list[0].id;
  }

  list.forEach(student => {
    const button = document.createElement("button");
    button.className = `student-card ${student.id === state.selectedId ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <div class="student-card-top">
        <strong>${student.name}</strong>
        <span class="risk-pill ${student.riskLevel.className}">${student.riskLevel.text}</span>
      </div>
      <div class="student-meta">${student.course} · ${student.teacher}</div>
      <div class="student-meta">剩 ${student.lessonsLeft} 节 · ${student.lastContact}联系 · ${student.status}</div>
    `;
    button.addEventListener("click", () => {
      state.selectedId = student.id;
      render();
    });
    container.appendChild(button);
  });
}

async function renderMessage(student) {
  const data = await api(`/api/students/${student.id}/message?tone=${state.tone}`);
  document.getElementById("messageBox").value = data.message;
}

function renderDetail() {
  const student = state.students.find(item => item.id === state.selectedId) || filteredStudents()[0];
  if (!student) return;
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
  document.getElementById("growthTimeline").innerHTML = student.proof.map(item => `
    <article class="proof-card">
      <strong>${item[0]}</strong>
      <p>${item[1]}</p>
    </article>
  `).join("");
  renderMessage(student);
}

function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1600);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label}已复制`);
  } catch {
    showToast("浏览器不允许复制，请手动选中文本");
  }
}

function selectedStudent() {
  return state.students.find(item => item.id === state.selectedId);
}

async function updateStatus(status) {
  const student = selectedStudent();
  const data = await api(`/api/students/${student.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  state.students = state.students.map(item => item.id === data.student.id ? data.student : item)
    .sort((a, b) => b.riskScore - a.riskScore);
  renderSummary(data.summary);
  render();
  showToast(status === "已续费" ? "已记录续费结果" : "已记录跟进状态");
}

async function createStudent(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  const data = await api("/api/students", {
    method: "POST",
    body: JSON.stringify(body)
  });
  state.students = [data.student, ...state.students].sort((a, b) => b.riskScore - a.riskScore);
  state.selectedId = data.student.id;
  renderSummary(data.summary);
  render();
  form.reset();
  form.lessonsLeft.value = 4;
  form.daysToEnd.value = 14;
  form.absentRate.value = 0;
  form.parentReplies.value = 1;
  form.homeworkMissed.value = 0;
  form.renewalValue.value = 3980;
  form.lastContact.value = "未联系";
  showToast("学员已保存");
}

async function scanKnowledgeFiles() {
  const data = await api("/api/knowledge/files");
  const container = document.getElementById("knowledgeFiles");
  if (!data.files.length) {
    container.innerHTML = "<span>没有找到知识库文件</span>";
    return;
  }
  container.innerHTML = data.files.map(file => `<span>${file}</span>`).join("");
  showToast(`发现 ${data.files.length} 个文件`);
}

async function uploadKnowledgeFile() {
  const input = document.getElementById("knowledgeUpload");
  const file = input.files?.[0];
  if (!file) {
    showToast("请选择一个知识库文件");
    return;
  }

  const content = await file.text();
  await api("/api/knowledge/upload", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      content
    })
  });

  input.value = "";
  await scanKnowledgeFiles();
  showToast("文件已上传到知识库");
}

async function extractKnowledgeCandidates() {
  const data = await api("/api/knowledge/extract", {
    method: "POST",
    body: JSON.stringify({})
  });
  state.knowledgeCandidates = data.candidates;
  renderKnowledgeCandidates();
  showToast(`识别到 ${data.candidates.length} 条候选记录`);
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
    return `
      <label class="candidate-card">
        <input type="checkbox" data-candidate-index="${index}" ${candidate.missing?.length ? "" : "checked"}>
        <div>
          <strong>${candidate.name || "未识别姓名"}</strong>
          <p>${candidate.course || "未识别课程"} · ${candidate.teacher || "未识别老师"} · 来源：${candidate.source}</p>
          <p>剩 ${candidate.lessonsLeft} 节 · ${candidate.daysToEnd} 天课消 · 续费 ${currency.format(candidate.renewalValue)}</p>
          <p class="candidate-proof">${proof}</p>
          ${missing}
        </div>
      </label>
    `;
  }).join("");
}

async function importKnowledgeCandidates() {
  const checked = [...document.querySelectorAll("[data-candidate-index]:checked")];
  const candidates = checked.map(input => state.knowledgeCandidates[Number(input.dataset.candidateIndex)]);
  if (!candidates.length) {
    showToast("请选择要导入的记录");
    return;
  }

  const data = await api("/api/knowledge/import", {
    method: "POST",
    body: JSON.stringify({ candidates })
  });

  if (!data.imported.length) {
    showToast("没有可导入的完整记录");
    return;
  }

  state.students = [...data.imported, ...state.students].sort((a, b) => b.riskScore - a.riskScore);
  state.selectedId = data.imported[0].id;
  renderSummary(data.summary);
  render();
  showToast(`已导入 ${data.imported.length} 位学员`);
}

async function triggerRiskNotifications() {
  const data = await api("/api/notifications/high-risk", { method: "POST" });
  state.notifications = data.notifications;
  renderNotifications(data.unreadCount);
  showToast(data.created.length ? `已生成 ${data.created.length} 条提醒` : "暂无新的高风险提醒");
}

async function markNotificationRead(id) {
  const data = await api(`/api/notifications/${id}/read`, { method: "POST" });
  state.notifications = state.notifications.map(item => item.id === data.notification.id ? data.notification : item);
  renderNotifications(data.unreadCount);
}

async function markAllNotificationsRead() {
  const data = await api("/api/notifications/read-all", { method: "POST" });
  state.notifications = data.notifications;
  renderNotifications(data.unreadCount);
}

function lessonFormPayload(form) {
  return {
    courseId: form.courseId.value,
    teacherId: form.teacherId.value,
    roomId: form.roomId.value,
    startTime: form.startTime.value ? new Date(form.startTime.value).toISOString() : "",
    endTime: form.endTime.value ? new Date(form.endTime.value).toISOString() : "",
    studentIds: [...form.studentIds.selectedOptions].map(option => Number(option.value))
  };
}

async function checkLessonConflicts() {
  const form = document.getElementById("lessonForm");
  const data = await api("/api/schedule/conflicts", {
    method: "POST",
    body: JSON.stringify(lessonFormPayload(form))
  });
  renderConflicts(data.conflicts);
}

function renderConflicts(conflicts) {
  const box = document.getElementById("conflictBox");
  if (!conflicts.length) {
    box.className = "conflict-box ok";
    box.textContent = "未发现冲突，可以保存课节。";
    return;
  }
  box.className = "conflict-box warning";
  box.innerHTML = `<strong>发现 ${conflicts.length} 个冲突：</strong><ul>${conflicts.map(item => `<li>${item}</li>`).join("")}</ul>`;
}

async function createLesson(form) {
  try {
    const data = await api("/api/schedule/lessons", {
      method: "POST",
      body: JSON.stringify(lessonFormPayload(form))
    });
    state.lessons = [...state.lessons, data.lesson].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    renderLessons();
    renderConflicts(data.conflicts);
    form.reset();
    showToast("课节已保存");
  } catch (error) {
    showToast(error.message);
    await checkLessonConflicts().catch(() => {});
  }
}

async function completeLesson(id) {
  const data = await api(`/api/schedule/lessons/${id}/complete`, { method: "POST" });
  state.lessons = state.lessons.map(lesson => lesson.id === data.lesson.id ? data.lesson : lesson);
  state.students = data.students;
  renderLessons();
  renderSummary(data.summary);
  render();
  showToast(`已完成课消：${data.consumed.length} 位学员扣课`);
}

function bindEvents() {
  document.querySelectorAll(".fold-header").forEach(header => {
    header.addEventListener("click", () => {
      const section = header.closest(".fold-section");
      const collapsed = section.classList.toggle("collapsed");
      header.setAttribute("aria-expanded", String(!collapsed));
    });
  });

  document.getElementById("notificationButton").addEventListener("click", () => {
    document.getElementById("notificationDrawer").classList.add("open");
    loadNotifications().catch(error => showToast(error.message));
  });
  document.getElementById("closeNotificationButton").addEventListener("click", () => {
    document.getElementById("notificationDrawer").classList.remove("open");
  });
  document.getElementById("triggerRiskNotificationsButton").addEventListener("click", () => {
    triggerRiskNotifications().catch(error => showToast(error.message));
  });
  document.getElementById("markAllNotificationsButton").addEventListener("click", () => {
    markAllNotificationsRead().catch(error => showToast(error.message));
  });
  document.getElementById("notificationList").addEventListener("click", event => {
    const button = event.target.closest("[data-read-notification]");
    if (!button) return;
    markNotificationRead(button.dataset.readNotification).catch(error => showToast(error.message));
  });
  document.getElementById("refreshScheduleButton").addEventListener("click", () => {
    Promise.all([loadScheduleMeta(), loadLessons()]).then(() => showToast("课表已刷新")).catch(error => showToast(error.message));
  });
  document.getElementById("checkConflictButton").addEventListener("click", () => {
    checkLessonConflicts().catch(error => showToast(error.message));
  });
  document.getElementById("lessonForm").addEventListener("submit", event => {
    event.preventDefault();
    createLesson(event.currentTarget).catch(error => showToast(error.message));
  });
  document.getElementById("lessonList").addEventListener("click", event => {
    const button = event.target.closest("[data-complete-lesson]");
    if (!button) return;
    completeLesson(button.dataset.completeLesson).catch(error => showToast(error.message));
  });

  document.getElementById("searchInput").addEventListener("input", event => {
    state.query = event.target.value;
    render();
  });

  document.querySelectorAll(".filter-button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-button").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.filter;
      render();
    });
  });

  document.querySelectorAll(".tone-button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tone-button").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      state.tone = button.dataset.tone;
      renderDetail();
    });
  });

  document.getElementById("copyMessageButton").addEventListener("click", () => {
    copyText(document.getElementById("messageBox").value, "话术");
  });

  document.getElementById("copyProofButton").addEventListener("click", () => {
    const student = selectedStudent();
    const proof = student.proof.map(item => `${item[0]}：${item[1]}`).join("\n");
    copyText(`${student.name}成长证据\n${proof}`, "成长证据");
  });

  document.getElementById("markContactedButton").addEventListener("click", () => updateStatus("已跟进"));
  document.getElementById("markRenewedButton").addEventListener("click", () => updateStatus("已续费"));
  document.getElementById("studentForm").addEventListener("submit", event => {
    event.preventDefault();
    createStudent(event.currentTarget).catch(error => showToast(error.message));
  });
  document.getElementById("resetStudentForm").addEventListener("click", () => {
    document.getElementById("studentForm").reset();
  });
  document.getElementById("scanKnowledgeButton").addEventListener("click", () => {
    scanKnowledgeFiles().catch(error => showToast(error.message));
  });
  document.getElementById("uploadKnowledgeButton").addEventListener("click", () => {
    uploadKnowledgeFile().catch(error => showToast(error.message));
  });
  document.getElementById("extractKnowledgeButton").addEventListener("click", () => {
    extractKnowledgeCandidates().catch(error => showToast(error.message));
  });
  document.getElementById("importKnowledgeButton").addEventListener("click", () => {
    importKnowledgeCandidates().catch(error => showToast(error.message));
  });
  document.getElementById("logoutButton").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    window.location.href = "/login.html";
  });
}

function render() {
  renderList();
  renderDetail();
}

bindEvents();
Promise.all([loadSession(), loadStudents(), loadNotifications(), loadScheduleMeta(), loadLessons()]).catch(() => {
  showToast("请先登录");
});
scanKnowledgeFiles().catch(() => {});
