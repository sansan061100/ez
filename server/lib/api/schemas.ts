// Request schemas which are the same as the binding tags of go request models

import { f, objOf, schema } from '../web/binding';

// account.go
const accountCreateRequestFields = [
    f.str('Name', 'name', 'required,notBlank,max=64'),
    f.u8('Category', 'category', 'required'),
    f.u8('Type', 'type', 'required'),
    f.i64s('Icon', 'icon', 'required,min=1'),
    f.u8('IconType', 'iconType', 'min=0,max=1'),
    f.str('Color', 'color', 'required,len=6,validHexRGBColor'),
    f.str('Currency', 'currency', 'required,len=3,validCurrency'),
    f.str('Balance', 'balance', 'validTransactionAmount'),
    f.i64('BalanceTime', 'balanceTime'),
    f.str('Comment', 'comment', 'max=255'),
    f.int('CreditCardStatementDate', 'creditCardStatementDate', 'int', 'min=0,max=28'),
    f.str('CreditCardLimit', 'creditCardLimit', 'omitempty,validTransactionAmount'),
];

export const AccountCreateRequestSchema = schema(...accountCreateRequestFields);
AccountCreateRequestSchema.fields.push(
    f.arr('SubAccounts', 'subAccounts', objOf(AccountCreateRequestSchema), 'omitempty'),
    f.str('ClientSessionId', 'clientSessionId'),
);

export const AccountModifyRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=0'),
    f.str('Name', 'name', 'required,notBlank,max=64'),
    f.u8('Category', 'category', 'required'),
    f.i64s('Icon', 'icon', 'min=1'),
    f.u8('IconType', 'iconType', 'min=0,max=1'),
    f.str('Color', 'color', 'required,len=6,validHexRGBColor'),
    f.str('Currency', 'currency', 'omitempty,len=3,validCurrency', { ptr: true }),
    f.str('Balance', 'balance', 'omitempty,validTransactionAmount', { ptr: true }),
    f.i64('BalanceTime', 'balanceTime', 'omitempty', { ptr: true }),
    f.i64('LastReconciledTime', 'lastReconciledTime', 'omitempty', { ptr: true }),
    f.str('Comment', 'comment', 'max=255'),
    f.int('CreditCardStatementDate', 'creditCardStatementDate', 'int', 'min=0,max=28'),
    f.str('CreditCardLimit', 'creditCardLimit', 'omitempty,validTransactionAmount'),
    f.bool('Hidden', 'hidden'),
);
AccountModifyRequestSchema.fields.push(
    f.arr('SubAccounts', 'subAccounts', objOf(AccountModifyRequestSchema), 'omitempty'),
    f.str('ClientSessionId', 'clientSessionId'),
);

export const AccountUpdateLastReconciledTimeRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    f.i64('LastReconciledTime', 'lastReconciledTime', 'required'),
);

export const AccountListRequestSchema = schema(
    f.bool('VisibleOnly', 'visible_only'),
);

export const IdQueryRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
);

export const IdHideRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    f.bool('Hidden', 'hidden'),
);

export const NewDisplayOrderRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    f.i32('DisplayOrder', 'displayOrder'),
);

export const MoveRequestSchema = schema(
    f.arr('NewDisplayOrders', 'newDisplayOrders', objOf(NewDisplayOrderRequestSchema), 'required,min=1'),
);

export const IdDeleteRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
);

// data_management.go
export const ClearDataRequestSchema = schema(
    f.str('Password', 'password', 'omitempty,min=6,max=128'),
);

export const ClearAccountTransactionsRequestSchema = schema(
    f.i64s('AccountId', 'accountId', 'required,min=1'),
    f.str('Password', 'password', 'omitempty,min=6,max=128'),
);

export const ExportTransactionDataRequestSchema = schema(
    f.u8('Type', 'type', 'min=0,max=4'),
    f.str('CategoryIds', 'category_ids'),
    f.str('AccountIds', 'account_ids'),
    f.str('TagFilter', 'tag_filter', 'validTagFilter'),
    f.str('AmountFilter', 'amount_filter', 'validAmountFilter'),
    f.str('Keyword', 'keyword'),
    f.u8('MatchMode', 'match_mode', 'min=0,max=1'),
    f.i64('MaxTime', 'max_time', 'min=0'),
    f.i64('MinTime', 'min_time', 'min=0'),
);

