# 文件夹安全锁插件设计文档

## 概述

为 SiYuan 笔记开发一个插件，支持通过右键菜单给文件夹加"安全锁"。加锁后文件夹内容被 AES-GCM 256 加密，文档树中显示锁图标，点击需输入密码才能解锁。支持通过恢复码找回密码，恢复码可发送到用户设置的邮箱。

## 需求总结

- **触发方式**：文档树右键文件夹 → "加安全锁"
- **加密范围**：递归加密整个文件夹下所有文档
- **显示方式**：文档树中加锁文件夹显示锁图标，不隐藏
- **解锁方式**：点击加锁文件夹 → 弹出密码输入框 → 验证通过后解密
- **密码找回**：加锁时生成恢复码；用户可配置邮箱，恢复码通过邮件发送；忘记密码时用恢复码重置
- **技术形态**：SiYuan 插件，纯前端加密

## 架构设计

### 插件结构

```
siyuan-folder-lock/
├── plugin.json              # 插件元数据
├── index.ts                 # 插件入口，继承 Plugin
├── src/
│   ├── crypto.ts            # 加密引擎（AES-GCM + PBKDF2）
│   ├── store.ts             # 加密元数据存储管理
│   ├── menu.ts              # 右键菜单集成
│   ├── indicator.ts         # 文档树锁图标渲染
│   ├── dialog.ts            # 密码输入/设置/找回对话框
│   ├── recovery.ts          # 恢复码生成与邮件发送
│   └── api.ts               # SiYuan kernel API 封装
├── i18n/
│   ├── en_US.json
│   └── zh_CN.json
└── icon.svg                 # 锁图标
```

### 核心模块

#### 1. CryptoEngine（`src/crypto.ts`）

基于浏览器原生 `Web Crypto API`，负责所有加密/解密操作。

- **密钥派生**：`PBKDF2`（SHA-256，100000 次迭代，16 字节随机 salt）
- **对称加密**：`AES-GCM` 256 位，12 字节随机 IV
- **主密钥**：加锁时生成 256 位随机主密钥，分别用用户密码和恢复码加密后存储
- **关键函数**：
  - `deriveKey(password, salt)` → CryptoKey
  - `generateMasterKey()` → CryptoKey
  - `encrypt(data, key)` → { ciphertext, iv }
  - `decrypt(ciphertext, iv, key)` → data
  - `generateRecoveryCode()` → string（32 字符 base32）
  - `wrapKey(key, wrappingKey)` → wrappedKey
  - `unwrapKey(wrappedKey, unwrappingKey)` → CryptoKey

#### 2. LockStore（`src/store.ts`）

管理加密元数据，存储在 `this.data`（插件持久化存储，由 SiYuan 自动持久化）。

数据结构：
```
this.data = {
  locks: {
    "<folderId>": {
      salt: "base64",                    // PBKDF2 salt
      masterKeyWrapped: "base64",        // 用用户密码加密的主密钥
      masterKeyIv: "base64",             // 加密主密钥用的 IV
      recoveryKeyWrapped: "base64",      // 用恢复码加密的主密钥
      recoveryKeyIv: "base64",           // 加密恢复主密钥用的 IV
      recoverySalt: "base64",            // 恢复码 PBKDF2 salt
      email: "user@example.com",         // 用户邮箱（可选）
      lockedAt: 1234567890,              // 加锁时间戳
      docIds: ["doc1", "doc2", ...],     // 被加密的文档 ID 列表
      notebookId: "notebookId",          // 所属笔记本
    }
  },
  settings: {
    smtpHost: "",                        // SMTP 配置（可选）
    smtpPort: 587,
    smtpUser: "",
    smtpPass: "",
    defaultEmail: ""
  },
  unlockedSessions: {}                   // 当前会话已解锁的文件夹（临时，不持久化）
}
```

#### 3. MenuIntegration（`src/menu.ts`）

监听 `open-menu-doctree` 事件，在文档树右键菜单中添加：

- **加安全锁**：对未加锁文件夹显示
- **移除安全锁**：对已加锁文件夹显示（需先输入密码）
- **修改密码**：对已加锁文件夹显示（需先输入旧密码）

