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

function formatRelativeTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return "Just now";
  if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 1000))}m ago`;
  if (diffMs < 24 * 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 60 * 1000))}h ago`;
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diffMs / (24 * 60 * 60 * 1000))}d ago`;
  return formatDate(value);
}

function buildInitial(name) {
  const normalized = String(name || "").trim();
  if (!normalized) return "US";
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return normalized.slice(0, 2).toUpperCase();
}

function normalizeComment(item) {
  const nickname = String(item?.user?.nickname || "").trim() || "User";
  return {
    id: item.id,
    name: nickname,
    timeText: formatRelativeTime(item.createdAt),
    content: item.content || "",
    initial: buildInitial(nickname),
    likeCount: Number(item.likeCount || 0),
    likedByMe: Boolean(item.likedByMe),
  };
}

Page({
  data: {
    paperId: "",
    paper: null,
    isLoading: true,
    errorMsg: "",

    comments: [],
    commentsLoading: false,
    commentsError: "",
    commentSortBy: "time",
    newComment: "",
    isFavorite: false,
    isCommentSubmitting: false,
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
    this.reloadPageData();
  },

  onPullDownRefresh() {
    this.reloadPageData({ stopPullDown: true });
  },

  handleAuthError(err) {
    if (err.statusCode === 401 || err.message === "missing_token") {
      wx.removeStorageSync("token");
      wx.removeStorageSync("user");
      wx.reLaunch({ url: "/pages/login/login" });
      return true;
    }
    return false;
  },

  async reloadPageData(options = {}) {
    const paperId = this.data.paperId;
    if (!paperId) return;

    await Promise.all([
      this.fetchPaperDetail(paperId),
      this.fetchComments(),
    ]);

    if (options.stopPullDown) {
      wx.stopPullDownRefresh();
    }
  },

  async fetchPaperDetail(paperId) {
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
      if (this.handleAuthError(err)) return;
      this.setData({
        errorMsg: "获取论文详情失败，请稍后重试",
      });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async fetchComments() {
    const paperId = this.data.paperId;
    if (!paperId) return;

    this.setData({
      commentsLoading: true,
      commentsError: "",
    });

    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}/comments?sortBy=${encodeURIComponent(
          this.data.commentSortBy
        )}&order=desc&page=1&pageSize=50`,
        method: "GET",
        auth: true,
      });
      const comments = Array.isArray(resp.items) ? resp.items.map(normalizeComment) : [];
      this.setData({ comments });
    } catch (err) {
      if (this.handleAuthError(err)) return;
      this.setData({
        commentsError: "加载评论失败，请稍后重试",
      });
    } finally {
      this.setData({
        commentsLoading: false,
      });
    }
  },

  onInputComment(e) {
    this.setData({
      newComment: e.detail.value,
    });
  },

  async onSendComment() {
    const paperId = this.data.paperId;
    const content = String(this.data.newComment || "").trim();
    if (!paperId || !content || this.data.isCommentSubmitting) return;

    this.setData({ isCommentSubmitting: true });
    try {
      await request({
        url: `/papers/${encodeURIComponent(paperId)}/comments`,
        method: "POST",
        data: { content },
        auth: true,
      });

      this.setData({ newComment: "" });
      await this.fetchComments();
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({
          title: "评论发送失败",
          icon: "none",
        });
      }
    } finally {
      this.setData({ isCommentSubmitting: false });
    }
  },

  async onToggleCommentLike(e) {
    const paperId = this.data.paperId;
    const commentId = e.currentTarget?.dataset?.id;
    if (!paperId || !commentId) return;

    try {
      const resp = await request({
        url: `/papers/${encodeURIComponent(paperId)}/comments/${encodeURIComponent(
          commentId
        )}/like`,
        method: "POST",
        auth: true,
      });
      const comments = (this.data.comments || []).map((item) => {
        if (item.id !== commentId) return item;
        return {
          ...item,
          likedByMe: Boolean(resp.liked),
          likeCount: Number(resp.likeCount || 0),
        };
      });
      this.setData({ comments });
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({
          title: "操作失败",
          icon: "none",
        });
      }
    }
  },

  onChangeCommentSort(e) {
    const sortBy = String(e.currentTarget?.dataset?.sort || "").trim();
    if (!sortBy || sortBy === this.data.commentSortBy) return;
    if (sortBy !== "time" && sortBy !== "likes") return;
    this.setData({ commentSortBy: sortBy });
    this.fetchComments();
  },

  onToggleFavorite() {
    this.setData({
      isFavorite: !this.data.isFavorite,
    });
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
