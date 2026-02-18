const runtimeConfig = {
  // 可选: "direct-http" | "cloudbase-anyservice"
  apiMode: "cloudbase-anyservice",

  // direct-http 模式配置（本地开发可继续使用）
  apiBaseUrl: "http://111.229.204.242:8081",

  // cloudbase-anyservice 模式配置
  cloudbase: {
    // 云开发环境 ID，例如: prod-1gxxxxxx
    env: "cloud1-9gx3r43j22f4cca1",

    // AnyService 网关，默认使用官方网关
    gatewayService: "tcbanyservice",

    // 二选一:
    // 1) 云托管/AnyService 服务名（X-AnyService-Name）
    anyServiceName: "researchpilotapi",

    // 2) 云服务器接入标识（X-Vm-Service），示例: lhins-xxxxx
    vmService: "",
  },
};

module.exports = runtimeConfig;
