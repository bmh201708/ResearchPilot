// app.js
const runtimeConfig = require("./config/runtime");

App({
  onLaunch: function () {
    const cloudbaseConfig = runtimeConfig.cloudbase || {};
    const cloudEnv = cloudbaseConfig.env || "";

    this.globalData = {
      // direct-http | cloudbase-anyservice
      apiMode: runtimeConfig.apiMode || "direct-http",
      apiBaseUrl: runtimeConfig.apiBaseUrl || "",
      cloudbase: cloudbaseConfig,
      // 兼容旧页面示例代码
      env: cloudEnv,
      user: null,
    };

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: cloudEnv || undefined,
        traceUser: true,
      });
    }
  },
});
