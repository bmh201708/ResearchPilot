import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import pdfParse from "pdf-parse";
import { Pool } from "pg";

const app = express();
app.use(express.json({ limit: "80mb" }));

const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || "change_this_jwt_secret";
const wechatAppId = process.env.WECHAT_APP_ID || "";
const wechatAppSecret = process.env.WECHAT_APP_SECRET || "";
const semanticScholarApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY || "";
const llmApiKey = process.env.LLM_API_KEY || "";
const llmBaseUrl = process.env.LLM_BASE_URL || "https://api-inference.modelscope.cn";
const reviewModelName = process.env.REVIEW_MODEL_NAME || "deepseek-ai/DeepSeek-V3.2";
const defaultFeedKeywords =
  process.env.DEFAULT_FEED_KEYWORDS ||
  "large language model, retrieval augmented generation, computer vision";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const PAPER_ACTION_TYPES = new Set(["PASS", "MARK", "READ"]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROJECT_COLOR_THEMES = new Set([
  "green",
  "purple",
  "yellow",
  "blue",
  "orange",
]);
const SUPPORTED_MANUSCRIPT_EXTENSIONS = new Set(["pdf", "txt", "md"]);
const MAX_MANUSCRIPT_BASE64_CHARS = 70 * 1024 * 1024;
const MAX_REMOTE_MANUSCRIPT_BYTES = 55 * 1024 * 1024;
const MAX_MANUSCRIPT_CHARS_FOR_REVIEW = 24000;
const ALLOWED_REMOTE_HOST_SUFFIXES = [".myqcloud.com", ".tcb.qcloud.la"];
const REVIEW_TASK_TTL_MS = 2 * 60 * 60 * 1000;
const reviewTasks = new Map();
const DEFAULT_PROJECT_DEADLINES = [
  {
    abbr: "CVPR",
    fullName: "Computer Vision and Pattern Recognition",
    location: "Seattle, USA",
    startDate: "2026-06-17",
    deadline: "2026-02-22",
    progress: 90,
    note: "Abstract registration is closed. Full paper submission only.",
    colorTheme: "orange",
  },
  {
    abbr: "NeurIPS",
    fullName: "Neural Information Processing Systems",
    location: "Vancouver, Canada",
    startDate: "2026-12-01",
    deadline: "2026-03-06",
    progress: 85,
    note: "",
    colorTheme: "green",
  },
  {
    abbr: "CHI",
    fullName: "Human Factors in Computing Systems",
    location: "Yokohama, JP",
    startDate: "2026-05-01",
    deadline: "2026-04-06",
    progress: 40,
    note: "",
    colorTheme: "purple",
  },
  {
    abbr: "ICLR",
    fullName: "International Conference on Learning Representations",
    location: "Vienna, Austria",
    startDate: "2026-05-21",
    deadline: "2026-05-21",
    progress: 25,
    note: "",
    colorTheme: "yellow",
  },
  {
    abbr: "AAAI",
    fullName: "Association for the Advancement of AI",
    location: "Philadelphia, USA",
    startDate: "2026-07-20",
    deadline: "2026-07-20",
    progress: 10,
    note: "",
    colorTheme: "blue",
  },
];

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeKeywords(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeProjectDate(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw createHttpError(400, "invalid_project_date");
    }
    return null;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createHttpError(400, "invalid_project_date");
  }
  const parsedDate = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    throw createHttpError(400, "invalid_project_date");
  }
  return normalized;
}

function normalizeProjectProgress(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) return 0;
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw createHttpError(400, "invalid_project_progress");
  }
  const normalized = Math.round(numeric);
  if (normalized < 0 || normalized > 100) {
    throw createHttpError(400, "invalid_project_progress");
  }
  return normalized;
}

function normalizeProjectColorTheme(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) return "green";
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!PROJECT_COLOR_THEMES.has(normalized)) {
    throw createHttpError(400, "invalid_project_color_theme");
  }
  return normalized;
}

