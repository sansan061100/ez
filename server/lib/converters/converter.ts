import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import {
    type Account,
    CATEGORY_TYPE_EXPENSE,
    CATEGORY_TYPE_INCOME,
    CATEGORY_TYPE_TRANSFER,
    type ImportTransaction,
    LevelOneTransactionCategoryParentId,
    newAccount,
    newTransaction,
    newTransactionCategory,
    newTransactionTag,
    sortImportedTransactions,
    type Transaction,
    type TransactionCategory,
    type TransactionCategoryType,
    type TransactionDbType,
    type TransactionTag,
    type TransactionType,
    transactionDbTypeToTransactionType,
    TRANSACTION_DB_TYPE_EXPENSE,
    TRANSACTION_DB_TYPE_INCOME,
    TRANSACTION_DB_TYPE_MODIFY_BALANCE,
    TRANSACTION_DB_TYPE_TRANSFER_IN,
    TRANSACTION_DB_TYPE_TRANSFER_OUT,
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_MODIFY_BALANCE,
    TRANSACTION_TYPE_TRANSFER,
    type User,
} from '../models/index';
import type { Config } from '../settings/settings';
import { formatAmount, parseAmount, stringToFloat64 } from '../utils/converter';
import { fixedZone, formatTimezoneOffset, formatUnixTimeToLongDateTime, getMinTransactionTimeFromUnixTime, getTimezoneOffsetMinutes, getUnixTimeFromTransactionTime, parseFromLongDateTimeInTimeZone, parseFromTimezoneOffset, type Timezone } from '../utils/datetimes';
import { allCurrencyNames } from '../web/binding';
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION,
    TRANSACTION_DATA_TABLE_MEMBER,
    TRANSACTION_DATA_TABLE_MERCHANT,
    TRANSACTION_DATA_TABLE_PAYEE,
    TRANSACTION_DATA_TABLE_PROJECT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TAGS,
    TRANSACTION_DATA_TABLE_TIMEZONE_NOT_AVAILABLE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataTable,
    type TransactionDataTableBuilder,
} from './datatable';

export type AccountNameMap = Map<string, Account>;
export type CategoryNameMap = Map<string, Map<string, TransactionCategory>>;
export type TagNameMap = Map<string, TransactionTag>;

// ImportedDataResult represents the parsed result of imported data
export type ImportedDataResult = [ImportTransaction[], Account[], TransactionCategory[], TransactionCategory[], TransactionCategory[], TransactionTag[]];

// TransactionDataExporter defines the structure of transaction data exporter
export interface TransactionDataExporter {
    toExportedContent(ctx: Context, uid: bigint, transactions: Transaction[], accountMap: Map<bigint, Account>, categoryMap: Map<bigint, TransactionCategory>, tagMap: Map<bigint, TransactionTag>, allTagIndexes: Map<bigint, bigint[]>): Promise<Buffer>;
}

// TransactionDataImporter defines the structure of transaction data importer
export interface TransactionDataImporter {
    parseImportedData(ctx: Context, user: User, data: Buffer, defaultTimezone: Timezone, additionalOptions: TransactionDataImporterOptions, accountMap: AccountNameMap | null, expenseCategoryMap: CategoryNameMap | null, incomeCategoryMap: CategoryNameMap | null, transferCategoryMap: CategoryNameMap | null, tagMap: TagNameMap | null): Promise<ImportedDataResult>;
}

// TransactionDataImporterOptions represents the additional options of transaction data importer
export class TransactionDataImporterOptions {
    public constructor(
        public readonly currentConfig: Config | null = null,
        public readonly payeeAsTag: boolean = false,
        public readonly payeeAsDescription: boolean = false,
        public readonly memberAsTag: boolean = false,
        public readonly projectAsTag: boolean = false,
        public readonly merchantAsTag: boolean = false,
        public readonly aiAdditionalPrompt: string = '',
        public readonly aiImageContentType: string = '',
    ) {
    }

