import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const imageFileExtensionContentTypeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
};

export function getImageContentType(fileExtension: string): string {
    return imageFileExtensionContentTypeMap[fileExtension] ?? '';
}

export function listFileNamesWithPrefixAndSuffix(path: string, prefix: string, suffix: string): string[] {
    try {
        return readdirSync(path, { withFileTypes: true })
            .filter(entry => !entry.isDirectory() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix))
            .map(entry => entry.name);
    } catch {
        return [];
    }
}

export function isExists(path: string): boolean {
    try {
        statSync(path);
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }

        throw err;
    }
}

export function isExistsSafe(path: string): boolean {
    return existsSync(path);
}

export function writeFile(path: string, data: Buffer | string): void {
    writeFileSync(path, data);
}

// goExt behaves like go filepath.Ext
function goExt(path: string): string {
    for (let i = path.length - 1; i >= 0 && path[i] !== '/'; i--) {
        if (path[i] === '.') {
            return path.substring(i);
        }
    }

    return '';
}

export function getFileNameWithoutExtension(path: string): string {
    if (path === '') {
        return '';
    }

    for (let i = path.length - 1; i >= 0; i--) {
        if (path[i] === '/' || path[i] === '\\') {
            path = path.substring(i + 1);
            break;
        }
    }

    if (path === '') {
        return '';
    }

    const extension = goExt(path);

    if (extension.length < 1) {
        return path;
    }

    return path.substring(0, path.length - extension.length);
}

export function getFileNameExtension(path: string): string {
    const extension = goExt(path);

    if (extension.length < 1 || extension[0] !== '.') {
        return extension;
    }

    return extension.substring(1);
}

export { extname };
