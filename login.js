const form = document.getElementById("loginForm");
const errorBox = document.getElementById("loginError");

async function checkSession() {
  const response = await fetch("/api/session");
  if (response.ok) window.location.href = "/";
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  errorBox.textContent = "";

  const body = {
    username: form.username.value.trim(),
    password: form.password.value
  };

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (response.ok) {
    window.location.href = "/";
    return;
  }

  const data = await response.json().catch(() => ({}));
  errorBox.textContent = data.error || "登录失败";
});

checkSession();
