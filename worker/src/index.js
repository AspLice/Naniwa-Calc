import { json, corsHeaders, withCors } from "./utils/response.js";
import { sendOrUpdateDiscord } from "./utils/discord.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const origin = resolveCorsOrigin(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/" && request.method === "GET") {
        return withCors(json({
          service: "fivem-mechanic-expense-api",
          message: "API service is running. Use /api/* endpoints.",
          health: "/api/health",
          frontend: env.FRONTEND_ORIGIN,
        }), origin);
      }

      if (path === "/favicon.ico" && request.method === "GET") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }

      if (path === "/api/health" && request.method === "GET") {
        return withCors(json({ ok: true }), origin);
      }

      if (path === "/api/auth/login-options" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT username, role FROM users ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, username"
        ).all();

        const users = (rows.results || []).map((row) => ({
          username: row.username,
          role: row.role,
          pinRequired: row.role === "manager" || row.role === "admin",
        }));

        return withCors(json({ users }), origin);
      }

      if (path === "/api/auth/login" && request.method === "POST") {
        const body = await request.json();
        const username = (body.username || "").trim();
        const pin = (body.pin || "").trim();

        if (!username) return withCors(json({ error: "username is required" }, 400), origin);

        const user = await env.DB.prepare(
          "SELECT id, username, role, pin FROM users WHERE lower(username) = lower(?)"
        )
          .bind(username)
          .first();

        if (!user) return withCors(json({ error: "invalid credentials" }, 401), origin);

        if ((user.role === "manager" || user.role === "admin") && !pin) {
          return withCors(json({ error: "pin is required" }, 401), origin);
        }

        if ((user.role === "manager" || user.role === "admin") && user.pin !== pin) {
          await writeAudit(env, null, "auth.login_failed", "user", String(user.id), "wrong pin");
          return withCors(json({ error: "invalid credentials" }, 401), origin);
        }

        const token = crypto.randomUUID();
        await env.SESSIONS.put(`session:${token}`, JSON.stringify({
          id: user.id,
          username: user.username,
          role: user.role,
        }), { expirationTtl: SESSION_TTL_SECONDS });

        await writeAudit(env, user.id, "auth.login_success", "user", String(user.id), "login success");

        return withCors(json({ token, user: { id: user.id, username: user.username, role: user.role } }), origin);
      }

      if (path === "/api/auth/logout" && request.method === "POST") {
        const auth = await getAuthUser(request, env);
        if (auth.token) {
          await env.SESSIONS.delete(`session:${auth.token}`);
          if (auth.user) {
            await writeAudit(env, auth.user.id, "auth.logout", "user", String(auth.user.id), "logout");
          }
        }
        return withCors(json({ ok: true }), origin);
      }

      if (path === "/api/auth/me" && request.method === "GET") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);
        return withCors(json({ user: auth.user }), origin);
      }

      if (path === "/api/categories" && request.method === "GET") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);
        const rows = await env.DB.prepare("SELECT id, name FROM categories ORDER BY name").all();
        return withCors(json({ categories: rows.results || [] }), origin);
      }

      if (path === "/api/users" && request.method === "GET") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);
        if (!isManagerOrAdmin(auth.user.role)) return withCors(json({ error: "forbidden" }, 403), origin);

        const rows = await env.DB.prepare("SELECT id, username, role, created_at FROM users ORDER BY id").all();
        return withCors(json({ users: rows.results || [] }), origin);
      }

      if (path === "/api/users" && request.method === "POST") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);
        if (!isManagerOrAdmin(auth.user.role)) return withCors(json({ error: "forbidden" }, 403), origin);

        const body = await request.json();
        const username = (body.username || "").trim();
        const role = (body.role || "staff").trim().toLowerCase();
        const pin = body.pin ? String(body.pin).trim() : null;

        if (!username) return withCors(json({ error: "username is required" }, 400), origin);
        if (!["staff", "manager", "admin"].includes(role)) {
          return withCors(json({ error: "invalid role" }, 400), origin);
        }
        if (role === "admin" && auth.user.role !== "admin") {
          return withCors(json({ error: "only admin can create admin" }, 403), origin);
        }
        if ((role === "manager" || role === "admin") && !pin) {
          return withCors(json({ error: "pin is required for manager/admin" }, 400), origin);
        }

        const result = await env.DB.prepare("INSERT INTO users (username, role, pin) VALUES (?, ?, ?)")
          .bind(username, role, pin)
          .run();

        await writeAudit(env, auth.user.id, "user.create", "user", String(result.meta.last_row_id), role);

        return withCors(json({ ok: true, id: result.meta.last_row_id }), origin);
      }

      if (path.startsWith("/api/users/") && request.method === "PATCH") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);
        if (!isManagerOrAdmin(auth.user.role)) return withCors(json({ error: "forbidden" }, 403), origin);

        const id = Number(path.split("/").pop());
        if (!Number.isFinite(id)) return withCors(json({ error: "invalid user id" }, 400), origin);

        const body = await request.json();
        const role = body.role ? String(body.role).toLowerCase() : null;
        const pin = body.pin !== undefined ? String(body.pin).trim() : undefined;

        const user = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first();
        if (!user) return withCors(json({ error: "user not found" }, 404), origin);

        if (role === "admin" && auth.user.role !== "admin") {
          return withCors(json({ error: "only admin can assign admin role" }, 403), origin);
        }

        const nextRole = role || user.role;
        const nextPin = pin !== undefined ? pin : null;

        if ((nextRole === "manager" || nextRole === "admin") && pin !== undefined && !nextPin) {
          return withCors(json({ error: "pin cannot be empty for manager/admin" }, 400), origin);
        }

        await env.DB.prepare(
          "UPDATE users SET role = COALESCE(?, role), pin = CASE WHEN ? IS NULL THEN pin ELSE ? END, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
          .bind(role, pin, pin, id)
          .run();

        await writeAudit(env, auth.user.id, "user.update", "user", String(id), "updated role/pin");

        return withCors(json({ ok: true }), origin);
      }

      if (path === "/api/upload" && request.method === "POST") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);

        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
          return withCors(json({ error: "file is required" }, 400), origin);
        }

        if (!file.type.startsWith("image/")) {
          return withCors(json({ error: "only image upload is allowed" }, 400), origin);
        }

        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
          return withCors(json({ error: "file too large (max 5MB)" }, 400), origin);
        }

        const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".png";
        const key = `receipts/${Date.now()}-${crypto.randomUUID()}${ext}`;
        await env.RECEIPTS.put(key, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type },
        });

        return withCors(json({ key, name: file.name, mimeType: file.type, size: file.size }), origin);
      }

      if (path === "/api/expenses" && request.method === "POST") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);

        const body = await request.json();
        const categoryId = body.categoryId || null;
        const amount = Number(body.amount);
        const description = (body.description || "").trim();
        const expenseDate = (body.expenseDate || "").trim();
        const note = (body.note || "").trim();
        const attachmentKeys = Array.isArray(body.attachmentKeys) ? body.attachmentKeys : [];

        if (!Number.isFinite(amount) || amount <= 0) {
          return withCors(json({ error: "amount must be a positive number" }, 400), origin);
        }
        if (!description || !expenseDate) {
          return withCors(json({ error: "description and expenseDate are required" }, 400), origin);
        }

        const result = await env.DB.prepare(
          "INSERT INTO expenses (user_id, category_id, amount, description, expense_date, note) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(auth.user.id, categoryId, amount, description, expenseDate, note || null)
          .run();

        const expenseId = result.meta.last_row_id;

        for (const key of attachmentKeys) {
          await env.DB.prepare(
            "INSERT INTO expense_attachments (expense_id, r2_key, original_name) VALUES (?, ?, ?)"
          )
            .bind(expenseId, String(key), String(key).split("/").pop())
            .run();
        }

        await writeAudit(env, auth.user.id, "expense.create", "expense", String(expenseId), `amount=${amount}`);

        const expense = await getExpenseById(env, expenseId);
        const notify = await sendOrUpdateDiscord(env, mapExpenseToDiscord(expense));
        if (notify.messageId) {
          await env.DB.prepare("UPDATE expenses SET discord_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(notify.messageId, expenseId)
            .run();
        }

        return withCors(json({ ok: true, id: expenseId }), origin);
      }

      if (path === "/api/expenses" && request.method === "GET") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);

        const params = new URL(request.url).searchParams;
        const status = params.get("status");
        const all = params.get("all") === "1";

        const values = [];
        let sql = `
          SELECT e.id, e.user_id, u.username, e.category_id, c.name as category_name,
                 e.amount, e.description, e.expense_date, e.note, e.status,
                 e.rejection_reason, e.approved_by, e.approved_at, e.paid_at,
                 e.discord_message_id, e.created_at, e.updated_at
          FROM expenses e
          JOIN users u ON u.id = e.user_id
          LEFT JOIN categories c ON c.id = e.category_id
          WHERE 1=1
        `;

        if (!(all && isManagerOrAdmin(auth.user.role))) {
          sql += " AND e.user_id = ?";
          values.push(auth.user.id);
        }

        if (status) {
          sql += " AND e.status = ?";
          values.push(status);
        }

        sql += " ORDER BY e.id DESC LIMIT 200";

        const rows = await env.DB.prepare(sql).bind(...values).all();
        const expenses = rows.results || [];

        for (const expense of expenses) {
          const files = await env.DB.prepare(
            "SELECT id, r2_key, original_name, mime_type, size_bytes, created_at FROM expense_attachments WHERE expense_id = ? ORDER BY id"
          )
            .bind(expense.id)
            .all();
          expense.attachments = files.results || [];
        }

        return withCors(json({ expenses }), origin);
      }

      if (path.startsWith("/api/expenses/") && path.endsWith("/status") && request.method === "PATCH") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);
        if (!isManagerOrAdmin(auth.user.role)) return withCors(json({ error: "forbidden" }, 403), origin);

        const id = Number(path.split("/")[3]);
        if (!Number.isFinite(id)) return withCors(json({ error: "invalid expense id" }, 400), origin);

        const body = await request.json();
        const status = String(body.status || "").toLowerCase();
        const rejectionReason = body.rejectionReason ? String(body.rejectionReason).trim() : null;

        if (!["approved", "rejected", "paid"].includes(status)) {
          return withCors(json({ error: "invalid status" }, 400), origin);
        }

        const current = await getExpenseById(env, id);
        if (!current) return withCors(json({ error: "expense not found" }, 404), origin);

        if (status === "paid" && current.status !== "approved") {
          return withCors(json({ error: "only approved expense can be marked as paid" }, 400), origin);
        }

        await env.DB.prepare(
          `UPDATE expenses
           SET status = ?,
               rejection_reason = ?,
               approved_by = CASE WHEN ? IN ('approved', 'rejected') THEN ? ELSE approved_by END,
               approved_at = CASE WHEN ? IN ('approved', 'rejected') THEN CURRENT_TIMESTAMP ELSE approved_at END,
               paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
          .bind(status, rejectionReason, status, auth.user.id, status, status, id)
          .run();

        await writeAudit(env, auth.user.id, "expense.status_update", "expense", String(id), status);

        const updated = await getExpenseById(env, id);
        const notify = await sendOrUpdateDiscord(env, mapExpenseToDiscord(updated));
        if (notify.messageId && notify.messageId !== updated.discord_message_id) {
          await env.DB.prepare("UPDATE expenses SET discord_message_id = ? WHERE id = ?")
            .bind(notify.messageId, id)
            .run();
        }

        return withCors(json({ ok: true }), origin);
      }

      if (path.startsWith("/api/expenses/") && request.method === "DELETE") {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return withCors(json({ error: auth.error }, auth.status), origin);
        if (auth.user.role !== "admin") return withCors(json({ error: "forbidden" }, 403), origin);

        const id = Number(path.split("/").pop());
        if (!Number.isFinite(id)) return withCors(json({ error: "invalid expense id" }, 400), origin);

        await env.DB.prepare("DELETE FROM expense_attachments WHERE expense_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
        await writeAudit(env, auth.user.id, "expense.delete", "expense", String(id), "admin force delete");

        return withCors(json({ ok: true }), origin);
      }

      return withCors(json({ error: "not found" }, 404), origin);
    } catch (err) {
      return withCors(json({ error: "internal error", detail: String(err?.message || err) }, 500), env.FRONTEND_ORIGIN || "*");
    }
  },

  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM audit_logs WHERE created_at <= datetime('now', '-10 day')").run();
  },
};

function normalizeOrigin(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveCorsOrigin(request, env) {
  const configured = env.FRONTEND_ORIGIN || "*";
  if (configured === "*") return "*";

  const reqOrigin = request.headers.get("Origin");
  if (!reqOrigin) return normalizeOrigin(configured);

  if (normalizeOrigin(reqOrigin) === normalizeOrigin(configured)) {
    return reqOrigin;
  }

  return normalizeOrigin(configured);
}

async function getAuthUser(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const xToken = request.headers.get("X-Session-Token") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : xToken;

  if (!token) return { token: null, user: null };

  const raw = await env.SESSIONS.get(`session:${token}`);
  if (!raw) return { token, user: null };

  return { token, user: JSON.parse(raw) };
}

async function requireAuth(request, env) {
  const auth = await getAuthUser(request, env);
  if (!auth.token || !auth.user) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true, user: auth.user, token: auth.token };
}

function isManagerOrAdmin(role) {
  return role === "manager" || role === "admin";
}

async function getExpenseById(env, id) {
  return env.DB.prepare(
    `SELECT e.id, e.user_id, u.username, e.category_id, c.name as category_name,
            e.amount, e.description, e.expense_date, e.note, e.status,
            e.rejection_reason, e.approved_by, e.approved_at, e.paid_at,
            e.discord_message_id, e.created_at, e.updated_at
     FROM expenses e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.id = ?`
  )
    .bind(id)
    .first();
}

function mapExpenseToDiscord(expense) {
  return {
    messageId: expense.discord_message_id,
    expenseId: expense.id,
    username: expense.username,
    amount: expense.amount,
    status: expense.status,
    category: expense.category_name,
    expenseDate: expense.expense_date,
    description: expense.description,
  };
}

async function writeAudit(env, actorUserId, action, targetType, targetId, details) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(actorUserId, action, targetType, targetId, details)
    .run();
}
