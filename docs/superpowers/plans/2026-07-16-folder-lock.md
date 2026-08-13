# 文件夹安全锁插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个 SiYuan 插件，支持右键文件夹加安全锁（AES-GCM 加密），显示锁图标，密码解锁，恢复码找回。

**Architecture:** 纯前端 SiYuan 插件，使用 Web Crypto API 加密，通过 `open-menu-doctree` 事件集成右键菜单，通过 MutationObserver 渲染锁图标，加密元数据存储在 `this.data` 中。

**Tech Stack:** TypeScript, Web Crypto API, SiYuan Plugin API (petal), Webpack

---

## File Structure

```
plugins/siyuan-folder-lock/
├── plugin.json              # 插件元数据
├── package.json             # 依赖和构建脚本
├── tsconfig.json            # TypeScript 配置
├── webpack.config.js        # 构建配置
├── src/
│   ├── index.ts             # 插件入口，继承 Plugin
│   ├── crypto.ts            # 加密引擎（AES-GCM + PBKDF2）
│   ├── store.ts             # 加密元数据存储管理
│   ├── api.ts               # SiYuan kernel API 封装
│   ├── menu.ts              # 右键菜单集成
│   ├── indicator.ts         # 文档树锁图标渲染
│   ├── dialog.ts            # 密码输入/设置/找回对话框
│   └── recovery.ts          # 恢复码生成与邮件发送
├── i18n/
│   ├── en_US.json
│   └── zh_CN.json
└── icon.svg                 # 锁图标
```

---

### Task 1: 项目脚手架

**Files:**
- Create: `plugins/siyuan-folder-lock/plugin.json`
- Create: `plugins/siyuan-folder-lock/package.json`
- Create: `plugins/siyuan-folder-lock/tsconfig.json`
- Create: `plugins/siyuan-folder-lock/webpack.config.js`

- [ ] **Step 1: 创建 plugin.json**

```json
{
  "name": "siyuan-folder-lock",
  "author": "siyuan",
  "url": "https://github.com/siyuan-note/siyuan",
  "version": "0.1.0",
  "displayName": {
    "default": "Folder Lock",
    "zh_CN": "文件夹安全锁"
  },
  "description": {
    "default": "Encrypt folders with password protection",
    "zh_CN": "给文件夹加安全锁，密码保护文档内容"
  },
  "icon": "iconLock",
  "backends": ["all"],
  "frontends": ["desktop"],
  "i18n": ["en_US", "zh_CN"]
}
```

- [ ] **Step 2: 创建 package.json**

```json
{
  "name": "siyuan-folder-lock",
  "version": "0.1.0",
  "scripts": {
    "build": "webpack --mode production",
    "dev": "webpack --mode development --watch"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "ts-loader": "^9.0.0",
    "webpack": "^5.0.0",
    "webpack-cli": "^5.0.0",
    "css-loader": "^6.0.0",
    "style-loader": "^3.0.0",
    "mini-css-extract-plugin": "^2.0.0"
  }
}
```

- [ ] **Step 3: 创建 tsconfig.json 和 webpack.config.js**

- [ ] **Step 4: 安装依赖**

Run: `cd plugins/siyuan-folder-lock && npm install`

- [ ] **Step 5: Commit**

---

### Task 2: 加密引擎（crypto.ts）

**Files:**
- Create: `plugins/siyuan-folder-lock/src/crypto.ts`

- [ ] **Step 1: 实现 CryptoEngine 类**

包含以下函数：
- `deriveKey(password, salt)` — PBKDF2 派生密钥
- `generateMasterKey()` — 生成随机主密钥
- `encryptText(text, key)` — AES-GCM 加密文本，返回 {ciphertext, iv}
- `decryptText(ciphertext, iv, key)` — AES-GCM 解密文本
- `generateRecoveryCode()` — 生成 32 字符恢复码
- `wrapKey(key, wrappingKey)` — 用 wrappingKey 加密 key
- `unwrapKey(wrappedKey, iv, unwrappingKey)` — 解密 key
- `generateSalt()` — 生成 16 字节 salt
- `base64Encode(buf)` / `base64Decode(str)` — Base64 编解码

- [ ] **Step 2: Commit**

---

### Task 3: SiYuan API 封装（api.ts）

**Files:**
- Create: `plugins/siyuan-folder-lock/src/api.ts`

- [ ] **Step 1: 实现 API 封装**

包含以下函数：
- `getDocIDs(notebookId, path)` — 调用 `/api/filetree/listDocsByPath` 递归获取子文档
- `getDocContent(docId)` — 调用 `/api/filetree/getDoc` 获取文档内容
- `updateDoc(docId, content)` — 调用 `/api/filetree/...` 更新文档内容
- `getBlockKramdown(docId)` — 调用 `/api/block/getBlockKramdown` 获取 kramdown
- `updateBlockKramdown(docId, kramdown)` — 调用 `/api/block/updateBlock` 更新

使用 `fetchSyncPost` 进行同步调用。

- [ ] **Step 2: Commit**