function normalizeProjectText(value, {
  required = false,
  maxLength = 128,
  allowEmpty = false,
  field = "invalid_project_field",
} = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw createHttpError(400, field);
  }
  const normalized = String(value).trim();
  if (!normalized && !allowEmpty) {
    throw createHttpError(400, field);
  }
  if (normalized.length > maxLength) {
    throw createHttpError(400, field);
  }
  return normalized;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function parseProjectDeadlinePayload(body, { partial = false } = {}) {
  const raw = body || {};
  const payload = {};

  if (!partial || hasOwn(raw, "abbr")) {
    payload.abbr = normalizeProjectText(raw.abbr, {
      required: !partial,
      maxLength: 24,
      allowEmpty: false,
      field: "invalid_project_abbr",
    });
  }

  if (!partial || hasOwn(raw, "fullName")) {
    payload.fullName = normalizeProjectText(raw.fullName, {
      required: !partial,
      maxLength: 256,
      allowEmpty: false,
      field: "invalid_project_full_name",
    });
  }

  if (!partial || hasOwn(raw, "location")) {
    payload.location = normalizeProjectText(raw.location, {
      required: false,
      maxLength: 128,
      allowEmpty: true,
      field: "invalid_project_location",
    });
    if (payload.location === null) payload.location = "";
  }

  if (!partial || hasOwn(raw, "startDate")) {
    payload.startDate = normalizeProjectDate(raw.startDate, { required: false });
  }

  if (!partial || hasOwn(raw, "deadline")) {
    payload.deadline = normalizeProjectDate(raw.deadline, { required: true });
  }

  if (!partial || hasOwn(raw, "progress")) {
    payload.progress = normalizeProjectProgress(raw.progress, {
      required: !partial,
    });
    if (payload.progress === null) payload.progress = 0;
  }

  if (!partial || hasOwn(raw, "note")) {
    payload.note = normalizeProjectText(raw.note, {
      required: false,
      maxLength: 1000,
      allowEmpty: true,
      field: "invalid_project_note",
    });
    if (payload.note === null) payload.note = "";
  }

  if (!partial || hasOwn(raw, "colorTheme")) {
    payload.colorTheme = normalizeProjectColorTheme(raw.colorTheme, {
      required: !partial,
    });
    if (!payload.colorTheme) payload.colorTheme = "green";
  }

  return payload;
}

function mapProjectDeadlineRow(row) {
  const formatDateOnly = (value) => {
    if (!value) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const raw = String(value).trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw.slice(0, 10);
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
  };

  const startDate = formatDateOnly(row?.start_date);
  const deadline = formatDateOnly(row?.deadline);
  const year = startDate ? startDate.slice(0, 4) : deadline ? deadline.slice(0, 4) : "";

  return {
    id: row.id,
    abbr: row.abbr || "",
    year,
    fullName: row.full_name || "",
    location: row.location || "",
    startDate,
    deadline,
    progress: Number.isFinite(row.progress) ? row.progress : Number(row.progress || 0),
    note: row.note || "",
    colorTheme: row.color_theme || "green",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, storedDigestHex] = parts;
  if (!salt || !storedDigestHex) return false;
  const derivedHex = crypto.scryptSync(password, salt, 64).toString("hex");
  const storedBuffer = Buffer.from(storedDigestHex, "hex");
  const derivedBuffer = Buffer.from(derivedHex, "hex");
  if (storedBuffer.length !== derivedBuffer.length) return false;
  return crypto.timingSafeEqual(storedBuffer, derivedBuffer);
}

function buildAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      openid: user.openid || undefined,
      email: user.email || undefined,
    },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

function buildUserPayload(user) {
  return {
    id: user.id,
    openid: user.openid || null,
    email: user.email || null,
    nickname: user.nickname,
    avatarUrl: user.avatar_url,
    authProvider: user.auth_provider || null,
    fieldOfStudy: user.field_of_study || null,
  };
}

function isAllowedAvatarUrl(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith("http://") || value.startsWith("https://")) return true;
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function createHttpError(status, message, detail = null) {
  const err = new Error(message);
  err.status = status;
  err.publicMessage = message;
  err.detail = detail;
  return err;
}

