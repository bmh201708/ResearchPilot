const app = getApp();
const { request } = require("../../utils/request");

function normalizePaper(item) {
  const authors = Array.isArray(item.authors) ? item.authors : [];
  const shortAbstract = (item.abstract || "").trim().slice(0, 180);
  return {
    id: item.id,
    title: item.title || "Untitled Paper",
    abstractShort: shortAbstract || "No abstract available.",
    authorsText: authors.slice(0, 4).join(", ") || "Unknown authors",
    yearText: item.year ? `${item.year}` : "Latest",
    citationText: `${item.citationCount || 0} citations`,
    likedByMe: Boolean(item.likedByMe),
  };
}

function parseDatasetBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0" || normalized === "") return false;
  return Boolean(value);
}

Page({
  data: {
    keywords: "",
    appliedKeywords: "",
    papers: [],
    leadPaper: null,
    restPapers: [],
    isLoading: false,
    errorMsg: "",
    source: "",
    likeSubmittingId: "",
  },

  onLoad(options) {
    const fromQuery = decodeURIComponent(options.keywords || "");
    const keywords = fromQuery || app.globalData.exploreKeywords || "";
    this.setData({ keywords });
    this.fetchPapers(keywords);
  },

  onPullDownRefresh() {
    this.fetchPapers(this.data.keywords, { stopPullDown: true });
  },

  onKeywordInput(e) {
    this.setData({ keywords: e.detail.value || "" });
  },

  onSearchTap() {
    if (this.data.isLoading) return;
    this.fetchPapers(this.data.keywords);
  },

  async fetchPapers(rawKeywords, options = {}) {
    if (this.data.isLoading) return;
    const keywords = (rawKeywords || "").trim();
    const query = [
      "page=1",
      "pageSize=8",
      keywords ? `keywords=${encodeURIComponent(keywords)}` : "",
    ]
      .filter(Boolean)
      .join("&");

    this.setData({ isLoading: true, errorMsg: "" });
    try {
      const resp = await request({
        url: `/papers/feed?${query}`,
        method: "GET",
        auth: true,
      });
      const papers = (resp.items || []).map(normalizePaper);
      const leadPaper = papers.length ? papers[0] : null;
      const restPapers = papers.slice(1);

      app.globalData.exploreKeywords = keywords;
      this.setData({
        papers,
        leadPaper,
        restPapers,
        appliedKeywords:
          (resp.meta && resp.meta.appliedKeywords) || keywords || "",
        source: (resp.meta && resp.meta.source) || "",
      });
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      this.setData({ errorMsg: "获取论文失败，请稍后重试" });
    } finally {
      this.setData({ isLoading: false });
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  onSwitchToExplore() {
    app.globalData.exploreKeywords = (this.data.keywords || "").trim();
    wx.switchTab({
      url: "/pages/explore/index",
      fail: (err) => {
        console.error("跳转失败，请检查 app.json 中是否配置了该 TabBar 路径", err);
      },
    });
  },

  onCardClick(e) {
    const paperId = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "";
    if (!paperId) return;
    wx.navigateTo({
      url: `/pages/paper/detail?id=${encodeURIComponent(paperId)}`,
      fail: (err) => {
        console.error("详情页跳转失败，请检查 app.json 是否注册了该页面", err);
      },
    });
  },

  onPaperTap(e) {
    this.onCardClick(e);
  },

  updatePaperLikeState(paperId, likedByMe) {
    const papers = (this.data.papers || []).map((item) => {
      if (item.id !== paperId) return item;
      return {
        ...item,
        likedByMe: Boolean(likedByMe),
      };
    });
    this.setData({
      papers,
      leadPaper: papers.length ? papers[0] : null,
      restPapers: papers.slice(1),
    });
  },

  async onTogglePaperLike(e) {
    const paperId = String(e.currentTarget?.dataset?.id || "").trim();
    const likedByMe = parseDatasetBoolean(e.currentTarget?.dataset?.liked);
    if (!paperId || this.data.likeSubmittingId === paperId) return;

    this.setData({ likeSubmittingId: paperId });
    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}/like`,
        method: "POST",
        data: {
          liked: !likedByMe,
        },
        auth: true,
      });
      this.updatePaperLikeState(paperId, Boolean(resp.liked));
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({
        title: "点赞失败，请重试",
        icon: "none",
      });
    } finally {
      this.setData({ likeSubmittingId: "" });
    }
  },
});
