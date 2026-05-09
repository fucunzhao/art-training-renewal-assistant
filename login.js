const form = document.getElementById("loginForm");
const errorBox = document.getElementById("loginError");
const title = document.getElementById("authTitle");
const hint = document.getElementById("authHint");
const submit = document.getElementById("authSubmit");
const role = document.getElementById("role");
const roleField = document.getElementById("roleField");
let mode = "login";

async function checkSession() {
  const response = await fetch("/api/session");
  if (response.ok) window.location.href = "/";
}

function setMode(nextMode) {
  mode = nextMode;
  errorBox.textContent = "";
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.authMode === mode);
  });
  const registering = mode === "register";
  title.textContent = registering ? "注册新用户" : "登录续费增长助手";
  hint.textContent = registering ? "创建账号后会自动进入工作台。" : "可使用测试账号 admin / zzdh6886 登录。";
  submit.textContent = registering ? "注册并进入" : "登录工作台";
  role.classList.toggle("hidden-field", !registering);
  roleField.classList.toggle("hidden-field", !registering);
  form.password.value = registering ? "" : "zzdh6886";
}

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => setMode(tab.dataset.authMode));
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  errorBox.textContent = "";

  const body = {
    username: form.username.value.trim(),
    password: form.password.value,
    role: form.role.value
  };

  const response = await fetch(mode === "register" ? "/api/register" : "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (response.ok) {
    window.location.href = "/";
    return;
  }

  const data = await response.json().catch(() => ({}));
  errorBox.textContent = data.error || "操作失败";
});

checkSession();
