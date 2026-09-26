import { mkdirSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { Agent as HttpsAgent } from 'node:https';
import { dirname, join, posix } from 'node:path';

import { getOutgoingUserAgent } from '../core/types';
import * as errs from '../errs/index';
import { HttpClient } from '../httpclient/index';
import * as log from '../log/index';
import {
    type Config,
    LocalFileSystemObjectStorageType,
    MinIOStorageType,
    S3StorageType,
    WebDAVStorageType,
} from '../settings/settings';

const avatarPathPrefix = 'avatar';
const userCustomIconPathPrefix = 'icon';
const transactionPicturePathPrefix = 'transaction';

type Ctx = log.LogContext | null;

// ObjectStorage represents an object storage to store file object
export interface ObjectStorage {
    exists(ctx: Ctx, path: string): Promise<boolean>;
    read(ctx: Ctx, path: string): Promise<Buffer | null>;
    save(ctx: Ctx, path: string, object: Buffer): Promise<void>;
    delete(ctx: Ctx, path: string): Promise<void>;
}

// LocalFileSystemObjectStorage represents local file system storage
export class LocalFileSystemObjectStorage implements ObjectStorage {
    private readonly rootPath: string;

    public constructor(config: Config, pathPrefix: string) {
        this.rootPath = join(config.localFileSystemPath, pathPrefix);
        mkdirSync(this.rootPath, { recursive: true });
    }

    public async exists(_ctx: Ctx, path: string): Promise<boolean> {
        try {
            await stat(this.getFinalPath(path));
            return true;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return false;
            }

            throw err;
        }
    }

    public async read(_ctx: Ctx, path: string): Promise<Buffer | null> {
        try {
            return await readFile(this.getFinalPath(path));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }

            throw err;
        }
    }

    public async save(_ctx: Ctx, path: string, object: Buffer): Promise<void> {
        const finalPath = this.getFinalPath(path);
        await mkdir(dirname(finalPath), { recursive: true });
        await writeFile(finalPath, object);
    }

    public async delete(_ctx: Ctx, path: string): Promise<void> {
        try {
            await rm(this.getFinalPath(path));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }
    }

    private getFinalPath(path: string): string {
        return join(this.rootPath, path);
    }
}

function getObjectKey(rootPath: string, path: string): string {
    if (rootPath.length > 0 && !rootPath.endsWith('/')) {
        rootPath = rootPath + '/';
    }

    if (rootPath.length > 0 && rootPath.startsWith('/')) {
        rootPath = rootPath.substring(1);
    }

    if (path.length > 0 && path.startsWith('/')) {
        path = path.substring(1);
    }

    path = path.replaceAll('\\', '/');
    return rootPath + path;
}

// S3ObjectStorage represents s3-compatible object storage
export class S3ObjectStorage implements ObjectStorage {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly s3: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly s3Module: any;
    private readonly bucket: string;
    private readonly rootPath: string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private constructor(s3Module: any, s3: any, bucket: string, rootPath: string) {
        this.s3Module = s3Module;
        this.s3 = s3;
        this.bucket = bucket;
        this.rootPath = rootPath;
    }

    public static async create(config: Config, pathPrefix: string): Promise<S3ObjectStorage> {
        const s3Config = config.s3Config;
        const s3Module = await import('@aws-sdk/client-s3');
        let endpoint: string | undefined;

        if (s3Config.endpoint !== '') {
            if (s3Config.endpoint.includes('://')) {
                endpoint = s3Config.endpoint;
            } else {
                endpoint = (s3Config.useSSL ? 'https://' : 'http://') + s3Config.endpoint;
            }
        }

        let requestHandler: any; // eslint-disable-line @typescript-eslint/no-explicit-any

        if (s3Config.skipTLSVerify) {
            const { NodeHttpHandler } = await import('@smithy/node-http-handler');
            requestHandler = new NodeHttpHandler({ httpsAgent: new HttpsAgent({ rejectUnauthorized: false }) });
        }

        const s3 = new s3Module.S3Client({
            region: s3Config.region,
            endpoint: endpoint,
            forcePathStyle: s3Config.usePathStyle,
            credentials: {
                accessKeyId: s3Config.accessKeyID,
                secretAccessKey: s3Config.secretAccessKey,
                sessionToken: s3Config.sessionToken || undefined,
            },
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            requestHandler: requestHandler,
        });

        const rootPath = getObjectKey(s3Config.rootPath, pathPrefix).replaceAll('\\', '/');

        try {
            await s3.send(new s3Module.HeadBucketCommand({ Bucket: s3Config.bucket }));
        } catch (err) {
            const name = (err as { name?: string }).name;

            if (name !== 'NotFound' && name !== 'NoSuchBucket') {
                throw err;
            }

            await s3.send(new s3Module.CreateBucketCommand({
                Bucket: s3Config.bucket,
                CreateBucketConfiguration: { LocationConstraint: s3Config.region as never },
            }));
        }

        return new S3ObjectStorage(s3Module, s3, s3Config.bucket, rootPath);
    }

