// pages/login/login.js
const app = getApp();

Page({

  /**
   * 页面的初始数据
   */
  data: {
    isLoading: false,
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  },

  // 登录按钮点击事件
  onSignIn: function() {
    if (this.data.isLoading) return;

    const baseUrl = (app.globalData.apiBaseUrl || "").replace(/\/$/, "");
    if (!baseUrl) {
      wx.showToast({
        title: "未配置后端地址",
        icon: "none",
      });
      return;
    }

    this.setData({ isLoading: true });
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          wx.showToast({ title: "获取登录码失败", icon: "none" });
          this.setData({ isLoading: false });
          return;
        }

        const sendLoginRequest = (retryTimes = 0) => {
          let willRetry = false;
          wx.request({
            url: `${baseUrl}/auth/wx-login`,
            method: "POST",
            timeout: 12000,
            header: {
              "Content-Type": "application/json",
            },
            data: {
              code: loginRes.code,
            },
            success: (res) => {
              if (res.statusCode === 200 && res.data && res.data.token) {
                wx.setStorageSync("token", res.data.token);
                wx.setStorageSync("user", res.data.user || {});
                app.globalData.user = res.data.user || null;
                wx.switchTab({
                  url: "/pages/lab/index",
                });
                return;
              }

              if (res.statusCode === 502 && retryTimes < 1) {
                willRetry = true;
                setTimeout(() => sendLoginRequest(retryTimes + 1), 800);
                return;
              }

              const msg = (res.data && res.data.message) || `登录失败(${res.statusCode})`;
              wx.showToast({
                title: msg,
                icon: "none",
              });
            },
            fail: (err) => {
              console.error("请求登录接口失败", err);
              wx.showToast({
                title: "网络异常，请稍后重试",
                icon: "none",
              });
            },
            complete: () => {
              if (!willRetry) {
                this.setData({ isLoading: false });
              }
            },
          });
        };

        sendLoginRequest(0);
      },
      fail: (err) => {
        console.error("wx.login 调用失败", err);
        wx.showToast({
          title: "微信登录失败",
          icon: "none",
        });
        this.setData({ isLoading: false });
      },
    });
  },

  // 创建账号按钮点击事件
  onCreate: function() {
    wx.navigateTo({
      url: '/pages/register/register',
      fail: (err) => {
        console.error("跳转失败，请检查路径是否正确", err);
      }
    });
  },
})
