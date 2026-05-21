const state = {
  students: [],
  knowledgeCandidates: [],
  knowledgeImportReport: null,
  hermesStatus: null,
  notifications: [],
  scheduleMeta: null,
  lessons: [],
  recommendations: [],
  p0Records: loadP0Records(),
  p0Filters: {
    studentId: "",
    startDate: "",
    endDate: "",
    status: "active",
    query: ""
  },
  selectedTeacherDates: new Set(),
  studentPicker: {
    targetId: "",
    query: "",
    selectedIds: new Set()
  },
  lookupTimer: null,
  selectedId: null,
  filter: "all",
  tone: "warm",
  query: ""
};

function loadP0Records() {
  return { attendance: [], finance: [], communications: [], renewalOrders: [] };
}

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
  state.hermesStatus = {
    ...(data.ai || {}),
    reachable: Boolean(data.ai?.enabled),
    message: data.ai?.enabled ? "Hermes 已配置，点击检测确认连通性" : "Hermes 未启用"
  };
  renderHermesStatus();
}

function renderHermesStatus() {
  const box = document.getElementById("hermesStatus");
  if (!box) return;
  const status = state.hermesStatus || {};
  const isReady = Boolean(status.reachable);
  const isConfigured = Boolean(status.configured || status.enabled);
  box.classList.toggle("ok", isReady);
  box.classList.toggle("bad", !isReady && isConfigured);
  box.classList.toggle("muted", !isConfigured);
  box.classList.toggle("checking", Boolean(status.checking));
  const label = status.checking
    ? "Hermes 检测中"
    : isReady
      ? `Hermes 可用${status.latencyMs ? ` · ${status.latencyMs}ms` : ""}`
      : isConfigured
        ? "Hermes 异常"
        : "Hermes 未配置";
  const detail = [
    status.gatewayHost ? `网关：${status.gatewayHost}` : "",
    status.model ? `模型：${status.model}` : "",
    status.message || ""
  ].filter(Boolean).join("；");
  box.querySelector("span").textContent = label;
  box.title = detail || label;
}

async function checkHermesConnection(options = {}) {
  state.hermesStatus = { ...(state.hermesStatus || {}), checking: true };
  renderHermesStatus();
  const data = await api("/api/hermes/status");
  state.hermesStatus = data.hermes || {};
  renderHermesStatus();
  if (!options.silent) {
    showToast(state.hermesStatus.message || (state.hermesStatus.reachable ? "Hermes 可用" : "Hermes 不可用"));
  }
}

