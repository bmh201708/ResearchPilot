const app = getApp();

function getApiBaseUrl() {
  return (app.globalData.apiBaseUrl || "").replace(/\/$/, "");
}

function request({ url, method = "GET", data, auth = false, timeout = 12000 }) {
  return new Promise((resolve, reject) => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      reject(new Error("api_base_url_not_configured"));
      return;
    }

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

    wx.request({
      url: `${baseUrl}${url}`,
      method,
      data,
      timeout,
      header: headers,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const message = (res.data && res.data.message) || `http_${res.statusCode}`;
        const err = new Error(message);
        err.statusCode = res.statusCode;
        err.response = res.data;
        reject(err);
      },
      fail: (err) => {
        reject(err);
      },
    });
  });
}

module.exports = {
  request,
};