---

### Task 4: 存储管理（store.ts）

**Files:**
- Create: `plugins/siyuan-folder-lock/src/store.ts`

- [ ] **Step 1: 实现 LockStore 类**

管理 `this.data` 中的加密元数据：
- `addLock(folderId, lockData)` — 添加加锁记录
- `removeLock(folderId)` — 移除加锁记录
- `getLock(folderId)` — 获取加锁记录
- `isLocked(folderId)` — 检查是否已加锁
- `getLockedFolders()` — 获取所有加锁文件夹
- `isUnlocked(folderId)` — 检查当前会话是否已解锁
- `setUnlocked(folderId)` — 标记当前会话已解锁
- `clearUnlocked()` — 清除会话解锁状态

- [ ] **Step 2: Commit**

---

### Task 5: 恢复码系统（recovery.ts）

**Files:**
- Create: `plugins/siyuan-folder-lock/src/recovery.ts`

- [ ] **Step 1: 实现 RecoverySystem**

- `generateRecoveryCode()` — 调用 crypto.ts 生成恢复码
- `sendRecoveryCode(email, code, folderName)` — 通过 fetch 调用邮件 API（可选）
- `showRecoveryCodeDialog(code)` — 在对话框中显示恢复码

- [ ] **Step 2: Commit**

---

### Task 6: 密码对话框（dialog.ts）

**Files:**
- Create: `plugins/siyuan-folder-lock/src/dialog.ts`

- [ ] **Step 1: 实现对话框组件**

- `showSetPasswordDialog()` — 设置密码对话框（密码+确认密码+邮箱），返回 Promise<{password, email}>
- `showUnlockDialog()` — 解锁对话框（密码输入+忘记密码链接），返回 Promise<string>
- `showRecoveryDialog()` — 找回密码对话框（恢复码+新密码），返回 Promise<{code, newPassword}>
- `showRecoveryCodeDisplay(code)` — 恢复码展示对话框（显示码+复制按钮）

使用 SiYuan 的 `Dialog` API（`new Dialog({title, content, width})`）。

- [ ] **Step 2: Commit**

---

### Task 7: 右键菜单集成（menu.ts）

**Files:**
- Create: `plugins/siyuan-folder-lock/src/menu.ts`

- [ ] **Step 1: 实现 MenuIntegration**

- 监听 `open-menu-doctree` 事件
- 检查 `detail.type === "docs"` 且选中的是文件夹（非笔记本）
- 从 `detail.elements` 获取选中的文档树节点
- 检查是否已加锁，添加对应菜单项：
  - 未加锁 → "加安全锁"（调用加锁流程）
  - 已加锁 → "移除安全锁"（调用解锁流程）
  - 已加锁 → "修改密码"

- [ ] **Step 2: Commit**

---

### Task 8: 文档树锁图标（indicator.ts）

**Files:**
- Create: `plugins/siyuan-folder-lock/src/indicator.ts`

- [ ] **Step 1: 实现 LockIndicator**

- 使用 MutationObserver 监听文档树 DOM 变化
- 检查文档树节点的 data-node-id 是否在加锁列表中
- 为加锁文件夹添加锁图标（SVG，通过 `addIcons` 注册）
- 已解锁的显示不同图标状态

- [ ] **Step 2: Commit**

---

### Task 9: 插件入口（index.ts）

**Files:**
- Create: `plugins/siyuan-folder-lock/src/index.ts`

- [ ] **Step 1: 实现 FolderLockPlugin 类**

继承 `Plugin`，在 `onload()` 中：
1. 注册自定义图标
2. 初始化 LockStore
3. 初始化 MenuIntegration
4. 初始化 LockIndicator
5. 注册设置面板（SMTP 配置）

在 `onunload()` 中清理资源。

- [ ] **Step 2: 实现加锁/解锁核心流程**

- `lockFolder(folderId)` — 完整加锁流程
- `unlockFolder(folderId)` — 完整解锁流程
- `recoverPassword(folderId)` — 找回密码流程

- [ ] **Step 3: Commit**

---

### Task 10: i18n 和构建

**Files:**
- Create: `plugins/siyuan-folder-lock/i18n/en_US.json`
- Create: `plugins/siyuan-folder-lock/i18n/zh_CN.json`
- Create: `plugins/siyuan-folder-lock/src/index.css`

- [ ] **Step 1: 创建 i18n 文件**

包含所有 UI 文本的翻译：
- lockFolder, unlockFolder, setPassword, confirmPassword, email
- recoveryCode, recoveryCodeDisplay, forgotPassword
- lockSuccess, unlockSuccess, passwordError, recoveryCodeError
- encryptedPlaceholder, modifyPassword

- [ ] **Step 2: 创建 CSS 样式**

锁图标样式、对话框样式。

- [ ] **Step 3: 构建插件**

Run: `cd plugins/siyuan-folder-lock && npm run build`

- [ ] **Step 4: 复制到 SiYuan 插件目录测试**

- [ ] **Step 5: Commit**
