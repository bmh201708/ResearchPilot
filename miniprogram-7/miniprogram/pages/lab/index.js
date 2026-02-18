const app = getApp();
const { request } = require("../../utils/request");

// pages/lab/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    user: null,
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
    this.syncCurrentUser();
  },

  async syncCurrentUser() {
    try {
      const user = await request({
        url: "/users/me",
        method: "GET",
        auth: true,
      });
      app.globalData.user = user;
      this.setData({ user });
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        app.globalData.user = null;
        wx.reLaunch({
          url: "/pages/login/login",
        });
        return;
      }
      console.error("获取用户信息失败", err);
    }
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

  }
})
