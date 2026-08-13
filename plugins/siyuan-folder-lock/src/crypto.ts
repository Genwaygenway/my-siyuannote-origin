// 加密引擎：基于 Web Crypto API 的 AES-GCM 256 加密
// 使用 PBKDF2 派生密钥，支持主密钥包装/解包

export const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

/** Base64 编码 ArrayBuffer */
export function base64Encode(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Base64 解码为 ArrayBuffer */
export function base64Decode(str: string): ArrayBuffer {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/** 生成随机 salt */
export function generateSalt(): string {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    return base64Encode(salt.buffer);
}

/** 用 PBKDF2 从密码派生 CryptoKey */
export async function deriveKey(
    password: string,
    saltBase64: string,
    iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
    const salt = new Uint8Array(base64Decode(saltBase64));
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: KEY_LENGTH },
        false,
        ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
    );
}

/** 生成随机主密钥 */
export async function generateMasterKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
        { name: "AES-GCM", length: KEY_LENGTH },
        true,
        ["encrypt", "decrypt"]
    );
}

/** AES-GCM 加密文本，返回 {ciphertext, iv} */
export async function encryptText(
    text: string,
    key: CryptoKey,
    context?: string,
): Promise<{ ciphertext: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
        createAesGcmParams(iv, context),
        key,
        enc.encode(text)
    );
    return {
        ciphertext: base64Encode(encrypted),
        iv: base64Encode(iv.buffer),
    };
}

/** AES-GCM 解密文本 */
export async function decryptText(
    ciphertextBase64: string,
    ivBase64: string,
    key: CryptoKey,
    context?: string,
): Promise<string> {
    const iv = new Uint8Array(base64Decode(ivBase64));
    const ciphertext = base64Decode(ciphertextBase64);
    const decrypted = await crypto.subtle.decrypt(
        createAesGcmParams(iv, context),
        key,
        ciphertext
    );
    const dec = new TextDecoder();
    return dec.decode(decrypted);
}

/** 用 wrappingKey 加密 masterKey，返回 {wrappedKey, iv} */
export async function wrapKey(
    masterKey: CryptoKey,
    wrappingKey: CryptoKey,
    context?: string,
): Promise<{ wrappedKey: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const exported = await crypto.subtle.exportKey("raw", masterKey);
    const wrapped = await crypto.subtle.encrypt(
        createAesGcmParams(iv, context),
        wrappingKey,
        exported
    );
    return {
        wrappedKey: base64Encode(wrapped),
        iv: base64Encode(iv.buffer),
    };
}

/** 用 unwrappingKey 解包 masterKey */
export async function unwrapKey(
    wrappedKeyBase64: string,
    ivBase64: string,
    unwrappingKey: CryptoKey,
    context?: string,
): Promise<CryptoKey> {
    const iv = new Uint8Array(base64Decode(ivBase64));
    const wrapped = base64Decode(wrappedKeyBase64);
    const rawKey = await crypto.subtle.decrypt(
        createAesGcmParams(iv, context),
        unwrappingKey,
        wrapped
    );
    return crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM", length: KEY_LENGTH },
        false,
        ["encrypt", "decrypt"]
    );
}

function createAesGcmParams(iv: Uint8Array, context?: string): AesGcmParams {
    const normalizedIv = new Uint8Array(iv).buffer;
    if (!context) {
        return {name: "AES-GCM", iv: normalizedIv};
    }
    return {
        name: "AES-GCM",
        iv: normalizedIv,
        additionalData: new TextEncoder().encode(context).buffer,
    };
}

/** 生成 32 字符恢复码（base32 风格，带分隔符） */
export function generateRecoveryCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let code = "";
    for (let i = 0; i < bytes.length; i++) {
        code += chars[bytes[i] % chars.length];
    }
    // 每 4 字符加一个分隔符
    return code.match(/.{4}/g)!.join("-");
}
