import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { getLocaleTextItems } from '../locales/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_TRANSFER, type User } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import type { Timezone } from '../utils/datetimes';
import { decodeWithBOMOverride } from '../utils/encodings';
import { parseFirstConsecutiveNumber } from '../utils/numbers';
import { extractDataTable, trimSpaces } from './chinese_extractor';
import {
    type AccountNameMap,
    type CategoryNameMap,
    createNewSimpleImporterWithTypeNameMapping,
    type ImportedDataResult,
    type TagNameMap,
    type TransactionDataImporter,
    type TransactionDataImporterOptions,
    type TransactionTypeNameMapping,
} from './converter';
import { createNewCsvBasicDataTable } from './csv';
import {
    type BasicDataTable,
    type CommonDataTableRow,
    type CommonTransactionDataRowParser,
    createNewCommonDataTableFromBasicDataTable,
    createNewTransactionDataTableFromCommonDataTable,
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataTableColumn,
} from './datatable';
import { createNewExcelOOXMLFileBasicDataTable } from './excel';

const wechatPayTransactionDataCsvFileHeader = '微信支付账单明细';
const wechatPayTransactionDataHeaderStartContentBeginning = '----------------------微信支付账单明细列表--------------------';

const timeColumnName = '交易时间';
const categoryColumnName = '交易类型';
const productNameColumnName = '商品';
const typeColumnName = '收/支';
const amountColumnName = '金额(元)';
const relatedAccountColumnName = '支付方式';
const statusColumnName = '当前状态';
const descriptionColumnName = '备注';

const categoryTransferToWeChatWallet = '零钱充值';
const categoryTransferFromWeChatWallet = '零钱提现';
const categoryCreditCardRepayment = '信用卡还款';
const statusRefundName = '退款';

const incomeTypeName = '收入';
const expenseTypeName = '支出';
const transferTypeName = '/';

const wechatPayTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

const wechatPayTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_INCOME, incomeTypeName],
    [TRANSACTION_TYPE_EXPENSE, expenseTypeName],
    [TRANSACTION_TYPE_TRANSFER, transferTypeName],
]);

class WeChatPayTransactionDataRowParser implements CommonTransactionDataRowParser {
    private readonly existedOriginalDataColumns: Set<string>;

    public constructor(headerColumnNames: string[]) {
        this.existedOriginalDataColumns = new Set(headerColumnNames);
    }

    private has(columnName: string): boolean {
        return this.existedOriginalDataColumns.has(columnName);
    }

    public parse(ctx: Context, user: User, dataRow: CommonDataTableRow, rowId: string): [RowData, boolean] {
        const prefix = 'wechat_pay_transaction_data_row_parser.Parse';
        const typeName = dataRow.getData(typeColumnName);

        if (typeName !== incomeTypeName && typeName !== expenseTypeName && typeName !== transferTypeName) {
            log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because type is "${typeName}"`);
            return [new Map(), false];
        }

        const data: RowData = new Map();

        if (this.has(timeColumnName)) {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, dataRow.getData(timeColumnName));
        }

        if (this.has(categoryColumnName)) {
            data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, dataRow.getData(categoryColumnName));
        }

        if (this.has(amountColumnName)) {
            const [amount, success] = parseFirstConsecutiveNumber(dataRow.getData(amountColumnName).replaceAll(',', ''));

            if (!success) {
                log.errorf(ctx, `[${prefix}] cannot parse amount "${dataRow.getData(amountColumnName)}" of transaction in row "${rowId}"`);
                throw errs.ErrAmountInvalid;
            }

            data.set(TRANSACTION_DATA_TABLE_AMOUNT, amount);
        }

        const description = this.has(descriptionColumnName) ? dataRow.getData(descriptionColumnName) : '';
        const productName = this.has(productNameColumnName) ? dataRow.getData(productNameColumnName) : '';

        if (this.has(descriptionColumnName) && description !== '' && description !== '/') {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, description);
        } else if (this.has(productNameColumnName) && productName !== '' && productName !== '/') {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, productName);
        } else {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, '');
        }

        const relatedAccountName = this.has(relatedAccountColumnName) ? dataRow.getData(relatedAccountColumnName) : '';
        const statusName = this.has(statusColumnName) ? dataRow.getData(statusColumnName) : '';
        const locale = user.language !== '' ? user.language : ctx.getClientLocale();
        const walletName = getLocaleTextItems(locale).dataConverterTextItems.weChatWallet;

        if (this.has(typeColumnName)) {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, typeName);

            if (typeName === incomeTypeName) {
                if (relatedAccountName === '' || relatedAccountName === '/') {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, walletName);
                    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '');
                } else {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, relatedAccountName);
                }
            } else if (typeName === transferTypeName) {
                const subCategory = data.get(TRANSACTION_DATA_TABLE_SUB_CATEGORY) ?? '';

                if (subCategory === categoryTransferToWeChatWallet) {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, relatedAccountName);
                    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, walletName);
                } else if (subCategory === categoryTransferFromWeChatWallet) {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, walletName);
                    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, relatedAccountName);
                } else if (subCategory === categoryCreditCardRepayment) {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, relatedAccountName);
                    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '');
                } else {
                    log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because unknown transfer transaction category "${subCategory}"`);
                    return [new Map(), false];
                }
            } else {
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, relatedAccountName);
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '');
            }
        }

        if (data.get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) === incomeTypeName && statusName !== '' && statusName.indexOf(statusRefundName) >= 0) {
            try {
                const amount = parseAmount(data.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '');
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseTypeName);
                data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
            } catch {
                // keep original data
            }
        }

        return [data, true];
    }
}