function buildLlmChatCompletionsUrl(rawBaseUrl) {
  const base = String(rawBaseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "https://api-inference.modelscope.cn/v1/chat/completions";
  if (/\/v1\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function extFromFileName(fileName = "") {
  const safe = String(fileName || "").trim().toLowerCase();
  if (!safe.includes(".")) return "";
  return safe.split(".").pop() || "";
}

function decodeBase64Buffer(contentBase64) {
  if (typeof contentBase64 !== "string" || !contentBase64.trim()) {
    throw createHttpError(400, "invalid_content_base64");
  }
  if (contentBase64.length > MAX_MANUSCRIPT_BASE64_CHARS) {
    throw createHttpError(400, "manuscript_too_large");
  }

  try {
    const buffer = Buffer.from(contentBase64.trim(), "base64");
    if (!buffer || !buffer.length) {
      throw new Error("empty_buffer");
    }
    return buffer;
  } catch {
    throw createHttpError(400, "invalid_content_base64");
  }
}

function isAllowedRemoteManuscriptHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  return ALLOWED_REMOTE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

async function fetchRemoteFileBuffer(fileUrl) {
  let urlObj;
  try {
    urlObj = new URL(String(fileUrl || "").trim());
  } catch {
    throw createHttpError(400, "invalid_file_url");
  }

  if (urlObj.protocol !== "https:") {
    throw createHttpError(400, "invalid_file_url_protocol");
  }
  if (!isAllowedRemoteManuscriptHost(urlObj.hostname)) {
    throw createHttpError(400, "invalid_file_url_host");
  }

  const resp = await fetch(urlObj.toString(), { method: "GET" });
  if (!resp.ok) {
    throw createHttpError(400, "file_download_failed", `http_${resp.status}`);
  }

  const contentLength = Number(resp.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_MANUSCRIPT_BYTES) {
    throw createHttpError(400, "manuscript_too_large");
  }

  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw createHttpError(400, "manuscript_content_empty");
  }
  if (buffer.length > MAX_REMOTE_MANUSCRIPT_BYTES) {
    throw createHttpError(400, "manuscript_too_large");
  }
  return buffer;
}

async function extractManuscriptText({
  fileName,
  mimeType,
  extension,
  contentBase64,
  fileUrl,
}) {
  const derivedExt = String(extension || "").toLowerCase() || extFromFileName(fileName);
  if (!SUPPORTED_MANUSCRIPT_EXTENSIONS.has(derivedExt)) {
    throw createHttpError(400, "unsupported_file_type");
  }

  let buffer;
  if (typeof contentBase64 === "string" && contentBase64.trim()) {
    buffer = decodeBase64Buffer(contentBase64);
  } else if (typeof fileUrl === "string" && fileUrl.trim()) {
    buffer = await fetchRemoteFileBuffer(fileUrl);
  } else {
    throw createHttpError(400, "invalid_payload");
  }

  const normalizedMimeType = String(mimeType || "").toLowerCase();

  let manuscriptText = "";
  if (derivedExt === "pdf" || normalizedMimeType.includes("pdf")) {
    try {
      const parsed = await pdfParse(buffer);
      manuscriptText = String(parsed?.text || "");
    } catch (err) {
      throw createHttpError(400, "pdf_parse_failed", String(err?.message || err));
    }
  } else {
    manuscriptText = buffer.toString("utf8");
  }

  const cleaned = manuscriptText
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned || cleaned.length < 60) {
    throw createHttpError(400, "manuscript_content_too_short");
  }

  return {
    text: cleaned.slice(0, MAX_MANUSCRIPT_CHARS_FOR_REVIEW),
    extension: derivedExt,
  };
}

function parseJsonFromLlmContent(content) {
  const raw = String(content || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {}

  const markdownJsonMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (markdownJsonMatch?.[1]) {
    try {
      return JSON.parse(markdownJsonMatch[1].trim());
    } catch {}
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const jsonLike = raw.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonLike);
    } catch {}
  }

  return null;
}

function normalizeStringArray(input, maxLength = 5) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxLength);
}

function normalizeDecision(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("reject")) return "REJECT";
  if (lower.includes("accept")) return "ACCEPT";
  return "REJECT";
}

function normalizeScore(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n > 10 && n <= 100) n /= 10;
  return Math.max(0, Math.min(10, Number(n.toFixed(1))));
}

function normalizeReviewResult(rawResult) {
  const raw = rawResult || {};
  return {
    decision: normalizeDecision(raw.decision),
    score: normalizeScore(raw.score),
    summary: String(raw.summary || "").trim(),
    strengths: normalizeStringArray(raw.strengths),
    weaknesses: normalizeStringArray(raw.weaknesses),
    suggestions: normalizeStringArray(raw.suggestions),
  };
}

