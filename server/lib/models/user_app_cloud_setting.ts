import { defineTable, type JsonCodec } from '../datastore/schema';

export type UserApplicationCloudSettingType = 'string' | 'number' | 'boolean' | 'string_boolean_map';

export const USER_APPLICATION_CLOUD_SETTING_TYPE_STRING: UserApplicationCloudSettingType = 'string';
export const USER_APPLICATION_CLOUD_SETTING_TYPE_NUMBER: UserApplicationCloudSettingType = 'number';
export const USER_APPLICATION_CLOUD_SETTING_TYPE_BOOLEAN: UserApplicationCloudSettingType = 'boolean';
export const USER_APPLICATION_CLOUD_SETTING_TYPE_STRING_BOOLEAN_MAP: UserApplicationCloudSettingType = 'string_boolean_map';

export const ALL_ALLOWED_CLOUD_SYNC_APP_SETTING_KEY_TYPES: Record<string, UserApplicationCloudSettingType> = {
    // Basic Settings
    'showAccountBalance': 'boolean',
    // Overview Page
    'accountCategoryOrders': 'string',
    'autoUpdateExchangeRatesData': 'boolean',
    'chartColors': 'string',
    'showAddTransactionButtonInDesktopNavbar': 'boolean',
    'desktopOverviewPageLayout': 'string',
    'mobileOverviewPageLayout': 'string',
    'showAmountInHomePage': 'boolean',
    'timezoneUsedForStatisticsInHomePage': 'number',
    'overviewAccountFilterInHomePage': 'string_boolean_map',
    'overviewTransactionCategoryFilterInHomePage': 'string_boolean_map',
    // Transaction List Page
    'itemsCountInTransactionListPage': 'number',
    'showTotalAmountInTransactionListPage': 'boolean',
    'showTagInTransactionListPage': 'boolean',
    'defaultKeywordMatchModeInTransactionListPage': 'number',
    'quickSaveButtonStyleInMobileTransactionListPage': 'number',
    // Transaction Edit Page
    'quickAddButtonActionInMobileTransactionEditPage': 'number',
    'autoSaveTransactionDraft': 'string',
    'autoGetCurrentGeoLocation': 'boolean',
    'alwaysShowTransactionPicturesInMobileTransactionEditPage': 'boolean',
    'transactionPictureQuality': 'number',
    'alwaysRequireConfirmationOfClipboardContentBeforeSubmission': 'boolean',
    'autoUploadTransactionPictureForAIRecognition': 'boolean',
    // Import Transaction Dialog
    'rememberLastSelectedFileTypeInImportTransactionDialog': 'boolean',
    'lastSelectedFileTypeInImportTransactionDialog': 'string',
    // Insights Explorer Page
    'insightsExplorerDefaultDateRangeType': 'number',
    'showTagInInsightsExplorerPage': 'boolean',
    // Account List Page
    'totalAmountExcludeAccountIds': 'string_boolean_map',
    'hideCategoriesWithoutAccounts': 'boolean',
    'defaultCreditCardAmountDisplayTypeInMobile': 'number',
    'reconciliationStatementButtonDefaultDateRangeTypeInDesktop': 'number',
    'reconciliationStatementPageDefaultDateRangeTypeInMobile': 'number',
    // Exchange Rates Data Page
    'currencySortByInExchangeRatesPage': 'number',
    // Browser Cache Settings
    'mapCacheExpiration': 'number',
    'exchangeRatesDataCacheExpiration': 'number',
    // Statistics Settings
    'statistics.defaultChartDataType': 'number',
    'statistics.defaultTimezoneType': 'number',
    'statistics.defaultAccountFilter': 'string_boolean_map',
    'statistics.defaultTransactionCategoryFilter': 'string_boolean_map',
    'statistics.defaultKeywordMatchMode': 'number',
    'statistics.defaultSortingType': 'number',
    'statistics.defaultCategoricalChartType': 'number',
    'statistics.defaultCategoricalChartDataRangeType': 'number',
    'statistics.defaultTrendChartType': 'number',
    'statistics.defaultTrendChartDataRangeType': 'number',
    'statistics.defaultAssetTrendsChartType': 'number',
    'statistics.defaultAssetTrendsChartDataRangeType': 'number',
};

// ApplicationCloudSetting represents a user application setting item
export interface ApplicationCloudSetting {
    settingKey: string;
    settingValue: string;
}

export const ApplicationCloudSettingSliceCodec: JsonCodec = {
    encode(value: unknown): string {
        const settings = (value as ApplicationCloudSetting[] | null) ?? null;

        if (settings === null) {
            return 'null';
        }

        return JSON.stringify(settings.map(s => ({ settingKey: s.settingKey, settingValue: s.settingValue })));
    },
    decode(text: string): unknown {
        const data = JSON.parse(text) as unknown;

        if (!Array.isArray(data)) {
            return null;
        }

        return data.map(item => ({
            settingKey: String((item as Record<string, unknown>)['settingKey'] ?? ''),
            settingValue: String((item as Record<string, unknown>)['settingValue'] ?? ''),
        }));
    },
};

// UserApplicationCloudSetting represents user application cloud settings stored in database
export interface UserApplicationCloudSetting {
    uid: bigint;
    settings: ApplicationCloudSetting[] | null;
    updatedUnixTime: number;
}

export const UserApplicationCloudSettingTable = defineTable<UserApplicationCloudSetting>('user_application_cloud_setting', [
    ['uid', 'id', { pk: true }],
    ['settings', 'json', { codec: ApplicationCloudSettingSliceCodec }],
    ['updated_unix_time', 'i64'],
]);

export interface UserApplicationCloudSettingsUpdateRequest {
    settings: ApplicationCloudSetting[] | null;
    fullUpdate: boolean;
}

export function sortApplicationCloudSettings(s: ApplicationCloudSetting[]): ApplicationCloudSetting[] {
    return s.sort((a, b) => (a.settingKey < b.settingKey ? -1 : a.settingKey > b.settingKey ? 1 : 0));
}