    public async exists(_ctx: Ctx, path: string): Promise<boolean> {
        try {
            const output = await this.s3.send(new this.s3Module.HeadObjectCommand({ Bucket: this.bucket, Key: getObjectKey(this.rootPath, path) }));
            return !output.DeleteMarker;
        } catch (err) {
            const name = (err as { name?: string }).name;

            if (name === 'NotFound' || name === 'NoSuchKey') {
                return false;
            }

            throw err;
        }
    }

    public async read(_ctx: Ctx, path: string): Promise<Buffer | null> {
        try {
            const output = await this.s3.send(new this.s3Module.GetObjectCommand({ Bucket: this.bucket, Key: getObjectKey(this.rootPath, path) }));

            if (output.DeleteMarker) {
                return null;
            }

            return Buffer.from(await output.Body.transformToByteArray());
        } catch (err) {
            const name = (err as { name?: string }).name;

            if (name === 'NotFound' || name === 'NoSuchKey') {
                return null;
            }

            throw err;
        }
    }

    public async save(_ctx: Ctx, path: string, object: Buffer): Promise<void> {
        await this.s3.send(new this.s3Module.PutObjectCommand({ Bucket: this.bucket, Key: getObjectKey(this.rootPath, path), Body: object }));
    }

    public async delete(_ctx: Ctx, path: string): Promise<void> {
        await this.s3.send(new this.s3Module.DeleteObjectCommand({ Bucket: this.bucket, Key: getObjectKey(this.rootPath, path) }));
    }
}

// MinIOObjectStorage represents minio storage
export class MinIOObjectStorage implements ObjectStorage {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly client: any;
    private readonly bucket: string;
    private readonly rootPath: string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private constructor(client: any, bucket: string, rootPath: string) {
        this.client = client;
        this.bucket = bucket;
        this.rootPath = rootPath;
    }

    public static async create(config: Config, pathPrefix: string): Promise<MinIOObjectStorage> {
        const minIOConfig = config.minIOConfig;
        const minio = await import('minio');
        let endPoint = minIOConfig.endpoint;
        let port: number | undefined;
        const portIndex = endPoint.lastIndexOf(':');

        if (portIndex > 0 && /^\d+$/.test(endPoint.substring(portIndex + 1))) {
            port = parseInt(endPoint.substring(portIndex + 1), 10);
            endPoint = endPoint.substring(0, portIndex);
        }

        const client = new minio.Client({
            endPoint: endPoint,
            port: port,
            useSSL: minIOConfig.useSSL,
            accessKey: minIOConfig.accessKeyID,
            secretKey: minIOConfig.secretAccessKey,
            region: minIOConfig.location || undefined,
            transportAgent: minIOConfig.skipTLSVerify ? new HttpsAgent({ rejectUnauthorized: false }) : undefined,
        });

        const rootPath = getObjectKey(minIOConfig.rootPath, pathPrefix).replaceAll('\\', '/');
        const exists = await client.bucketExists(minIOConfig.bucket);

        if (!exists) {
            await client.makeBucket(minIOConfig.bucket, minIOConfig.location || undefined);
        }

        return new MinIOObjectStorage(client, minIOConfig.bucket, rootPath);
    }

    private static isNotFoundError(err: unknown): boolean {
        const code = (err as { code?: string }).code;
        return code === 'NoSuchKey' || code === 'NoSuchObject' || code === 'NotFound';
    }