// budget.ts
export const BudgetSaveItemRequestSchema = schema(
    f.i64s('CategoryId', 'categoryId', 'min=0'),
    f.i64('Amount', 'amount', 'required,min=1,max=999999999999999'),
);

export const BudgetSaveRequestSchema = schema(
    f.arr('Budgets', 'budgets', objOf(BudgetSaveItemRequestSchema), 'max=1000'),
);

// exchange_rate.go
export const UserCustomExchangeRateUpdateRequestSchema = schema(
    f.str('Currency', 'currency', 'required,len=3,validCurrency'),
    f.str('Rate', 'rate'),
);

export const UserCustomExchangeRateDeleteRequestSchema = schema(
    f.str('Currency', 'currency', 'required,len=3,validCurrency'),
);

// explorer.go
export const InsightsExplorerCreateRequestSchema = schema(
    f.str('Name', 'name', 'required,notBlank,max=64'),
    f.any('Data', 'data', 'required'),
    f.str('ClientSessionId', 'clientSessionId'),
);

export const InsightsExplorerModifyRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=0'),
    f.str('Name', 'name', 'required,notBlank,max=64'),
    f.any('Data', 'data', 'required'),
    f.bool('Hidden', 'hidden'),
    f.str('ClientSessionId', 'clientSessionId'),
);

// forget_password.go
export const ForgetPasswordRequestSchema = schema(
    f.str('Email', 'email', 'required,notBlank,max=100,validEmail'),
);

export const PasswordResetRequestSchema = schema(
    f.str('Email', 'email', 'required,notBlank,max=100,validEmail'),
    f.str('Password', 'password', 'required,min=6,max=128'),
);

// large_language_model.go
export const TransactionTextRecognitionRequestSchema = schema(
    f.str('Text', 'text'),
);

// oauth2.go
export const OAuth2LoginRequestSchema = schema(
    f.str('Platform', 'platform', 'required'),
    f.str('ClientSessionId', 'client_session_id', 'required'),
    f.str('Token', 'token'),
);

export const OAuth2CallbackRequestSchema = schema(
    f.str('State', 'state'),
    f.str('Code', 'code'),
    f.str('Error', 'error'),
    f.str('ErrorDescription', 'error_description'),
);

export const OAuth2CallbackLoginRequestSchema = schema(
    f.str('Password', 'password', 'omitempty,min=6,max=128'),
    f.str('Passcode', 'passcode', 'omitempty,notBlank,len=6'),
    f.str('Token', 'token', 'omitempty'),
);

// token_record.go
export const TokenGenerateRequestSchema = schema(
    f.i64('ExpiredInSeconds', 'expiresInSeconds', 'omitempty,min=0,max=4294967295'),
    f.str('Password', 'password', 'omitempty,min=6,max=128'),
);

export const TokenRevokeRequestSchema = schema(
    f.str('TokenId', 'tokenId', 'required,notBlank'),
);

// transaction_category.go
export const TransactionCategoryListRequestSchema = schema(
    f.u8('Type', 'type', 'min=0'),
    f.i64s('ParentId', 'parent_id', 'min=-1', { defaultValue: '-1' }),
);

export const TransactionCategoryCreateRequestSchema = schema(
    f.str('Name', 'name', 'required,notBlank,max=64'),
    f.u8('Type', 'type', 'required'),
    f.i64s('ParentId', 'parentId', 'min=0'),
    f.i64s('Icon', 'icon', 'min=1'),
    f.u8('IconType', 'iconType', 'min=0,max=1'),
    f.str('Color', 'color', 'required,len=6,validHexRGBColor'),
    f.str('Comment', 'comment', 'max=255'),
    f.str('ClientSessionId', 'clientSessionId'),
);

export const TransactionCategoryCreateWithSubCategoriesSchema = schema(
    f.str('Name', 'name', 'required,notBlank,max=64'),
    f.u8('Type', 'type', 'required'),
    f.i64s('Icon', 'icon', 'min=1'),
    f.u8('IconType', 'iconType', 'min=0,max=1'),
    f.str('Color', 'color', 'required,len=6,validHexRGBColor'),
    f.str('Comment', 'comment', 'max=255'),
    f.arr('SubCategories', 'subCategories', objOf(TransactionCategoryCreateRequestSchema), 'required'),
);

export const TransactionCategoryCreateBatchRequestSchema = schema(
    f.arr('Categories', 'categories', objOf(TransactionCategoryCreateWithSubCategoriesSchema), 'required'),
);

