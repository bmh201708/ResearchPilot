const { request } = require("../../utils/request");

function getDiffDays(deadline) {
  const ddlTime = new Date(deadline).getTime();
  const todayTime = new Date().getTime();
  return Math.ceil((ddlTime - todayTime) / (1000 * 60 * 60 * 24));
}

function normalizeConference(item) {
  const startDate = item && item.startDate ? String(item.startDate) : "";
  const deadline = item && item.deadline ? String(item.deadline) : "";
  return {
    id: item.id,
    abbr: String(item.abbr || "").trim(),
    year:
      String(item.year || "").trim() ||
      (startDate ? startDate.slice(0, 4) : deadline ? deadline.slice(0, 4) : ""),
    fullName: String(item.fullName || "").trim(),
    location: String(item.location || "").trim(),
    startDate,
    deadline,
    progress: Number(item.progress || 0),
    note: String(item.note || "").trim(),
    colorTheme: String(item.colorTheme || "green").trim().toLowerCase() || "green",
  };
}

Page({
  data: {
    featuredConf: null,
    gridConfs: [],
    allConfs: [],
    showModal: false,
    isEdit: false,
    currentEditId: null,
    isLoading: false,
    isSaving: false,
    formData: {
      abbr: "",
      fullName: "",
      location: "",
      startDate: "",
      deadline: "",
      progress: 0,
      note: "",
      colorTheme: "green",
    },
    themeOptions: [
      { name: "Green", value: "green" },
      { name: "Purple", value: "purple" },
      { name: "Yellow", value: "yellow" },
      { name: "Blue", value: "blue" },
      { name: "Orange", value: "orange" },
    ],
  },

  onLoad() {
    this.fetchConferences();
  },

  onPullDownRefresh() {
    this.fetchConferences({ stopPullDown: true });
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

  async fetchConferences(options = {}) {
    this.setData({ isLoading: true });
    try {
      const resp = await request({
        url: "/projects/conferences",
        method: "GET",
        auth: true,
      });
      const conferences = Array.isArray(resp.items)
        ? resp.items.map(normalizeConference)
        : [];
      this.processConferences(conferences);
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({
          title: "加载失败",
          icon: "none",
        });
      }
    } finally {
      this.setData({ isLoading: false });
      if (options.stopPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  processConferences(conferences) {
    const list = Array.isArray(conferences) ? conferences : [];
    const processedList = list
      .map((conf) => {
        const diffDays = getDiffDays(conf.deadline);
        let timeLeftStr = "";
        if (diffDays <= 0) {
          timeLeftStr = "Passed";
        } else if (diffDays <= 60) {
          timeLeftStr = `${diffDays} Days`;
        } else {
          timeLeftStr = `${Math.round(diffDays / 30)} Mos`;
        }
        return {
          ...conf,
          diffDays,
          timeLeftStr,
        };
      })
      .filter((conf) => conf.diffDays > 0)
      .sort((a, b) => a.diffDays - b.diffDays);

    this.setData({
      allConfs: list,
      featuredConf: processedList[0] || null,
      gridConfs: processedList.slice(1),
    });
  },

  onEditConference(e) {
    const conf = e.currentTarget.dataset.item;
    if (!conf || !conf.id) return;

    this.setData({
      showModal: true,
      isEdit: true,
      currentEditId: conf.id,
      formData: {
        abbr: conf.abbr || "",
        fullName: conf.fullName || "",
        location: conf.location || "",
        startDate: conf.startDate || "",
        deadline: conf.deadline || "",
        progress: String(conf.progress ?? 0),
        note: conf.note || "",
        colorTheme: conf.colorTheme || "green",
      },
    });
  },

  onAddConference() {
    this.setData({
      showModal: true,
      isEdit: false,
      currentEditId: null,
      formData: {
        abbr: "",
        fullName: "",
        location: "",
        startDate: "",
        deadline: "",
        progress: "0",
        note: "",
        colorTheme: "green",
      },
    });
  },

  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`formData.${field}`]: e.detail.value,
    });
  },

  onSelectColor(e) {
    const theme = e.currentTarget.dataset.theme;
    this.setData({
      "formData.colorTheme": theme,
    });
  },

  closeModal() {
    this.setData({ showModal: false });
  },

  buildPayload(formData) {
    const abbr = String(formData.abbr || "").trim();
    const fullName = String(formData.fullName || "").trim();
    const location = String(formData.location || "").trim();
    const startDate = String(formData.startDate || "").trim();
    const deadline = String(formData.deadline || "").trim();
    const note = String(formData.note || "").trim();
    const progress = Number(formData.progress);
    const colorTheme = String(formData.colorTheme || "green")
      .trim()
      .toLowerCase();

    if (!abbr) {
      wx.showToast({ title: "请输入简称", icon: "none" });
      return null;
    }
    if (!fullName) {
      wx.showToast({ title: "请输入会议全称", icon: "none" });
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      wx.showToast({ title: "截止日期格式应为 YYYY-MM-DD", icon: "none" });
      return null;
    }
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      wx.showToast({ title: "开始日期格式应为 YYYY-MM-DD", icon: "none" });
      return null;
    }
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      wx.showToast({ title: "进度需为 0-100", icon: "none" });
      return null;
    }

    return {
      abbr,
      fullName,
      location,
      startDate: startDate || null,
      deadline,
      progress: Math.round(progress),
      note,
      colorTheme,
    };
  },

  async onSaveConference() {
    if (this.data.isSaving) return;
    const payload = this.buildPayload(this.data.formData);
    if (!payload) return;

    this.setData({ isSaving: true });
    try {
      if (this.data.isEdit) {
        await request({
          url: `/projects/conferences/${encodeURIComponent(this.data.currentEditId)}`,
          method: "PATCH",
          data: payload,
          auth: true,
        });
      } else {
        await request({
          url: "/projects/conferences",
          method: "POST",
          data: payload,
          auth: true,
        });
      }

      this.setData({
        showModal: false,
      });
      await this.fetchConferences();
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({
          title: "保存失败",
          icon: "none",
        });
      }
    } finally {
      this.setData({ isSaving: false });
    }
  },

  async onDeleteConference() {
    if (!this.data.currentEditId || this.data.isSaving) return;

    this.setData({ isSaving: true });
    try {
      await request({
        url: `/projects/conferences/${encodeURIComponent(this.data.currentEditId)}`,
        method: "DELETE",
        auth: true,
      });
      this.setData({
        showModal: false,
      });
      await this.fetchConferences();
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({
          title: "删除失败",
          icon: "none",
        });
      }
    } finally {
      this.setData({ isSaving: false });
    }
  },
});
