#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..");
const configPath = join(scriptDir, "plugin-versions.json");
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJSON = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const config = readJSON(configPath);

const usage = () => {
    console.log(`用法：
  node scripts/manage-plugin-versions.mjs status [插件名|all] [--workspace 路径] [--online]
  node scripts/manage-plugin-versions.mjs check [插件名|all] [--workspace 路径] [--online]
  node scripts/manage-plugin-versions.mjs build <插件名|all> --channel <store|local> [--workspace 路径] [--build-id 标识]
  node scripts/manage-plugin-versions.mjs set <插件名> <稳定版本号>
  node scripts/manage-plugin-versions.mjs sync-store [插件名|all]

本地版规则：
  已上架 1.0.1、源码仍为 1.0.1 时，本地版为 1.0.2-local.<构建标识>。
  源码已升到待上架的 1.0.2 时，本地版为 1.0.2-local.<构建标识>。`);
};

const fail = (message) => {
    throw new Error(message);
};

const getOption = (args, name) => {
    const index = args.indexOf(name);
    if (index === -1) {
        return undefined;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        fail(`${name} 缺少参数`);
    }
    return value;
};

const hasOption = (args, name) => args.includes(name);

const normalizePlugin = (entry) => ({
    ...entry,
    root: resolve(repositoryRoot, entry.root),
});

const selectPlugins = (target = "all") => {
    const plugins = config.plugins.map(normalizePlugin);
    if (target === "all") {
        return plugins;
    }
    const plugin = plugins.find((item) => item.name === target);
    if (!plugin) {
        fail(`未知插件：${target}`);
    }
    return [plugin];
};

const parseVersion = (version) => {
    const match = versionPattern.exec(version || "");
    if (!match) {
        fail(`无效的 SemVer 版本号：${version}`);
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] || "",
    };
};

const compareVersions = (left, right) => {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (const key of ["major", "minor", "patch"]) {
        if (a[key] !== b[key]) {
            return a[key] < b[key] ? -1 : 1;
        }
    }
    if (a.prerelease === b.prerelease) {
        return 0;
    }
    if (!a.prerelease) {
        return 1;
    }
    if (!b.prerelease) {
        return -1;
    }
    return a.prerelease.localeCompare(b.prerelease, "en", {numeric: true});
};

const getBuildId = (requested) => {
    const value = requested || new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    if (!/^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/.test(value)) {
        fail(`无效的本地构建标识：${value}`);
    }
    return value;
};

