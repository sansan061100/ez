import * as errs from '../errs/index';
import type { User } from '../models/index';
import type { Config } from '../settings/settings';
import { md5EncodeToString } from '../utils/strings';

// AvatarProvider is common avatar provider interface
export interface AvatarProvider {
    getAvatarUrl(user: User): string;
}

// InternalStorageAvatarProvider represents the internal storage avatar provider
export class InternalStorageAvatarProvider implements AvatarProvider {
    private readonly webRootUrl: string;

    public constructor(config: Config) {
        this.webRootUrl = config.rootUrl;
    }

    public getAvatarUrl(user: User): string {
        if (user.customAvatarType === '') {
            return '';
        }

        return `${this.webRootUrl}avatar/${user.uid}.${user.customAvatarType}`;
    }
}

// GravatarAvatarProvider represents the gravatar avatar provider
export class GravatarAvatarProvider implements AvatarProvider {
    public getAvatarUrl(user: User): string {
        const email = user.email.trim().toLowerCase();
        return `https://www.gravatar.com/avatar/${md5EncodeToString(email)}`;
    }
}

// NullAvatarProvider represents the null avatar provider
export class NullAvatarProvider implements AvatarProvider {
    public getAvatarUrl(_user: User): string {
        return '';
    }
}

class AvatarProviderContainer {
    public current: AvatarProvider | null = null;

    public getAvatarUrl(user: User): string {
        return this.current ? this.current.getAvatarUrl(user) : '';
    }
}

export const Container = new AvatarProviderContainer();

export function initializeAvatarProvider(config: Config): void {
    if (config.avatarProvider === 'internal') {
        Container.current = new InternalStorageAvatarProvider(config);
    } else if (config.avatarProvider === 'gravatar') {
        Container.current = new GravatarAvatarProvider();
    } else if (config.avatarProvider === '') {
        Container.current = new NullAvatarProvider();
    } else {
        throw errs.ErrInvalidAvatarProvider;
    }
}
