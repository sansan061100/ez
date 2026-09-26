import { type CipherGCM, createCipheriv, createDecipheriv, createHash, type DecipherGCM, pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';

import { ErrCiphertextInvalid } from '../errs/index';

const availableCharacters = '!#$&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~';
const availableNumberAndLetters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const availableNumberAndLowercaseLetters = '0123456789abcdefghijklmnopqrstuvwxyz';

// subString returns a substring by unicode code points, supports negative start
export function subString(str: string, start: number, length: number): string {
    const chars = Array.from(str);
    const realLength = chars.length;

    if (start < 0) {
        start = realLength + start;
    }

    let end = start + length;

    if (start > end) {
        [start, end] = [end, start];
    }

    start = Math.min(Math.max(start, 0), realLength);
    end = Math.min(Math.max(end, 0), realLength);

    return chars.slice(start, end).join('');
}

export function containsAnyString(s: string, substrs: string[]): boolean {
    return substrs.some(sub => s.indexOf(sub) >= 0);
}

export function getFirstLowerCharString(s: string): string {
    if (s === '') {
        return s;
    }

    const chars = Array.from(s);
    const first = chars[0]!;

    if (first.toLowerCase() === first && first.toUpperCase() !== first) {
        return s;
    }

    chars[0] = first.toLowerCase();
    return chars.join('');
}

export function containsOnlyOneRune(s: string, r: string): boolean {
    if (s.length < 1) {
        return false;
    }

    for (const ch of s) {
        if (ch !== r) {
            return false;
        }
    }

    return true;
}

function getRandomFromCharset(charset: string, n: number): string {
    let result = '';

    for (let i = 0; i < n; i++) {
        result += charset[randomInt(charset.length)];
    }

    return result;
}

export function getRandomString(n: number): string {
    return getRandomFromCharset(availableCharacters, n);
}

export function getRandomNumberOrLetter(n: number): string {
    return getRandomFromCharset(availableNumberAndLetters, n);
}

export function getRandomNumberOrLowercaseLetter(n: number): string {
    return getRandomFromCharset(availableNumberAndLowercaseLetters, n);
}

export function md5Encode(data: Buffer | string): Buffer {
    return createHash('md5').update(data).digest();
}

export function md5EncodeToString(data: Buffer | string): string {
    return md5Encode(data).toString('hex');
}

export function md5EncodeToStringWithUidAndSalt(data: Buffer, uid: bigint, salt: string): string {
    let hash = md5Encode(Buffer.concat([data, Buffer.from(salt + uid.toString())]));
    hash = md5Encode(Buffer.concat([hash, Buffer.from(uid.toString() + salt)]));
    return hash.toString('hex');
}

export function sha256EncodeToString(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
}

const gcmNonceSize = 12;
const gcmTagSize = 16;

function aesAlgorithm(key: Buffer): string {
    switch (key.length) {
        case 16:
            return 'aes-128-gcm';
        case 24:
            return 'aes-192-gcm';
        case 32:
            return 'aes-256-gcm';
        default:
            throw new Error(`crypto/aes: invalid key size ${key.length}`);
    }
}

// aesGCMEncrypt returns nonce + ciphertext + tag (same layout as go cipher.AEAD Seal)
export function aesGCMEncrypt(key: Buffer, plainText: Buffer): Buffer {
    const nonce = randomBytes(gcmNonceSize);
    const cipher = createCipheriv(aesAlgorithm(key), key, nonce) as CipherGCM;
    const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()]);
    return Buffer.concat([nonce, encrypted, cipher.getAuthTag()]);
}

export function aesGCMDecrypt(key: Buffer, ciphertext: Buffer): Buffer {
    if (ciphertext.length - gcmNonceSize <= 0) {
        throw ErrCiphertextInvalid;
    }

    const nonce = ciphertext.subarray(0, gcmNonceSize);
    const data = ciphertext.subarray(gcmNonceSize);

    if (data.length < gcmTagSize) {
        throw new Error('cipher: message authentication failed');
    }

    const decipher = createDecipheriv(aesAlgorithm(key), key, nonce) as DecipherGCM;
    decipher.setAuthTag(data.subarray(data.length - gcmTagSize));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - gcmTagSize)), decipher.final()]);
}

export function encodePassword(password: string, salt: string): string {
    const encodedPassword = pbkdf2Sync(Buffer.from(password), Buffer.from(salt), 10000, 48, 'sha256'); // 256^48 = 64^64
    return encodedPassword.toString('base64').replace(/=+$/, '');
}

export function encryptSecret(secret: string, key: string): string {
    const encryptedSecret = aesGCMEncrypt(md5Encode(Buffer.from(key)), Buffer.from(secret)); // md5encode make the aes key's length to 16
    return encryptedSecret.toString('base64');
}

export function decryptSecret(encryptedSecret: string, key: string): string {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encryptedSecret) || encryptedSecret.length % 4 !== 0) {
        throw new Error('illegal base64 data');
    }

    const encryptedData = Buffer.from(encryptedSecret, 'base64');
    return aesGCMDecrypt(md5Encode(Buffer.from(key)), encryptedData).toString();
}

// goSprintf formats text like go fmt.Sprintf, supports %s, %v, %d, %q and %%
export function goSprintf(format: string, ...args: unknown[]): string {
    let index = 0;

    return format.replace(/%([svdq%])/g, (match: string, verb: string) => {
        if (verb === '%') {
            return '%';
        }

        if (index >= args.length) {
            return `%!${verb}(MISSING)`;
        }

        const arg = args[index++];

        if (verb === 'q') {
            return JSON.stringify(String(arg));
        }

        if (typeof arg === 'bigint' || typeof arg === 'number') {
            return verb === 'd' ? String(typeof arg === 'number' ? Math.trunc(arg) : arg) : String(arg);
        }

        return String(arg);
    });
}

// scanLines splits the text into lines like go bufio.Scanner with ScanLines (trailing "\r" removed, stops at token longer than 64KB)
export function scanLines(text: string): string[] {
    const lines: string[] = [];
    const maxTokenSize = 64 * 1024;
    let pos = 0;

    while (pos < text.length) {
        const index = text.indexOf('\n', pos);
        let line = index >= 0 ? text.substring(pos, index) : text.substring(pos);

        if (Buffer.byteLength(line, 'utf8') + (index >= 0 ? 1 : 0) > maxTokenSize) {
            break;
        }

        if (line.endsWith('\r')) {
            line = line.substring(0, line.length - 1);
        }

        lines.push(line);

        if (index < 0) {
            break;
        }

        pos = index + 1;
    }

    return lines;
}