export const TransactionCategoryModifyRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    f.str('Name', 'name', 'required,notBlank,max=64'),
    f.i64s('ParentId', 'parentId', 'min=0'),
    f.i64s('Icon', 'icon', 'min=1'),
    f.u8('IconType', 'iconType', 'min=0,max=1'),
    f.str('Color', 'color', 'required,len=6,validHexRGBColor'),
    f.str('Comment', 'comment', 'max=255'),
    f.bool('Hidden', 'hidden'),
);

// transaction_tag.go
export const TransactionTagCreateRequestSchema = schema(
    f.i64s('GroupId', 'groupId'),
    f.str('Name', 'name', 'required,notBlank,max=64'),
);

export const TransactionTagCreateBatchRequestSchema = schema(
    f.arr('Tags', 'tags', objOf(TransactionTagCreateRequestSchema), 'required'),
    f.i64s('GroupId', 'groupId'),
    f.bool('SkipExists', 'skipExists'),
);

export const TransactionTagModifyRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    f.i64s('GroupId', 'groupId'),
    f.str('Name', 'name', 'required,notBlank,max=64'),
);

// transaction_tag_group.go
export const TransactionTagGroupCreateRequestSchema = schema(
    f.str('Name', 'name', 'required,notBlank,max=64'),
);

export const TransactionTagGroupModifyRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    f.str('Name', 'name', 'required,notBlank,max=64'),
);

// transaction_picture_info.go
export const TransactionPictureUnusedDeleteRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
);

// transaction.go
const TransactionGeoLocationRequestSchema = schema(
    f.float('Latitude', 'latitude', 'required'),
    f.float('Longitude', 'longitude', 'required'),
);

export const TransactionCreateRequestSchema = schema(
    f.u8('Type', 'type', 'required'),
    f.i64s('CategoryId', 'categoryId'),
    f.i64('Time', 'time', 'required,min=1'),
    f.i16('UtcOffset', 'utcOffset', 'min=-720,max=840'),
    f.i64s('SourceAccountId', 'sourceAccountId', 'required,min=1'),
    f.i64s('DestinationAccountId', 'destinationAccountId', 'min=0'),
    f.i64('SourceAmount', 'sourceAmount', 'validTransactionAmount'),
    f.i64('DestinationAmount', 'destinationAmount', 'validTransactionAmount'),
    f.bool('HideAmount', 'hideAmount'),
    f.strArr('TagIds', 'tagIds'),
    f.strArr('PictureIds', 'pictureIds'),
    f.str('Comment', 'comment', 'max=255'),
    f.obj('GeoLocation', 'geoLocation', TransactionGeoLocationRequestSchema, 'omitempty', { ptr: true }),
    f.str('ClientSessionId', 'clientSessionId'),
);

export const TransactionModifyRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    f.u8('Type', 'type', 'required'),
    f.i64s('CategoryId', 'categoryId'),
    f.i64('Time', 'time', 'required,min=1'),
    f.i16('UtcOffset', 'utcOffset', 'min=-720,max=840'),
    f.i64s('SourceAccountId', 'sourceAccountId', 'required,min=1'),
    f.i64s('DestinationAccountId', 'destinationAccountId', 'min=0'),
    f.i64('SourceAmount', 'sourceAmount', 'validTransactionAmount'),
    f.i64('DestinationAmount', 'destinationAmount', 'validTransactionAmount'),
    f.bool('HideAmount', 'hideAmount'),
    f.strArr('TagIds', 'tagIds'),
    f.strArr('PictureIds', 'pictureIds'),
    f.str('Comment', 'comment', 'max=255'),
    f.obj('GeoLocation', 'geoLocation', TransactionGeoLocationRequestSchema, 'omitempty', { ptr: true }),
);

export const TransactionImportRequestSchema = schema(
    f.arr('Transactions', 'transactions', objOf(TransactionCreateRequestSchema)),
    f.str('ClientSessionId', 'clientSessionId'),
);

export const TransactionImportProcessRequestSchema = schema(
    f.str('ClientSessionId', 'client_session_id'),
);

const transactionQueryFilterFields = [
    f.u8('Type', 'type', 'min=0,max=4'),
    f.str('CategoryIds', 'category_ids'),
    f.str('AccountIds', 'account_ids'),
    f.str('TagFilter', 'tag_filter', 'validTagFilter'),
    f.str('AmountFilter', 'amount_filter', 'validAmountFilter'),
    f.str('Keyword', 'keyword'),
    f.u8('MatchMode', 'match_mode', 'min=0,max=1'),
    f.bool('MustHavePictures', 'must_have_pictures'),
];

