import { getUserExternalAuthTypeCategory } from '../core/types';
import { defineTable } from '../datastore/schema';

// UserExternalAuth represents user external auth data stored in database
export interface UserExternalAuth {
    uid: bigint;
    externalAuthType: string;
    externalUsername: string;
    externalEmail: string;
    createdUnixTime: number;
}

const uqeAuthTypeUsername = 'uqe_userexternalauth_authtype_username';
const uqeAuthTypeEmail = 'uqe_userexternalauth_authtype_email';

export const UserExternalAuthTable = defineTable<UserExternalAuth>('user_external_auth', [
    ['uid', 'id', { pk: true }],
    ['external_auth_type', 'str', { length: 32, pk: true, unique: [uqeAuthTypeUsername, uqeAuthTypeEmail] }],
    ['external_username', 'str', { length: 32, notNull: true, unique: [uqeAuthTypeUsername] }],
    ['external_email', 'str', { length: 100, notNull: true, unique: [uqeAuthTypeEmail] }],
    ['created_unix_time', 'i64'],
]);

export interface UserExternalAuthUnlinkRequest {
    externalAuthType: string;
    password: string;
}

export interface UserExternalAuthInfoResponse {
    externalAuthCategory: string;
    externalAuthType: string;
    linked: boolean;
    externalUsername?: string;
    createdAt?: number;
}

export function toUserExternalAuthInfoResponse(a: UserExternalAuth): UserExternalAuthInfoResponse {
    const ret: UserExternalAuthInfoResponse = {
        externalAuthCategory: getUserExternalAuthTypeCategory(a.externalAuthType),
        externalAuthType: a.externalAuthType,
        linked: true,
    };

    if (a.externalUsername !== '') {
        ret.externalUsername = a.externalUsername;
    }

    if (a.createdUnixTime !== 0) {
        ret.createdAt = a.createdUnixTime;
    }

    return ret;
}

export function sortUserExternalAuthInfoResponses(s: UserExternalAuthInfoResponse[]): UserExternalAuthInfoResponse[] {
    return s.sort((a, b) => {
        if (a.linked && !b.linked) {
            return -1;
        } else if (!a.linked && b.linked) {
            return 1;
        } else if (!a.linked && !b.linked) {
            return a.externalAuthType < b.externalAuthType ? -1 : a.externalAuthType > b.externalAuthType ? 1 : 0;
        }

        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
}
