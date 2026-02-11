// pages/login/login.js
Page({

  /**
   * 页面的初始数据
   */
  data: {

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
    wx.switchTab({
      url: '/pages/lab/index',
      fail: (err) => {
        console.error("跳转失败，请检查路径是否正确", err);
      }
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