    public async exists(_ctx: Ctx, path: string): Promise<boolean> {
        try {
            await this.client.statObject(this.bucket, getObjectKey(this.rootPath, path));
            return true;
        } catch (err) {
            if (MinIOObjectStorage.isNotFoundError(err)) {
                return false;
            }

            throw err;
        }
    }

    public async read(_ctx: Ctx, path: string): Promise<Buffer | null> {
        try {
            const stream = await this.client.getObject(this.bucket, getObjectKey(this.rootPath, path));
            const chunks: Buffer[] = [];

            for await (const chunk of stream) {
                chunks.push(Buffer.from(chunk as Uint8Array));
            }

            return Buffer.concat(chunks);
        } catch (err) {
            if (MinIOObjectStorage.isNotFoundError(err)) {
                return null;
            }

            throw err;
        }
    }

    public async save(_ctx: Ctx, path: string, object: Buffer): Promise<void> {
        await this.client.putObject(this.bucket, getObjectKey(this.rootPath, path), object, object.length);
    }

    public async delete(_ctx: Ctx, path: string): Promise<void> {
        await this.client.removeObject(this.bucket, getObjectKey(this.rootPath, path));
    }
}

// WebDAVObjectStorage represents webdav storage
export class WebDAVObjectStorage implements ObjectStorage {
    private readonly httpClient: HttpClient;
    private readonly url: string;
    private readonly authorization: string;
    private readonly rootPath: string;

    private constructor(config: Config, pathPrefix: string) {
        const webDavConfig = config.webDAVConfig;
        this.httpClient = new HttpClient(webDavConfig.requestTimeout, webDavConfig.proxy, webDavConfig.skipTLSVerify, getOutgoingUserAgent(), false);
        this.url = webDavConfig.url;
        this.authorization = 'Basic ' + Buffer.from(`${webDavConfig.username}:${webDavConfig.password}`).toString('base64');

        let rootPath = webDavConfig.rootPath;
        rootPath = WebDAVObjectStorage.joinPath(rootPath, pathPrefix);
        this.rootPath = rootPath.replaceAll('\\', '/');
    }

    public static async create(config: Config, pathPrefix: string): Promise<WebDAVObjectStorage> {
        const storage = new WebDAVObjectStorage(config, pathPrefix);
        const exists = await storage.directoryExists(null, storage.rootPath);

        if (!exists) {
            await storage.createAllDirectories(null, '', storage.rootPath);
        }

        return storage;
    }

    private static joinPath(rootPath: string, path: string): string {
        if (rootPath.length < 1 || !rootPath.endsWith('/')) {
            rootPath = rootPath + '/';
        }

        if (path.length > 0 && path.startsWith('/')) {
            path = path.substring(1);
        }

        path = path.replaceAll('\\', '/');
        return rootPath + path;
    }

    public async exists(ctx: Ctx, path: string): Promise<boolean> {
        let resp;

        try {
            resp = await this.httpClient.request(this.getFinalFileUrl(path), { method: 'HEAD', headers: { Authorization: this.authorization } });
        } catch (err) {
            log.errorf(ctx, `[webdav_storage.Exists] cannot check file exists, because ${(err as Error).message}`);
            throw err;
        }

        if (resp.status === 200) {
            return true;
        } else if (resp.status === 404) {
            return false;
        }

        log.errorf(ctx, `[webdav_storage.Exists] cannot check file exists, http status code is ${resp.status}`);
        throw errs.ErrSystemError;
    }

    public async read(ctx: Ctx, path: string): Promise<Buffer | null> {
        let resp;

        try {
            resp = await this.httpClient.request(this.getFinalFileUrl(path), { method: 'GET', headers: { Authorization: this.authorization } });
        } catch (err) {
            log.errorf(ctx, `[webdav_storage.Read] cannot get file, because ${(err as Error).message}`);
            throw err;
        }

        if (resp.status === 404) {
            return null;
        }

        if (resp.status !== 200) {
            log.errorf(ctx, `[webdav_storage.Read] cannot get file, http status code is ${resp.status}, response is ${resp.body.toString()}`);
            throw errs.ErrSystemError;
        }

        return resp.body;
    }

