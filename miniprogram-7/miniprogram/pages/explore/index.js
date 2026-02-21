const app = getApp();
const { request } = require("../../utils/request");

function splitColumns(papers) {
  const left = [];
  const right = [];
  papers.forEach((paper, index) => {
    if (index % 2 === 0) {
      left.push(paper);
      return;
    }
    right.push(paper);
  });
  return { left, right };
}

function normalizePaper(item) {
  const authors = Array.isArray(item.authors) ? item.authors : [];
  const shortAbstract = (item.abstract || "").trim().slice(0, 120);
  return {
    id: item.id,
    title: item.title || "Untitled Paper",
    abstractShort: shortAbstract || "No abstract available.",
    authorsText: authors.slice(0, 3).join(", ") || "Unknown authors",
    yearText: item.year ? `${item.year}` : "Latest",
    citationText: `Citations ${item.citationCount || 0}`,
    source: item.source || "semantic_scholar",
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
    leftPapers: [],
    rightPapers: [],
    isLoading: false,
    errorMsg: "",
    source: "",
    likeSubmittingId: "",
  },

  onLoad() {
    const keywords = app.globalData.exploreKeywords || "";
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
      "pageSize=12",
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
      const columns = splitColumns(papers);
      const appliedKeywords =
        (resp.meta && resp.meta.appliedKeywords) || keywords || "";

      app.globalData.exploreKeywords = keywords;
      this.setData({
        appliedKeywords,
        papers,
        leftPapers: columns.left,
        rightPapers: columns.right,
        source: (resp.meta && resp.meta.source) || "",
      });
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      this.setData({
        errorMsg: "获取论文失败，请稍后重试",
      });
    } finally {
      this.setData({ isLoading: false });
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  onSwitchToCard() {
    const keywords = encodeURIComponent((this.data.keywords || "").trim());
    wx.navigateTo({
      url: `/pages/explore_Card/index?keywords=${keywords}`,
      fail: (err) => {
        console.error("跳转失败:", err);
      },
    });
  },

  onPaperTap(e) {
    const paperId = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "";
    if (!paperId) return;
    wx.navigateTo({
      url: `/pages/paper/detail?id=${encodeURIComponent(paperId)}`,
      fail: (err) => {
        console.error("跳转详情页失败:", err);
      },
    });
  },

  updatePaperLikeState(paperId, likedByMe) {
    const papers = (this.data.papers || []).map((item) => {
      if (item.id !== paperId) return item;
      return {
        ...item,
        likedByMe: Boolean(likedByMe),
      };
    });
    const columns = splitColumns(papers);
    this.setData({
      papers,
      leftPapers: columns.left,
      rightPapers: columns.right,
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