const getLocalVersion = (sourceVersion, storeVersion, buildId) => {
    if (compareVersions(sourceVersion, storeVersion) < 0) {
        fail(`源码版本 ${sourceVersion} 低于商店版本 ${storeVersion}`);
    }
    if (compareVersions(sourceVersion, storeVersion) > 0) {
        return `${sourceVersion}-local.${buildId}`;
    }
    const parsed = parseVersion(storeVersion);
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-local.${buildId}`;
};

const getPaths = (plugin, workspace) => ({
    packageManifest: join(plugin.root, "package.json"),
    pluginManifest: join(plugin.root, "plugin.json"),
    distManifest: join(plugin.root, "dist", "plugin.json"),
    packageZip: join(plugin.root, "package.zip"),
    installedRoot: workspace ? join(resolve(workspace), "data", "plugins", plugin.name) : undefined,
    installedManifest: workspace ? join(resolve(workspace), "data", "plugins", plugin.name, "plugin.json") : undefined,
});

const inspectPlugin = (plugin, workspace) => {
    const paths = getPaths(plugin, workspace);
    if (!existsSync(paths.packageManifest) || !existsSync(paths.pluginManifest)) {
        fail(`${plugin.name} 缺少 package.json 或 plugin.json：${plugin.root}`);
    }
    const packageManifest = readJSON(paths.packageManifest);
    const pluginManifest = readJSON(paths.pluginManifest);
    const packageLockPath = join(plugin.root, "package-lock.json");
    const packageLock = existsSync(packageLockPath) ? readJSON(packageLockPath) : undefined;
    const distManifest = existsSync(paths.distManifest) ? readJSON(paths.distManifest) : undefined;
    const installedManifest = paths.installedManifest && existsSync(paths.installedManifest) ? readJSON(paths.installedManifest) : undefined;
    return {paths, packageManifest, pluginManifest, packageLock, distManifest, installedManifest};
};

const validatePlugin = (plugin, workspace, options = {}) => {
    const {checkDist = true, checkInstalled = true} = options;
    const state = inspectPlugin(plugin, workspace);
    const errors = [];
    if (state.packageManifest.name !== plugin.name || state.pluginManifest.name !== plugin.name) {
        errors.push("源码清单中的插件名不一致");
    }
    if (state.packageManifest.version !== state.pluginManifest.version) {
        errors.push(`package.json 为 ${state.packageManifest.version}，plugin.json 为 ${state.pluginManifest.version}`);
    }
    if (!stableVersionPattern.test(state.pluginManifest.version || "")) {
        errors.push(`源码版本必须是稳定 SemVer：${state.pluginManifest.version}`);
    }
    if (!stableVersionPattern.test(plugin.storeVersion || "")) {
        errors.push(`登记的商店版本不是稳定 SemVer：${plugin.storeVersion}`);
    }
    if (state.packageLock && (state.packageLock.version !== state.pluginManifest.version ||
        state.packageLock.packages?.[""]?.version !== state.pluginManifest.version)) {
        errors.push(`package-lock.json 与源码版本 ${state.pluginManifest.version} 不一致`);
    }
    if (versionPattern.test(state.pluginManifest.version || "") && versionPattern.test(plugin.storeVersion || "") &&
        compareVersions(state.pluginManifest.version, plugin.storeVersion) < 0) {
        errors.push(`源码版本 ${state.pluginManifest.version} 低于商店版本 ${plugin.storeVersion}`);
    }
    if (checkDist && state.distManifest && state.distManifest.version !== state.pluginManifest.version) {
        errors.push(`构建产物为 ${state.distManifest.version}，源码为 ${state.pluginManifest.version}`);
    }
    if (checkDist && state.distManifest && state.distManifest.name !== plugin.name) {
        errors.push(`构建产物插件名错误：${state.distManifest.name}`);
    }
    if (checkInstalled && state.installedManifest && !versionPattern.test(state.installedManifest.version || "")) {
        errors.push(`本地安装版本不是有效 SemVer：${state.installedManifest.version}`);
    }
    return {state, errors};
};

const fetchOnlineVersions = async () => {
    const response = await fetch(config.storeIndex, {headers: {"User-Agent": "siyuan-plugin-version-manager"}});
    if (!response.ok) {
        fail(`读取商店索引失败：HTTP ${response.status}`);
    }
    const data = await response.json();
    return new Map(data.repos.map((item) => [item.package.name, item.package.version]));
};

const printStatus = (plugin, state, onlineVersions) => {
    const source = state.pluginManifest.version;
    const localNext = getLocalVersion(source, plugin.storeVersion, "<构建标识>");
    console.log(`${plugin.name}\n  商店登记：${plugin.storeVersion}\n  商店线上：${onlineVersions?.get(plugin.name) || "未查询"}\n  源码目标：${source}\n  构建产物：${state.distManifest?.version || "无"}\n  本地安装：${state.installedManifest?.version || "未指定工作空间或未安装"}\n  下次本地：${localNext}`);
};

const runStatus = async (args, strict) => {
    const target = args[1] && !args[1].startsWith("--") ? args[1] : "all";
    const workspace = getOption(args, "--workspace");
    const onlineVersions = hasOption(args, "--online") ? await fetchOnlineVersions() : undefined;
    let failed = false;
    for (const plugin of selectPlugins(target)) {
        const {state, errors} = validatePlugin(plugin, workspace);
        if (onlineVersions) {
            const onlineVersion = onlineVersions.get(plugin.name);
            if (!onlineVersion) {
                errors.push("线上商店尚未收录");
            } else if (onlineVersion !== plugin.storeVersion) {
                errors.push(`商店登记为 ${plugin.storeVersion}，线上为 ${onlineVersion}`);
            }
        }
        printStatus(plugin, state, onlineVersions);
        if (errors.length) {
            failed = true;
            errors.forEach((error) => console.error(`  错误：${error}`));
        } else if (strict) {
            console.log("  检查：通过");
        }
    }
    if (strict && failed) {
        process.exitCode = 1;
    }
};

const runBuild = (plugin) => {
    const result = spawnSync(plugin.packageManager, ["run", "build"], {
        cwd: plugin.root,
        stdio: "inherit",
    });
    if (result.error) {
        fail(`${plugin.name} 构建失败：${result.error.message}`);
    }
    if (result.status !== 0) {
        fail(`${plugin.name} 构建失败，退出码 ${result.status}`);
    }
};

const installLocalBuild = (plugin, workspace, localVersion) => {
    const {paths} = inspectPlugin(plugin, workspace);
    if (!existsSync(dirname(paths.distManifest))) {
        fail(`${plugin.name} 缺少 dist 构建目录`);
    }
    const pluginsRoot = dirname(paths.installedRoot);
    const operationId = `${Date.now()}-${localVersion.replace(/[^0-9A-Za-z.-]/g, "-")}`;
    const stagingRoot = join(pluginsRoot, `.${plugin.name}.installing-${operationId}`);
    const backupRoot = join(pluginsRoot, `.${plugin.name}.backup-${operationId}`);
    mkdirSync(pluginsRoot, {recursive: true});
    cpSync(join(plugin.root, "dist"), stagingRoot, {recursive: true});
    const localManifestPath = join(stagingRoot, "plugin.json");
    const localManifest = readJSON(localManifestPath);
    localManifest.version = localVersion;
    writeJSON(localManifestPath, localManifest);
    try {
        if (existsSync(paths.installedRoot)) {
            renameSync(paths.installedRoot, backupRoot);
        }
        renameSync(stagingRoot, paths.installedRoot);
        rmSync(backupRoot, {recursive: true, force: true});
    } catch (error) {
        rmSync(stagingRoot, {recursive: true, force: true});
        if (!existsSync(paths.installedRoot) && existsSync(backupRoot)) {
            renameSync(backupRoot, paths.installedRoot);
        }
        throw error;
    }
};

const runBuildCommand = (args) => {
    const target = args[1];
    const channel = getOption(args, "--channel");
    const workspace = getOption(args, "--workspace");
    if (!target || !["store", "local"].includes(channel)) {
        fail("build 需要插件名以及 --channel store 或 --channel local");
    }
    if (channel === "local" && !workspace) {
        fail("本地构建需要 --workspace 路径");
    }
    if (channel === "local" && !existsSync(join(resolve(workspace), "data"))) {
        fail(`工作空间缺少 data 目录：${resolve(workspace)}`);
    }
    const buildId = getBuildId(getOption(args, "--build-id"));
    for (const plugin of selectPlugins(target)) {
        const before = validatePlugin(plugin, workspace, {checkDist: false, checkInstalled: false});
        if (before.errors.length) {
            fail(`${plugin.name} 构建前检查失败：${before.errors.join("；")}`);
        }
        runBuild(plugin);
        const after = validatePlugin(plugin, workspace, {checkInstalled: false});
        if (after.errors.length) {
            fail(`${plugin.name} 构建后检查失败：${after.errors.join("；")}`);
        }
        if (!existsSync(after.state.paths.packageZip)) {
            fail(`${plugin.name} 未生成 package.zip`);
        }
        if (channel === "store") {
            console.log(`${plugin.name} 商店包已生成：${after.state.pluginManifest.version}`);
            continue;
        }
        const localVersion = getLocalVersion(after.state.pluginManifest.version, plugin.storeVersion, buildId);
        installLocalBuild(plugin, workspace, localVersion);
        const installed = validatePlugin(plugin, workspace);
        if (installed.errors.length) {
            fail(`${plugin.name} 本地安装检查失败：${installed.errors.join("；")}`);
        }
        console.log(`${plugin.name} 本地版已安装：${localVersion}`);
    }
};

const setVersion = (args) => {
    const pluginName = args[1];
    const version = args[2];
    if (!pluginName || !stableVersionPattern.test(version || "")) {
        fail("set 需要插件名和稳定 SemVer，例如 1.2.3");
    }
    const [plugin] = selectPlugins(pluginName);
    if (compareVersions(version, plugin.storeVersion) < 0) {
        fail(`新版本 ${version} 不能低于商店版本 ${plugin.storeVersion}`);
    }
    const state = inspectPlugin(plugin);
    state.packageManifest.version = version;
    state.pluginManifest.version = version;
    writeJSON(state.paths.packageManifest, state.packageManifest);
    writeJSON(state.paths.pluginManifest, state.pluginManifest);
    const packageLockPath = join(plugin.root, "package-lock.json");
    if (existsSync(packageLockPath)) {
        const packageLock = readJSON(packageLockPath);
        packageLock.version = version;
        if (packageLock.packages?.[""]) {
            packageLock.packages[""].version = version;
        }
        writeJSON(packageLockPath, packageLock);
    }
    console.log(`${plugin.name} 源码目标版本已设为 ${version}；商店登记仍为 ${plugin.storeVersion}`);
};

const syncStoreVersions = async (args) => {
    const target = args[1] && !args[1].startsWith("--") ? args[1] : "all";
    const onlineVersions = await fetchOnlineVersions();
    const selectedNames = new Set(selectPlugins(target).map((plugin) => plugin.name));
    const updates = [];
    for (const entry of config.plugins) {
        if (!selectedNames.has(entry.name)) {
            continue;
        }
        const onlineVersion = onlineVersions.get(entry.name);
        if (!onlineVersion || !stableVersionPattern.test(onlineVersion)) {
            fail(`${entry.name} 线上商店没有有效的稳定版本`);
        }
        const plugin = normalizePlugin(entry);
        const sourceVersion = inspectPlugin(plugin).pluginManifest.version;
        if (compareVersions(sourceVersion, onlineVersion) < 0) {
            fail(`${entry.name} 源码版本 ${sourceVersion} 低于线上商店 ${onlineVersion}`);
        }
        updates.push({entry, onlineVersion});
    }
    updates.forEach(({entry, onlineVersion}) => {
        entry.storeVersion = onlineVersion;
        console.log(`${entry.name} 商店登记已同步为 ${onlineVersion}`);
    });
    writeJSON(configPath, config);
};

const main = async () => {
    const args = process.argv.slice(2);
    const command = args[0];
    if (!command || command === "help" || hasOption(args, "--help")) {
        usage();
        return;
    }
    if (command === "status") {
        await runStatus(args, false);
        return;
    }
    if (command === "check") {
        await runStatus(args, true);
        return;
    }
    if (command === "build") {
        runBuildCommand(args);
        return;
    }
    if (command === "set") {
        setVersion(args);
        return;
    }
    if (command === "sync-store") {
        await syncStoreVersions(args);
        return;
    }
    fail(`未知命令：${command}`);
};

main().catch((error) => {
    console.error(`版本管理失败：${error.message}`);
    process.exitCode = 1;
});
