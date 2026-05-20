const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "tmp-e2e-data");
const port = 5617;
const baseUrl = `http://127.0.0.1:${port}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname, options = {}, cookie = "") {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || "GET"} ${pathname} failed: ${data.error || response.status}`);
  return { response, data };
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/login.html`);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  throw new Error("server did not start in time");
}

async function main() {
  await fs.rm(dataDir, { recursive: true, force: true });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_USER: "admin",
      ADMIN_PASS: "zzdh6886"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer();
    const login = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "zzdh6886" })
    });
    const cookie = login.response.headers.get("set-cookie").split(";")[0];

    const studentResult = await request("/api/students", {
      method: "POST",
      body: JSON.stringify({
        name: "E2E学员",
        age: 9,
        course: "创意美术",
        teacher: "周老师",
        paidAmount: 1000,
        prepaidLessons: 10,
        paymentStatus: "已缴清",
        debtAmount: 0
      })
    }, cookie);
    const studentId = studentResult.data.student.id;
    assert(studentResult.data.student.lessonsLeft === 10, "new student lessons should equal prepaid lessons");

    const attendance = await request("/api/p0/attendance", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        date: "2026-05-20",
        course: "创意美术",
        teacher: "周老师",
        status: "到课",
        lessons: 2,
        note: "E2E课消"
      })
    }, cookie);
    assert(attendance.data.student.lessonsLeft === 8, "attendance should consume lessons");
    assert(attendance.data.summary.monthConsumedLessons >= 2, "P0 summary should include consumed lessons");

    const finance = await request("/api/p0/finance", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        date: "2026-05-20",
        direction: "income",
        category: "续费",
        amount: 500,
        lessons: 3,
        paymentMethod: "微信",
        note: "E2E缴费"
      })
    }, cookie);
    assert(finance.data.student.lessonsLeft === 11, "income lessons should add to balance");
    assert(finance.data.summary.monthIncome >= 500, "P0 summary should include income");

    const communication = await request("/api/p0/communications", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        date: "2026-05-20",
        scenario: "续费提醒",
        channel: "微信",
        status: "待跟进",
        nextFollowUp: "2026-05-21",
        content: "E2E沟通"
      })
    }, cookie);
    assert(communication.data.summary.pendingFollowUps >= 1, "P0 summary should include pending follow-up");

    const completed = await request(`/api/p0/communications/${communication.data.record.id}/complete`, {
      method: "POST",
      body: JSON.stringify({})
    }, cookie);
    assert(completed.data.record.status === "已完成", "communication should be completed");

    const voided = await request(`/api/p0/attendance/${attendance.data.record.id}/void`, {
      method: "POST",
      body: JSON.stringify({ reason: "E2E回滚" })
    }, cookie);
    assert(voided.data.student.lessonsLeft === 13, "void attendance should roll consumed lessons back");

    console.log("E2E checks passed");
  } finally {
    child.kill();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
