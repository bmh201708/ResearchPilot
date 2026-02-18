# CloudBase AnyService 落地指南（作业一周交付版）

## 1. 目标

在不等待 ICP 备案的前提下，让微信小程序预览/体验版可正常调用你的现有后端（腾讯云服务器 `111.229.204.242`）。

当前代码已支持两种请求模式：

- `direct-http`：开发工具本地调试直连 `http://111.229.204.242:8081`
- `cloudbase-anyservice`：通过 `wx.cloud.callContainer` 走 CloudBase AnyService

## 2. 已完成的代码改造

- 新增运行时配置：`/Users/jimjimu/Documents/GitHub/ResearchPilot/miniprogram-7/miniprogram/config/runtime.js`
- 小程序启动配置改造：`/Users/jimjimu/Documents/GitHub/ResearchPilot/miniprogram-7/miniprogram/app.js`
- 统一请求层支持 AnyService：`/Users/jimjimu/Documents/GitHub/ResearchPilot/miniprogram-7/miniprogram/utils/request.js`
- 微信登录改为走统一请求层：`/Users/jimjimu/Documents/GitHub/ResearchPilot/miniprogram-7/miniprogram/pages/login/login.js`

## 3. 控制台配置步骤

1. 打开微信开发者工具，确认 `AppID` 为当前项目使用的 `wxa79a767109f8d055`。
2. 打开腾讯云 CloudBase 控制台，创建或选择一个环境（记录环境 ID，如 `prod-xxxx`）。
3. 在 CloudBase 中启用 AnyService。
4. 选择“接入云服务器/CVM”方式，目标地址填你的服务入口：
   - 协议：`HTTP`
   - 地址：`111.229.204.242`
   - 端口：`8081`
   - 健康检查路径：`/healthz`
5. 保存后拿到服务标识：
   - 如果控制台给的是云服务器接入标识（示例 `lhins-xxxx`），用于 `vmService`
   - 如果给的是 AnyService 服务名，用于 `anyServiceName`

## 4. 小程序配置

编辑 `/Users/jimjimu/Documents/GitHub/ResearchPilot/miniprogram-7/miniprogram/config/runtime.js`：

```js
const runtimeConfig = {
  apiMode: "cloudbase-anyservice",
  apiBaseUrl: "http://111.229.204.242:8081",
  cloudbase: {
    env: "你的CloudBase环境ID",
    gatewayService: "tcbanyservice",
    anyServiceName: "",
    vmService: "你的vmService标识", // 如果你用的是CVM接入，填这里
  },
};
```

说明：

- `anyServiceName` 和 `vmService` 二选一，至少填一个。
- 你当前场景建议优先填 `vmService`（CVM接入最直接）。

## 5. 验收清单

1. 微信开发者工具点击“预览”，用微信大号/小号分别扫码。
2. 两个账号都应能进入小程序并完成登录，不再出现“网络异常”。
3. 登录后进入 Profile，确认用户信息正常展示。
4. Explore 页可正常拉取论文列表。

## 6. 常见报错与处理

- `cloudbase_env_not_configured`
  - 没填 `cloudbase.env`。
- `anyservice_target_not_configured`
  - `anyServiceName` 和 `vmService` 都没填。
- `网络异常`
  - AnyService 后端目标不可达，检查：
    - `http://111.229.204.242:8081/healthz` 是否可访问
    - CloudBase 控制台里的目标端口/健康检查路径是否正确
    - 服务器安全组是否放行对应端口

## 7. 交付建议（这周）

1. 本周演示阶段固定使用 `cloudbase-anyservice` 模式。
2. 作业提交后再并行推进备案 + `https` 正式域名。
3. 备案完成后，可把 `apiMode` 切回 `direct-http`（改成正式 `https` 域名）。