function purgeExpiredReviewTasks() {
  const now = Date.now();
  for (const [taskId, task] of reviewTasks.entries()) {
    const updatedAtMs = new Date(task.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) continue;
    if (now - updatedAtMs > REVIEW_TASK_TTL_MS) {
      reviewTasks.delete(taskId);
    }
  }
}

function buildReviewTaskPayload(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    fileName: task.fileName,
    error: task.error || null,
    review: task.review || null,
  };
}

function createReviewTask({ userId, fileName, mimeType, extension, fileUrl }) {
  purgeExpiredReviewTasks();
  const nowIso = new Date().toISOString();
  const taskId = crypto.randomUUID();
  const task = {
    taskId,
    userId,
    fileName,
    mimeType,
    extension,
    fileUrl,
    status: "PENDING",
    error: null,
    review: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  reviewTasks.set(taskId, task);
  return task;
}

async function runReviewTask(taskId) {
  const task = reviewTasks.get(taskId);
  if (!task) return;

  task.status = "RUNNING";
  task.updatedAt = new Date().toISOString();

  try {
    const manuscript = await extractManuscriptText({
      fileName: task.fileName,
      mimeType: task.mimeType,
      extension: task.extension,
      fileUrl: task.fileUrl,
    });
    const review = await generateAiReviewFromManuscript(manuscript.text);
    task.status = "DONE";
    task.review = review;
    task.error = null;
    task.updatedAt = new Date().toISOString();
  } catch (err) {
    task.status = "FAILED";
    task.error = err?.publicMessage || "review_simulation_failed";
    task.updatedAt = new Date().toISOString();
  }
}

async function generateAiReviewFromManuscript(manuscriptText) {
  if (!llmApiKey) {
    throw createHttpError(500, "llm_config_missing");
  }

  const endpoint = buildLlmChatCompletionsUrl(llmBaseUrl);
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmApiKey}`,
    },
    body: JSON.stringify({
      model: reviewModelName,
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content:
            "You are a strict but constructive academic reviewer. Reply with JSON only.",
        },
        {
          role: "user",
          content: `Review this manuscript and return JSON with fields: decision (ACCEPT or REJECT), score (0-10), summary, strengths (array), weaknesses (array), suggestions (array).\n\nManuscript:\n${manuscriptText}`,
        },
      ],
    }),
  });

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
    const providerError =
      payload?.error?.message || payload?.message || `llm_http_${resp.status}`;
    throw createHttpError(502, "llm_request_failed", providerError);
  }

  let content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    content = content.map((item) => item?.text || "").join("\n");
  }
  if (typeof content !== "string") {
    content = payload?.choices?.[0]?.text || "";
  }

  const parsed = parseJsonFromLlmContent(content);
  if (!parsed) {
    throw createHttpError(502, "llm_response_invalid");
  }

  return normalizeReviewResult(parsed);
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
      SELECT
        id,
        openid,
        email,
        nickname,
        avatar_url,
        auth_provider,
        field_of_study,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [userId]
  );
  return result.rows[0] || null;
}

async function getUserByEmail(email) {
  const result = await pool.query(
    `
      SELECT
        id,
        openid,
        email,
        password_hash,
        nickname,
        avatar_url,
        auth_provider,
        field_of_study,
        created_at,
        updated_at
      FROM users
      WHERE email = $1
      LIMIT 1;
    `,
    [email]
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
  const normalizedNickname =
    typeof nickname === "string"
      ? nickname.trim() && nickname.trim() !== "微信用户"
        ? nickname.trim()
        : null
      : null;
  const normalizedAvatarUrl =
    typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl.trim() : null;

  const sql = `
    INSERT INTO users (id, openid, nickname, avatar_url, auth_provider)
    VALUES ($1, $2, $3, $4, 'WECHAT')
    ON CONFLICT (openid) DO UPDATE
      SET nickname = CASE
            WHEN users.nickname IS NULL
              OR users.nickname = ''
              OR users.nickname = '微信用户'
            THEN COALESCE(EXCLUDED.nickname, users.nickname)
            ELSE users.nickname
          END,
          avatar_url = CASE
            WHEN users.avatar_url IS NULL
              OR users.avatar_url = ''
            THEN COALESCE(EXCLUDED.avatar_url, users.avatar_url)
            ELSE users.avatar_url
          END,
          auth_provider = 'WECHAT',
          updated_at = NOW()
    RETURNING
      id,
      openid,
      email,
      nickname,
      avatar_url,
      auth_provider,
      field_of_study,
      created_at,
      updated_at;
  `;
  const values = [
    crypto.randomUUID(),
    openid,
    normalizedNickname,
    normalizedAvatarUrl,
  ];
  const result = await pool.query(sql, values);
  return result.rows[0];
}

async function seedDefaultProjectDeadlines(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
        SELECT project_defaults_initialized
        FROM users
        WHERE id = $1
        FOR UPDATE;
      `,
      [userId]
    );
    const userRow = userResult.rows[0];
    if (!userRow) {
      await client.query("ROLLBACK");
      return;
    }
    if (userRow.project_defaults_initialized) {
      await client.query("COMMIT");
      return;
    }

    const countResult = await client.query(
      `
        SELECT COUNT(*)::int AS total
        FROM project_deadlines
        WHERE user_id = $1;
      `,
      [userId]
    );
    const existingTotal = countResult.rows[0]?.total ?? 0;
    if (existingTotal > 0) {
      await client.query(
        `
          UPDATE users
          SET project_defaults_initialized = TRUE,
              updated_at = NOW()
          WHERE id = $1;
        `,
        [userId]
      );
      await client.query("COMMIT");
      return;
    }

    const sql = `
      INSERT INTO project_deadlines (
        id,
        user_id,
        abbr,
        full_name,
        location,
        start_date,
        deadline,
        progress,
        note,
        color_theme
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id, abbr, deadline) DO NOTHING;
    `;

    for (const conf of DEFAULT_PROJECT_DEADLINES) {
      await client.query(sql, [
        crypto.randomUUID(),
        userId,
        conf.abbr,
        conf.fullName,
        conf.location || "",
        conf.startDate || null,
        conf.deadline,
        Number(conf.progress) || 0,
        conf.note || "",
        conf.colorTheme || "green",
      ]);
    }

    await client.query(
      `
        UPDATE users
        SET project_defaults_initialized = TRUE,
            updated_at = NOW()
        WHERE id = $1;
      `,
      [userId]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

    const token = buildAuthToken(user);

    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: 7 * 24 * 60 * 60,
      user: buildUserPayload(user),
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

app.post("/auth/email-register", async (req, res) => {
  try {
    const {
      email,
      password,
      fullName = null,
      fieldOfStudy = null,
    } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ message: "invalid_email" });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ message: "password_too_short" });
    }

    const passwordHash = hashPassword(password);
    const insertResult = await pool.query(
      `
        INSERT INTO users (
          id,
          email,
          password_hash,
          nickname,
          field_of_study,
          auth_provider
        )
        VALUES ($1, $2, $3, $4, $5, 'EMAIL')
        ON CONFLICT (email) DO NOTHING
        RETURNING
          id,
          openid,
          email,
          nickname,
          avatar_url,
          auth_provider,
          field_of_study,
          created_at,
          updated_at;
      `,
      [
        crypto.randomUUID(),
        normalizedEmail,
        passwordHash,
        fullName ? String(fullName).trim() || null : null,
        fieldOfStudy ? String(fieldOfStudy).trim() || null : null,
      ]
    );
    const user = insertResult.rows[0];
    if (!user) {
      return res.status(409).json({ message: "email_already_registered" });
    }

    const token = buildAuthToken(user);
    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: 7 * 24 * 60 * 60,
      user: buildUserPayload(user),
    });
  } catch (err) {
    return res.status(500).json({
      message: "email_register_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/auth/email-login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ message: "invalid_email" });
    }
    if (!password || typeof password !== "string") {
      return res.status(400).json({ message: "missing_password" });
    }

    const user = await getUserByEmail(normalizedEmail);
    if (!user || !user.password_hash) {
      return res.status(401).json({ message: "invalid_credentials" });
    }
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ message: "invalid_credentials" });
    }

    const token = buildAuthToken(user);
    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: 7 * 24 * 60 * 60,
      user: buildUserPayload(user),
    });
  } catch (err) {
    return res.status(500).json({
      message: "email_login_failed",
      detail: String(err?.message || err),
    });
  }
});

