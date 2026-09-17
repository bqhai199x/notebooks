#!/usr/bin/env node

/**
 * Script hỗ trợ lấy GOOGLE_REFRESH_TOKEN cho Google Drive API.
 * Chạy lệnh: node scripts/setup-gdrive-auth.mjs
 */

import http from "node:http";
import readline from "node:readline";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultValue = "") {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function cleanInput(val) {
  return String(val || "").trim().replace(/^["']|["']$/g, "").trim();
}

function openBrowser(url) {
  if (process.platform === "win32") {
    // Trên Windows, dùng powershell Start-Process để URL có dấu & không bị cmd làm hỏng
    exec(`powershell -NoProfile -Command "Start-Process '${url.replace(/'/g, "''")}'"`, () => {});
  } else if (process.platform === "darwin") {
    exec(`open "${url}"`, () => {});
  } else {
    exec(`xdg-open "${url}"`, () => {});
  }
}

function readExistingEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const result = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        result[match[1]] = value.trim();
      }
    }
  }
  return result;
}

async function main() {
  console.log("\n========================================================");
  console.log("   HƯỚNG DẪN LẤY GOOGLE_REFRESH_TOKEN CHO GOOGLE DRIVE   ");
  console.log("========================================================\n");

  const existingEnv = readExistingEnv();

  let clientId = cleanInput(await ask("1. Nhập GOOGLE_CLIENT_ID", existingEnv.GOOGLE_CLIENT_ID || ""));
  if (!clientId) {
    console.error("Lỗi: Client ID không được để trống!");
    process.exit(1);
  }

  let clientSecret = cleanInput(await ask("2. Nhập GOOGLE_CLIENT_SECRET", existingEnv.GOOGLE_CLIENT_SECRET || ""));
  if (!clientSecret) {
    console.error("Lỗi: Client Secret không được để trống!");
    process.exit(1);
  }

  // Google OAuth quy định loopback cho Desktop App: http://127.0.0.1:<port>
  const PORT = 38472;
  const redirectUri = `http://127.0.0.1:${PORT}`;

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n--------------------------------------------------------");
  console.log(`Đang khởi động máy chủ xác thực tạm thời tại http://127.0.0.1:${PORT} ...`);

  let resolved = false;

  async function handleCode(code, server) {
    if (resolved) return;
    resolved = true;
    console.log("\nĐã nhận Authorization Code. Đang lấy Refresh Token...");
    try {
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        console.warn("\nCảnh báo: Google không trả về refresh_token.");
        console.warn("Nguyên nhân: Ứng dụng đã được cấp quyền trước đó.");
        console.warn("Giải pháp: Vào https://myaccount.google.com/permissions xóa quyền 'My Notes' và chạy lại script này.");
      } else {
        console.log("\n========================================================");
        console.log("THÀNH CÔNG! GOOGLE_REFRESH_TOKEN CỦA BẠN LÀ:");
        console.log("--------------------------------------------------------");
        console.log(`\x1b[32m%s\x1b[0m`, tokens.refresh_token);
        console.log("========================================================\n");

        const saveNow = await ask("Bạn có muốn tự động ghi token vào .env.local không? (y/n)", "y");
        if (saveNow.toLowerCase() === "y") {
          const envPath = path.resolve(process.cwd(), ".env.local");
          let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

          const updates = {
            GOOGLE_CLIENT_ID: clientId,
            GOOGLE_CLIENT_SECRET: clientSecret,
            GOOGLE_REFRESH_TOKEN: tokens.refresh_token,
          };

          for (const [k, v] of Object.entries(updates)) {
            const regex = new RegExp(`^${k}=.*$`, "m");
            if (regex.test(envContent)) {
              envContent = envContent.replace(regex, `${k}=${v}`);
            } else {
              envContent += `\n${k}=${v}`;
            }
          }

          fs.writeFileSync(envPath, envContent.trim() + "\n", "utf8");
          console.log("\nĐã cập nhật .env.local thành công!");
        }
      }
    } catch (err) {
      console.error("\nLỗi khi đổi token:", err.message);
    } finally {
      if (server) server.close();
      rl.close();
      process.exit(0);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2>Xác thực thất bại: ${error}</h2><p>Vui lòng thử lại trong terminal.</p>`);
        console.error("\nXác thực thất bại từ Google:", error);
        server.close();
        process.exit(1);
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #22c55e;">Xác thực thành công!</h1>
            <p>Bạn có thể đóng tab này và quay lại cửa sổ dòng lệnh (Terminal).</p>
          </div>
        `);

        await handleCode(code, server);
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Waiting for auth code...");
      }
    } catch (err) {
      console.error("\nLỗi xử lý xác thực:", err.message);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal error: " + err.message);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log("3. Mở liên kết sau trên trình duyệt để xác thực cấp quyền:");
    console.log(`\n\x1b[36m${authUrl}\x1b[0m\n`);
    console.log("Đang mở trình duyệt...");
    openBrowser(authUrl);

    console.log("(Nếu trình duyệt không tự mở, bạn hãy copy toàn bộ đường link màu xanh ở trên dán vào trình duyệt).");
    console.log("(Hoặc nếu trình duyệt redirect về trang lỗi, bạn có thể copy toàn bộ URL trên thanh địa chỉ dán vào đây bên dưới):\n");

    rl.question("Dán URL chuyển hướng hoặc code (nếu cần): ", async (manualInput) => {
      const input = manualInput.trim();
      if (!input) return;
      let code = input;
      try {
        if (input.includes("code=")) {
          const parsed = new URL(input.startsWith("http") ? input : `http://dummy${input}`);
          code = parsed.searchParams.get("code") || code;
        }
      } catch {}
      await handleCode(code, server);
    });
  });

  server.on("error", (err) => {
    console.error(`Không thể mở server cục bộ trên cổng ${PORT} (${err.message}).`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
