import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const app = express();
app.use(express.json({ limit: "1mb" }));

const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || "change_this_jwt_secret";
const wechatAppId = process.env.WECHAT_APP_ID || "";
const wechatAppSecret = process.env.WECHAT_APP_SECRET || "";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fetchWeChatSession(code) {
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", wechatAppId);
  url.searchParams.set("secret", wechatAppSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error(`wechat_http_${resp.status}`);
  }

  const data = await resp.json();
  if (data.errcode) {
    const err = new Error(data.errmsg || "wechat_error");
    err.code = data.errcode;
    throw err;
  }
  if (!data.openid) {
    throw new Error("wechat_openid_missing");
  }
  return data;
}

async function upsertUserByOpenId({ openid, nickname, avatarUrl }) {
  const sql = `
    INSERT INTO users (id, openid, nickname, avatar_url)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (openid) DO UPDATE
      SET nickname = COALESCE(EXCLUDED.nickname, users.nickname),
          avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
          updated_at = NOW()
    RETURNING id, openid, nickname, avatar_url, created_at, updated_at;
  `;
  const values = [crypto.randomUUID(), openid, nickname ?? null, avatarUrl ?? null];
  const result = await pool.query(sql, values);
  return result.rows[0];
}

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      status: "ok",
      service: "research-pilot-backend",
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "database_unavailable",
      detail: String(err.message || err),
    });
  }
});

app.post("/auth/wx-login", async (req, res) => {
  try {
    const { code, nickname, avatarUrl } = req.body || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ message: "invalid_code" });
    }
    if (!wechatAppId || !wechatAppSecret) {
      return res.status(500).json({ message: "wechat_config_missing" });
    }

    const session = await fetchWeChatSession(code);
    const user = await upsertUserByOpenId({
      openid: session.openid,
      nickname,
      avatarUrl,
    });

    const token = jwt.sign(
      {
        sub: user.id,
        openid: user.openid,
      },
      jwtSecret,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: 7 * 24 * 60 * 60,
      user: {
        id: user.id,
        openid: user.openid,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (err) {
    const msg = String(err?.message || err);
    const status = err?.code ? 401 : 500;
    return res.status(status).json({
      message: "wx_login_failed",
      detail: msg,
      code: err?.code ?? null,
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ message: "not_found" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Research Pilot backend listening on ${port}`);
});