    private with(changes: Partial<TransactionDataImporterOptions>): TransactionDataImporterOptions {
        return new TransactionDataImporterOptions(
            changes.currentConfig !== undefined ? changes.currentConfig : this.currentConfig,
            changes.payeeAsTag ?? this.payeeAsTag,
            changes.payeeAsDescription ?? this.payeeAsDescription,
            changes.memberAsTag ?? this.memberAsTag,
            changes.projectAsTag ?? this.projectAsTag,
            changes.merchantAsTag ?? this.merchantAsTag,
            changes.aiAdditionalPrompt ?? this.aiAdditionalPrompt,
            changes.aiImageContentType ?? this.aiImageContentType,
        );
    }

    public withPayeeAsTag(): TransactionDataImporterOptions {
        return this.with({ payeeAsTag: true });
    }

    public withPayeeAsDescription(): TransactionDataImporterOptions {
        return this.with({ payeeAsDescription: true });
    }

    public withMemberAsTag(): TransactionDataImporterOptions {
        return this.with({ memberAsTag: true });
    }

    public withProjectAsTag(): TransactionDataImporterOptions {
        return this.with({ projectAsTag: true });
    }

    public withMerchantAsTag(): TransactionDataImporterOptions {
        return this.with({ merchantAsTag: true });
    }

    public withAIAdditionalPrompt(prompt: string): TransactionDataImporterOptions {
        return this.with({ aiAdditionalPrompt: prompt });
    }

    public withAIImageContentType(contentType: string): TransactionDataImporterOptions {
        return this.with({ aiImageContentType: contentType });
    }
}

export const DefaultImporterOptions = new TransactionDataImporterOptions();

// parseImporterOptions parses the importer options string (e.g. "payeeAsTag,memberAsTag")
export function parseImporterOptions(config: Config, s: string): TransactionDataImporterOptions {
    let payeeAsTag = false;
    let payeeAsDescription = false;
    let memberAsTag = false;
    let projectAsTag = false;
    let merchantAsTag = false;

    if (s !== '') {
        for (const option of s.split(',')) {
            switch (option) {
                case 'payeeAsTag': payeeAsTag = true; break;
                case 'payeeAsDescription': payeeAsDescription = true; break;
                case 'memberAsTag': memberAsTag = true; break;
                case 'projectAsTag': projectAsTag = true; break;
                case 'merchantAsTag': merchantAsTag = true; break;
            }
        }
    }

    return new TransactionDataImporterOptions(config, payeeAsTag, payeeAsDescription, memberAsTag, projectAsTag, merchantAsTag, '', '');
}

export type TransactionGeoLocationOrder = string;

export const TRANSACTION_GEO_LOCATION_ORDER_LONGITUDE_LATITUDE = 'lonlat';
export const TRANSACTION_GEO_LOCATION_ORDER_LATITUDE_LONGITUDE = 'latlon';

// TransactionTypeNameMapping maps transaction type to display name
export type TransactionTypeNameMapping = Map<TransactionType, string>;

// DataTableTransactionDataImporter defines the structure of transaction data importer by data table
export class DataTableTransactionDataImporter {
    public constructor(
        private readonly transactionTypeMapping: Map<string, TransactionType> | null,
        private readonly geoLocationSeparator: string = '',
        private readonly geoLocationOrder: TransactionGeoLocationOrder = '',
        private readonly transactionTagSeparator: string = '',
    ) {
    }

