const { request } = require("../../utils/request");

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ["pdf", "txt", "md"];

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function extFromFileName(fileName = "") {
  const safe = String(fileName || "").trim().toLowerCase();
  if (!safe.includes(".")) return "";
  return safe.split(".").pop();
}

function basename(filePath = "") {
  const safe = String(filePath || "").trim();
  if (!safe) return "";
  const parts = safe.split("/");
  return parts[parts.length - 1] || "";
}

function normalizeReview(review) {
  const safe = review || {};
  return {
    decision: String(safe.decision || "REJECT").toUpperCase(),
    score: Number.isFinite(Number(safe.score)) ? Number(safe.score) : 0,
    summary: String(safe.summary || ""),
    strengths: Array.isArray(safe.strengths) ? safe.strengths : [],
    weaknesses: Array.isArray(safe.weaknesses) ? safe.weaknesses : [],
    suggestions: Array.isArray(safe.suggestions) ? safe.suggestions : [],
  };
}

function sanitizeFileName(fileName = "") {
  return String(fileName || "manuscript")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
}

function uploadFileToCloud({ filePath, fileName }) {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const cloudPath = `review-simulator/${Date.now()}-${randomSuffix}-${sanitizeFileName(
    fileName
  )}`;

  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => resolve(res?.fileID || ""),
      fail: (err) => reject(err),
    });
  });
}

function getTempFileUrl(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (res) => {
        const item = Array.isArray(res?.fileList) ? res.fileList[0] : null;
        if (!item?.tempFileURL) {
          reject(new Error("temp_url_missing"));
          return;
        }
        resolve(String(item.tempFileURL));
      },
      fail: (err) => reject(err),
    });
  });
}

function deleteCloudFile(fileID) {
  return new Promise((resolve) => {
    if (!fileID) {
      resolve();
      return;
    }
    wx.cloud.deleteFile({
      fileList: [fileID],
      complete: () => resolve(),
    });
  });
}

Page({
  data: {
    selectedFileName: "",
    selectedFileSizeText: "",
    selectedFilePath: "",
    selectedMimeType: "",
    selectedExtension: "",
    isReviewing: false,
    reviewTaskId: "",
    reviewStatus: "",
    reviewResult: null,
  },

  onUnload() {
    this.stopReviewPolling();
  },

  stopReviewPolling() {
    if (this.reviewPollTimer) {
      clearTimeout(this.reviewPollTimer);
      this.reviewPollTimer = null;
    }
  },

  scheduleNextPoll(taskId) {
    this.stopReviewPolling();
    this.reviewPollTimer = setTimeout(() => {
      this.pollReviewTask(taskId);
    }, 2500);
  },

  async pollReviewTask(taskId) {
    try {
      const resp = await request({
        url: `/lab/review-simulator/tasks/${taskId}`,
        method: "GET",
        auth: true,
        timeout: 20000,
      });
      const task = resp?.task || {};
      const status = String(task.status || "PENDING").toUpperCase();

      if (status === "DONE") {
        this.stopReviewPolling();
        await deleteCloudFile(this.currentUploadedFileId || "");
        this.currentUploadedFileId = "";
        this.setData({
          isReviewing: false,
          reviewTaskId: "",
          reviewStatus: "DONE",
          reviewResult: normalizeReview(task.review || {}),
        });
        return;
      }

      if (status === "FAILED") {
        this.stopReviewPolling();
        await deleteCloudFile(this.currentUploadedFileId || "");
        this.currentUploadedFileId = "";
        this.setData({
          isReviewing: false,
          reviewTaskId: "",
          reviewStatus: "FAILED",
        });
        wx.showToast({
          title: task.error || "审稿失败，请重试",
          icon: "none",
        });
        return;
      }

      this.setData({
        reviewTaskId: taskId,
        reviewStatus: status,
      });
      this.pollErrorCount = 0;
      this.scheduleNextPoll(taskId);
    } catch (err) {
      this.pollErrorCount = (this.pollErrorCount || 0) + 1;
      if (this.pollErrorCount >= 5) {
        this.stopReviewPolling();
        this.setData({
          isReviewing: false,
          reviewTaskId: "",
          reviewStatus: "FAILED",
        });
        wx.showToast({
          title: "审稿超时，请稍后重试",
          icon: "none",
        });
        return;
      }
      this.scheduleNextPoll(taskId);
    }
  },

  onChooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: SUPPORTED_EXTENSIONS,
      success: (res) => {
        const file = Array.isArray(res?.tempFiles) ? res.tempFiles[0] : null;
        if (!file?.path) {
          wx.showToast({ title: "未选择文件", icon: "none" });
          return;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          wx.showToast({
            title: "文件过大，请控制在50MB内",
            icon: "none",
          });
          return;
        }

        const fileName = String(file.name || basename(file.path) || "manuscript");
        const extension = extFromFileName(fileName);
        if (!SUPPORTED_EXTENSIONS.includes(extension)) {
          wx.showToast({
            title: "仅支持 PDF/TXT/MD",
            icon: "none",
          });
          return;
        }

        this.setData({
          selectedFileName: fileName,
          selectedFileSizeText: formatFileSize(file.size || 0),
          selectedFilePath: file.path,
          selectedMimeType: file.type || "",
          selectedExtension: extension,
          reviewResult: null,
        });
      },
      fail: () => {
        wx.showToast({
          title: "文件选择已取消",
          icon: "none",
        });
      },
    });
  },

  async onStartReview() {
    if (this.data.isReviewing) return;
    if (!this.data.selectedFilePath || !this.data.selectedFileName) {
      wx.showToast({ title: "请先上传论文稿件", icon: "none" });
      return;
    }

    this.setData({
      isReviewing: true,
      reviewTaskId: "",
      reviewStatus: "PENDING",
      reviewResult: null,
    });
    let uploadedFileId = "";
    try {
      uploadedFileId = await uploadFileToCloud({
        filePath: this.data.selectedFilePath,
        fileName: this.data.selectedFileName,
      });
      const tempFileUrl = await getTempFileUrl(uploadedFileId);

      const resp = await request({
        url: "/lab/review-simulator/tasks",
        method: "POST",
        auth: true,
        timeout: 20000,
        data: {
          fileName: this.data.selectedFileName,
          mimeType: this.data.selectedMimeType,
          extension: this.data.selectedExtension,
          fileUrl: tempFileUrl,
        },
      });
      const taskId = String(resp?.task?.taskId || "");
      if (!taskId) {
        throw new Error("task_id_missing");
      }

      this.currentUploadedFileId = uploadedFileId;
      this.pollErrorCount = 0;
      this.setData({
        reviewTaskId: taskId,
        reviewStatus: String(resp?.task?.status || "PENDING"),
      });
      this.pollReviewTask(taskId);
    } catch (err) {
      await deleteCloudFile(uploadedFileId);
      const msg = err?.response?.message || err?.errMsg || "审稿失败，请稍后重试";
      wx.showToast({ title: msg, icon: "none" });
      this.setData({
        isReviewing: false,
        reviewTaskId: "",
        reviewStatus: "",
      });
    }
  },
});
