window.API_BASE_URL = window.API_BASE_URL || "http://localhost:8787";

const storageKeys = {
  token: "expense_token",
  user: "expense_user",
};

export function getToken() {
  return localStorage.getItem(storageKeys.token);
}

export function getUser() {
  const raw = localStorage.getItem(storageKeys.user);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  localStorage.setItem(storageKeys.token, token);
  localStorage.setItem(storageKeys.user, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(storageKeys.token);
  localStorage.removeItem(storageKeys.user);
}

export async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${window.API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await res.json() : {};

  if (!res.ok) {
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return body;
}

export async function uploadFile(file) {
  const token = getToken();
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(`${window.API_BASE_URL}/api/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: fd,
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "upload failed");
  return body;
}

export function guardPage(allowRoles = ["staff", "manager", "admin"]) {
  const user = getUser();
  if (!user) {
    location.href = "index.html";
    return null;
  }
  if (!allowRoles.includes(user.role)) {
    alert("権限がありません");
    location.href = "dashboard.html";
    return null;
  }
  return user;
}

export function renderNav() {
  const user = getUser();
  if (!user) return "";

  return `
    <nav>
      <a href="dashboard.html">Dashboard</a>
      <a href="submit.html">Submit</a>
      <a href="history.html">History</a>
      ${(user.role === "manager" || user.role === "admin") ? '<a href="approve.html">Approve</a>' : ""}
      ${(user.role === "manager" || user.role === "admin") ? '<a href="users.html">Users</a>' : ""}
      ${(user.role === "manager" || user.role === "admin") ? '<a href="admin.html">Admin</a>' : ""}
      <button id="logoutBtn" class="danger">Logout</button>
    </nav>
  `;
}

export async function bindLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (_err) {
      // ignore API failure at logout
    }
    clearSession();
    location.href = "index.html";
  });
}