app.put("/users/me/profile", authMiddleware, async (req, res) => {
  try {
    const nicknameRaw = req.body?.nickname;
    const avatarUrlRaw = req.body?.avatarUrl;

    const nickname =
      typeof nicknameRaw === "string" ? nicknameRaw.trim().slice(0, 32) : null;
    const avatarUrl =
      typeof avatarUrlRaw === "string" ? avatarUrlRaw.trim() : null;

    if (!nickname || nickname.length < 1) {
      return res.status(400).json({ message: "invalid_nickname" });
    }
    if (avatarUrl && !isAllowedAvatarUrl(avatarUrl)) {
      return res.status(400).json({ message: "invalid_avatar_url" });
    }

    const result = await pool.query(
      `
        UPDATE users
        SET
          nickname = $2,
          avatar_url = COALESCE($3, avatar_url),
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          openid,
          email,
          nickname,
          avatar_url,
          auth_provider,
          field_of_study,
          created_at,
          updated_at;
      `,
      [req.auth.userId, nickname, avatarUrl]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: "user_not_found" });
    }

    return res.status(200).json({
      user: buildUserPayload(user),
    });
  } catch (err) {
    return res.status(500).json({
      message: "update_profile_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/users/me", authMiddleware, async (req, res) => {
  const user = req.currentUser;
  return res.status(200).json({
    id: user.id,
    openid: user.openid || null,
    email: user.email || null,
    nickname: user.nickname || null,
    avatarUrl: user.avatar_url || null,
    authProvider: user.auth_provider || null,
    fieldOfStudy: user.field_of_study || null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  });
});

app.get("/projects/conferences", authMiddleware, async (req, res) => {
  try {
    await seedDefaultProjectDeadlines(req.auth.userId);

    const result = await pool.query(
      `
        SELECT
          id,
          user_id,
          abbr,
          full_name,
          location,
          start_date,
          deadline,
          progress,
          note,
          color_theme,
          created_at,
          updated_at
        FROM project_deadlines
        WHERE user_id = $1
        ORDER BY deadline ASC, created_at ASC;
      `,
      [req.auth.userId]
    );

    return res.status(200).json({
      items: result.rows.map(mapProjectDeadlineRow),
    });
  } catch (err) {
    return res.status(500).json({
      message: "project_conference_list_failed",
      detail: String(err?.message || err),
    });
  }
});

app.post("/projects/conferences", authMiddleware, async (req, res) => {
  try {
    const payload = parseProjectDeadlinePayload(req.body, { partial: false });
    const result = await pool.query(
      `
        INSERT INTO project_deadlines (
          id,
          user_id,
          abbr,
          full_name,
          location,
          start_date,
          deadline,
          progress,
          note,
          color_theme
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
          id,
          user_id,
          abbr,
          full_name,
          location,
          start_date,
          deadline,
          progress,
          note,
          color_theme,
          created_at,
          updated_at;
      `,
      [
        crypto.randomUUID(),
        req.auth.userId,
        payload.abbr,
        payload.fullName,
        payload.location || "",
        payload.startDate,
        payload.deadline,
        payload.progress ?? 0,
        payload.note || "",
        payload.colorTheme || "green",
      ]
    );

    return res.status(201).json({
      item: mapProjectDeadlineRow(result.rows[0]),
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      message: err?.publicMessage || "project_conference_create_failed",
      detail: err?.detail || String(err?.message || err),
    });
  }
});

app.patch("/projects/conferences/:id", authMiddleware, async (req, res) => {
  try {
    const projectId = String(req.params?.id || "").trim();
    if (!projectId) {
      return res.status(400).json({ message: "invalid_project_id" });
    }

    const payload = parseProjectDeadlinePayload(req.body, { partial: true });
    const columnMap = {
      abbr: "abbr",
      fullName: "full_name",
      location: "location",
      startDate: "start_date",
      deadline: "deadline",
      progress: "progress",
      note: "note",
      colorTheme: "color_theme",
    };

    const updates = [];
    const values = [];
    let index = 1;

    for (const [key, column] of Object.entries(columnMap)) {
      if (!hasOwn(payload, key)) continue;
      updates.push(`${column} = $${index}`);
      values.push(payload[key]);
      index += 1;
    }

    if (!updates.length) {
      return res.status(400).json({ message: "no_project_fields_to_update" });
    }

    updates.push("updated_at = NOW()");

    values.push(projectId);
    values.push(req.auth.userId);
    const idParam = index;
    const userIdParam = index + 1;

    const result = await pool.query(
      `
        UPDATE project_deadlines
        SET ${updates.join(", ")}
        WHERE id = $${idParam}
          AND user_id = $${userIdParam}
        RETURNING
          id,
          user_id,
          abbr,
          full_name,
          location,
          start_date,
          deadline,
          progress,
          note,
          color_theme,
          created_at,
          updated_at;
      `,
      values
    );

    const updated = result.rows[0];
    if (!updated) {
      return res.status(404).json({ message: "project_conference_not_found" });
    }

    return res.status(200).json({
      item: mapProjectDeadlineRow(updated),
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      message: err?.publicMessage || "project_conference_update_failed",
      detail: err?.detail || String(err?.message || err),
    });
  }
});

app.delete("/projects/conferences/:id", authMiddleware, async (req, res) => {
  try {
    const projectId = String(req.params?.id || "").trim();
    if (!projectId) {
      return res.status(400).json({ message: "invalid_project_id" });
    }

    const result = await pool.query(
      `
        DELETE FROM project_deadlines
        WHERE id = $1
          AND user_id = $2
        RETURNING id;
      `,
      [projectId, req.auth.userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: "project_conference_not_found" });
    }

    return res.status(200).json({
      id: result.rows[0].id,
      deleted: true,
    });
  } catch (err) {
    return res.status(500).json({
      message: "project_conference_delete_failed",
      detail: String(err?.message || err),
    });
  }
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

app.post("/lab/review-simulator/tasks", authMiddleware, async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || "").trim();
    const mimeType = String(req.body?.mimeType || "").trim();
    const extension = String(req.body?.extension || "").trim();
    const fileUrl = String(req.body?.fileUrl || "").trim();

    if (!fileName || !fileUrl) {
      return res.status(400).json({ message: "invalid_payload" });
    }

    const derivedExt = extension || extFromFileName(fileName);
    if (!SUPPORTED_MANUSCRIPT_EXTENSIONS.has(String(derivedExt || "").toLowerCase())) {
      return res.status(400).json({ message: "unsupported_file_type" });
    }

    const task = createReviewTask({
      userId: req.auth.userId,
      fileName,
      mimeType,
      extension: derivedExt,
      fileUrl,
    });

    runReviewTask(task.taskId).catch(() => {});

    return res.status(202).json({
      task: buildReviewTaskPayload(task),
    });
  } catch (err) {
    return res.status(500).json({
      message: "review_task_create_failed",
      detail: String(err?.message || err),
    });
  }
});

