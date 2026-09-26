import { join } from 'node:path';

import type { Context } from '../core/context';
import { Container as DataStoreContainer, type Database } from '../datastore/index';
import { Container as MailerContainer, type MailMessage } from '../mail/index';
import { UserCustomIconFileExtension } from '../models/user_custom_icon';
import { type Config, Container as ConfigContainer } from '../settings/settings';
import { Container as StorageContainer } from '../storage/index';
import { Container as UuidContainer, type UuidType } from '../uuid/index';

// ServiceBase contains the common dependencies of services
export class ServiceBase {
    public userDB(): Database {
        return DataStoreContainer.userStore.choose(0n);
    }

    public tokenDB(uid: bigint): Database {
        return DataStoreContainer.tokenStore.choose(uid);
    }

    public tokenDBByIndex(index: number): Database {
        return DataStoreContainer.tokenStore.get(index);
    }

    public tokenDBCount(): number {
        return DataStoreContainer.tokenStore.count();
    }

    public userDataDB(uid: bigint): Database {
        return DataStoreContainer.userDataStore.choose(uid);
    }

    public userDataDBByIndex(index: number): Database {
        return DataStoreContainer.userDataStore.get(index);
    }

    public userDataDBCount(): number {
        return DataStoreContainer.userDataStore.count();
    }

    public currentConfig(): Config {
        return ConfigContainer.getCurrentConfig();
    }

    public async sendMail(message: MailMessage): Promise<void> {
        await MailerContainer.sendMail(message);
    }

    public generateUuid(uuidType: UuidType): bigint {
        return UuidContainer.generateUuid(uuidType);
    }

    public generateUuids(uuidType: UuidType, count: number): bigint[] | null {
        return UuidContainer.generateUuids(uuidType, count);
    }

    public existsAvatar(ctx: Context, uid: bigint, fileExtension: string): Promise<boolean> {
        return StorageContainer.existsAvatar(ctx, this.getUserAvatarPath(uid, fileExtension));
    }

    public readAvatar(ctx: Context, uid: bigint, fileExtension: string): Promise<Buffer | null> {
        return StorageContainer.readAvatar(ctx, this.getUserAvatarPath(uid, fileExtension));
    }

    public saveAvatar(ctx: Context, uid: bigint, object: Buffer, fileExtension: string): Promise<void> {
        return StorageContainer.saveAvatar(ctx, this.getUserAvatarPath(uid, fileExtension), object);
    }

    public deleteAvatar(ctx: Context, uid: bigint, fileExtension: string): Promise<void> {
        return StorageContainer.deleteAvatar(ctx, this.getUserAvatarPath(uid, fileExtension));
    }

    public existsUserCustomIcon(ctx: Context, uid: bigint, iconId: bigint): Promise<boolean> {
        return StorageContainer.existsUserCustomIcon(ctx, this.getUserCustomIconPath(uid, iconId));
    }

    public readUserCustomIcon(ctx: Context, uid: bigint, iconId: bigint): Promise<Buffer | null> {
        return StorageContainer.readUserCustomIcon(ctx, this.getUserCustomIconPath(uid, iconId));
    }

    public saveUserCustomIcon(ctx: Context, uid: bigint, iconId: bigint, object: Buffer): Promise<void> {
        return StorageContainer.saveUserCustomIcon(ctx, this.getUserCustomIconPath(uid, iconId), object);
    }

    public deleteUserCustomIcon(ctx: Context, uid: bigint, iconId: bigint): Promise<void> {
        return StorageContainer.deleteUserCustomIcon(ctx, this.getUserCustomIconPath(uid, iconId));
    }

    public existsTransactionPicture(ctx: Context, uid: bigint, pictureId: bigint, fileExtension: string): Promise<boolean> {
        return StorageContainer.existsTransactionPicture(ctx, this.getTransactionPicturePath(uid, pictureId, fileExtension));
    }

    public readTransactionPicture(ctx: Context, uid: bigint, pictureId: bigint, fileExtension: string): Promise<Buffer | null> {
        return StorageContainer.readTransactionPicture(ctx, this.getTransactionPicturePath(uid, pictureId, fileExtension));
    }

    public saveTransactionPicture(ctx: Context, uid: bigint, pictureId: bigint, object: Buffer, fileExtension: string): Promise<void> {
        return StorageContainer.saveTransactionPicture(ctx, this.getTransactionPicturePath(uid, pictureId, fileExtension), object);
    }

    public deleteTransactionPicture(ctx: Context, uid: bigint, pictureId: bigint, fileExtension: string): Promise<void> {
        return StorageContainer.deleteTransactionPicture(ctx, this.getTransactionPicturePath(uid, pictureId, fileExtension));
    }

    private getUserAvatarPath(uid: bigint, fileExtension: string): string {
        return `${uid}.${fileExtension}`;
    }

    private getTransactionPicturePath(uid: bigint, pictureId: bigint, fileExtension: string): string {
        return join(uid.toString(), `${pictureId}.${fileExtension}`);
    }

    private getUserCustomIconPath(uid: bigint, iconId: bigint): string {
        return join(uid.toString(), `${iconId}.${UserCustomIconFileExtension}`);
    }
}

// nowUnix returns current unix time in seconds
export function nowUnix(): number {
    return Math.floor(Date.now() / 1000);
}
