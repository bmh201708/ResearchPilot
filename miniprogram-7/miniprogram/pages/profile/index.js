// pages/profile/index.js
const { request } = require("../../utils/request");

function buildDisplayName(user) {
  const nickname = (user && user.nickname ? String(user.nickname).trim() : "") || "";
  if (nickname) return nickname;
  const email = (user && user.email ? String(user.email).trim() : "") || "";
  if (email && email.includes("@")) return email.split("@")[0];
  return "User";
}

function buildBio(user) {
  const fieldOfStudy =
    (user && user.fieldOfStudy ? String(user.fieldOfStudy).trim() : "") || "";
  if (fieldOfStudy) return fieldOfStudy;
  return "Design-minded academic explorer";
}

Page({
  data: {
    userName: "User",
    userBio: "Design-minded academic explorer",
    avatarUrl: "/images/profile/user.png",
  },

  onShow() {
    this.syncProfile();
  },

  onPullDownRefresh() {
    this.syncProfile({ stopPullDown: true });
  },

  async syncProfile(options = {}) {
    try {
      const user = await request({
        url: "/users/me",
        method: "GET",
        auth: true,
      });
      this.setData({
        userName: buildDisplayName(user),
        userBio: buildBio(user),
        avatarUrl: user.avatarUrl || "/images/profile/user.png",
      });
      wx.setStorageSync("user", user || {});
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({
          url: "/pages/login/login",
        });
        return;
      }

      const cachedUser = wx.getStorageSync("user") || {};
      this.setData({
        userName: buildDisplayName(cachedUser),
        userBio: buildBio(cachedUser),
        avatarUrl: cachedUser.avatarUrl || "/images/profile/user.png",
      });
    } finally {
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },
});