export const TransactionCountRequestSchema = schema(
    ...transactionQueryFilterFields,
    f.i64('MaxTime', 'max_time', 'min=0'),
    f.i64('MinTime', 'min_time', 'min=0'),
);

export const TransactionListByMaxTimeRequestSchema = schema(
    ...transactionQueryFilterFields,
    f.i64('MaxTime', 'max_time', 'min=0'),
    f.i64('MinTime', 'min_time', 'min=0'),
    f.i32('Page', 'page', 'min=0'),
    f.i32('Count', 'count', 'required,min=1,max=50'),
    f.bool('WithCount', 'with_count'),
    f.bool('WithPictures', 'with_pictures'),
    f.bool('TrimAccount', 'trim_account'),
    f.bool('TrimCategory', 'trim_category'),
    f.bool('TrimTag', 'trim_tag'),
);

export const TransactionListInMonthByPageRequestSchema = schema(
    f.i32('Year', 'year', 'required,min=1'),
    f.i32('Month', 'month', 'required,min=1'),
    ...transactionQueryFilterFields,
    f.bool('WithPictures', 'with_pictures'),
    f.bool('TrimAccount', 'trim_account'),
    f.bool('TrimCategory', 'trim_category'),
    f.bool('TrimTag', 'trim_tag'),
);

export const TransactionAllListRequestSchema = schema(
    ...transactionQueryFilterFields,
    f.i64('StartTime', 'start_time', 'min=0'),
    f.i64('EndTime', 'end_time', 'min=0'),
    f.bool('WithPictures', 'with_pictures'),
    f.bool('TrimAccount', 'trim_account'),
    f.bool('TrimCategory', 'trim_category'),
    f.bool('TrimTag', 'trim_tag'),
);

export const TransactionReconciliationStatementRequestSchema = schema(
    f.i64s('AccountId', 'account_id', 'required,min=1'),
    f.i64('StartTime', 'start_time'),
    f.i64('EndTime', 'end_time'),
);

export const TransactionStatisticRequestSchema = schema(
    f.i64('StartTime', 'start_time', 'min=0'),
    f.i64('EndTime', 'end_time', 'min=0'),
    f.str('TagFilter', 'tag_filter', 'validTagFilter'),
    f.str('Keyword', 'keyword'),
    f.u8('MatchMode', 'match_mode', 'min=0,max=1'),
    f.bool('UseTransactionTimezone', 'use_transaction_timezone'),
);

const YearMonthRangeRequestSchema = schema(
    f.str('StartYearMonth', 'start_year_month'),
    f.str('EndYearMonth', 'end_year_month'),
);

export const TransactionStatisticTrendsRequestSchema = schema(
    f.embed(YearMonthRangeRequestSchema),
    f.str('TagFilter', 'tag_filter', 'validTagFilter'),
    f.str('Keyword', 'keyword'),
    f.u8('MatchMode', 'match_mode', 'min=0,max=1'),
    f.bool('UseTransactionTimezone', 'use_transaction_timezone'),
);

export const TransactionStatisticAssetTrendsRequestSchema = schema(
    f.i64('StartTime', 'start_time'),
    f.i64('EndTime', 'end_time'),
);

export const TransactionAmountsRequestSchema = schema(
    f.str('Query', 'query'),
    f.str('ExcludeAccountIds', 'exclude_account_ids'),
    f.str('ExcludeCategoryIds', 'exclude_category_ids'),
    f.bool('UseTransactionTimezone', 'use_transaction_timezone'),
);

export const TransactionDailyAmountsRequestSchema = schema(
    f.i64('StartTime', 'start_time', 'required,min=1'),
    f.i64('EndTime', 'end_time', 'required,min=1'),
    f.str('ExcludeAccountIds', 'exclude_account_ids'),
    f.str('ExcludeCategoryIds', 'exclude_category_ids'),
    f.bool('UseTransactionTimezone', 'use_transaction_timezone'),
);

export const TransactionGetRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    f.bool('WithPictures', 'with_pictures'),
    f.bool('TrimAccount', 'trim_account'),
    f.bool('TrimCategory', 'trim_category'),
    f.bool('TrimTag', 'trim_tag'),
);