通过 `this.eventBus.on("open-menu-doctree", handler)` 注册。在 handler 中，通过 `detail.menu`（subMenu 对象）的 `addItem` 方法添加菜单项。`detail.type` 区分 "docs"（文档/文件夹）和 "notebook"（笔记本），仅对 "docs" 类型显示菜单项。

#### 4. LockIndicator（`src/indicator.ts`）

在文档树中为加锁文件夹渲染锁图标。

- 使用 `MutationObserver` 监听文档树 DOM 变化
- 当检测到文档树节点更新时，检查该节点对应的 folderId 是否在 `this.data.locks` 中
- 若已加锁，在节点图标旁追加锁图标（小 SVG，使用 `addIcons` 注册）
- 若已解锁（当前会话），显示解锁状态的图标

#### 5. PasswordDialog（`src/dialog.ts`）

使用 SiYuan 的 `Dialog` API 构建对话框：

- **设置密码对话框**：密码输入 + 确认密码 + 邮箱（可选）+ 显示恢复码
- **解锁对话框**：密码输入 + "忘记密码？"链接
- **找回密码对话框**：恢复码输入 + 新密码 + 确认新密码
- **修改密码对话框**：旧密码 + 新密码 + 确认新密码

#### 6. RecoverySystem（`src/recovery.ts`）

- **生成恢复码**：32 字符 base32 编码（如 `ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567`）
- **发送邮件**：
  - 若用户配置了 SMTP，通过第三方 SMTP HTTP API（如 EmailJS 或 Resend）发送
  - 若未配置，在对话框中直接显示恢复码，提示用户手动保存
  - 邮件内容包含：恢复码、加锁文件夹名称、加锁时间

#### 7. SiYuanAPI（`src/api.ts`）

封装 SiYuan kernel API 调用：

- `getDocContent(docId)` → 调用 `/api/filetree/getDoc` 获取文档内容
- `getDocIDs(folderId)` → 调用 `/api/filetree/listDocsByPath` 递归获取子文档列表
- `updateDoc(docId, content)` → 调用 `/api/filetree/...` 更新文档内容
- `getBlockInfo(blockId)` → 调用 `/api/block/getBlockInfo` 获取块信息

## 加密流程

### 加锁流程

1. 用户右键文件夹 → 点击"加安全锁"
2. 弹出设置密码对话框：输入密码 + 确认密码 + 邮箱（可选）
3. 生成 16 字节随机 salt，用 PBKDF2 从密码派生密钥包装密钥（wrappingKey）
4. 生成 256 位随机主密钥（masterKey）
5. 用 wrappingKey 加密 masterKey → masterKeyWrapped + masterKeyIv
6. 生成恢复码，用 PBKDF2 从恢复码派生 recoveryWrappingKey
7. 用 recoveryWrappingKey 加密 masterKey → recoveryKeyWrapped + recoveryKeyIv
8. 调用 `/api/filetree/listDocsByPath` 递归获取文件夹下所有文档 ID
9. 对每个文档：
   - 调用 `/api/filetree/getDoc` 读取原始内容
   - 用 masterKey 进行 AES-GCM 加密，得到密文（base64 编码）
   - 将密文存储到插件数据 `this.data.locks[folderId].encryptedDocs[docId]`
   - 将原 .sy 文件内容替换为占位文档（显示「此文档已被安全锁加密」），保持 .sy 文件格式有效
   - 记录文档 ID
10. 存储加密元数据到 `this.data.locks[folderId]`
11. 若配置了 SMTP，发送恢复码到邮箱；否则在对话框中显示恢复码
12. 刷新文档树，显示锁图标

### 解锁流程

1. 用户点击加锁文件夹 → 弹出密码输入框
2. 用户输入密码
3. 从 `this.data.locks[folderId]` 读取 salt，用 PBKDF2 派生 wrappingKey
4. 用 wrappingKey 解密 masterKeyWrapped → masterKey
5. 对每个文档：
   - 从 `this.data.locks[folderId].encryptedDocs[docId]` 读取密文
   - 用 masterKey 解密，恢复原始内容
   - 将解密后的原始内容写回 .sy 文件