app.get("/lab/review-simulator/tasks/:taskId", authMiddleware, async (req, res) => {
  const taskId = String(req.params?.taskId || "").trim();
  if (!taskId) {
    return res.status(400).json({ message: "invalid_task_id" });
  }

  const task = reviewTasks.get(taskId);
  if (!task || task.userId !== req.auth.userId) {
    return res.status(404).json({ message: "task_not_found" });
  }

  return res.status(200).json({
    task: buildReviewTaskPayload(task),
  });
});

app.post("/lab/review-simulator", authMiddleware, async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || "").trim();
    const mimeType = String(req.body?.mimeType || "").trim();
    const extension = String(req.body?.extension || "").trim();
    const contentBase64 = String(req.body?.contentBase64 || "");
    const fileUrl = String(req.body?.fileUrl || "").trim();

    if (!fileName || (!contentBase64 && !fileUrl)) {
      return res.status(400).json({ message: "invalid_payload" });
    }

    const manuscript = await extractManuscriptText({
      fileName,
      mimeType,
      extension,
      contentBase64,
      fileUrl,
    });
    const review = await generateAiReviewFromManuscript(manuscript.text);

    return res.status(200).json({
      review,
      meta: {
        model: reviewModelName,
        endpoint: buildLlmChatCompletionsUrl(llmBaseUrl),
        inputChars: manuscript.text.length,
        fileType: manuscript.extension,
      },
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({
      message: err?.publicMessage || "review_simulation_failed",
      detail: err?.detail || String(err?.message || err),
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ message: "not_found" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Research Pilot backend listening on ${port}`);
});
