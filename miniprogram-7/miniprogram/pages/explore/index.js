// pages/explore/index.js
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

  /**
   * 顶部 Icon 按钮点击事件
   * 跳转到 explore_Card 页面
   */
  onSwitchToCard: function() {
    wx.navigateTo({
      url: '/pages/explore_Card/index',
      fail: (err) => {
        console.error("跳转失败:", err);
      }
    });
  },

  /**
   * 卡片点击事件
   * 跳转到 paper/detail 页面
   */
  onCardClick: function() {
    wx.navigateTo({
      url: '/pages/paper/detail',
      fail: (err) => {
        console.error("跳转详情页失败:", err);
      }
    });
  }
})