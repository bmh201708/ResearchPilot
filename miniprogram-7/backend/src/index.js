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
const semanticScholarApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY || "";
const defaultFeedKeywords =
  process.env.DEFAULT_FEED_KEYWORDS ||
  "large language model, retrieval augmented generation, computer vision";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const PAPER_ACTION_TYPES = new Set(["PASS", "MARK", "READ"]);

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeKeywords(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function buildPublishedAt(publicationDate, year) {
  if (publicationDate) {
    const date = new Date(publicationDate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (year && Number.isFinite(Number(year))) {
    const date = new Date(`${year}-01-01T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

async function requestSemanticScholar(url, { useApiKey = true } = {}) {
  const headers = {
    Accept: "application/json",
  };
  if (useApiKey && semanticScholarApiKey) {
    headers["x-api-key"] = semanticScholarApiKey;
  }

  const resp = await fetch(url, { method: "GET", headers });
  const text = await resp.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!resp.ok) {
    const err = new Error(
      payload?.message || `semantic_scholar_http_${resp.status}`
    );
    err.status = resp.status;
    err.code = payload?.code || null;
    throw err;
  }
  return payload;
}

async function fetchSemanticScholarPapersBySearch({
  keywords,
  page,
  pageSize,
  useApiKey = true,
}) {
  const offset = (page - 1) * pageSize;
  const fields = [
    "paperId",
    "title",
    "authors",
    "abstract",
    "year",
    "venue",
    "citationCount",
    "publicationDate",
    "url",
    "openAccessPdf",
    "fieldsOfStudy",
  ].join(",");

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", keywords);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("fields", fields);
  const payload = await requestSemanticScholar(url, { useApiKey });

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const total = Number.isFinite(payload?.total) ? payload.total : rows.length;
  return { rows, total, source: "semantic_scholar" };
}

async function fetchSemanticScholarPapersByBulk({ keywords, page, pageSize }) {
  const fields = [
    "paperId",
    "title",
    "authors",
    "abstract",
    "year",
    "venue",
    "citationCount",
    "publicationDate",
    "url",
    "openAccessPdf",
    "fieldsOfStudy",
  ].join(",");

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search/bulk");
  url.searchParams.set("query", keywords);
  url.searchParams.set("fields", fields);

  const payload = await requestSemanticScholar(url, { useApiKey: false });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const total = Number.isFinite(payload?.total) ? payload.total : rows.length;
  const offset = (page - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    total,
    source: "semantic_scholar_bulk",
  };
}

async function fetchSemanticScholarPaperById(paperId) {
  const fields = [
    "paperId",
    "title",
    "authors",
    "abstract",
    "year",
    "venue",
    "citationCount",
    "publicationDate",
    "url",
    "openAccessPdf",
    "fieldsOfStudy",
  ].join(",");
  const url = new URL(
    `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(
      paperId
    )}`
  );
  url.searchParams.set("fields", fields);

  try {
    return await requestSemanticScholar(url, { useApiKey: true });
  } catch (errWithApiKey) {
    if (semanticScholarApiKey && errWithApiKey?.status === 403) {
      return requestSemanticScholar(url, { useApiKey: false });
    }
    throw errWithApiKey;
  }
}

function mapSemanticScholarPaper(row) {
  const paperId = String(row?.paperId || "");
  if (!paperId) return null;
  const authors = Array.isArray(row?.authors)
    ? row.authors
        .map((author) => author?.name)
        .filter((name) => typeof name === "string" && name.trim())
    : [];
  const tags = Array.isArray(row?.fieldsOfStudy)
    ? row.fieldsOfStudy
        .map((tag) => String(tag || "").trim())
        .filter((tag) => Boolean(tag))
    : [];

  return {
    id: paperId,
    arxivId: `s2:${paperId}`,
    title: String(row?.title || "Untitled Paper"),
    authors,
    abstract: String(row?.abstract || "No abstract available."),
    publishedAt: buildPublishedAt(row?.publicationDate, row?.year),
    tags,
    venue: row?.venue ? String(row.venue) : null,
    year: Number.isFinite(row?.year) ? row.year : null,
    citationCount: Number.isFinite(row?.citationCount) ? row.citationCount : 0,
    url: row?.url ? String(row.url) : null,
    openAccessPdfUrl: row?.openAccessPdf?.url
      ? String(row.openAccessPdf.url)
      : null,
  };
}

async function upsertPapersFromSemanticScholar(papers) {
  if (!papers.length) return;
  const sql = `
    INSERT INTO papers (id, arxiv_id, title, authors, abstract, published_at, tags, updated_at)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE
      SET title = EXCLUDED.title,
          authors = EXCLUDED.authors,
          abstract = EXCLUDED.abstract,
          published_at = EXCLUDED.published_at,
          tags = EXCLUDED.tags,
          updated_at = NOW();
  `;
  for (const paper of papers) {
    await pool.query(sql, [
      paper.id,
      paper.arxivId,
      paper.title,
      JSON.stringify(paper.authors),
      paper.abstract,
      paper.publishedAt.toISOString(),
      JSON.stringify(paper.tags),
    ]);
  }
}

async function getUserActionsByPaperIds(userId, paperIds) {
  if (!paperIds.length) return new Map();
  const result = await pool.query(
    `
      SELECT paper_id, action
      FROM user_paper_actions
      WHERE user_id = $1
        AND paper_id = ANY($2::text[]);
    `,
    [userId, paperIds]
  );
  return new Map(result.rows.map((row) => [row.paper_id, row.action]));
}

async function loadLocalFeed({ userId, page, pageSize }) {
  const offset = (page - 1) * pageSize;
  const [countResult, feedResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM papers;`),
    pool.query(
      `
        SELECT
          p.id,
          p.arxiv_id,
          p.title,
          p.authors,
          p.abstract,
          p.published_at,
          p.tags,
          ps.summary_bg,
          ps.summary_method,
          ps.summary_contrib,
          ps.model_name,
          upa.action AS user_action
        FROM papers p
        LEFT JOIN paper_summaries ps
          ON ps.paper_id = p.id
        LEFT JOIN user_paper_actions upa
          ON upa.paper_id = p.id AND upa.user_id = $1
        ORDER BY p.published_at DESC
        LIMIT $2 OFFSET $3;
      `,
      [userId, pageSize, offset]
    ),
  ]);

  const total = countResult.rows[0]?.total ?? 0;
  const items = feedResult.rows.map((row) => ({
    id: row.id,
    arxivId: row.arxiv_id,
    title: row.title,
    authors: row.authors || [],
    abstract: row.abstract,
    publishedAt: row.published_at,
    tags: row.tags || [],
    userAction: row.user_action || null,
    summary:
      row.summary_bg || row.summary_method || row.summary_contrib
        ? {
            background: row.summary_bg,
            method: row.summary_method,
            contribution: row.summary_contrib,
            modelName: row.model_name || null,
          }
        : null,
    source: "local_cache",
  }));

  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      hasMore: offset + items.length < total,
    },
  };
}