    public async save(ctx: Ctx, path: string, object: Buffer): Promise<void> {
        const finalPath = WebDAVObjectStorage.joinPath(this.rootPath, path);
        const dir = posix.dirname(finalPath.replaceAll('\\', '/'));
        const exists = await this.directoryExists(ctx, dir);

        if (!exists) {
            const rootExists = await this.directoryExists(ctx, this.rootPath);

            if (!rootExists) {
                await this.createAllDirectories(ctx, '', this.rootPath);
            }

            await this.createAllDirectories(ctx, this.rootPath, posix.dirname(path.replaceAll('\\', '/')));
        }

        let resp;

        try {
            resp = await this.httpClient.request(this.getFinalFileUrl(path), { method: 'PUT', headers: { Authorization: this.authorization }, body: object });
        } catch (err) {
            log.errorf(ctx, `[webdav_storage.Save] cannot save file, because ${(err as Error).message}`);
            throw err;
        }

        if (resp.status < 200 || resp.status >= 300) {
            log.errorf(ctx, `[webdav_storage.Save] cannot save file, http status code is ${resp.status}, response is ${resp.body.toString()}`);
            throw errs.ErrSystemError;
        }
    }

    public async delete(ctx: Ctx, path: string): Promise<void> {
        let resp;

        try {
            resp = await this.httpClient.request(this.getFinalFileUrl(path), { method: 'DELETE', headers: { Authorization: this.authorization } });
        } catch (err) {
            log.errorf(ctx, `[webdav_storage.Delete] cannot delete file, because ${(err as Error).message}`);
            throw err;
        }

        if (resp.status !== 204 && resp.status !== 404) {
            log.errorf(ctx, `[webdav_storage.Delete] cannot delete file, http status code is ${resp.status}, response is ${resp.body.toString()}`);
            throw errs.ErrSystemError;
        }
    }

    private async directoryExists(ctx: Ctx, path: string): Promise<boolean> {
        let resp;

        try {
            resp = await this.httpClient.request(this.getFinalDirectoryUrl(path), { method: 'PROPFIND', headers: { Authorization: this.authorization } });
        } catch (err) {
            log.errorf(ctx, `[webdav_storage.directoryExists] cannot check directory exists, because ${(err as Error).message}`);
            throw err;
        }

        if (resp.status === 207 || resp.status === 200) {
            return true;
        } else if (resp.status === 404) {
            return false;
        }

        log.errorf(ctx, `[webdav_storage.directoryExists] cannot check directory exists, http status code is ${resp.status}`);
        throw errs.ErrSystemError;
    }

    private async createDirectory(ctx: Ctx, path: string): Promise<void> {
        let resp;

        try {
            resp = await this.httpClient.request(this.getFinalDirectoryUrl(path), { method: 'MKCOL', headers: { Authorization: this.authorization } });
        } catch (err) {
            log.errorf(ctx, `[webdav_storage.createDirectory] cannot create directory, because ${(err as Error).message}`);
            throw err;
        }

        if (resp.status !== 201 && resp.status !== 405) {
            log.errorf(ctx, `[webdav_storage.createDirectory] cannot create directory, http status code is ${resp.status}, response is ${resp.body.toString()}`);
            throw errs.ErrSystemError;
        }
    }

    private async createAllDirectories(ctx: Ctx, currentPath: string, path: string): Promise<void> {
        for (const dir of path.split('/')) {
            if (dir.length === 0) {
                continue;
            }

            currentPath = currentPath + '/' + dir;
            const exists = await this.directoryExists(ctx, currentPath);

            if (!exists) {
                await this.createDirectory(ctx, currentPath);
            }
        }
    }

    private getFinalFileUrl(filePath: string): string {
        let finalUrl = this.url;

        if (finalUrl.length < 1 || !finalUrl.endsWith('/')) {
            finalUrl = finalUrl + '/';
        }

        let finalPath = WebDAVObjectStorage.joinPath(this.rootPath, filePath);

        if (finalPath.startsWith('/')) {
            finalPath = finalPath.substring(1);
        }

        return finalUrl + finalPath;
    }