export const TransactionBatchUpdateCategoryRequestSchema = schema(
    f.strArr('TransactionIds', 'transactionIds', 'required'),
    f.i64s('CategoryId', 'categoryId', 'required'),
);

export const TransactionBatchUpdateAccountRequestSchema = schema(
    f.strArr('TransactionIds', 'transactionIds', 'required'),
    f.i64s('AccountId', 'accountId', 'required'),
    f.bool('IsDestinationAccount', 'isDestinationAccount'),
);

export const TransactionBatchTagsRequestSchema = schema(
    f.strArr('TransactionIds', 'transactionIds', 'required'),
    f.strArr('TagIds', 'tagIds', 'required'),
);

export const TransactionBatchClearTagsRequestSchema = schema(
    f.strArr('TransactionIds', 'transactionIds', 'required'),
);

export const TransactionMoveBetweenAccountsRequestSchema = schema(
    f.i64s('FromAccountId', 'fromAccountId', 'required,min=1'),
    f.i64s('ToAccountId', 'toAccountId', 'required,min=1'),
);

export const TransactionBatchDeleteRequestSchema = schema(
    f.strArr('Ids', 'ids', 'required'),
    f.str('Password', 'password', 'omitempty,min=6,max=128'),
);

// transaction_template.go
export const TransactionTemplateListRequestSchema = schema(
    f.u8('TemplateType', 'templateType'),
);

const transactionTemplateCommonFields = [
    f.str('Name', 'name', 'required,notBlank,max=64'),
    f.u8('Type', 'type', 'required'),
    f.i64s('CategoryId', 'categoryId', 'required,min=1'),
    f.i64s('SourceAccountId', 'sourceAccountId', 'required,min=1'),
    f.i64s('DestinationAccountId', 'destinationAccountId', 'min=0'),
    f.i64('SourceAmount', 'sourceAmount', 'validTransactionAmount'),
    f.i64('DestinationAmount', 'destinationAmount', 'validTransactionAmount'),
    f.bool('HideAmount', 'hideAmount'),
    f.strArr('TagIds', 'tagIds'),
    f.str('Comment', 'comment', 'max=255'),
    f.u8('ScheduledFrequencyType', 'scheduledFrequencyType', 'omitempty', { ptr: true }),
    f.str('ScheduledFrequency', 'scheduledFrequency', 'omitempty', { ptr: true }),
    f.str('ScheduledStartDate', 'scheduledStartDate', 'omitempty', { ptr: true }),
    f.str('ScheduledEndDate', 'scheduledEndDate', 'omitempty', { ptr: true }),
    f.i16('ScheduledTimezoneUtcOffset', 'utcOffset', 'omitempty,min=-720,max=840', { ptr: true }),
];

export const TransactionTemplateCreateRequestSchema = schema(
    f.u8('TemplateType', 'templateType'),
    ...transactionTemplateCommonFields,
    f.str('ClientSessionId', 'clientSessionId'),
);

export const TransactionTemplateModifyRequestSchema = schema(
    f.i64s('Id', 'id', 'required,min=1'),
    ...transactionTemplateCommonFields,
);

// two_factor.go
export const TwoFactorLoginRequestSchema = schema(
    f.str('Passcode', 'passcode', 'required,notBlank,len=6'),
);

export const TwoFactorEnableConfirmRequestSchema = schema(
    f.str('Secret', 'secret', 'required,notBlank,len=32'),
    f.str('Passcode', 'passcode', 'required,notBlank,len=6'),
);

export const PasswordRequestSchema = schema(
    f.str('Password', 'password', 'omitempty,min=6,max=128'),
);

export const TwoFactorRecoveryCodeLoginRequestSchema = schema(
    f.str('RecoveryCode', 'recoveryCode', 'required,notBlank,len=11'),
);

// user_app_cloud_setting.go
const ApplicationCloudSettingSchema = schema(
    f.str('SettingKey', 'settingKey'),
    f.str('SettingValue', 'settingValue'),
);

export const UserApplicationCloudSettingsUpdateRequestSchema = schema(
    f.arr('Settings', 'settings', objOf(ApplicationCloudSettingSchema)),
    f.bool('FullUpdate', 'fullUpdate'),
);

// user_external_auth.go
export const UserExternalAuthUnlinkRequestSchema = schema(
    f.str('ExternalAuthType', 'externalAuthType', 'required,notBlank'),
    f.str('Password', 'password', 'required,min=6,max=128'),
);