async function loadStudents() {
  const data = await api("/api/students");
  state.students = data.students || [];
  if (!state.selectedId && state.students[0]) state.selectedId = state.students[0].id;
  renderSummary(data.summary || {});
  renderP0Options();
  renderP0Records();
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

async function loadP0Data() {
  const data = await api("/api/p0");
  state.p0Records = {
    attendance: data.attendance || [],
    finance: data.finance || [],
    communications: data.communications || [],
    renewalOrders: data.renewalOrders || []
  };
  renderP0Records(data.summary || null);
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

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysValue(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function isSameMonth(dateText) {
  const now = new Date();
  const date = new Date(`${dateText}T00:00:00`);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isToday(dateText) {
  return dateText === todayValue();
}

function studentNameById(id) {
  return state.students.find(student => String(student.id) === String(id))?.name || "未关联学员";
}

function paymentText(student) {
  const debt = Number(student.debtAmount || 0);
  if (debt > 0) return `${student.paymentStatus || "欠费"} ${currency.format(debt)}`;
  return student.paymentStatus || "已缴清";
}

function studentSelectLabel(student) {
  if (!student) return "";
  const debt = Number(student.debtAmount || 0);
  const debtText = debt > 0 ? ` · 欠 ${currency.format(debt)}` : "";
  return `${student.name} · ${student.course || "未填课程"} · ${student.teacher || "未分配老师"} · 剩 ${student.lessonsLeft ?? 0} 节${debtText}`;
}

function studentSearchText(student) {
  return [
    student.name,
    student.course,
    student.teacher,
    student.paymentStatus,
    student.debtAmount,
    student.lessonsLeft,
    student.lastContact,
    student.status
  ].map(value => String(value || "").toLowerCase()).join(" ");
}

function getStudentOptionsSource() {
  const byId = new Map();
  [...state.students, ...(state.scheduleMeta?.students || [])].forEach(student => {
    if (student?.id !== undefined) byId.set(String(student.id), { ...byId.get(String(student.id)), ...student });
  });
  return [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
}

function selectedStudentsFor(select) {
  if (!select) return [];
  const selectedValues = new Set([...select.selectedOptions].map(option => String(option.value)));
  return getStudentOptionsSource().filter(student => selectedValues.has(String(student.id)));
}

function syncStudentPickerButton(select) {
  if (!select) return;
  const field = select.closest(".student-picker-field");
  const button = field?.querySelector(".student-picker-trigger");
  const label = field?.querySelector(".student-picker-label");
  const meta = field?.querySelector(".student-picker-meta");
  if (!button || !label || !meta) return;
  const selected = selectedStudentsFor(select);
  const isMultiple = select.multiple;
  label.textContent = selected.length
    ? (isMultiple ? `已选择 ${selected.length} 位学员` : selected[0].name)
    : (field.dataset.placeholder || "选择学员");
  meta.textContent = selected.length
    ? (isMultiple ? selected.map(student => student.name).slice(0, 4).join("、") + (selected.length > 4 ? "…" : "") : studentSelectLabel(selected[0]))
    : "点击后搜索姓名、课程、老师、欠费状态";
  button.classList.toggle("has-value", selected.length > 0);
}

function syncStudentPickerButtons() {
  document.querySelectorAll(".student-picker-native").forEach(syncStudentPickerButton);
}

function renderP0Options() {
  const studentOptions = state.students.map(student => `<option value="${student.id}">${student.name} · 剩余 ${student.lessonsLeft} 课时</option>`).join("");
  ["p0AttendanceStudent", "p0FinanceStudent", "p0CommunicationStudent", "p0RecordStudentFilter"].forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      const previousValue = select.value;
      select.innerHTML = ["p0FinanceStudent", "p0RecordStudentFilter"].includes(id) ? `<option value="">全部学员</option>${studentOptions}` : studentOptions;
      if ([...select.options].some(option => option.value === previousValue)) select.value = previousValue;
    }
  });
  syncStudentPickerButtons();
}

function renderP0Dashboard(summary = null) {
  if (summary) {
    const values = {
      p0TodayAttendance: summary.todayAttendanceCount || 0,
      p0MonthLessons: summary.monthConsumedLessons || 0,
      p0MonthIncome: currency.format(summary.monthIncome || 0),
      p0MonthProfit: currency.format(summary.monthProfit || 0),
      p0FollowUps: summary.pendingFollowUps || 0
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });
    return;
  }

  const attendance = state.p0Records.attendance;
  const finance = state.p0Records.finance;
  const communications = state.p0Records.communications;
  const activeAttendance = attendance.filter(item => item.status !== "作废");
  const activeFinance = finance.filter(item => item.status !== "作废");
  const monthAttendance = activeAttendance.filter(item => isSameMonth(item.date));
  const monthIncome = activeFinance.filter(item => item.direction === "income" && isSameMonth(item.date)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const monthExpense = activeFinance.filter(item => item.direction === "expense" && isSameMonth(item.date)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const followUps = communications.filter(item => item.status === "待跟进").length;

  const values = {
    p0TodayAttendance: activeAttendance.filter(item => isToday(item.date)).length,
    p0MonthLessons: monthAttendance.reduce((sum, item) => sum + Number(item.consumedLessons ?? item.lessons ?? 0), 0),
    p0MonthIncome: currency.format(monthIncome),
    p0MonthProfit: currency.format(monthIncome - monthExpense),
    p0FollowUps: followUps
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
}

function followUpPriority(record) {
  if (record.status !== "待跟进") return 9;
  if (!record.nextFollowUp) return 3;
  if (record.nextFollowUp < todayValue()) return 0;
  if (record.nextFollowUp === todayValue()) return 1;
  return 2;
}

function followUpLabel(record) {
  if (!record.nextFollowUp) return "未设置日期";
  if (record.nextFollowUp < todayValue()) return `逾期 ${record.nextFollowUp}`;
  if (record.nextFollowUp === todayValue()) return "今日到期";
  return `计划 ${record.nextFollowUp}`;
}

function renderP0FollowUpTasks() {
  const container = document.getElementById("p0FollowUpTasks");
  const hint = document.getElementById("p0FollowUpHint");
  if (!container) return;
  const tasks = state.p0Records.communications
    .filter(item => item.status === "待跟进")
    .sort((a, b) => followUpPriority(a) - followUpPriority(b) || String(a.nextFollowUp || "").localeCompare(String(b.nextFollowUp || "")))
    .slice(0, 6);
  if (hint) {
    const overdue = state.p0Records.communications.filter(item => item.status === "待跟进" && item.nextFollowUp && item.nextFollowUp < todayValue()).length;
    const today = state.p0Records.communications.filter(item => item.status === "待跟进" && item.nextFollowUp === todayValue()).length;
    hint.textContent = overdue || today ? `逾期 ${overdue} 条，今日 ${today} 条` : "暂无今日到期，保持节奏";
  }
  if (!tasks.length) {
    container.innerHTML = "<p class=\"empty-state\">暂无待跟进沟通</p>";
    return;
  }
  container.innerHTML = tasks.map(item => {
    const priority = followUpPriority(item);
    const cls = priority === 0 ? "overdue" : priority === 1 ? "today" : "";
    return `
      <article class="${cls}">
        <div>
          <strong>${item.studentName || studentNameById(item.studentId)} · ${item.scenario}</strong>
          <small>${followUpLabel(item)} · ${item.channel || "未填方式"}</small>
          ${item.content ? `<p>${item.content}</p>` : ""}
        </div>
        <span class="record-actions">
          <button type="button" data-focus-student="${item.studentId}">查看</button>
          <button type="button" data-complete-communication="${item.id}">完成</button>
        </span>
      </article>
    `;
  }).join("");
}

function recordSnippet(item, type) {
  const statusTag = item.status === "作废" ? "<em>已作废</em>" : "";
  if (type === "attendance") {
    const feedbackTag = item.feedback ? "<em class=\"ok\">已反馈</em>" : "";
    const actions = item.status === "作废" ? "" : `<span class="record-actions"><button type="button" data-feedback-attendance="${item.id}">${item.feedback ? "再生成" : "生成反馈"}</button><button type="button" data-void-attendance="${item.id}">作废</button></span>`;
    return `<div><strong>${item.date} · ${item.studentName || studentNameById(item.studentId)} ${statusTag} ${feedbackTag}</strong><small>${item.status} · 扣 ${item.consumedLessons ?? item.lessons ?? 0} 课时 · ${item.course || "未填课程"}</small></div>${actions}`;
  }
  if (type === "finance") {
    const prefix = item.direction === "income" ? "收入" : "支出";
    const action = item.status === "作废" ? "" : `<button type="button" data-void-finance="${item.id}">作废</button>`;
    return `<div><strong>${item.date} · ${prefix} ${currency.format(Number(item.amount || 0))} ${statusTag}</strong><small>${item.category} · ${item.studentName || studentNameById(item.studentId)} · ${item.paymentMethod || "未填方式"}</small></div>${action}`;
  }
  const action = item.status === "待跟进" ? `<button type="button" data-complete-communication="${item.id}">完成</button>` : "";
  return `<div><strong>${item.date} · ${item.studentName || studentNameById(item.studentId)}</strong><small>${item.scenario} · ${item.channel} · ${item.status}</small></div>${action}`;
}

function recordSearchText(item, type) {
  return [
    type,
    item.date,
    item.studentName || studentNameById(item.studentId),
    item.course,
    item.teacher,
    item.status,
    item.category,
    item.direction,
    item.paymentMethod,
    item.scenario,
    item.channel,
    item.note,
    item.content
  ].map(value => String(value || "").toLowerCase()).join(" ");
}

function filterP0Records(records, type) {
  const filters = state.p0Filters;
  const query = filters.query.trim().toLowerCase();
  return records.filter(item => {
    const date = item.date || "";
    if (filters.studentId && String(item.studentId || "") !== String(filters.studentId)) return false;
    if (filters.startDate && date < filters.startDate) return false;
    if (filters.endDate && date > filters.endDate) return false;
    if (filters.status === "active" && item.status === "作废") return false;
    if (filters.status === "voided" && item.status !== "作废") return false;
    if (filters.status === "pending" && item.status !== "待跟进") return false;
    if (filters.status === "done" && !["已完成", "已反馈"].includes(String(item.status || "")) && !item.feedback) return false;
    if (query && !recordSearchText(item, type).includes(query)) return false;
    return true;
  });
}

function renderP0FilterSummary(filtered) {
  const summary = document.getElementById("p0FilterSummary");
  if (!summary) return;
  const attendanceLessons = filtered.attendance.reduce((sum, item) => sum + Number(item.consumedLessons ?? item.lessons ?? 0), 0);
  const income = filtered.finance.filter(item => item.direction === "income" && item.status !== "作废").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expense = filtered.finance.filter(item => item.direction === "expense" && item.status !== "作废").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  summary.innerHTML = `
    <span>课消 ${filtered.attendance.length} 条 / ${attendanceLessons} 课时</span>
    <span>收入 ${currency.format(income)}</span>
    <span>支出 ${currency.format(expense)}</span>
    <span>沟通 ${filtered.communications.length} 条</span>
  `;
}

function currentFilteredP0Records() {
  return {
    attendance: filterP0Records(state.p0Records.attendance, "attendance"),
    finance: filterP0Records(state.p0Records.finance, "finance"),
    communications: filterP0Records(state.p0Records.communications, "communication")
  };
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsvFile(fileName, rows) {
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function p0ExportRows(filtered) {
  const rows = [["类型", "日期", "学员", "项目/场景", "课程/老师", "金额", "课时", "状态", "方式", "备注/内容"]];
  filtered.attendance.forEach(item => rows.push([
    "课消考勤",
    item.date,
    item.studentName || studentNameById(item.studentId),
    item.status,
    `${item.course || ""} ${item.teacher || ""}`.trim(),
    "",
    item.consumedLessons ?? item.lessons ?? 0,
    item.status || "有效",
    "",
    item.note || ""
  ]));
  filtered.finance.forEach(item => rows.push([
    "财务流水",
    item.date,
    item.studentName || studentNameById(item.studentId),
    item.category || "",
    item.direction === "income" ? "收入" : "支出",
    item.amount || 0,
    item.lessons || 0,
    item.status || "有效",
    item.paymentMethod || "",
    item.note || ""
  ]));
  filtered.communications.forEach(item => rows.push([
    "家校沟通",
    item.date,
    item.studentName || studentNameById(item.studentId),
    item.scenario || "",
    "",
    "",
    "",
    item.status || "",
    item.channel || "",
    item.content || ""
  ]));
  return rows;
}

function exportP0Records() {
  const filtered = currentFilteredP0Records();
  const rows = p0ExportRows(filtered);
  if (rows.length <= 1) return showToast("当前筛选条件下没有可导出的记录");
  const date = todayValue();
  downloadCsvFile(`P0业务台账-${date}.csv`, rows);
  showToast(`已导出 ${rows.length - 1} 条业务记录`);
}

function renderP0RecordList(id, records, type) {
  const container = document.getElementById(id);
  if (!container) return;
  if (!records.length) {
    container.innerHTML = "<p class=\"empty-state\">暂无记录</p>";
    return;
  }
  container.innerHTML = records.slice(0, 6).map(item => `<article>${recordSnippet(item, type)}</article>`).join("");
}

function ensureStudentLedgerSection() {
  if (document.getElementById("studentLedgerSummary")) return;
  const growthSection = document.querySelector(".growth-section");
  if (!growthSection) return;
  const section = document.createElement("div");
  section.className = "student-ledger-section";
  section.innerHTML = `
    <div class="section-title"><h3>业务记录</h3><small>课消、缴费与家校沟通历史</small></div>
    <div id="studentLedgerSummary" class="student-ledger-summary"></div>
    <div class="student-ledger-grid">
      <div><h4>课消记录</h4><div id="studentAttendanceLedger" class="student-ledger-list"></div></div>
      <div><h4>缴费记录</h4><div id="studentFinanceLedger" class="student-ledger-list"></div></div>
      <div><h4>沟通记录</h4><div id="studentCommunicationLedger" class="student-ledger-list"></div></div>
    </div>
  `;
  growthSection.insertAdjacentElement("afterend", section);
}

function ensureAiRiskSection() {
  if (document.getElementById("aiRiskBox")) return;
  const insightBand = document.querySelector(".insight-band");
  if (!insightBand) return;
  const section = document.createElement("div");
  section.className = "ai-risk-section";
  section.innerHTML = `
    <div class="section-title">
      <h3>AI 风险评估</h3>
      <button id="generateRiskButton" type="button">生成 AI 评估</button>
    </div>
    <div id="aiRiskBox" class="ai-risk-box">结合课消、财务、沟通记录生成续费风险建议。</div>
  `;
  insightBand.insertAdjacentElement("afterend", section);
}

function ensureRenewalOrderSection() {
  if (document.getElementById("renewalOrderForm")) return;
  const insightBand = document.querySelector(".insight-band");
  if (!insightBand) return;
  const section = document.createElement("div");
  section.className = "renewal-order-section";
  section.innerHTML = `
    <div class="section-title">
      <div><h3>续费订单</h3><small>意向、收款、课时入账与欠费跟进</small></div>
    </div>
    <form id="renewalOrderForm" class="renewal-order-form">
      <label>续费课程<input name="course" required></label>
      <label>续费课时<input name="lessons" type="number" min="0.5" step="0.5" value="24" required></label>
      <label>应收金额<input name="amountDue" type="number" min="1" value="3980" required></label>
      <label>本次实收<input name="amountPaid" type="number" min="0" value="0"></label>
      <label>支付方式<select name="paymentMethod"><option value="微信">微信</option><option value="支付宝">支付宝</option><option value="现金">现金</option><option value="银行转账">银行转账</option><option value="其他">其他</option></select></label>
      <label class="wide">备注<textarea name="note" rows="2" placeholder="例如：春季班续费，尾款明天补齐"></textarea></label>
      <button class="primary wide" type="submit">创建续费订单</button>
    </form>
    <div id="renewalOrderList" class="renewal-order-list"></div>
  `;
  insightBand.insertAdjacentElement("afterend", section);
}

function renderLedgerList(id, records, emptyText, renderItem) {
  const container = document.getElementById(id);
  if (!container) return;
  if (!records.length) {
    container.innerHTML = `<p class="empty-state">${emptyText}</p>`;
    return;
  }
  container.innerHTML = records.slice(0, 6).map(renderItem).join("");
}

function renderStudentLedgerSummary(attendance, finance, communications) {
  const container = document.getElementById("studentLedgerSummary");
  if (!container) return;
  const activeAttendance = attendance.filter(item => item.status !== "作废");
  const activeFinance = finance.filter(item => item.status !== "作废");
  const consumedLessons = activeAttendance.reduce((sum, item) => sum + Number(item.consumedLessons || 0), 0);
  const income = activeFinance.filter(item => item.direction === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expense = activeFinance.filter(item => item.direction === "expense").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingCommunications = communications.filter(item => item.status === "待跟进").length;
  const latestDates = [...attendance, ...finance, ...communications].map(item => item.date).filter(Boolean).sort().reverse();
  container.innerHTML = `
    <div><span>${activeAttendance.length}</span><small>有效课消记录</small></div>
    <div><span>${consumedLessons}</span><small>累计课消课时</small></div>
    <div><span>${currency.format(income - expense)}</span><small>净收入</small></div>
    <div><span>${pendingCommunications}</span><small>待跟进沟通</small></div>
    <div><span>${latestDates[0] || "-"}</span><small>最近业务日期</small></div>
  `;
}

function ledgerNote(text) {
  const value = String(text || "").trim();
  return value ? `<p>${value}</p>` : "";
}

function renderRenewalOrders(student) {
  ensureRenewalOrderSection();
  const form = document.getElementById("renewalOrderForm");
  const list = document.getElementById("renewalOrderList");
  if (!student || !form || !list) return;
  if (!form.course.value) form.course.value = student.course || "";
  if (form.amountDue && Number(student.debtAmount || 0) > 0) form.amountDue.value = student.debtAmount;
  const orders = (state.p0Records.renewalOrders || [])
    .filter(item => String(item.studentId) === String(student.id))
    .sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")));
  if (!orders.length) {
    list.innerHTML = "<p class=\"empty-state\">暂无续费订单</p>";
    return;
  }
  list.innerHTML = orders.slice(0, 5).map(order => {
    const debt = Number(order.debtAmount || 0);
    const action = debt > 0 && order.status !== "已取消"
      ? `<form class="renewal-payment-form" data-renewal-payment="${order.id}">
          <input name="amount" type="number" min="1" max="${debt}" value="${debt}" aria-label="收款金额">
          <select name="paymentMethod" aria-label="支付方式"><option value="微信">微信</option><option value="支付宝">支付宝</option><option value="现金">现金</option><option value="银行转账">银行转账</option><option value="其他">其他</option></select>
          <button type="submit">记录收款</button>
        </form>`
      : "";
    return `<article>
      <div>
        <strong>${order.date} · ${order.course} · ${order.status}</strong>
        <small>${order.lessons} 课时 · 应收 ${currency.format(order.amountDue || 0)} · 已收 ${currency.format(order.amountPaid || 0)} · 欠费 ${currency.format(debt)}</small>
        ${ledgerNote(order.note)}
      </div>
      ${action}
    </article>`;
  }).join("");
}

function renderStudentLedger(student) {
  ensureStudentLedgerSection();
  if (!student) return;
  const studentId = String(student.id);
  const attendance = state.p0Records.attendance.filter(item => String(item.studentId) === studentId);
  const finance = state.p0Records.finance.filter(item => String(item.studentId) === studentId);
  const communications = state.p0Records.communications.filter(item => String(item.studentId) === studentId);
  renderRenewalOrders(student);
  renderStudentLedgerSummary(attendance, finance, communications);

  renderLedgerList("studentAttendanceLedger", attendance, "暂无课消记录", item => `
    <article class="${item.status === "作废" ? "voided" : ""}">
      <strong>${item.date} · ${item.status}${item.feedback ? " · 已生成反馈" : ""}</strong>
      <small>${item.course || "未填课程"} · ${item.teacher || "未填老师"} · 扣 ${item.consumedLessons || 0} 课时</small>
      <small>课前 ${item.beforeLessons ?? "-"} 节 · 课后 ${item.afterLessons ?? "-"} 节</small>
      ${ledgerNote(item.note)}
    </article>
  `);
  renderLedgerList("studentFinanceLedger", finance, "暂无缴费记录", item => `
    <article class="${item.status === "作废" ? "voided" : ""}">
      <strong>${item.date} · ${item.direction === "income" ? "收入" : "支出"} ${currency.format(item.amount || 0)}</strong>
      <small>${item.category} · ${item.paymentMethod || "未填方式"} · 课时 ${item.lessons || 0} · ${item.status || "有效"}</small>
      ${ledgerNote(item.note)}
    </article>
  `);
  renderLedgerList("studentCommunicationLedger", communications, "暂无沟通记录", item => `
    <article class="${item.status === "作废" ? "voided" : ""}">
      <strong>${item.date} · ${item.scenario}</strong>
      <small>${item.channel} · ${item.status}${item.nextFollowUp ? ` · 下次 ${item.nextFollowUp}` : ""}</small>
      ${ledgerNote(item.content)}
    </article>
  `);
}

function resetAiRiskSection() {
  ensureAiRiskSection();
  const box = document.getElementById("aiRiskBox");
  if (box) box.textContent = "结合课消、财务、沟通记录生成续费风险建议。";
}

function renderP0Records(summary = null) {
  renderP0Dashboard(summary);
  renderP0FollowUpTasks();
  const filtered = currentFilteredP0Records();
  renderP0FilterSummary(filtered);
  renderP0RecordList("p0AttendanceList", filtered.attendance, "attendance");
  renderP0RecordList("p0FinanceList", filtered.finance, "finance");
  renderP0RecordList("p0CommunicationList", filtered.communications, "communication");
}

function initP0Forms() {
  ["p0AttendanceForm", "p0FinanceForm", "p0CommunicationForm"].forEach(id => {
    const form = document.getElementById(id);
    if (form?.date && !form.date.value) form.date.value = todayValue();
  });
}

function syncP0FiltersFromControls() {
  const studentSelect = document.getElementById("p0RecordStudentFilter");
  state.p0Filters = {
    studentId: studentSelect?.value || "",
    startDate: document.getElementById("p0FilterStart")?.value || "",
    endDate: document.getElementById("p0FilterEnd")?.value || "",
    status: document.getElementById("p0FilterStatus")?.value || "active",
    query: document.getElementById("p0RecordSearch")?.value || ""
  };
  renderP0Records();
}

function resetP0Filters() {
  const studentSelect = document.getElementById("p0RecordStudentFilter");
  if (studentSelect) {
    studentSelect.value = "";
    syncStudentPickerButton(studentSelect);
  }
  ["p0FilterStart", "p0FilterEnd", "p0RecordSearch"].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });
  const status = document.getElementById("p0FilterStatus");
  if (status) status.value = "active";
  syncP0FiltersFromControls();
}

function setCommunicationFollowUp(days) {
  const form = document.getElementById("p0CommunicationForm");
  if (!form?.nextFollowUp) return;
  form.nextFollowUp.value = addDaysValue(days);
  if (form.status) form.status.value = "待跟进";
  showToast(days === 0 ? "下次跟进已设为今天" : `下次跟进已设为 ${days} 天后`);
}

function clearCommunicationFollowUp() {
  const form = document.getElementById("p0CommunicationForm");
  if (!form?.nextFollowUp) return;
  form.nextFollowUp.value = "";
  showToast("已清空下次跟进日期");
}

function initQuickLessonDefaults() {
  const form = document.getElementById("quickLessonForm");
  if (form?.date && !form.date.value) form.date.value = todayValue();
}

function openStudentPicker(targetId) {
  const select = document.getElementById(targetId);
  const modal = document.getElementById("studentPickerModal");
  if (!select || !modal) return;
  state.studentPicker.targetId = targetId;
  state.studentPicker.query = "";
  state.studentPicker.selectedIds = new Set([...select.selectedOptions].map(option => String(option.value)).filter(Boolean));
  const field = select.closest(".student-picker-field");
  document.getElementById("studentPickerTitle").textContent = field?.dataset.title || "选择学员";
  document.getElementById("studentPickerSearch").value = "";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  renderStudentPickerModal();
  window.setTimeout(() => document.getElementById("studentPickerSearch")?.focus(), 0);
}

function closeStudentPicker() {
  const modal = document.getElementById("studentPickerModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function renderStudentPickerModal() {
  const select = document.getElementById(state.studentPicker.targetId);
  const list = document.getElementById("studentPickerList");
  const count = document.getElementById("studentPickerCount");
  if (!select || !list || !count) return;
  const query = state.studentPicker.query.trim().toLowerCase();
  const students = getStudentOptionsSource().filter(student => !query || studentSearchText(student).includes(query));
  count.textContent = `${students.length} 人`;
  if (!students.length) {
    list.innerHTML = `<p class="empty-state">没有匹配的学员</p>`;
    return;
  }
  list.innerHTML = students.map(student => {
    const checked = state.studentPicker.selectedIds.has(String(student.id));
    const debt = Number(student.debtAmount || 0);
    return `
      <button type="button" class="student-picker-option ${checked ? "selected" : ""}" data-student-option="${student.id}">
        <span class="student-picker-check">${checked ? "✓" : ""}</span>
        <span class="student-picker-main">
          <strong>${student.name}</strong>
          <small>${student.course || "未填课程"} · ${student.teacher || "未分配老师"} · 剩 ${student.lessonsLeft ?? 0} 节</small>
        </span>
        <span class="student-picker-tags">
          <em class="${debt > 0 ? "debt" : ""}">${debt > 0 ? `欠 ${currency.format(debt)}` : (student.paymentStatus || "已缴清")}</em>
          <em>${student.riskLevel?.text || student.status || "未评估"}</em>
        </span>
      </button>
    `;
  }).join("");
}

function toggleStudentPickerSelection(studentId) {
  const select = document.getElementById(state.studentPicker.targetId);
  if (!select) return;
  const key = String(studentId);
  if (select.multiple) {
    state.studentPicker.selectedIds.has(key) ? state.studentPicker.selectedIds.delete(key) : state.studentPicker.selectedIds.add(key);
  } else {
    state.studentPicker.selectedIds = new Set([key]);
  }
  renderStudentPickerModal();
}

function applyStudentPickerSelection() {
  const select = document.getElementById(state.studentPicker.targetId);
  if (!select) return;
  const selected = state.studentPicker.selectedIds;
  [...select.options].forEach(option => { option.selected = selected.has(String(option.value)); });
  syncStudentPickerButton(select);
  select.dispatchEvent(new Event("change", { bubbles: true }));
  closeStudentPicker();
}

function clearStudentPickerSelection() {
  state.studentPicker.selectedIds.clear();
  renderStudentPickerModal();
}

function applyQuickClassSelection() {
  if (!state.scheduleMeta) return;
  const classId = Number(document.getElementById("quickLessonClass").value);
  const classItem = state.scheduleMeta.classes.find(item => Number(item.id) === classId);
  if (!classItem) return;

  document.getElementById("quickLessonCourse").value = classItem.courseTypeId;
  document.getElementById("quickLessonTeacher").value = classItem.teacherId;
  const studentSelect = document.getElementById("quickLessonStudents");
  [...studentSelect.options].forEach(option => {
    option.selected = (classItem.studentIds || []).map(Number).includes(Number(option.value));
  });
  syncStudentPickerButton(studentSelect);
}

async function createP0Record(collection, payload) {
  const endpoint = {
    attendance: "/api/p0/attendance",
    finance: "/api/p0/finance",
    communications: "/api/p0/communications"
  }[collection];
  const data = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
  await loadP0Data();
  if (data.students) {
    state.students = data.students;
    if (data.businessSummary) renderSummary(data.businessSummary);
    renderP0Options();
    render();
  }
  return data;
}

async function createRenewalOrder(payload) {
  const data = await api("/api/renewal-orders", { method: "POST", body: JSON.stringify(payload) });
  await loadP0Data();
  if (data.students) {
    state.students = data.students;
    if (data.businessSummary) renderSummary(data.businessSummary);
    renderP0Options();
    render();
  }
  return data;
}

async function recordRenewalPayment(orderId, payload) {
  const data = await api(`/api/renewal-orders/${orderId}/payments`, { method: "POST", body: JSON.stringify(payload) });
  await loadP0Data();
  if (data.students) {
    state.students = data.students;
    if (data.businessSummary) renderSummary(data.businessSummary);
    renderP0Options();
    render();
  }
  return data;
}

async function applyP0Mutation(path, successText) {
  const data = await api(path, { method: "POST", body: JSON.stringify({ reason: "前端作废" }) });
  await loadP0Data();
  if (data.students) {
    state.students = data.students;
    if (data.businessSummary) renderSummary(data.businessSummary);
  }
  render();
  showToast(successText);
}

async function generateAiRiskAssessment() {
  const student = selectedStudent();
  if (!student) return;
  ensureAiRiskSection();
  const box = document.getElementById("aiRiskBox");
  const button = document.getElementById("generateRiskButton");
  if (box) box.textContent = "正在生成 AI 风险评估...";
  if (button) button.disabled = true;
  try {
    const data = await api(`/api/students/${student.id}/risk`, { method: "POST", body: JSON.stringify({}) });
    if (box) {
      box.textContent = data.text || "未生成风险评估";
      box.dataset.source = data.source || "template";
    }
    showToast(data.source === "hermes" ? "Hermes 风险评估已生成" : "已使用本地规则生成风险评估");
  } catch (error) {
    if (box) box.textContent = error.message;
    showToast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
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
  document.getElementById("quickLessonClass").innerHTML = `<option value="">不选择班级</option>${state.scheduleMeta.classes.map(item => `<option value="${item.id}">${item.name} · ${item.courseName}</option>`).join("")}`;
  document.getElementById("quickLessonCourse").innerHTML = courseOptions;
  document.getElementById("quickLessonTeacher").innerHTML = teacherOptions;
  document.getElementById("quickLessonRoom").innerHTML = state.scheduleMeta.rooms.map(room => `<option value="${room.id}">${room.name} · ${room.capacity || "-"}人</option>`).join("");
  document.getElementById("quickLessonStudents").innerHTML = studentOptions;
  initQuickLessonDefaults();
  syncStudentPickerButtons();

  renderCourseTypes();
  renderTeachers();
  renderTeacherCalendar();
  renderClasses();
  renderAvailability();
  renderRecommendations();
  renderTeacherPaySettlement();
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
    const payText = teacher.payMethod === "perLessonStudent"
      ? `按课时+人数 · ${currency.format(teacher.payRate || 0)}/课时 + ${currency.format(teacher.studentRate || 0)}/生`
      : `按课时 · ${currency.format(teacher.payRate || 0)}/课时`;
    return `
      <div class="compact-item teacher-item">
        <span class="teacher-summary">
          <strong>${teacher.name}</strong>
          <span class="teacher-meta">${teacher.employmentType || "\u672a\u8bbe\u7f6e"} \u00b7 ${teacher.courseNames || "\u672a\u7ed1\u5b9a\u8bfe\u7a0b"} \u00b7 ${slots.countText}</span>
          <small>${teacher.phone || "\u672a\u586b\u7535\u8bdd"} \u00b7 ${payText} \u00b7 ${slots.previewText}</small>
        </span>
        <button type="button" data-delete-teacher="${teacher.id}">\u5220\u9664</button>
      </div>
    `;
  }).join("") || "<p class=\"empty-state\">\u6682\u65e0\u6559\u5e08\u8d44\u6599</p>";
}

function renderTeacherPaySettlement() {
  const container = document.getElementById("teacherPaySettlement");
  if (!container || !state.scheduleMeta) return;
  const settlements = state.scheduleMeta.teacherPaySettlement || [];
  if (!settlements.length) {
    container.innerHTML = "<p class=\"empty-state\">暂无已课消课节，暂不能生成课酬。</p>";
    return;
  }
  container.innerHTML = settlements.map(item => `
    <article class="teacher-pay-card">
      <div>
        <strong>${item.teacherName}</strong>
        <small>${item.lessonCount} 节课 · ${item.studentCount} 人次 · 应结 ${currency.format(item.totalPay || 0)}</small>
      </div>
      <div class="teacher-pay-lessons">
        ${item.lessons.slice(0, 4).map(lesson => `<span>${new Date(lesson.startTime).toLocaleDateString("zh-CN")} · ${lesson.courseName} · ${lesson.studentCount}人 · ${currency.format(lesson.teacherPay?.amount || 0)}</span>`).join("")}
      </div>
    </article>
  `).join("");
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
      <div class="student-meta ${Number(student.debtAmount || 0) > 0 ? "debt-meta" : ""}">${paymentText(student)}</div>
    `;
    button.addEventListener("click", () => { state.selectedId = student.id; render(); });
    container.appendChild(button);
  });
}

function selectedStudent() {
  return state.students.find(item => item.id === state.selectedId);
}

function focusFoldSection(name) {
  const section = document.querySelector(`[data-fold-section="${name}"]`);
  if (!section) return;
  section.classList.remove("collapsed");
  section.querySelector(".fold-header")?.setAttribute("aria-expanded", "true");
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setSelectValue(selectId, value) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.value = value ?? "";
  syncStudentPickerButton(select);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function focusP0Form(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  window.setTimeout(() => {
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    form.classList.add("focus-pulse");
    window.setTimeout(() => form.classList.remove("focus-pulse"), 1300);
  }, 180);
}

function quickFillStudentAction(action) {
  const student = selectedStudent();
  if (!student) return showToast("请先选择学员");
  focusFoldSection("p0");
  if (action === "attendance") {
    const form = document.getElementById("p0AttendanceForm");
    setSelectValue("p0AttendanceStudent", student.id);
    if (form.course && !form.course.value) form.course.value = student.course || "";
    if (form.teacher && !form.teacher.value) form.teacher.value = student.teacher || "";
    if (form.lessons && !form.lessons.value) form.lessons.value = 1;
    focusP0Form("p0AttendanceForm");
    showToast(`已带入 ${student.name} 的课消表单`);
    return;
  }
  if (action === "finance") {
    const form = document.getElementById("p0FinanceForm");
    setSelectValue("p0FinanceStudent", student.id);
    if (form.direction) form.direction.value = "income";
    if (form.category) form.category.value = "续费";
    if (form.amount && Number(student.debtAmount || 0) > 0) form.amount.value = student.debtAmount;
    focusP0Form("p0FinanceForm");
    showToast(`已带入 ${student.name} 的缴费表单`);
    return;
  }
  if (action === "communication") {
    setSelectValue("p0CommunicationStudent", student.id);
    focusP0Form("p0CommunicationForm");
    showToast(`已带入 ${student.name} 的沟通表单`);
  }
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
  const contactSummary = document.getElementById("studentContactSummary");
  if (contactSummary) {
    const contactItems = [
      student.birthMonth ? `出生年月：${student.birthMonth}` : "",
      `家长电话：${student.parentPhone || "未填写"}`,
      student.parentWechat ? `微信：${student.parentWechat}` : "",
      student.parentEmail ? `邮箱：${student.parentEmail}` : ""
    ].filter(Boolean);
    contactSummary.innerHTML = contactItems.map(item => `<span>${item}</span>`).join("");
  }
  riskBadge.textContent = student.riskLevel.text;
  riskBadge.className = `risk-badge ${student.riskLevel.className}`;
  document.getElementById("riskScore").textContent = student.riskScore;
  const lessonsLeftNode = document.getElementById("lessonsLeft");
  lessonsLeftNode.textContent = student.lessonsLeft;
  lessonsLeftNode.title = student.lessonsLeftSource || "系统计算";
  document.getElementById("daysToEnd").textContent = student.daysToEnd;
  document.getElementById("renewalValue").textContent = currency.format(student.renewalValue);
  document.getElementById("renewalValue").insertAdjacentHTML("beforeend", Number(student.debtAmount || 0) > 0 ? `<small class="metric-debt">欠 ${currency.format(student.debtAmount)}</small>` : "");
  document.getElementById("nextAction").textContent = student.nextAction;
  document.getElementById("riskReasons").innerHTML = student.riskReasons.map(reason => `<li>${reason}</li>`).join("");
  resetAiRiskSection();
  document.getElementById("growthTimeline").innerHTML = student.proof.map(item => `<article class="proof-card"><strong>${item[0]}</strong><p>${item[1]}</p></article>`).join("");
  renderStudentLedger(student);
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
  const fields = ["age", "birthMonth", "parentPhone", "parentEmail", "parentWechat", "teacher", "course", "paidAt", "paidAmount", "paymentStatus", "debtAmount", "prepaidLessons", "daysToEnd", "absentRate", "parentReplies", "homeworkMissed", "lastContact"];
  fields.forEach(name => {
    if (form[name] && record[name] !== undefined && record[name] !== null && record[name] !== "") form[name].value = record[name];
  });
  if (form.lessonsLeft) form.lessonsLeft.value = "";
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
  form.paymentStatus.value = "已缴清";
  form.debtAmount.value = 0;
  form.prepaidLessons.value = 24;
  form.lessonsLeft.value = "";
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
    payMethod: form.payMethod.value,
    payRate: form.payRate.value,
    studentRate: form.studentRate.value,
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
  form.payRate.value = 0;
  form.studentRate.value = 0;
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

function downloadStudentImportTemplate() {
  const rows = [
    ["姓名", "年龄", "出生年月", "家长电话", "家长邮箱", "家长微信", "课程", "老师", "缴费时间", "缴费金额", "缴费状态", "欠费金额", "预缴课时", "剩余课时", "预计课消天数", "缺勤率", "家长回复", "作业缺交", "最近联系", "成长证据"],
    ["王一诺", "8", "2018-05", "13800000000", "parent@example.com", "wx_wang", "创意美术", "周老师", todayValue(), "3980", "已缴清", "0", "32", "", "14", "0", "1", "0", "未联系", "色彩层次提升明显"],
    ["李小美", "7", "2019-03", "13900000000", "", "wx_li", "素描基础", "李老师", todayValue(), "1000", "部分缴费", "1980", "24", "", "10", "5", "0", "1", "已微信沟通", "线条控制更稳定"]
  ];
  downloadCsvFile(`学员批量导入模板-${todayValue()}.csv`, rows);
  showToast("已下载学员批量导入模板");
}

function mergeImportedStudents(imported, current) {
  const importedIds = new Set(imported.map(item => item.id));
  return [
    ...imported,
    ...current.filter(student => !importedIds.has(student.id))
  ].sort((a, b) => b.riskScore - a.riskScore);
}

async function extractKnowledgeCandidates() {
  const data = await api("/api/knowledge/extract", { method: "POST", body: JSON.stringify({}) });
  state.knowledgeCandidates = data.candidates || [];
  state.knowledgeImportReport = null;
  renderKnowledgeCandidates();
  const summary = data.summary;
  showToast(summary ? `识别 ${summary.total} 条：新增 ${summary.create}，更新 ${summary.update}，需补充 ${summary.invalid}` : `识别到 ${state.knowledgeCandidates.length} 条候选记录`);
}

function renderKnowledgeCandidates() {
  const container = document.getElementById("knowledgeCandidates");
  if (!state.knowledgeCandidates.length) {
    container.innerHTML = "";
    return;
  }
  const total = state.knowledgeCandidates.length;
  const createCount = state.knowledgeCandidates.filter(item => item.importAction === "create").length;
  const updateCount = state.knowledgeCandidates.filter(item => item.importAction === "update").length;
  const invalidCount = state.knowledgeCandidates.filter(item => item.importAction === "invalid").length;
  const summary = `<div class="import-summary"><span>共 ${total} 条</span><span>新增 ${createCount}</span><span>更新 ${updateCount}</span><span>需补充 ${invalidCount}</span></div>`;
  container.innerHTML = state.knowledgeCandidates.map((candidate, index) => {
    const missing = candidate.missing?.length ? `<p class="candidate-warning">缺少必填项：${candidate.missing.join("、")}</p>` : "";
    const proof = candidate.proof?.map(item => `${item[0]}：${item[1]}`).join("<br>") || "";
    const actionText = candidate.importAction === "update" ? "更新已有" : candidate.importAction === "invalid" ? "需补充" : "新增";
    const actionClass = candidate.importAction === "update" ? "update" : candidate.importAction === "invalid" ? "invalid" : "create";
    const lessons = candidate.lessonsLeft === undefined || candidate.lessonsLeft === "" ? `预缴 ${candidate.prepaidLessons ?? 0} 节自动计算` : `剩 ${candidate.lessonsLeft} 节`;
    const payment = `${candidate.paymentStatus || "已缴清"}${Number(candidate.debtAmount || 0) > 0 ? ` · 欠 ${currency.format(candidate.debtAmount)}` : ""}`;
    return `<label class="candidate-card ${actionClass}"><input type="checkbox" data-candidate-index="${index}" ${candidate.missing?.length ? "" : "checked"}><div><div class="candidate-title-row"><strong>${candidate.name || "未识别姓名"}</strong><em>${actionText}</em></div><p>${candidate.course || "未识别课程"} · ${candidate.teacher || "未识别老师"} · 来源：${candidate.source}</p><p>${lessons} · 预缴 ${candidate.prepaidLessons ?? 0} 节 · 缴费 ${currency.format(candidate.paidAmount || candidate.renewalValue || 0)} · ${payment}</p><p class="candidate-proof">${proof}</p>${missing}</div></label>`;
  }).join("");
  container.insertAdjacentHTML("afterbegin", summary);
}

async function importKnowledgeCandidates() {
  const checked = [...document.querySelectorAll("[data-candidate-index]:checked")];
  const candidates = checked.map(input => state.knowledgeCandidates[Number(input.dataset.candidateIndex)]);
  if (!candidates.length) return showToast("请选择要导入的记录");
  const data = await api("/api/knowledge/import", { method: "POST", body: JSON.stringify({ candidates }) });
  state.knowledgeImportReport = data;
  if (!data.imported.length) return showToast("没有可导入的完整记录，可下载导入报告查看原因");
  state.students = mergeImportedStudents(data.imported, state.students);
  state.selectedId = data.imported[0].id;
  renderSummary(data.summary);
  render();
  await loadScheduleMeta();
  const summary = data.importSummary;
  showToast(summary ? `已导入 ${summary.imported} 条：新增 ${summary.created}，更新 ${summary.updated}，跳过 ${summary.skipped}` : `已导入 ${data.imported.length} 位学员`);
}

function downloadKnowledgeImportReport() {
  const report = state.knowledgeImportReport;
  if (!report) return showToast("请先执行一次导入，再下载导入报告");
  const imported = (report.imported || []).map(item => [
    "成功",
    item.importAction === "update" ? "更新已有" : "新增",
    item.name,
    item.course,
    item.teacher,
    item.paymentStatus || "",
    item.debtAmount || 0,
    item.prepaidLessons ?? "",
    item.lessonsLeft ?? "",
    item.source || "",
    ""
  ]);
  const skipped = (report.skipped || []).map(item => [
    "跳过",
    item.importAction === "invalid" ? "资料不完整" : "未导入",
    item.name || "",
    item.course || "",
    item.teacher || "",
    item.paymentStatus || "",
    item.debtAmount || 0,
    item.prepaidLessons ?? "",
    item.lessonsLeft ?? "",
    item.source || "",
    item.reason || (item.missing?.length ? `缺少必填项：${item.missing.join("、")}` : "")
  ]);
  const rows = [["结果", "动作", "姓名", "课程", "老师", "缴费状态", "欠费金额", "预缴课时", "剩余课时", "来源", "原因"], ...imported, ...skipped];
  downloadCsvFile(`学员导入报告-${todayValue()}.csv`, rows);
  showToast(`已下载导入报告：成功 ${imported.length} 条，跳过 ${skipped.length} 条`);
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
  syncStudentPickerButtons();
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

function quickLessonPayload(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  const date = body.date || todayValue();
  body.startTime = new Date(`${date}T${body.startTime || "10:00"}:00`).toISOString();
  body.endTime = body.endTime ? new Date(`${date}T${body.endTime}:00`).toISOString() : "";
  body.studentIds = [...form.studentIds.selectedOptions].map(option => Number(option.value));
  body.force = Boolean(form.force?.checked);
  return body;
}

async function createQuickLesson(form) {
  const body = quickLessonPayload(form);
  if (!body.studentIds.length) return showToast("请至少选择一位学员");
  try {
    const data = await api("/api/schedule/lessons", { method: "POST", body: JSON.stringify(body) });
    state.lessons = [...state.lessons, data.lesson].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    await Promise.all([loadScheduleMeta(), loadLessons()]);
    syncStudentPickerButtons();
    showToast("快速课表已生成");
  } catch (error) {
    if (String(error.message || "").includes("冲突")) {
      showToast("存在排课冲突，可勾选“有冲突也保存”后重试");
      return;
    }
    showToast(error.message);
  }
}

async function completeLesson(id) {
  const data = await api(`/api/schedule/lessons/${id}/complete`, { method: "POST" });
  state.lessons = state.lessons.map(lesson => lesson.id === data.lesson.id ? data.lesson : lesson);
  state.students = data.students;
  renderLessons();
  renderSummary(data.summary);
  await loadScheduleMeta();
  await loadP0Data();
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
  document.getElementById("checkHermesButton").addEventListener("click", () => checkHermesConnection().catch(error => {
    state.hermesStatus = { ...(state.hermesStatus || {}), reachable: false, checking: false, message: error.message };
    renderHermesStatus();
    showToast(error.message);
  }));
  document.getElementById("closeNotificationButton").addEventListener("click", () => document.getElementById("notificationDrawer").classList.remove("open"));
  document.getElementById("triggerRiskNotificationsButton").addEventListener("click", () => triggerRiskNotifications().catch(error => showToast(error.message)));
  document.getElementById("markAllNotificationsButton").addEventListener("click", () => markAllNotificationsRead().catch(error => showToast(error.message)));
  document.getElementById("notificationList").addEventListener("click", event => { const button = event.target.closest("[data-read-notification]"); if (button) markNotificationRead(button.dataset.readNotification).catch(error => showToast(error.message)); });

  document.body.addEventListener("click", event => {
    const openButton = event.target.closest("[data-open-student-picker]");
    if (openButton) {
      openStudentPicker(openButton.dataset.openStudentPicker);
      return;
    }
    if (event.target.closest("[data-close-student-picker]")) {
      closeStudentPicker();
      return;
    }
    const optionButton = event.target.closest("[data-student-option]");
    if (optionButton) {
      toggleStudentPickerSelection(optionButton.dataset.studentOption);
      return;
    }
    if (event.target.closest("[data-apply-student-picker]")) {
      applyStudentPickerSelection();
      return;
    }
    if (event.target.closest("[data-clear-student-picker]")) {
      clearStudentPickerSelection();
    }
  });
  document.getElementById("studentPickerSearch").addEventListener("input", event => {
    state.studentPicker.query = event.target.value;
    renderStudentPickerModal();
  });
  document.getElementById("studentPickerModal").addEventListener("click", event => {
    if (event.target.id === "studentPickerModal") closeStudentPicker();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeStudentPicker();
  });

  document.getElementById("p0AttendanceForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    createP0Record("attendance", body).then(() => {
      form.note.value = "";
      showToast("课消考勤已保存，学员课时已同步更新");
    }).catch(error => showToast(error.message));
  });
  document.getElementById("p0FinanceForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    createP0Record("finance", body)
      .then(() => showToast("财务流水已保存"))
      .catch(error => showToast(error.message));
  });
  document.getElementById("p0CommunicationForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    createP0Record("communications", body).then(() => {
      form.content.value = "";
      showToast("家校沟通已保存");
    }).catch(error => showToast(error.message));
  });
  document.getElementById("p0CommunicationForm").addEventListener("click", event => {
    const dayButton = event.target.closest("[data-followup-days]");
    if (dayButton) {
      setCommunicationFollowUp(Number(dayButton.dataset.followupDays));
      return;
    }
    if (event.target.closest("[data-followup-clear]")) clearCommunicationFollowUp();
  });
  document.getElementById("p0UseMessageButton").addEventListener("click", () => {
    const message = document.getElementById("messageBox").value.trim();
    if (!message) return showToast("请先在学员详情中生成话术");
    const student = selectedStudent();
    if (student) {
      const select = document.getElementById("p0CommunicationStudent");
      select.value = student.id;
      syncStudentPickerButton(select);
    }
    document.getElementById("p0CommunicationContent").value = message;
    showToast("已把当前 Hermes 话术带入沟通记录");
  });
  document.getElementById("p0RefreshButton").addEventListener("click", () => loadP0Data().then(() => showToast("P0 业务记录已刷新")).catch(error => showToast(error.message)));
  ["p0FilterStart", "p0FilterEnd", "p0FilterStatus", "p0RecordSearch"].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.addEventListener("input", syncP0FiltersFromControls);
  });
  document.getElementById("p0RecordStudentFilter").addEventListener("change", syncP0FiltersFromControls);
  document.getElementById("p0ExportRecordsButton").addEventListener("click", exportP0Records);
  document.getElementById("p0ResetFiltersButton").addEventListener("click", resetP0Filters);
  document.getElementById("p0FollowUpTasks").addEventListener("click", event => {
    const focusButton = event.target.closest("[data-focus-student]");
    const completeButton = event.target.closest("[data-complete-communication]");
    if (focusButton) {
      state.selectedId = Number(focusButton.dataset.focusStudent);
      focusFoldSection("dashboard");
      render();
      return;
    }
    if (completeButton) applyP0Mutation(`/api/p0/communications/${completeButton.dataset.completeCommunication}/complete`, "沟通记录已完成").catch(error => showToast(error.message));
  });
  document.querySelector(".p0-records").addEventListener("click", event => {
    const attendanceButton = event.target.closest("[data-void-attendance]");
    const feedbackButton = event.target.closest("[data-feedback-attendance]");
    const financeButton = event.target.closest("[data-void-finance]");
    const communicationButton = event.target.closest("[data-complete-communication]");
    if (feedbackButton) {
      applyP0Mutation(`/api/p0/attendance/${feedbackButton.dataset.feedbackAttendance}/feedback`, "课后反馈已生成并保存为沟通记录").catch(error => showToast(error.message));
    }
    if (attendanceButton && window.confirm("作废这条课消记录并回滚学员课时？")) {
      applyP0Mutation(`/api/p0/attendance/${attendanceButton.dataset.voidAttendance}/void`, "课消记录已作废，课时已回滚").catch(error => showToast(error.message));
    }
    if (financeButton && window.confirm("作废这条财务流水？若它曾增加课时，将同步回滚。")) {
      applyP0Mutation(`/api/p0/finance/${financeButton.dataset.voidFinance}/void`, "财务流水已作废").catch(error => showToast(error.message));
    }
    if (communicationButton) {
      applyP0Mutation(`/api/p0/communications/${communicationButton.dataset.completeCommunication}/complete`, "沟通记录已标记完成").catch(error => showToast(error.message));
    }
  });

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
  document.getElementById("quickLessonClass").addEventListener("change", applyQuickClassSelection);
  document.getElementById("quickFillClassButton").addEventListener("click", applyQuickClassSelection);
  document.getElementById("quickLessonForm").addEventListener("submit", event => { event.preventDefault(); createQuickLesson(event.currentTarget); });
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
  document.querySelector(".detail-panel").addEventListener("click", event => {
    const quickAction = event.target.closest("[data-student-quick-action]");
    if (quickAction) quickFillStudentAction(quickAction.dataset.studentQuickAction);
    if (event.target.closest("#generateRiskButton")) generateAiRiskAssessment();
  });
  document.querySelector(".detail-panel").addEventListener("submit", event => {
    if (event.target.id === "renewalOrderForm") {
      event.preventDefault();
      const student = selectedStudent();
      if (!student) return showToast("请先选择学员");
      const body = Object.fromEntries(new FormData(event.target).entries());
      body.studentId = student.id;
      body.date = todayValue();
      createRenewalOrder(body).then(() => {
        event.target.note.value = "";
        showToast("续费订单已创建，收款和欠费已同步");
      }).catch(error => showToast(error.message));
      return;
    }
    const paymentForm = event.target.closest("[data-renewal-payment]");
    if (paymentForm) {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(paymentForm).entries());
      body.date = todayValue();
      recordRenewalPayment(paymentForm.dataset.renewalPayment, body)
        .then(() => showToast("续费收款已记录，课时和欠费已同步"))
        .catch(error => showToast(error.message));
    }
  });
  document.getElementById("studentForm").addEventListener("submit", event => { event.preventDefault(); createStudent(event.currentTarget).catch(error => showToast(error.message)); });
  document.getElementById("studentNameInput").addEventListener("input", event => { clearTimeout(state.lookupTimer); state.lookupTimer = setTimeout(() => lookupStudentByName(event.target.value).catch(error => showToast(error.message)), 350); });
  document.getElementById("resetStudentForm").addEventListener("click", () => document.getElementById("studentForm").reset());
  document.getElementById("downloadImportTemplateButton").addEventListener("click", downloadStudentImportTemplate);
  document.getElementById("scanKnowledgeButton").addEventListener("click", () => scanKnowledgeFiles().catch(error => showToast(error.message)));
  document.getElementById("uploadKnowledgeButton").addEventListener("click", () => uploadKnowledgeFile().catch(error => showToast(error.message)));
  document.getElementById("extractKnowledgeButton").addEventListener("click", () => extractKnowledgeCandidates().catch(error => showToast(error.message)));
  document.getElementById("importKnowledgeButton").addEventListener("click", () => importKnowledgeCandidates().catch(error => showToast(error.message)));
  document.getElementById("downloadImportReportButton").addEventListener("click", downloadKnowledgeImportReport);
  document.getElementById("logoutButton").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); window.location.href = "/login.html"; });
}

function render() {
  renderP0Options();
  renderP0Records();
  renderList();
  renderDetail();
}

bindEvents();
initP0Forms();
initQuickLessonDefaults();
renderTeacherCalendar();
Promise.all([loadSession(), loadStudents(), loadNotifications(), loadScheduleMeta(), loadLessons(), loadP0Data()]).catch(() => showToast("请先登录"));
scanKnowledgeFiles().catch(() => {});
checkHermesConnection({ silent: true }).catch(() => {});
