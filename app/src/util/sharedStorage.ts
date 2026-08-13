import {Constants} from "../constants";
import {fetchPost} from "./fetch";
import {mergeKnowledgeStorage, mergeTodoStorage} from "./sharedStorageMerge";

const STORAGE_ROOT = "/data/storage/siyuan-custom";
const STORAGE_EVENT = "siyuan-shared-storage";
const SHARED_KEYS = [Constants.LOCAL_TODO, Constants.LOCAL_KNOWLEDGE];
const MAX_WRITE_ATTEMPTS = 8;

interface ISharedStorageSnapshot {
    values: any[];
    revision: string;
}

let writeQueue = Promise.resolve();
let hydrateQueue = Promise.resolve();
let supportsShardedStorage: boolean | undefined;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const mergeSharedStorageVal = (key: string, left: any, right: any) => {
    if (key === Constants.LOCAL_TODO) {
        return mergeTodoStorage(left, right);
    }
    if (key === Constants.LOCAL_KNOWLEDGE) {
        return mergeKnowledgeStorage(left, right);
    }
    return right;
};

const mergeSharedStorageValues = (key: string, values: any[]) => values.reduce(
    (merged, value) => mergeSharedStorageVal(key, merged, value), undefined);

const getLegacyPath = (key: string) => `${STORAGE_ROOT}/${key}.json`;

const readLegacyStorageVal = (key: string) => new Promise<any>((resolve) => {
    fetchPost("/api/file/getFile", {path: getLegacyPath(key)}, (response) => {
        resolve(response);
    }, undefined, () => {
        resolve(undefined);
    });
});

const requestShardedStorage = async (url: string, body: Record<string, any>) => {
    const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(body),
    });
    if (response.status === 404) {
        supportsShardedStorage = false;
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`Shared storage request failed with HTTP ${response.status}`);
    }
    const result = await response.json() as IWebSocketData;
    supportsShardedStorage = true;
    return result;
};

const parseSnapshot = (value: any): ISharedStorageSnapshot => {
    if (!value || !Array.isArray(value.values) || typeof value.revision !== "string") {
        throw new Error("Invalid shared storage snapshot");
    }
    return value;
};

const readShardedStorage = async (key: string) => {
    if (supportsShardedStorage === false) {
        return undefined;
    }
    const response = await requestShardedStorage("/api/storage/getSharedStorage", {key});
    if (!response) {
        return undefined;
    }
    if (response.code !== 0) {
        throw new Error(response.msg || "Unable to read shared storage");
    }
    return parseSnapshot(response.data);
};

const readSharedStorageVal = async (key: string) => {
    const snapshot = await readShardedStorage(key);
    if (snapshot) {
        return mergeSharedStorageValues(key, snapshot.values);
    }
    return readLegacyStorageVal(key);
};

const persistShardedStorageVal = async (key: string, pendingValue: any) => {
    let snapshot = await readShardedStorage(key);
    if (!snapshot) {
        throw new Error("This kernel does not support conflict-safe shared storage writes");
    }

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const merged = mergeSharedStorageValues(key, [...snapshot.values, pendingValue]);
        const response = await requestShardedStorage("/api/storage/setSharedStorage", {
            key,
            expectedRevision: snapshot.revision,
            value: merged,
        });
        if (!response) {
            throw new Error("Shared storage API became unavailable during a write");
        }
        snapshot = parseSnapshot(response.data);
        if (response.code === 0) {
            return mergeSharedStorageValues(key, snapshot.values);
        }
        if (response.code !== 409) {
            throw new Error(response.msg || "Unable to save shared storage");
        }
    }
    throw new Error("Shared storage changed too frequently; retry later");
};

export const notifySharedStorage = (key: string, value: any) => {
    document.querySelectorAll(".sy__todo, .sy__calendar, .sy__file, .mobile-knowledge, .mobile-workspace")
        .forEach((element) => {
            element.dispatchEvent(new CustomEvent(STORAGE_EVENT, {detail: {key, value}}));
        });
};

export const bindSharedStorage = (element: HTMLElement, callback: (key: string, value: any) => void) => {
    element.addEventListener(STORAGE_EVENT, ((event: CustomEvent) => {
        callback(event.detail.key, clone(event.detail.value));
    }) as EventListener);
};

export const applySharedStorageVal = (key: string, value: any) => {
    if (!window.siyuan.storage) {
        return;
    }
    window.siyuan.storage[key] = value;
    if (SHARED_KEYS.includes(key)) {
        notifySharedStorage(key, value);
    }
};

export const persistSharedStorageVal = (key: string, value: any) => {
    if (!SHARED_KEYS.includes(key)) {
        return Promise.resolve(value);
    }
    const operation = writeQueue.then(() => persistShardedStorageVal(key, clone(value)));
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
};

const hydrateSharedStorageNow = async () => {
    if (!window.siyuan.storage) {
        return;
    }
    for (const key of SHARED_KEYS) {
        try {
            const remote = await readSharedStorageVal(key);
            const local = window.siyuan.storage[key];
            const merged = mergeSharedStorageVal(key, remote, local);
            window.siyuan.storage[key] = merged;
            notifySharedStorage(key, merged);
            if (!remote || JSON.stringify(remote) !== JSON.stringify(merged)) {
                const persistedVal = await persistSharedStorageVal(key, merged);
                applySharedStorageVal(key, persistedVal);
            }
        } catch (error) {
            console.warn(`Hydrate shared storage [${key}] failed`, error);
        }
    }
};

export const hydrateSharedStorage = () => {
    const operation = hydrateQueue.then(hydrateSharedStorageNow);
    hydrateQueue = operation.then(() => undefined, () => undefined);
    return operation;
};
