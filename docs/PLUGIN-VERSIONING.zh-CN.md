# 三个插件的版本管理

统一管理 Calendar Plus、Todo Plus 和 Security Lock 的商店版、源码版、构建产物与本地安装版。

## 版本规则

- 商店版只使用稳定 SemVer，例如 `1.0.1`。
- 本地版使用下一稳定版的预发布号，例如商店为 `1.0.1` 时，本地为 `1.0.2-local.20260721153000`。
- 如果源码已经升到待发布的 `1.0.2`，本地版使用 `1.0.2-local.20260721153000`。
- 当前商店版不会覆盖较新的本地开发版；同版本的正式版发布后会高于预发布版，SiYuan 可以正常提示更新。
- `package.json` 与源码 `plugin.json` 必须始终保持同一个稳定版本。本地版本只写入工作空间安装目录，不污染商店构建包。

## 常用命令

在 `siyuan-note` 目录运行：

```bash
# 同时核对源码、构建产物、本地安装和线上商店
node scripts/manage-plugin-versions.mjs check all --workspace /path/to/workspace --online

# 构建三个稳定商店包，不发布
node scripts/manage-plugin-versions.mjs build all --channel store

# 构建并原子替换工作空间里的三个本地版
node scripts/manage-plugin-versions.mjs build all --channel local --workspace /path/to/workspace

# 把某个插件的源码目标版本升到下一稳定版
node scripts/manage-plugin-versions.mjs set siyuan-calendar-plus 1.0.2

# 商店审核完成后，从线上索引同步已发布版本
node scripts/manage-plugin-versions.mjs sync-store siyuan-calendar-plus
```

商店构建只生成 `package.zip`，不会自动提交、打标签、发布 Release 或修改商店仓库。`sync-store` 只接受线上商店已经出现的稳定版本，避免提前把待发布版本登记成商店版。