6. 从 `this.data.locks` 中移除该文件夹记录
7. 刷新文档树，移除锁图标
8. 显示成功提示

### 找回密码流程

1. 用户点击"忘记密码？"
2. 弹出找回密码对话框：输入恢复码 + 新密码 + 确认新密码
3. 从 `this.data.locks[folderId]` 读取 recoverySalt，用 PBKDF2 从恢复码派生 recoveryWrappingKey
4. 用 recoveryWrappingKey 解密 recoveryKeyWrapped → masterKey
5. 用新密码生成新的 salt 和 wrappingKey
6. 用新 wrappingKey 重新加密 masterKey → 更新 masterKeyWrapped
7. 生成新的恢复码，更新 recoveryKeyWrapped
8. 显示新的恢复码（或发送到邮箱）

## 文档打开拦截

通过监听 `switch-protyle` 事件，当用户尝试打开加锁文件夹下的文档时：

1. 检查文档 ID 是否在任何加锁文件夹的 `docIds` 列表中
2. 若是且当前会话未解锁，阻止文档加载，弹出密码输入框
3. 密码验证通过后，临时标记该文件夹为"本会话已解锁"（仅内存，不持久化），允许打开文档
4. 文档内容仍以加密形式存储在插件数据中，解锁时才恢复到 .sy 文件

注意：加密后，原始文档内容被加密存储在插件数据中，.sy 文件被替换为占位文档。SiYuan 编辑器中会显示「此文档已被安全锁加密」的提示。完全解锁（移除安全锁）后才会将明文写回 .sy 文件。

## 错误处理

- **密码错误**：解密 masterKeyWrapped 失败时，提示"密码错误"，不泄露具体错误信息
- **恢复码错误**：解密 recoveryKeyWrapped 失败时，提示"恢复码错误"
- **文档读取失败**：跳过该文档，记录错误日志，继续处理其他文档
- **文档写入失败**：回滚已加密的文档，恢复原始内容，提示错误
- **网络异常**：提示网络错误，建议检查 kernel 连接
- **加密中断**（如关闭窗口）：加锁前先备份原始内容到临时存储，中断时可恢复

## 存储安全

- 密码不存储在任何地方，仅用于派生密钥
- 恢复码不存储明文，仅存储用恢复码加密的密钥副本
- salt 和 IV 可以明文存储（设计上无需保密）
- 插件 `this.data` 由 SiYuan 持久化到 `storage/petal/<pluginName>/data.json`
- 加密后的文档内容也存储在 `this.data` 中，文件体积会增大
- 对于大文件夹（数百篇文档），建议分批加密并考虑存储优化

## 邮件发送方案

由于纯前端 JavaScript 无法直接发送 SMTP 邮件，采用以下策略：

1. **默认（无需配置）**：加锁成功后，在对话框中显示恢复码，用户手动复制保存
2. **可选（配置邮件服务）**：用户在插件设置中配置第三方邮件 API（如 Resend、SendGrid）的 API Key 和收件邮箱，插件通过 `fetch` 调用该 API 发送恢复码邮件
3. 设置项：
   - 邮件服务类型（Resend / SendGrid / 自定义 Webhook）
   - API Key
   - 发件邮箱
   - 收件邮箱

## 文件结构

插件作为独立项目开发，最终产物可安装到 SiYuan 的 `data/plugins/` 目录。

开发时可在 SiYuan 仓库内开发，通过符号链接或复制到插件目录测试。

## 技术约束

- 加密使用浏览器原生 `Web Crypto API`（`crypto.subtle`），无需第三方库
- 所有 SiYuan API 调用使用 `fetchPost`/`fetchSyncPost`
- 对话框使用 SiYuan 插件 API 的 `Dialog` 类
- 菜单使用 `this.eventBus.on("open-menu-doctree", ...)` 集成
- 图标使用 `this.addIcons()` 注册自定义 SVG
- 不修改 SiYuan 核心代码，纯插件实现
