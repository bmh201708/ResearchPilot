const { request } = require("../../utils/request");

const DEFAULT_AVATAR = "/images/profile/user.png";

function isWechatProfileIncomplete(user) {
  const authProvider = (user?.authProvider || "").toUpperCase();
  if (authProvider !== "WECHAT") return false;
  const nickname = (user?.nickname ? String(user.nickname).trim() : "") || "";
  const avatarUrl = (user?.avatarUrl ? String(user.avatarUrl).trim() : "") || "";
  return !nickname || nickname === "微信用户" || !avatarUrl;
}

Page({
  data: {
    nickname: "",
    displayAvatarUrl: DEFAULT_AVATAR,
    originalAvatarUrl: "",
    pendingAvatarDataUrl: "",
    isSaving: false,
  },

  onLoad() {
    this.bootstrap();
  },

  async bootstrap() {
    const token = wx.getStorageSync("token");
    if (!token) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }

    try {
      const user = await request({
        url: "/users/me",
        method: "GET",
        auth: true,
      });
      wx.setStorageSync("user", user || {});

      if (!isWechatProfileIncomplete(user)) {
        wx.switchTab({ url: "/pages/lab/index" });
        return;
      }

      const safeNickname =
        user?.nickname && user.nickname !== "微信用户" ? String(user.nickname) : "";
      const safeAvatar = (user?.avatarUrl ? String(user.avatarUrl) : "") || "";

      this.setData({
        nickname: safeNickname,
        originalAvatarUrl: safeAvatar,
        displayAvatarUrl: safeAvatar || DEFAULT_AVATAR,
        pendingAvatarDataUrl: "",
      });
    } catch (err) {
      if (err.statusCode === 401 || err.message === "missing_token") {
        wx.removeStorageSync("token");
        wx.removeStorageSync("user");
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({
        title: "读取资料失败",
        icon: "none",
      });
    }
  },

  onEditNicknameInput(e) {
    this.setData({
      nickname: e.detail.value || "",
    });
  },

  onChooseAvatar(e) {
    const tempPath = e?.detail?.avatarUrl;
    if (!tempPath) return;

    wx.compressImage({
      src: tempPath,
      quality: 40,
      success: (compressRes) => {
        const filePath = compressRes.tempFilePath || tempPath;
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: "base64",
          success: (fileRes) => {
            const base64 = fileRes.data || "";
            if (!base64) {
              wx.showToast({ title: "头像读取失败", icon: "none" });
              return;
            }
            this.setData({
              displayAvatarUrl: tempPath,
              pendingAvatarDataUrl: `data:image/jpeg;base64,${base64}`,
            });
          },
          fail: () => {
            wx.showToast({ title: "头像读取失败", icon: "none" });
          },
        });
      },
      fail: () => {
        wx.showToast({ title: "头像处理失败", icon: "none" });
      },
    });
  },

  async onSaveProfile() {
    if (this.data.isSaving) return;

    const nickname = (this.data.nickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "请输入昵称", icon: "none" });
      return;
    }

    const originalAvatar = (this.data.originalAvatarUrl || "").trim();
    const pendingAvatar = (this.data.pendingAvatarDataUrl || "").trim();
    if (!originalAvatar && !pendingAvatar) {
      wx.showToast({ title: "请上传头像", icon: "none" });
      return;
    }

    this.setData({ isSaving: true });
    try {
      const resp = await request({
        url: "/users/me/profile",
        method: "PUT",
        auth: true,
        data: {
          nickname,
          avatarUrl: pendingAvatar || originalAvatar,
        },
      });
      const user = resp?.user || {};
      wx.setStorageSync("user", user);
      wx.showToast({
        title: "资料已完成",
        icon: "success",
      });
      setTimeout(() => {
        wx.switchTab({
          url: "/pages/lab/index",
        });
      }, 250);
    } catch (err) {
      const msg = err?.response?.message || "更新失败";
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      this.setData({ isSaving: false });
    }
  },
});