// user.go
export const UserLoginRequestSchema = schema(
    f.str('LoginName', 'loginName', 'required,notBlank,max=100,validUsername|validEmail'),
    f.str('Password', 'password', 'required,min=6,max=128'),
);

export const UserRegisterRequestSchema = schema(
    f.str('Username', 'username', 'required,notBlank,max=32,validUsername'),
    f.str('Email', 'email', 'required,notBlank,max=100,validEmail'),
    f.str('Nickname', 'nickname', 'required,notBlank,max=64,validNickname'),
    f.str('Password', 'password', 'required,min=6,max=128'),
    f.str('Language', 'language', 'required,min=2,max=16'),
    f.str('DefaultCurrency', 'defaultCurrency', 'required,len=3,validCurrency'),
    f.u8('FirstDayOfWeek', 'firstDayOfWeek', 'min=0,max=6'),
    f.embed(TransactionCategoryCreateBatchRequestSchema),
);

export const UserVerifyEmailRequestSchema = schema(
    f.bool('RequestNewToken', 'requestNewToken', 'omitempty'),
);

export const UserResendVerifyEmailRequestSchema = schema(
    f.str('Email', 'email', 'omitempty,max=100,validEmail'),
    f.str('Password', 'password', 'omitempty,min=6,max=128'),
);

export const UserProfileUpdateRequestSchema = schema(
    f.str('Email', 'email', 'omitempty,notBlank,max=100,validEmail'),
    f.str('Nickname', 'nickname', 'omitempty,notBlank,max=64,validNickname'),
    f.str('Password', 'password', 'omitempty,min=6,max=128'),
    f.str('OldPassword', 'oldPassword', 'omitempty,min=6,max=128'),
    f.i64s('DefaultAccountId', 'defaultAccountId', 'omitempty,min=1'),
    f.bool('UseLastReconciledTime', 'useLastReconciledTime', 'omitempty', { ptr: true }),
    f.u8('TransactionEditScope', 'transactionEditScope', 'omitempty,min=0,max=7', { ptr: true }),
    f.str('Language', 'language', 'omitempty,min=2,max=16'),
    f.str('DefaultCurrency', 'defaultCurrency', 'omitempty,len=3,validCurrency'),
    f.u8('FirstDayOfWeek', 'firstDayOfWeek', 'omitempty,min=0,max=6', { ptr: true }),
    f.int('FiscalYearStart', 'fiscalYearStart', 'uint16', 'omitempty,validFiscalYearStart', { ptr: true }),
    f.u8('CalendarDisplayType', 'calendarDisplayType', 'omitempty,min=0,max=4', { ptr: true }),
    f.u8('DateDisplayType', 'dateDisplayType', 'omitempty,min=0,max=3', { ptr: true }),
    f.u8('LongDateFormat', 'longDateFormat', 'omitempty,min=0,max=3', { ptr: true }),
    f.u8('ShortDateFormat', 'shortDateFormat', 'omitempty,min=0,max=3', { ptr: true }),
    f.u8('LongTimeFormat', 'longTimeFormat', 'omitempty,min=0,max=3', { ptr: true }),
    f.u8('ShortTimeFormat', 'shortTimeFormat', 'omitempty,min=0,max=3', { ptr: true }),
    f.u8('FiscalYearFormat', 'fiscalYearFormat', 'omitempty,min=0,max=5', { ptr: true }),
    f.u8('CurrencyDisplayType', 'currencyDisplayType', 'omitempty,min=0,max=11', { ptr: true }),
    f.u8('NumeralSystem', 'numeralSystem', 'omitempty,min=0,max=5', { ptr: true }),
    f.u8('DecimalSeparator', 'decimalSeparator', 'omitempty,min=0,max=3', { ptr: true }),
    f.u8('DigitGroupingSymbol', 'digitGroupingSymbol', 'omitempty,min=0,max=4', { ptr: true }),
    f.u8('DigitGrouping', 'digitGrouping', 'omitempty,min=0,max=3', { ptr: true }),
    f.u8('CoordinateDisplayType', 'coordinateDisplayType', 'omitempty,min=0,max=6', { ptr: true }),
    f.u8('ExpenseAmountColor', 'expenseAmountColor', 'omitempty,min=0,max=4', { ptr: true }),
    f.u8('IncomeAmountColor', 'incomeAmountColor', 'omitempty,min=0,max=4', { ptr: true }),
);