function getBearerToken(authHeader = "") {
  if (!authHeader || typeof authHeader !== "string") return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function getUserById(userId) {
  const result = await pool.query(
    `
      SELECT id, openid, nickname, avatar_url, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [userId]
  );
  return result.rows[0] || null;
}

async function authMiddleware(req, res, next) {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ message: "missing_token" });
    }
    const payload = jwt.verify(token, jwtSecret);
    if (!payload?.sub) {
      return res.status(401).json({ message: "invalid_token" });
    }

    const user = await getUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ message: "user_not_found" });
    }

    req.auth = {
      userId: user.id,
      openid: user.openid,
    };
    req.currentUser = user;
    return next();
  } catch (err) {
    return res.status(401).json({
      message: "invalid_token",
      detail: String(err?.message || err),
    });
  }
}

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

app.get("/users/me", authMiddleware, async (req, res) => {
  const user = req.currentUser;
  return res.status(200).json({
    id: user.id,
    openid: user.openid,
    nickname: user.nickname,
    avatarUrl: user.avatar_url,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  });
});

app.get("/papers/feed", authMiddleware, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 1000000);
    const pageSize = parsePositiveInt(req.query.pageSize, 10, 30);
    const requestedKeywords = normalizeKeywords(req.query.keywords);
    const appliedKeywords = requestedKeywords || defaultFeedKeywords;

    try {
      let semanticResult;
      let semanticError = null;
      try {
        semanticResult = await fetchSemanticScholarPapersBySearch({
          keywords: appliedKeywords,
          page,
          pageSize,
          useApiKey: true,
        });
      } catch (errWithApiKey) {
        semanticError = errWithApiKey;
        if (semanticScholarApiKey && errWithApiKey?.status === 403) {
          semanticResult = await fetchSemanticScholarPapersBySearch({
            keywords: appliedKeywords,
            page,
            pageSize,
            useApiKey: false,
          });
          semanticError = null;
        }
      }

      if (!semanticResult) {
        semanticResult = await fetchSemanticScholarPapersByBulk({
          keywords: appliedKeywords,
          page,
          pageSize,
        });
      }

      const semanticPapers = semanticResult.rows
        .map(mapSemanticScholarPaper)
        .filter(Boolean);

      await upsertPapersFromSemanticScholar(semanticPapers);
      const userActionMap = await getUserActionsByPaperIds(
        req.auth.userId,
        semanticPapers.map((paper) => paper.id)
      );

      const items = semanticPapers.map((paper) => ({
        id: paper.id,
        arxivId: paper.arxivId,
        title: paper.title,
        authors: paper.authors,
        abstract: paper.abstract,
        publishedAt: paper.publishedAt,
        tags: paper.tags,
        userAction: userActionMap.get(paper.id) || null,
        summary: null,
        source: "semantic_scholar",
        semanticProvider:
          semanticResult.source === "semantic_scholar_bulk"
            ? "semantic_scholar_bulk"
            : "semantic_scholar_search",
        semanticKeyFallback:
          Boolean(semanticError) && semanticResult.source === "semantic_scholar_bulk",
        venue: paper.venue,
        year: paper.year,
        citationCount: paper.citationCount,
        url: paper.url,
        openAccessPdfUrl: paper.openAccessPdfUrl,
      }));

      const offset = (page - 1) * pageSize;
      return res.status(200).json({
        items,
        pagination: {
          page,
          pageSize,
          total: semanticResult.total,
          hasMore: offset + items.length < semanticResult.total,
        },
        meta: {
          requestedKeywords: requestedKeywords || null,
          appliedKeywords,
          source: semanticResult.source,
          fallback: false,
        },
      });
    } catch (semanticErr) {
      const localFeed = await loadLocalFeed({
        userId: req.auth.userId,
        page,
        pageSize,
      });

      return res.status(200).json({
        ...localFeed,
        meta: {
          requestedKeywords: requestedKeywords || null,
          appliedKeywords,
          source: "local_cache",
          fallback: true,
          semanticScholarError: String(
            semanticErr?.message || "semantic_scholar_failed"
          ),
        },
      });
    }
  } catch (err) {
    return res.status(500).json({
      message: "papers_feed_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/papers/:id/action", authMiddleware, async (req, res) => {
  try {
    const paperId = String(req.params.id || "");
    const action = String(req.body?.action || "").toUpperCase();
    if (!paperId) {
      return res.status(400).json({ message: "invalid_paper_id" });
    }
    if (!PAPER_ACTION_TYPES.has(action)) {
      return res.status(400).json({ message: "invalid_action" });
    }

    const paperResult = await pool.query(
      `
        SELECT id
        FROM papers
        WHERE id = $1
        LIMIT 1;
      `,
      [paperId]
    );
    if (!paperResult.rows[0]) {
      return res.status(404).json({ message: "paper_not_found" });
    }

    const saveResult = await pool.query(
      `
        INSERT INTO user_paper_actions (id, user_id, paper_id, action)
        VALUES ($1, $2, $3, $4::paper_action_type)
        ON CONFLICT (user_id, paper_id) DO UPDATE
          SET action = EXCLUDED.action,
              updated_at = NOW()
        RETURNING id, user_id, paper_id, action, created_at, updated_at;
      `,
      [crypto.randomUUID(), req.auth.userId, paperId, action]
    );
    const row = saveResult.rows[0];
    return res.status(200).json({
      id: row.id,
      userId: row.user_id,
      paperId: row.paper_id,
      action: row.action,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    return res.status(500).json({
      message: "paper_action_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/papers/:id", authMiddleware, async (req, res) => {
  try {
    const paperId = String(req.params.id || "");
    if (!paperId) {
      return res.status(400).json({ message: "invalid_paper_id" });
    }

    const result = await pool.query(
      `
        SELECT
          p.id,
          p.arxiv_id,
          p.title,
          p.authors,
          p.abstract,
          p.published_at,
          p.tags,
          ps.summary_bg,
          ps.summary_method,
          ps.summary_contrib,
          ps.model_name,
          upa.action AS user_action
        FROM papers p
        LEFT JOIN paper_summaries ps
          ON ps.paper_id = p.id
        LEFT JOIN user_paper_actions upa
          ON upa.paper_id = p.id AND upa.user_id = $2
        WHERE p.id = $1
        LIMIT 1;
      `,
      [paperId, req.auth.userId]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ message: "paper_not_found" });
    }

    let semanticData = null;
    try {
      semanticData = await fetchSemanticScholarPaperById(paperId);
    } catch {
      semanticData = null;
    }

    const semanticScholarUrl =
      semanticData?.url || `https://www.semanticscholar.org/paper/${paperId}`;
    const openAccessPdfUrl = semanticData?.openAccessPdf?.url || null;

    return res.status(200).json({
      id: row.id,
      arxivId: row.arxiv_id,
      title: row.title,
      authors: row.authors || [],
      abstract: row.abstract,
      publishedAt: row.published_at,
      tags: row.tags || [],
      userAction: row.user_action || null,
      citationCount: Number.isFinite(semanticData?.citationCount)
        ? semanticData.citationCount
        : 0,
      venue: semanticData?.venue || null,
      year: Number.isFinite(semanticData?.year) ? semanticData.year : null,
      link: semanticScholarUrl,
      openAccessPdfUrl,
      summary:
        row.summary_bg || row.summary_method || row.summary_contrib
          ? {
              background: row.summary_bg,
              method: row.summary_method,
              contribution: row.summary_contrib,
              modelName: row.model_name || null,
            }
          : null,
    });
  } catch (err) {
    return res.status(500).json({
      message: "paper_detail_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/profile/dashboard", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const [actionStats, commentStats, missionStats, taskStats, badgeStats] =
      await Promise.all([
        pool.query(
          `
            SELECT
              COUNT(*) FILTER (WHERE action = 'MARK')::int AS marked_count,
              COUNT(*) FILTER (WHERE action = 'READ')::int AS read_count,
              COUNT(*) FILTER (WHERE action = 'PASS')::int AS pass_count
            FROM user_paper_actions
            WHERE user_id = $1;
          `,
          [userId]
        ),
        pool.query(
          `
            SELECT COUNT(*)::int AS comment_count
            FROM comments
            WHERE user_id = $1;
          `,
          [userId]
        ),
        pool.query(
          `
            SELECT COUNT(*)::int AS mission_count
            FROM missions
            WHERE user_id = $1;
          `,
          [userId]
        ),
        pool.query(
          `
            SELECT
              COUNT(*) FILTER (WHERE t.status = 'TODO')::int AS todo_count,
              COUNT(*) FILTER (WHERE t.status = 'DOING')::int AS doing_count,
              COUNT(*) FILTER (WHERE t.status = 'DONE')::int AS done_count
            FROM tasks t
            INNER JOIN missions m ON m.id = t.mission_id
            WHERE m.user_id = $1;
          `,
          [userId]
        ),
        pool.query(
          `
            SELECT COUNT(*)::int AS badge_count
            FROM user_badges
            WHERE user_id = $1;
          `,
          [userId]
        ),
      ]);

    const actionRow = actionStats.rows[0] || {};
    const taskRow = taskStats.rows[0] || {};
    const user = req.currentUser;
    return res.status(200).json({
      user: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
      },
      stats: {
        markedPapers: actionRow.marked_count ?? 0,
        readPapers: actionRow.read_count ?? 0,
        passPapers: actionRow.pass_count ?? 0,
        comments: commentStats.rows[0]?.comment_count ?? 0,
        missions: missionStats.rows[0]?.mission_count ?? 0,
        badges: badgeStats.rows[0]?.badge_count ?? 0,
        tasks: {
          todo: taskRow.todo_count ?? 0,
          doing: taskRow.doing_count ?? 0,
          done: taskRow.done_count ?? 0,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: "profile_dashboard_failed",
      detail: String(err?.message || err),
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ message: "not_found" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Research Pilot backend listening on ${port}`);
});
