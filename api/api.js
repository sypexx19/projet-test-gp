/* ==========================================================================
   api.js — data layer for the Gantt timeline

   Two modes, switched by one setting:
   - "local": tasks are saved in this browser (localStorage). Works out of the box.
   - "n8n"  : every call is sent to ONE n8n Webhook node, which routes by "action".

   To connect n8n later, only edit CONFIG.N8N_WEBHOOK_URL below.
   index.html never changes: it only calls GanttAPI.getTasks / createTask / ...

   Task shape:
   { id: "t_xxx", name: "Design", owner: "Amina", start: "2026-10-12",
     end: "2026-10-18", progress: 60 }          (dates are YYYY-MM-DD)

   ---- n8n contract --------------------------------------------------------
   Request  (POST, JSON):  { action, payload, sentAt }
     action = "list"    payload = {}
     action = "create"  payload = { task }
     action = "update"  payload = { id, changes }
     action = "delete"  payload = { id }
   Response (JSON):
     list   -> [ task, ... ]  or  { tasks: [ ... ] }
     create -> task           or  { task }
     update -> task           or  { task }
     delete -> anything (e.g. { ok: true })
   In n8n: Webhook (POST, "Respond: Using 'Respond to Webhook' node")
           -> Switch on {{ $json.body.action }} -> your nodes
           -> Respond to Webhook.
   ======================================================================== */

(function (global) {
  "use strict";

  const CONFIG = {
    N8N_WEBHOOK_URL: "", // e.g. "https://your-n8n.example.com/webhook/gantt"
    TIMEOUT_MS: 8000,
    STORAGE_KEY: "gp-gantt-tasks-v1",
  };

  const mode = () => (CONFIG.N8N_WEBHOOK_URL ? "n8n" : "local");

  /* ---------- helpers ---------- */

  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromToday = (offset) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return toISO(d);
  };
  const newId = () => "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function clean(input) {
    const progress = Math.max(0, Math.min(100, Number(input.progress) || 0));
    return {
      id: input.id || newId(),
      name: String(input.name || "").trim(),
      owner: String(input.owner || "").trim(),
      start: input.start,
      end: input.end,
      progress,
    };
  }

  /* ---------- local mode ---------- */

  function seed() {
    return [
      { name: "Gather requirements", owner: "Amina", start: fromToday(-16), end: fromToday(-9), progress: 100 },
      { name: "UI/UX mockups", owner: "Yacine", start: fromToday(-10), end: fromToday(-1), progress: 90 },
      { name: "Database and API", owner: "Didou", start: fromToday(-4), end: fromToday(8), progress: 55 },
      { name: "Front-end build", owner: "Sara", start: fromToday(0), end: fromToday(14), progress: 20 },
      { name: "Testing", owner: "Amina", start: fromToday(10), end: fromToday(18), progress: 0 },
      { name: "Deployment", owner: "Didou", start: fromToday(19), end: fromToday(22), progress: 0 },
    ].map(clean);
  }

  const local = {
    read() {
      try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* fall through to seed */ }
      const first = seed();
      local.write(first);
      return first;
    },
    write(list) {
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(list));
    },
  };

  /* ---------- n8n mode ---------- */

  async function callN8n(action, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
    try {
      const res = await fetch(CONFIG.N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, sentAt: new Date().toISOString() }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`n8n answered with status ${res.status}`);
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } catch (err) {
      if (err.name === "AbortError") throw new Error("n8n did not answer in time");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- public API ---------- */

  async function getTasks() {
    if (mode() === "local") return local.read().map(clean);
    const data = await callN8n("list", {});
    const list = Array.isArray(data) ? data : data.tasks || [];
    return list.map(clean);
  }

  async function createTask(input) {
    const task = clean(input);
    if (mode() === "local") {
      const list = local.read();
      list.push(task);
      local.write(list);
      return task;
    }
    const data = await callN8n("create", { task });
    return clean(data.task || data);
  }

  async function updateTask(id, changes) {
    if (mode() === "local") {
      const list = local.read();
      const i = list.findIndex((t) => t.id === id);
      if (i === -1) throw new Error("Task not found");
      list[i] = clean({ ...list[i], ...changes, id });
      local.write(list);
      return list[i];
    }
    const data = await callN8n("update", { id, changes });
    return clean(data.task || data);
  }

  async function deleteTask(id) {
    if (mode() === "local") {
      local.write(local.read().filter((t) => t.id !== id));
      return { ok: true };
    }
    return callN8n("delete", { id });
  }
  global.GanttAPI = { CONFIG, mode, getTasks, createTask, updateTask, deleteTask };
})(window);
