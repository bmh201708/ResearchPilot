const app = getApp();

function getApiBaseUrl() {
  return (app.globalData.apiBaseUrl || "").replace(/\/$/, "");
}

function getApiMode() {
  return app.globalData.apiMode || "direct-http";
}

function getCloudbaseConfig() {
  return app.globalData.cloudbase || {};
}

function buildQueryString(data) {
  if (!data || typeof data !== "object") return "";
  const entries = Object.entries(data).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );
  if (!entries.length) return "";

  return entries
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value
          .map((item) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
          .join("&");
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");
}

function normalizeResponse({ statusCode, data }) {
  if (statusCode >= 200 && statusCode < 300) {
    return { ok: true, payload: data };
  }
  const message = (data && data.message) || `http_${statusCode}`;
  const err = new Error(message);
  err.statusCode = statusCode;
  err.response = data;
  return { ok: false, error: err };
}

function sendByDirectHttp({ url, method, data, timeout, headers }) {
  return new Promise((resolve, reject) => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      reject(new Error("api_base_url_not_configured"));
      return;
    }

    let finalUrl = `${baseUrl}${url}`;
    let payload = data;
    if (method === "GET" && payload) {
      const query = buildQueryString(payload);
      if (query) {
        finalUrl += `${finalUrl.includes("?") ? "&" : "?"}${query}`;
      }
      payload = undefined;
    }

    wx.request({
      url: finalUrl,
      method,
      data: payload,
      timeout,
      header: headers,
      success: (res) => {
        const normalized = normalizeResponse(res);
        if (normalized.ok) {
          resolve(normalized.payload);
          return;
        }
        reject(normalized.error);
      },
      fail: (err) => reject(err),
    });
  });
}

function sendByCloudbaseAnyService({ url, method, data, timeout, headers }) {
  return new Promise((resolve, reject) => {
    const cloudbase = getCloudbaseConfig();
    const env = cloudbase.env || "";
    const gatewayService = cloudbase.gatewayService || "tcbanyservice";
    const anyServiceName = cloudbase.anyServiceName || "";
    const vmService = cloudbase.vmService || "";

    if (!env) {
      reject(new Error("cloudbase_env_not_configured"));
      return;
    }
    if (!anyServiceName && !vmService) {
      reject(new Error("anyservice_target_not_configured"));
      return;
    }

    let path = url.startsWith("/") ? url : `/${url}`;
    let payload = data;
    if (method === "GET" && payload) {
      const query = buildQueryString(payload);
      if (query) {
        path += `${path.includes("?") ? "&" : "?"}${query}`;
      }
      payload = undefined;
    }

    const cloudHeaders = {
      ...headers,
      "X-WX-SERVICE": gatewayService,
    };
    if (anyServiceName) {
      cloudHeaders["X-AnyService-Name"] = anyServiceName;
    }
    if (vmService) {
      cloudHeaders["X-Vm-Service"] = vmService;
    }

    wx.cloud.callContainer({
      config: {
        env,
      },
      path,
      method,
      header: cloudHeaders,
      data: payload,
      timeout,
      success: (res) => {
        const normalized = normalizeResponse(res);
        if (normalized.ok) {
          resolve(normalized.payload);
          return;
        }
        reject(normalized.error);
      },
      fail: (err) => reject(err),
    });
  });
}

function request({ url, method = "GET", data, auth = false, timeout = 12000 }) {
  return new Promise((resolve, reject) => {
    const apiMode = getApiMode();

    const headers = {
      "Content-Type": "application/json",
    };

    if (auth) {
      const token = wx.getStorageSync("token");
      if (!token) {
        reject(new Error("missing_token"));
        return;
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const sender =
      apiMode === "cloudbase-anyservice" ? sendByCloudbaseAnyService : sendByDirectHttp;

    sender({
      url,
      method,
      data,
      timeout,
      headers,
    })
      .then(resolve)
      .catch(reject);
  });
}

module.exports = {
  request,
};