function createNewWeChatPayTransactionBasicDataTable(ctx: Context, originalDataTable: BasicDataTable): BasicDataTable {
    return extractDataTable(ctx, originalDataTable, {
        logPrefix: 'wechat_pay_transaction_data_extrator.createNewWeChatPayTransactionBasicDataTable',
        fileHeader: wechatPayTransactionDataCsvFileHeader,
        isDataHeaderStart: firstColumn => firstColumn.indexOf(wechatPayTransactionDataHeaderStartContentBeginning) === 0,
        includeDataHeaderStartLine: false,
        trimItem: trimSpaces,
    });
}

async function parseWeChatPayData(ctx: Context, user: User, originalDataTable: BasicDataTable, logPrefix: string, dataTypeName: string, defaultTimezone: Timezone, additionalOptions: TransactionDataImporterOptions, accountMap: AccountNameMap | null, expenseCategoryMap: CategoryNameMap | null, incomeCategoryMap: CategoryNameMap | null, transferCategoryMap: CategoryNameMap | null, tagMap: TagNameMap | null): Promise<ImportedDataResult> {
    const dataTable = createNewWeChatPayTransactionBasicDataTable(ctx, originalDataTable);
    const commonDataTable = createNewCommonDataTableFromBasicDataTable(dataTable);

    if (!commonDataTable.hasColumn(timeColumnName) ||
        !commonDataTable.hasColumn(categoryColumnName) ||
        !commonDataTable.hasColumn(typeColumnName) ||
        !commonDataTable.hasColumn(amountColumnName) ||
        !commonDataTable.hasColumn(statusColumnName)) {
        log.errorf(ctx, `[${logPrefix}] cannot parse wechat pay ${dataTypeName} data, because missing essential columns in header row`);
        throw errs.ErrMissingRequiredFieldInHeaderRow;
    }

    const transactionRowParser = new WeChatPayTransactionDataRowParser(dataTable.headerColumnNames());
    const transactionDataTable = createNewTransactionDataTableFromCommonDataTable(commonDataTable, wechatPayTransactionSupportedColumns, transactionRowParser);
    const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(wechatPayTransactionTypeNameMapping);
    return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
}

export const WeChatPayTransactionDataCsvFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const csvDataTable = createNewCsvBasicDataTable(ctx, decodeWithBOMOverride(data), false);
        return parseWeChatPayData(ctx, user, csvDataTable, 'wechat_pay_transaction_data_csv_file_importer.ParseImportedData', 'csv', defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};

export const WeChatPayTransactionDataXlsxFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const xlsxDataTable = createNewExcelOOXMLFileBasicDataTable(data, false);
        return parseWeChatPayData(ctx, user, xlsxDataTable, 'wechat_pay_transaction_data_xlsx_file_importer.ParseImportedData', 'xlsx', defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
