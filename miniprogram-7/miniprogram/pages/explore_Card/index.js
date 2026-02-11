// pages/explore_Card/index.js
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
   * 跳转到发现页 (TabBar页面)
   * 注意：跳转到 TabBar 页面必须使用 wx.switchTab
   */
  onSwitchToExplore: function() {
    wx.switchTab({
      url: '/pages/explore/index',
      success: function() {
        console.log('跳转成功');
      },
      fail: function(err) {
        console.error('跳转失败，请检查 app.json 中是否配置了该 TabBar 路径', err);
        
        // 容错处理：如果不是 TabBar 页面，尝试普通跳转
        // wx.navigateTo({ url: '/pages/explore/index' });
      }
    });
  },

  /**
   * 新增：主卡片点击跳转
   * 跳转到普通页面 pages/paper/detail
   */
  onCardClick: function() {
    wx.navigateTo({
      url: '/pages/paper/detail',
      fail: (err) => {
        console.error("详情页跳转失败，请检查 app.json 是否注册了该页面", err);
      }
    });
  },

  
})