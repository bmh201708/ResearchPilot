# Research Pilot Mini Program

微信小程序 + Node.js 后端 + PostgreSQL 的论文探索工具。

<p align="center">
  <img src="docs/img/tease.png" alt="Research Pilot Tease" width="680" />
</p>

## 项目结构

- `miniprogram/`：微信小程序前端
- `backend/`：Node.js API 服务
- `deploy/`：Docker Compose 与 Nginx 配置
- `docs/`：需求与开发文档
- `cloudfunctions/`：云开发示例/扩展代码

## 当前技术架构

- 前端：微信小程序原生框架
- 后端：Node.js + Express
- 数据库：PostgreSQL（Docker）
- 缓存：Redis（Docker）
- 生产入口：Nginx（Docker）
- 小程序到后端链路：
  - 开发调试可用 `direct-http`
  - 预览/体验可用 CloudBase AnyService（已接入）

## 核心功能

- 邮箱注册/登录 + 微信登录
- 微信首次登录资料完善（昵称/头像）
- 论文推荐流（Semantic Scholar）与论文详情页
- `Review Simulator`：
  - 上传 `PDF/TXT/MD` 稿件（上限 50MB）
  - AI 审稿意见、`ACCEPT/REJECT`、评分
  - 异步任务模式（避免 AnyService 长请求超时）

## 本地与服务器启动

1. 准备后端环境变量（`deploy/.env`）
2. 启动服务：

```bash
cd deploy
docker compose up -d --build
```

3. 健康检查：

```bash
curl http://127.0.0.1:3005/healthz
curl http://127.0.0.1:8081/healthz
```

## 小程序配置

运行时配置文件：`miniprogram/config/runtime.js`

- AnyService 模式（当前推荐）：
  - `apiMode: "cloudbase-anyservice"`
  - `cloudbase.env: "<你的环境ID>"`
  - `cloudbase.anyServiceName` 或 `cloudbase.vmService` 二选一
- 直连模式（仅调试）：
  - `apiMode: "direct-http"`
  - `apiBaseUrl: "http://<ip>:<port>"`

## Review Simulator 配置说明

- 相关环境变量在服务器 `deploy/.env`：
  - `LLM_API_KEY`
  - `LLM_BASE_URL`（示例：`https://api-inference.modelscope.cn`）
  - `REVIEW_MODEL_NAME`（默认：`deepseek-ai/DeepSeek-V3.2`）
- 后端实际请求会自动拼接为 OpenAI 兼容端点：
  - `<LLM_BASE_URL>/v1/chat/completions`

## 关键文档

- `docs/后端技术架构规划.md`
- `docs/后端联调接口说明.md`
- `docs/CloudBase-AnyService落地指南.md`

## 常见问题

- 预览能进首页但登录失败：优先检查 AnyService 配置和 `runtime.js`
- `INVALID_HOST`：检查 AnyService 源站连接信息是否为 `host:port` 且服务标识一致
- 微信登录重复要求完善资料：检查数据库是否保存了昵称和头像
- `cloud.callContainer:fail code 102002`：改用异步任务接口（当前已实现），避免长请求超时
