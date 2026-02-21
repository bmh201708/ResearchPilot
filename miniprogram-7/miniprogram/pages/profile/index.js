// pages/profile/index.js
const { request } = require("../../utils/request");
const COLLECTED_ICON_CLASSES = ["bg-indigo-gradient", "bg-teal-gradient", "bg-pink-gradient"];

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

function normalizeCollectedPaper(item, index) {
  const title = String(item?.title || "").trim() || "Untitled Paper";
  const abstract = String(item?.abstract || "").trim();
  const description = abstract
    ? abstract.slice(0, 120)
    : "No abstract available.";
  const tags = Array.isArray(item?.tags)
    ? item.tags
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .slice(0, 2)
    : [];
  const publishedDate = item?.publishedAt ? new Date(item.publishedAt) : null;
  const year =
    publishedDate && !Number.isNaN(publishedDate.getTime())
      ? `${publishedDate.getFullYear()}`
      : "";
  const displayTags = tags.length ? tags : year ? [year] : ["PAPER"];

  return {
    id: String(item?.id || ""),
    title,
    description,
    tags: displayTags,
    iconClass: COLLECTED_ICON_CLASSES[index % COLLECTED_ICON_CLASSES.length],
    iconText: "PDF",
  };
}

Page({
  data: {
    userName: "User",
    userBio: "Design-minded academic explorer",
    avatarUrl: "/images/profile/user.png",
    collectedPapers: [],
    collectedLoading: false,
    collectedError: "",
  },

  onShow() {
    this.syncProfile();
  },

  onPullDownRefresh() {
    this.syncProfile({ stopPullDown: true });
  },

  handleAuthError(err) {
    if (err.statusCode === 401 || err.message === "missing_token") {
      wx.removeStorageSync("token");
      wx.removeStorageSync("user");
      wx.reLaunch({
        url: "/pages/login/login",
      });
      return true;
    }
    return false;
  },

  async syncProfile(options = {}) {
    try {
      await this.syncUserBasic();
      if (!wx.getStorageSync("token")) {
        return;
      }
      await this.syncCollectedPapers();
    } finally {
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  async syncUserBasic() {
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
      if (this.handleAuthError(err)) {
        return;
      }

      const cachedUser = wx.getStorageSync("user") || {};
      this.setData({
        userName: buildDisplayName(cachedUser),
        userBio: buildBio(cachedUser),
        avatarUrl: cachedUser.avatarUrl || "/images/profile/user.png",
      });
    }
  },

  async syncCollectedPapers() {
    this.setData({
      collectedLoading: true,
      collectedError: "",
    });
    try {
      const resp = await request({
        url: "/users/me/liked-papers?page=1&pageSize=50",
        method: "GET",
        auth: true,
      });
      const items = Array.isArray(resp.items) ? resp.items : [];
      this.setData({
        collectedPapers: items
          .map((item, index) => normalizeCollectedPaper(item, index))
          .filter((item) => item.id),
      });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({
        collectedError: "加载收藏论文失败，请稍后重试",
      });
    } finally {
      this.setData({
        collectedLoading: false,
      });
    }
  },

  onCollectedPaperTap(e) {
    const paperId = String(e.currentTarget?.dataset?.id || "").trim();
    if (!paperId) return;
    wx.navigateTo({
      url: `/pages/paper/detail?id=${encodeURIComponent(paperId)}`,
      fail: (err) => {
        console.error("跳转论文详情失败", err);
      },
    });
  },
});