    private getFinalDirectoryUrl(dirPath: string): string {
        let finalUrl = this.url;

        if (finalUrl.length < 1 || !finalUrl.endsWith('/')) {
            finalUrl = finalUrl + '/';
        }

        if (dirPath.startsWith('/')) {
            dirPath = dirPath.substring(1);
        }

        if (dirPath.length > 0 && !dirPath.endsWith('/')) {
            dirPath = dirPath + '/';
        }

        return finalUrl + dirPath;
    }
}

async function newObjectStorage(config: Config, pathPrefix: string): Promise<ObjectStorage> {
    if (config.storageType === LocalFileSystemObjectStorageType) {
        return new LocalFileSystemObjectStorage(config, pathPrefix);
    } else if (config.storageType === S3StorageType) {
        return S3ObjectStorage.create(config, pathPrefix);
    } else if (config.storageType === MinIOStorageType) {
        return MinIOObjectStorage.create(config, pathPrefix);
    } else if (config.storageType === WebDAVStorageType) {
        return WebDAVObjectStorage.create(config, pathPrefix);
    }

    throw errs.ErrInvalidStorageType;
}

function requireStorage(storage: ObjectStorage | null): ObjectStorage {
    if (!storage) {
        throw errs.ErrSystemError;
    }

    return storage;
}

// StorageContainer contains the current object storage
class StorageContainer {
    public avatarCurrentStorage: ObjectStorage | null = null;
    public userCustomIconCurrentStorage: ObjectStorage | null = null;
    public transactionPictureCurrentStorage: ObjectStorage | null = null;

    public existsAvatar(ctx: Ctx, path: string): Promise<boolean> {
        return requireStorage(this.avatarCurrentStorage).exists(ctx, path);
    }

    public readAvatar(ctx: Ctx, path: string): Promise<Buffer | null> {
        return requireStorage(this.avatarCurrentStorage).read(ctx, path);
    }

    public saveAvatar(ctx: Ctx, path: string, object: Buffer): Promise<void> {
        return requireStorage(this.avatarCurrentStorage).save(ctx, path, object);
    }

    public deleteAvatar(ctx: Ctx, path: string): Promise<void> {
        return requireStorage(this.avatarCurrentStorage).delete(ctx, path);
    }

    public existsUserCustomIcon(ctx: Ctx, path: string): Promise<boolean> {
        return requireStorage(this.userCustomIconCurrentStorage).exists(ctx, path);
    }

    public readUserCustomIcon(ctx: Ctx, path: string): Promise<Buffer | null> {
        return requireStorage(this.userCustomIconCurrentStorage).read(ctx, path);
    }

    public saveUserCustomIcon(ctx: Ctx, path: string, object: Buffer): Promise<void> {
        return requireStorage(this.userCustomIconCurrentStorage).save(ctx, path, object);
    }

    public deleteUserCustomIcon(ctx: Ctx, path: string): Promise<void> {
        return requireStorage(this.userCustomIconCurrentStorage).delete(ctx, path);
    }

    public existsTransactionPicture(ctx: Ctx, path: string): Promise<boolean> {
        return requireStorage(this.transactionPictureCurrentStorage).exists(ctx, path);
    }

    public readTransactionPicture(ctx: Ctx, path: string): Promise<Buffer | null> {
        return requireStorage(this.transactionPictureCurrentStorage).read(ctx, path);
    }

    public saveTransactionPicture(ctx: Ctx, path: string, object: Buffer): Promise<void> {
        return requireStorage(this.transactionPictureCurrentStorage).save(ctx, path, object);
    }

    public deleteTransactionPicture(ctx: Ctx, path: string): Promise<void> {
        return requireStorage(this.transactionPictureCurrentStorage).delete(ctx, path);
    }
}

export const Container = new StorageContainer();

export async function initializeStorageContainer(config: Config): Promise<void> {
    if (config.avatarProvider === 'internal') {
        Container.avatarCurrentStorage = await newObjectStorage(config, avatarPathPrefix);
    }

    if (config.enableUserCustomIcon) {
        Container.userCustomIconCurrentStorage = await newObjectStorage(config, userCustomIconPathPrefix);
    }

    if (config.enableTransactionPictures) {
        Container.transactionPictureCurrentStorage = await newObjectStorage(config, transactionPicturePathPrefix);
    }
}