    public async parseImportedData(ctx: Context, user: User, dataTable: TransactionDataTable, defaultTimezone: Timezone, additionalOptions: TransactionDataImporterOptions, accountMapParam: AccountNameMap | null, expenseCategoryMapParam: CategoryNameMap | null, incomeCategoryMapParam: CategoryNameMap | null, transferCategoryMapParam: CategoryNameMap | null, tagMapParam: TagNameMap | null): Promise<ImportedDataResult> {
        const prefix = 'data_table_transaction_data_importer.ParseImportedData';

        if (dataTable.transactionRowCount() < 1) {
            log.errorf(ctx, `[${prefix}] cannot parse import data for user "uid:${user.uid}", because data table row count is less 1`);
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        const nameDbTypeMap = this.buildTransactionTypeNameDbTypeMap();

        if (!dataTable.hasColumn(TRANSACTION_DATA_TABLE_TRANSACTION_TIME) ||
            !dataTable.hasColumn(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) ||
            !dataTable.hasColumn(TRANSACTION_DATA_TABLE_SUB_CATEGORY) ||
            !dataTable.hasColumn(TRANSACTION_DATA_TABLE_ACCOUNT_NAME) ||
            !dataTable.hasColumn(TRANSACTION_DATA_TABLE_AMOUNT) ||
            !dataTable.hasColumn(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME)) {
            log.errorf(ctx, `[${prefix}] cannot parse import data for user "uid:${user.uid}", because missing essential columns in header row`);
            throw errs.ErrMissingRequiredFieldInHeaderRow;
        }

        const accountMap: AccountNameMap = accountMapParam ?? new Map();
        const expenseCategoryMap: CategoryNameMap = expenseCategoryMapParam ?? new Map();
        const incomeCategoryMap: CategoryNameMap = incomeCategoryMapParam ?? new Map();
        const transferCategoryMap: CategoryNameMap = transferCategoryMapParam ?? new Map();
        const tagMap: TagNameMap = tagMapParam ?? new Map();

        const allNewTransactions: ImportTransaction[] = [];
        const allNewAccounts: Account[] = [];
        const allNewSubExpenseCategories: TransactionCategory[] = [];
        const allNewSubIncomeCategories: TransactionCategory[] = [];
        const allNewSubTransferCategories: TransactionCategory[] = [];
        const allNewTags: TransactionTag[] = [];

        const dataRowIterator = dataTable.transactionRowIterator();
        let dataRowIndex = 0;

        while (dataRowIterator.hasNext()) {
            dataRowIndex++;
            let dataRow;

            try {
                dataRow = await dataRowIterator.next(ctx, user);
            } catch (err) {
                log.errorf(ctx, `[${prefix}] cannot parse data row "index:${dataRowIndex}" for user "uid:${user.uid}", because ${(err as Error).message}`);
                throw err;
            }

            if (!dataRow || !dataRow.isValid()) {
                continue;
            }

            let timezone = defaultTimezone;

            if (dataTable.hasColumn(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE) && dataRow.getData(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE) !== TRANSACTION_DATA_TABLE_TIMEZONE_NOT_AVAILABLE) {
                try {
                    timezone = parseFromTimezoneOffset(dataRow.getData(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE));
                } catch (err) {
                    log.errorf(ctx, `[${prefix}] cannot parse time zone "${dataRow.getData(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE)}" in data row "index:${dataRowIndex}" for user "uid:${user.uid}", because ${(err as Error).message}`);
                    throw errs.ErrTransactionTimeZoneInvalid;
                }
            }

            let transactionUnixTime: number;

            try {
                transactionUnixTime = Math.floor(parseFromLongDateTimeInTimeZone(dataRow.getData(TRANSACTION_DATA_TABLE_TRANSACTION_TIME), timezone).toSeconds());
            } catch (err) {
                log.errorf(ctx, `[${prefix}] cannot parse time "${dataRow.getData(TRANSACTION_DATA_TABLE_TRANSACTION_TIME)}" in data row "index:${dataRowIndex}" for user "uid:${user.uid}", because ${(err as Error).message}`);
                throw errs.ErrTransactionTimeInvalid;
            }

            const transactionDbType = nameDbTypeMap.get(dataRow.getData(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE));

            if (transactionDbType === undefined) {
                log.errorf(ctx, `[${prefix}] cannot parse transaction type "${dataRow.getData(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE)}" in data row "index:${dataRowIndex}" for user "uid:${user.uid}", because ${errs.ErrTransactionTypeInvalid.message}`);
                throw errs.ErrTransactionTypeInvalid;
            }

            let categoryId = 0n;
            let categoryName = '';
            let subCategoryName = '';

            if (transactionDbType !== TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                const transactionCategoryType = getTransactionCategoryType(transactionDbType);
                categoryName = dataRow.getData(TRANSACTION_DATA_TABLE_CATEGORY);
                subCategoryName = dataRow.getData(TRANSACTION_DATA_TABLE_SUB_CATEGORY);

                let categoryMap: CategoryNameMap | null = null;
                let newCategories: TransactionCategory[] | null = null;

                if (transactionDbType === TRANSACTION_DB_TYPE_EXPENSE) {
                    categoryMap = expenseCategoryMap;
                    newCategories = allNewSubExpenseCategories;
                } else if (transactionDbType === TRANSACTION_DB_TYPE_INCOME) {
                    categoryMap = incomeCategoryMap;
                    newCategories = allNewSubIncomeCategories;
                } else if (transactionDbType === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                    categoryMap = transferCategoryMap;
                    newCategories = allNewSubTransferCategories;
                }

                if (categoryMap && newCategories) {
                    let subCategory = getTransactionCategory(categoryMap, categoryName, subCategoryName);

                    if (!subCategory) {
                        subCategory = newTransactionCategory({ uid: user.uid, name: subCategoryName, type: transactionCategoryType });
                        newCategories.push(subCategory);

                        if (!categoryMap.has(subCategoryName)) {
                            categoryMap.set(subCategoryName, new Map());
                        }

                        categoryMap.get(subCategoryName)?.set(categoryName, subCategory);
                    }

                    categoryId = subCategory.categoryId;
                }
            }

            const hasAccountCurrency = dataTable.hasColumn(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY) && dataRow.getData(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY) !== '';
            const accountName = dataRow.getData(TRANSACTION_DATA_TABLE_ACCOUNT_NAME);
            let accountCurrency = user.defaultCurrency;

            if (hasAccountCurrency) {
                accountCurrency = dataRow.getData(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY);

                if (!allCurrencyNames.has(accountCurrency)) {
                    log.errorf(ctx, `[${prefix}] account currency "${accountCurrency}" is not supported in data row "index:${dataRowIndex}" for user "uid:${user.uid}"`);
                    throw errs.ErrAccountCurrencyInvalid;
                }
            }

            let account = accountMap.get(accountName);
            const accountExists = account !== undefined;

            if (!account) {
                account = newAccount({ uid: user.uid, name: accountName, currency: accountCurrency });
                allNewAccounts.push(account);
                accountMap.set(accountName, account);
            }

            if (hasAccountCurrency) {
                if (account.name !== '' && account.currency !== accountCurrency) {
                    log.errorf(ctx, `[${prefix}] currency "${accountCurrency}" in data row "index:${dataRowIndex}" not equals currency "${account.currency}" of the account for user "uid:${user.uid}"`);
                    throw errs.ErrAccountCurrencyInvalid;
                }
            } else if (accountExists) {
                accountCurrency = account.currency;
            }

            let amount: number;

            try {
                amount = parseAmount(dataRow.getData(TRANSACTION_DATA_TABLE_AMOUNT));
            } catch (err) {
                log.errorf(ctx, `[${prefix}] cannot parse acmount "${dataRow.getData(TRANSACTION_DATA_TABLE_AMOUNT)}" in data row "index:${dataRowIndex}" for user "uid:${user.uid}", because ${(err as Error).message}`);
                throw errs.ErrAmountInvalid;
            }

            let relatedAccountId = 0n;
            let relatedAccountAmount = 0;
            let account2Name = '';
            let account2Currency = '';

            if (transactionDbType === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                const hasAccount2Currency = dataTable.hasColumn(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY) && dataRow.getData(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY) !== '';
                account2Name = dataRow.getData(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME);
                account2Currency = user.defaultCurrency;

                if (hasAccount2Currency) {
                    account2Currency = dataRow.getData(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY);

                    if (!allCurrencyNames.has(account2Currency)) {
                        log.errorf(ctx, `[${prefix}] account2 currency "${account2Currency}" is not supported in data row "index:${dataRowIndex}" for user "uid:${user.uid}"`);
                        throw errs.ErrAccountCurrencyInvalid;
                    }
                }

                let account2 = accountMap.get(account2Name);
                const account2Exists = account2 !== undefined;

                if (!account2) {
                    account2 = newAccount({ uid: user.uid, name: account2Name, currency: account2Currency });
                    allNewAccounts.push(account2);
                    accountMap.set(account2Name, account2);
                }

                if (hasAccount2Currency) {
                    if (account2.name !== '' && account2.currency !== account2Currency) {
                        log.errorf(ctx, `[${prefix}] currency "${account2Currency}" in data row "index:${dataRowIndex}" not equals currency "${account2.currency}" of the account2 for user "uid:${user.uid}"`);
                        throw errs.ErrAccountCurrencyInvalid;
                    }
                } else if (account2Exists) {
                    account2Currency = account2.currency;
                }

                relatedAccountId = account2.accountId;

                if (dataTable.hasColumn(TRANSACTION_DATA_TABLE_RELATED_AMOUNT)) {
                    try {
                        relatedAccountAmount = parseAmount(dataRow.getData(TRANSACTION_DATA_TABLE_RELATED_AMOUNT));
                    } catch (err) {
                        log.errorf(ctx, `[${prefix}] cannot parse acmount2 "${dataRow.getData(TRANSACTION_DATA_TABLE_RELATED_AMOUNT)}" in data row "index:${dataRowIndex}" for user "uid:${user.uid}", because ${(err as Error).message}`);
                        throw errs.ErrAmountInvalid;
                    }
                } else {
                    relatedAccountAmount = amount;
                }
            }

            let geoLongitude = 0;
            let geoLatitude = 0;

            if (dataTable.hasColumn(TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION) && this.geoLocationSeparator !== '') {
                const geoLocationItems = dataRow.getData(TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION).split(this.geoLocationSeparator);

                if (geoLocationItems.length === 2) {
                    let first: number, second: number;

                    try {
                        first = stringToFloat64(geoLocationItems[0] as string);
                        second = stringToFloat64(geoLocationItems[1] as string);
                    } catch (err) {
                        log.errorf(ctx, `[${prefix}] cannot parse geographic location "${dataRow.getData(TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION)}" in data row "index:${dataRowIndex}" for user "uid:${user.uid}", because ${(err as Error).message}`);
                        throw errs.ErrGeographicLocationInvalid;
                    }

                    if (this.geoLocationOrder === TRANSACTION_GEO_LOCATION_ORDER_LONGITUDE_LATITUDE) {
                        geoLongitude = first;
                        geoLatitude = second;
                    } else if (this.geoLocationOrder === TRANSACTION_GEO_LOCATION_ORDER_LATITUDE_LONGITUDE) {
                        geoLatitude = first;
                        geoLongitude = second;
                    }
                }
            }

            const tagIds: string[] = [];
            const tagNames: string[] = [];
            const tagNamesSet = new Set<string>();

            const addTag = (tagName: string): void => {
                if (tagName !== '' && !tagNamesSet.has(tagName)) {
                    let tag = tagMap.get(tagName);

                    if (!tag) {
                        tag = newTransactionTag({ uid: user.uid, name: tagName });
                        allNewTags.push(tag);
                        tagMap.set(tagName, tag);
                    }

                    tagIds.push(tag.tagId.toString());
                    tagNames.push(tagName);
                    tagNamesSet.add(tagName);
                }
            };

            if (dataTable.hasColumn(TRANSACTION_DATA_TABLE_TAGS)) {
                const tagsText = dataRow.getData(TRANSACTION_DATA_TABLE_TAGS);
                const tagNameItems = this.transactionTagSeparator !== '' ? tagsText.split(this.transactionTagSeparator) : [tagsText];

                for (const tagName of tagNameItems) {
                    if (tagName !== '') {
                        addTag(tagName);
                    }
                }
            }

            const optionalTagColumns: [number, boolean][] = [
                [TRANSACTION_DATA_TABLE_PAYEE, additionalOptions.payeeAsTag],
                [TRANSACTION_DATA_TABLE_MEMBER, additionalOptions.memberAsTag],
                [TRANSACTION_DATA_TABLE_PROJECT, additionalOptions.projectAsTag],
                [TRANSACTION_DATA_TABLE_MERCHANT, additionalOptions.merchantAsTag],
            ];

            for (const [column, enabled] of optionalTagColumns) {
                if (dataTable.hasColumn(column) && enabled) {
                    const value = dataRow.getData(column);

                    if (value !== '') {
                        addTag(value);
                    }
                }
            }

            let description = '';

            if (dataTable.hasColumn(TRANSACTION_DATA_TABLE_DESCRIPTION)) {
                description = dataRow.getData(TRANSACTION_DATA_TABLE_DESCRIPTION);
            }

            if (description === '' && additionalOptions.payeeAsDescription && dataTable.hasColumn(TRANSACTION_DATA_TABLE_PAYEE)) {
                description = dataRow.getData(TRANSACTION_DATA_TABLE_PAYEE);
            }

            allNewTransactions.push({
                transaction: newTransaction({
                    uid: user.uid,
                    type: transactionDbType,
                    categoryId: categoryId,
                    transactionTime: getMinTransactionTimeFromUnixTime(transactionUnixTime),
                    timezoneUtcOffset: getTimezoneOffsetMinutes(transactionUnixTime, timezone),
                    accountId: account.accountId,
                    amount: amount,
                    hideAmount: false,
                    relatedAccountId: relatedAccountId,
                    relatedAccountAmount: relatedAccountAmount,
                    comment: description,
                    geoLongitude: geoLongitude,
                    geoLatitude: geoLatitude,
                    createdIp: ctx.clientIP(),
                }),
                tagIds: tagIds.length > 0 ? tagIds : (null as unknown as string[]),
                originalCategoryName: subCategoryName,
                originalSourceAccountName: accountName,
                originalSourceAccountCurrency: accountCurrency,
                originalDestinationAccountName: account2Name,
                originalDestinationAccountCurrency: account2Currency,
                originalTagNames: tagNames.length > 0 ? tagNames : (null as unknown as string[]),
            });
        }

        if (allNewTransactions.length < 1) {
            log.errorf(ctx, `[${prefix}] no transaction data parsed for "uid:${user.uid}"`);
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        sortImportedTransactions(allNewTransactions);
        return [allNewTransactions, allNewAccounts, allNewSubExpenseCategories, allNewSubIncomeCategories, allNewSubTransferCategories, allNewTags];
    }

    private buildTransactionTypeNameDbTypeMap(): Map<string, TransactionDbType> {
        if (!this.transactionTypeMapping) {
            throw errs.ErrTransactionTypeInvalid;
        }

        const nameDbTypeMap = new Map<string, TransactionDbType>();

        for (const [name, transactionType] of this.transactionTypeMapping) {
            if (transactionType === TRANSACTION_TYPE_MODIFY_BALANCE) {
                nameDbTypeMap.set(name, TRANSACTION_DB_TYPE_MODIFY_BALANCE);
            } else if (transactionType === TRANSACTION_TYPE_INCOME) {
                nameDbTypeMap.set(name, TRANSACTION_DB_TYPE_INCOME);
            } else if (transactionType === TRANSACTION_TYPE_EXPENSE) {
                nameDbTypeMap.set(name, TRANSACTION_DB_TYPE_EXPENSE);
            } else if (transactionType === TRANSACTION_TYPE_TRANSFER) {
                nameDbTypeMap.set(name, TRANSACTION_DB_TYPE_TRANSFER_OUT);
            } else {
                throw errs.ErrTransactionTypeInvalid;
            }
        }

        return nameDbTypeMap;
    }
}

function getTransactionCategoryType(transactionType: TransactionDbType): TransactionCategoryType {
    if (transactionType === TRANSACTION_DB_TYPE_INCOME) {
        return CATEGORY_TYPE_INCOME;
    } else if (transactionType === TRANSACTION_DB_TYPE_EXPENSE) {
        return CATEGORY_TYPE_EXPENSE;
    } else if (transactionType === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        return CATEGORY_TYPE_TRANSFER;
    }

    throw errs.ErrTransactionTypeInvalid;
}

function getTransactionCategory(categories: CategoryNameMap, categoryName: string, subCategoryName: string): TransactionCategory | null {
    if (categories.size < 1) {
        return null;
    }

    const subCategories = categories.get(subCategoryName);

    if (!subCategories || subCategories.size < 1) {
        return null;
    }

    const exactMatched = categoryName !== '' ? subCategories.get(categoryName) : undefined;

    if (exactMatched) {
        return exactMatched;
    }

    for (const subCategory of subCategories.values()) {
        if (subCategory) {
            return subCategory;
        }
    }

    return null;
}

function buildTransactionNameTypeMap(transactionTypeMapping: TransactionTypeNameMapping | null): Map<string, TransactionType> | null {
    if (!transactionTypeMapping) {
        return null;
    }

    const typeNameMap = new Map<string, TransactionType>();

    for (const [transactionType, name] of transactionTypeMapping) {
        typeNameMap.set(name, transactionType);
    }

    return typeNameMap;
}

// createNewImporterWithTypeNameMapping returns a new data table transaction data importer with type name mapping
export function createNewImporterWithTypeNameMapping(transactionTypeMapping: TransactionTypeNameMapping, geoLocationSeparator: string, geoLocationOrder: TransactionGeoLocationOrder, transactionTagSeparator: string): DataTableTransactionDataImporter {
    return new DataTableTransactionDataImporter(buildTransactionNameTypeMap(transactionTypeMapping), geoLocationSeparator, geoLocationOrder, transactionTagSeparator);
}

// createNewSimpleImporter returns a new data table transaction data importer with name to type mapping
export function createNewSimpleImporter(transactionTypeMapping: Map<string, TransactionType> | null): DataTableTransactionDataImporter {
    return new DataTableTransactionDataImporter(transactionTypeMapping);
}

// createNewSimpleImporterWithTypeNameMapping returns a new data table transaction data importer with type to name mapping
export function createNewSimpleImporterWithTypeNameMapping(transactionTypeMapping: TransactionTypeNameMapping): DataTableTransactionDataImporter {
    return new DataTableTransactionDataImporter(buildTransactionNameTypeMap(transactionTypeMapping));
}

// goFormatFloat formats the float like go fmt "%f" (6 decimal places)
export function goFormatFloat(value: number): string {
    return value.toFixed(6);
}

// DataTableTransactionDataExporter defines the structure of transaction data exporter by data table
export class DataTableTransactionDataExporter {
    public constructor(
        private readonly transactionTypeMapping: TransactionTypeNameMapping,
        private readonly geoLocationSeparator: string,
        private readonly transactionTagSeparator: string,
    ) {
    }

    public buildExportedContent(_ctx: Context, dataTableBuilder: TransactionDataTableBuilder, _uid: bigint, transactions: Transaction[], accountMap: Map<bigint, Account>, categoryMap: Map<bigint, TransactionCategory>, tagMap: Map<bigint, TransactionTag>, allTagIndexes: Map<bigint, bigint[]>): void {
        const existsTransferOutTransactions = new Set<bigint>();

        for (const transaction of transactions) {
            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                existsTransferOutTransactions.add(transaction.transactionId);
            }
        }

        const replace = (text: string): string => dataTableBuilder.replaceDelimiters(text);
        const accountName = (accountId: bigint): string => {
            const account = accountMap.get(accountId);
            return account ? replace(account.name) : '';
        };
        const accountCurrency = (accountId: bigint): string => {
            const account = accountMap.get(accountId);
            return account ? replace(account.currency) : '';
        };

        for (const transaction of transactions) {
            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN && existsTransferOutTransactions.has(transaction.relatedId)) {
                continue;
            }

            const dataRowMap: RowData = new Map();
            const transactionUnixTime = getUnixTimeFromTransactionTime(transaction.transactionTime);
            const transactionTimeZone = fixedZone(transaction.timezoneUtcOffset);

            dataRowMap.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, formatUnixTimeToLongDateTime(transactionUnixTime, transactionTimeZone));
            dataRowMap.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, formatTimezoneOffset(transactionUnixTime, transactionTimeZone));
            dataRowMap.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, replace(this.getDisplayTransactionTypeName(transaction.type)));
            dataRowMap.set(TRANSACTION_DATA_TABLE_CATEGORY, this.getExportedTransactionCategoryName(replace, transaction.categoryId, categoryMap));
            dataRowMap.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, categoryMap.has(transaction.categoryId) ? replace((categoryMap.get(transaction.categoryId) as TransactionCategory).name) : '');

            if (transaction.type !== TRANSACTION_DB_TYPE_TRANSFER_IN) {
                dataRowMap.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, accountName(transaction.accountId));
                dataRowMap.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, accountCurrency(transaction.accountId));
                dataRowMap.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(transaction.amount));
            } else {
                dataRowMap.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, accountName(transaction.relatedAccountId));
                dataRowMap.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, accountCurrency(transaction.relatedAccountId));
                dataRowMap.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(transaction.relatedAccountAmount));
            }

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                dataRowMap.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, accountName(transaction.relatedAccountId));
                dataRowMap.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, accountCurrency(transaction.relatedAccountId));
                dataRowMap.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, formatAmount(transaction.relatedAccountAmount));
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_IN) {
                dataRowMap.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, accountName(transaction.accountId));
                dataRowMap.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, accountCurrency(transaction.accountId));
                dataRowMap.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, formatAmount(transaction.amount));
            }

            dataRowMap.set(TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION, transaction.geoLongitude !== 0 || transaction.geoLatitude !== 0 ? `${goFormatFloat(transaction.geoLongitude)}${this.geoLocationSeparator}${goFormatFloat(transaction.geoLatitude)}` : '');
            dataRowMap.set(TRANSACTION_DATA_TABLE_TAGS, this.getExportedTags(replace, transaction.transactionId, allTagIndexes, tagMap));
            dataRowMap.set(TRANSACTION_DATA_TABLE_DESCRIPTION, replace(transaction.comment));
            dataTableBuilder.appendTransaction(dataRowMap);
        }
    }

    private getDisplayTransactionTypeName(transactionDbType: TransactionDbType): string {
        let transactionType: TransactionType;

        try {
            transactionType = transactionDbTypeToTransactionType(transactionDbType);
        } catch {
            return '';
        }

        return this.transactionTypeMapping.get(transactionType) ?? '';
    }

    private getExportedTransactionCategoryName(replace: (text: string) => string, categoryId: bigint, categoryMap: Map<bigint, TransactionCategory>): string {
        const category = categoryMap.get(categoryId);

        if (!category) {
            return '';
        }

        if (category.parentCategoryId === LevelOneTransactionCategoryParentId) {
            return replace(category.name);
        }

        const parentCategory = categoryMap.get(category.parentCategoryId);
        return parentCategory ? replace(parentCategory.name) : '';
    }

    private getExportedTags(replace: (text: string) => string, transactionId: bigint, allTagIndexes: Map<bigint, bigint[]>, tagMap: Map<bigint, TransactionTag>): string {
        const tagIndexes = allTagIndexes.get(transactionId);

        if (!tagIndexes) {
            return '';
        }

        let ret = '';

        for (const tagIndex of tagIndexes) {
            const tag = tagMap.get(tagIndex);

            if (!tag) {
                continue;
            }

            if (ret.length > 0) {
                ret += this.transactionTagSeparator;
            }

            ret += tag.name.split(this.transactionTagSeparator).join(' ');
        }

        return replace(ret);
    }
}

// createNewExporter returns a new data table transaction data exporter
export function createNewExporter(transactionTypeMapping: TransactionTypeNameMapping, geoLocationSeparator: string, transactionTagSeparator: string): DataTableTransactionDataExporter {
    return new DataTableTransactionDataExporter(transactionTypeMapping, geoLocationSeparator, transactionTagSeparator);
}
