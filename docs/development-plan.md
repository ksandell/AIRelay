## 🧹 Log Rotation & Cleanup (7+1 Day Retention)

To keep disk usage predictable and prevent log bloat inside the container, implement an **internal cleanup/rotation job** with:

* **Daily rotation**
* **7 days retained + 1 active day**
* Automatic deletion of older logs
* Optional compression for archived logs

---

## 🎯 Goals

* Keep logs lightweight and bounded
* Avoid unbounded `/data/logs` growth
* Work identically on Windows Docker Desktop & Linux hosts
* No external cron dependency required

---

## 📂 Log Structure (Recommended)

```text
/data/logs/
├── app.log              ← current (active)
├── app-2026-04-28.log  ← rotated (yesterday)
├── app-2026-04-27.log
├── app-2026-04-26.log
├── app-2026-04-25.log
├── app-2026-04-24.log
├── app-2026-04-23.log
└── app-2026-04-22.log  ← last retained (oldest)
```

Retention:

* Keep **7 rotated files**
* * **1 active file**
* Delete anything older

---

## ⚙️ Rotation Strategy

### Trigger:

* Run **once per day at midnight (container local time)**

### Steps:

1. Close or flush `app.log`
2. Rename:

   ```text
   app.log → app-YYYY-MM-DD.log
   ```
3. Create new empty `app.log`
4. Delete logs older than 7 days
5. (Optional) gzip older logs

---

## 🧠 Implementation Approach

### ✅ Do NOT use system cron

Containers are minimal and may not include cron.

👉 Instead, implement an **internal scheduler** in Node.js:

---

## ⏱️ Scheduler (Node.js)

Use a lightweight scheduler like:

* `node-cron` (recommended)

### Install:

```bash
npm install node-cron
```

---

### Example:

```js
import cron from "node-cron";
import fs from "fs";
import path from "path";

const LOG_DIR = "/data/logs";
const ACTIVE_LOG = path.join(LOG_DIR, "app.log");

cron.schedule("0 0 * * *", () => {
  rotateLogs();
});
```

---

## 🔄 Rotation Function

```js
function rotateLogs() {
  const date = new Date().toISOString().split("T")[0];
  const rotatedName = `app-${date}.log`;
  const rotatedPath = path.join(LOG_DIR, rotatedName);

  try {
    // Rotate current log
    if (fs.existsSync(ACTIVE_LOG)) {
      fs.renameSync(ACTIVE_LOG, rotatedPath);
    }

    // Create new empty log
    fs.writeFileSync(ACTIVE_LOG, "");

    cleanupOldLogs();

    console.log(`[LOG] Rotated logs → ${rotatedName}`);
  } catch (err) {
    console.error("[LOG] Rotation failed:", err);
  }
}
```

---

## 🧹 Cleanup Function

```js
function cleanupOldLogs() {
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith("app-") && f.endsWith(".log"))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  const MAX_FILES = 7;

  if (files.length > MAX_FILES) {
    const toDelete = files.slice(MAX_FILES);

    toDelete.forEach(file => {
      const fullPath = path.join(LOG_DIR, file.name);
      fs.unlinkSync(fullPath);
      console.log(`[LOG] Deleted old log: ${file.name}`);
    });
  }
}
```

---

## 🗜️ Optional: Compression (Recommended Later)

To reduce disk usage further:

* Compress logs older than 1 day

### Example:

```js
import zlib from "zlib";

function compressLog(filePath) {
  const gzip = zlib.createGzip();
  const input = fs.createReadStream(filePath);
  const output = fs.createWriteStream(filePath + ".gz");

  input.pipe(gzip).pipe(output);

  input.on("end", () => {
    fs.unlinkSync(filePath);
  });
}
```

---

## 📡 Integration with Log Viewer UI

### Behavior:

* UI reads:

  * `/data/logs/app.log` (live)
  * last rotated files (optional browsing)

### API:

```http
GET /api/logs?limit=500
GET /api/logs/history?date=2026-04-28
```

---

## ⚠️ Edge Cases

| Issue                         | Solution                       |
| ----------------------------- | ------------------------------ |
| Log file locked during rename | use stream flush before rotate |
| Container restart at midnight | run rotation on startup check  |
| Timezone differences          | use UTC consistently           |
| High log volume               | add size-based rotation later  |

---

## 🔁 Startup Safety Check

Run cleanup on container start:

```js
rotateLogsIfNeeded();
cleanupOldLogs();
```

---

## 🚀 Future Enhancements

* Size-based rotation (e.g. 50MB max)
* Configurable retention (UI setting)
* Per-log-level files (info/error)
* Download logs from UI

---

## 🧠 Final Design Decision

> Logs are:

* **file-backed (persistent)**
* **memory-buffered (fast UI)**
* **auto-rotated (bounded size)**

---

## ✅ Outcome

* No log bloat
* Stable disk usage
* Works cross-platform
* Zero maintenance required

---

**This completes your container-grade logging system.**
