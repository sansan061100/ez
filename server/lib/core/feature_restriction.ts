// UserFeatureRestrictions is a bit set of UserFeatureRestrictionType
export type UserFeatureRestrictions = number;
export type UserFeatureRestrictionType = number;

export const USER_FEATURE_RESTRICTION_TYPE_UPDATE_PASSWORD = 1;
export const USER_FEATURE_RESTRICTION_TYPE_UPDATE_EMAIL = 2;
export const USER_FEATURE_RESTRICTION_TYPE_UPDATE_PROFILE_BASIC_INFO = 3;
export const USER_FEATURE_RESTRICTION_TYPE_UPDATE_AVATAR = 4;
export const USER_FEATURE_RESTRICTION_TYPE_REVOKE_OTHER_SESSION = 5;
export const USER_FEATURE_RESTRICTION_TYPE_ENABLE_2FA = 6;
export const USER_FEATURE_RESTRICTION_TYPE_DISABLE_2FA = 7;
export const USER_FEATURE_RESTRICTION_TYPE_FORGET_PASSWORD = 8;
export const USER_FEATURE_RESTRICTION_TYPE_IMPORT_TRANSACTION = 9;
export const USER_FEATURE_RESTRICTION_TYPE_EXPORT_TRANSACTION = 10;
export const USER_FEATURE_RESTRICTION_TYPE_CLEAR_ALL_DATA = 11;
export const USER_FEATURE_RESTRICTION_TYPE_SYNC_APPLICATION_SETTINGS = 12;
export const USER_FEATURE_RESTRICTION_TYPE_MCP_ACCESS = 13;
export const USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_IMAGE_RECOGNITION = 14;
export const USER_FEATURE_RESTRICTION_TYPE_OAUTH2_LOGIN = 15;
export const USER_FEATURE_RESTRICTION_TYPE_UNLINK_THIRD_PARTY_LOGIN = 16;
export const USER_FEATURE_RESTRICTION_TYPE_GENERATE_API_TOKEN = 17;
export const USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_TEXT_RECOGNITION = 18;
export const USER_FEATURE_RESTRICTION_TYPE_UPLOAD_CUSTOM_ICON = 19;

const userFeatureRestrictionTypeMinValue = USER_FEATURE_RESTRICTION_TYPE_UPDATE_PASSWORD;
const userFeatureRestrictionTypeMaxValue = USER_FEATURE_RESTRICTION_TYPE_UPLOAD_CUSTOM_ICON;

const featureRestrictionTypeNames: Record<number, string> = {
    1: 'Update Password',
    2: 'Update Email',
    3: 'Update Profile Basic Info',
    4: 'Update Avatar',
    5: 'Logout Other Session',
    6: 'Enable Two-Factor Authentication',
    7: 'Disable Enable Two-Factor Authentication',
    8: 'Forget Password',
    9: 'Import Transactions',
    10: 'Export Transactions',
    11: 'Clear All Data',
    12: 'Sync Application Settings',
    13: 'MCP (Model Context Protocol) Access',
    14: 'Create Transaction from AI Image Recognition',
    15: 'OAuth 2.0 Login',
    16: 'Unlink Third-Party Login',
    17: 'Generate API Token',
    18: 'Create Transaction from AI Text Recognition',
    19: 'Upload Custom Icon',
};

export function userFeatureRestrictionTypeName(t: UserFeatureRestrictionType): string {
    return featureRestrictionTypeNames[t] ?? `Invalid(${t})`;
}

function typeBit(t: UserFeatureRestrictionType): number {
    return 2 ** (t - 1);
}

export function addFeatureRestriction(r: UserFeatureRestrictions, t: UserFeatureRestrictionType): UserFeatureRestrictions {
    return containsFeatureRestriction(r, t) ? r : r + typeBit(t);
}

export function removeFeatureRestriction(r: UserFeatureRestrictions, t: UserFeatureRestrictionType): UserFeatureRestrictions {
    return containsFeatureRestriction(r, t) ? r - typeBit(t) : r;
}

export function containsFeatureRestriction(r: UserFeatureRestrictions, t: UserFeatureRestrictionType): boolean {
    return Math.floor(r / typeBit(t)) % 2 === 1;
}

export function featureRestrictionsToString(r: UserFeatureRestrictions): string {
    const names: string[] = [];

    for (let t = userFeatureRestrictionTypeMinValue; t <= userFeatureRestrictionTypeMaxValue; t++) {
        if (containsFeatureRestriction(r, t)) {
            names.push(userFeatureRestrictionTypeName(t));
        }
    }

    return names.join(',');
}

export function parseUserFeatureRestrictions(featureRestrictions: string): UserFeatureRestrictions {
    if (!featureRestrictions) {
        return 0;
    }

    let restrictions = 0;

    for (const item of featureRestrictions.split(',')) {
        if (!/^[+-]?\d+$/.test(item)) {
            continue;
        }

        const value = parseInt(item, 10);

        if (userFeatureRestrictionTypeMinValue <= value && value <= userFeatureRestrictionTypeMaxValue) {
            restrictions = addFeatureRestriction(restrictions, value);
        }
    }

    return restrictions;
}
