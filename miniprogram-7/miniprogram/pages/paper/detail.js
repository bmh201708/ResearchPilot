const { request } = require("../../utils/request");

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

Page({
  data: {
    paperId: "",
    paper: null,
    isLoading: true,
    errorMsg: "",

    comments: [
        {
          name: "Jane Doe",
          time: "2h ago",
          content: "Interesting approach to sparsity.",
          initial: "JD"
        },
        {
          name: "Bruce Wayne",
          time: "3h ago",
          content: "Not that good.",
          initial: "BW"
        }
      ],
      newComment: "",
      isFavorite: false,
  },

  onInputComment(e) {
    this.setData({
      newComment: e.detail.value
    })
  },
  
  onSendComment() {
    if (!this.data.newComment.trim()) return;
  
    const newItem = {
      name: "You",
      time: "Just now",
      content: this.data.newComment,
      initial: "YO"
    }
  
    this.setData({
      comments: [newItem, ...this.data.comments],
      newComment: ""
    })
  },
  
  onToggleFavorite() {
    this.setData({
      isFavorite: !this.data.isFavorite
    })
  },

  onLoad(options) {
    const paperId = decodeURIComponent(options.id || "").trim();
    if (!paperId) {
      this.setData({
        isLoading: false,
        errorMsg: "缺少论文 ID，无法加载详情",
      });
      return;
    }
    this.setData({ paperId });
    this.fetchPaperDetail(paperId);
  },

  onPullDownRefresh() {
    if (!this.data.paperId) {
      wx.stopPullDownRefresh();
      return;
    }
    this.fetchPaperDetail(this.data.paperId, { stopPullDown: true });
  },

  async fetchPaperDetail(paperId, options = {}) {
    this.setData({ isLoading: true, errorMsg: "" });
    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}`,
        method: "GET",
        auth: true,
      });

      const authors = Array.isArray(resp.authors) ? resp.authors : [];
      const tags = Array.isArray(resp.tags) ? resp.tags : [];
      const paper = {
        id: resp.id,
        title: resp.title || "Untitled Paper",
        abstract: resp.abstract || "No abstract available.",
        authors,
        authorsText: authors.join(", ") || "Unknown authors",
        tags,
        publishedText: formatDate(resp.publishedAt),
        venue: resp.venue || "",
        year: resp.year || "",
        citationCount: resp.citationCount || 0,
        link: resp.link || "",
      };
      this.setData({ paper });
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      this.setData({
        errorMsg: "获取论文详情失败，请稍后重试",
      });
    } finally {
      this.setData({ isLoading: false });
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  onCopyLink() {
    const link = this.data.paper && this.data.paper.link ? this.data.paper.link : "";
    if (!link) {
      wx.showToast({ title: "暂无可复制链接", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: link,
      success: () => {
        wx.showToast({ title: "链接已复制", icon: "success" });
      },
    });
  },

  onOpenLink() {
    const link = this.data.paper && this.data.paper.link ? this.data.paper.link : "";
    if (!link) {
      wx.showToast({ title: "暂无可打开链接", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: link,
      success: () => {
        wx.showModal({
          title: "链接已复制",
          content: "已复制论文链接，你可以在浏览器中打开。",
          showCancel: false,
        });
      },
    });
  },
});
