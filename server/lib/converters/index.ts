import * as errs from '../errs/index';
import type { TransactionType } from '../models/index';
import { AIRecognizedImageTransactionDataImporter, AIRecognizedTextTransactionDataImporter } from './ai';
import { AlipayAppTransactionDataCsvFileImporter, AlipayWebTransactionDataCsvFileImporter } from './alipay';
import { BeancountTransactionDataImporter } from './beancount';
import { Camt052TransactionDataImporter, Camt053TransactionDataImporter } from './camt';
import type { TransactionDataExporter, TransactionDataImporter } from './converter';
import {
    createNewCustomTransactionDataDsvFileImporter,
    createNewCustomTransactionDataDsvFileParser,
    createNewCustomTransactionDataExcelFileImporter,
    createNewCustomTransactionDataExcelFileParser,
    type CustomTransactionDataParser,
    isCustomExcelFileType,
    isDelimiterSeparatedValuesFileType,
} from './custom';
import type { TransactionDataTableColumn } from './datatable';
import { DefaultTransactionDataCSVFileConverter, DefaultTransactionDataJsonFileImporter, DefaultTransactionDataTSVFileConverter } from './default';
import { FeideeMymoneyAppTransactionDataCsvFileImporter, FeideeMymoneyElecloudTransactionDataXlsxFileImporter, FeideeMymoneyWebTransactionDataXlsFileImporter } from './feidee';
import { FireflyIIITransactionDataCsvFileImporter } from './fireflyiii';
import { GnuCashTransactionDataImporter } from './gnucash';
import { IifTransactionDataFileImporter } from './iif';
import { JDComFinanceTransactionDataCsvFileImporter } from './jdcom';
import { MT940TransactionDataFileImporter } from './mt';
import { OFXTransactionDataImporter } from './ofx';
import { QifDayMonthYearTransactionDataImporter, QifMonthDayYearTransactionDataImporter, QifYearMonthDayTransactionDataImporter } from './qif';
import { WeChatPayTransactionDataCsvFileImporter, WeChatPayTransactionDataXlsxFileImporter } from './wechat';

// getTransactionDataExporter returns the transaction data exporter according to the file type
export function getTransactionDataExporter(fileType: string): TransactionDataExporter | null {
    if (fileType === 'csv') {
        return DefaultTransactionDataCSVFileConverter;
    } else if (fileType === 'tsv') {
        return DefaultTransactionDataTSVFileConverter;
    } else {
        return null;
    }
}

const transactionDataImporters = new Map<string, TransactionDataImporter>([
    ['ezbookkeeping_csv', DefaultTransactionDataCSVFileConverter],
    ['ezbookkeeping_tsv', DefaultTransactionDataTSVFileConverter],
    ['ezbookkeeping_json', DefaultTransactionDataJsonFileImporter],
    ['ai_txt', AIRecognizedTextTransactionDataImporter],
    ['ai_image', AIRecognizedImageTransactionDataImporter],
    ['ofx', OFXTransactionDataImporter],
    ['qfx', OFXTransactionDataImporter],
    ['qif_ymd', QifYearMonthDayTransactionDataImporter],
    ['qif_mdy', QifMonthDayYearTransactionDataImporter],
    ['qif_dmy', QifDayMonthYearTransactionDataImporter],
    ['iif', IifTransactionDataFileImporter],
    ['camt052', Camt052TransactionDataImporter],
    ['camt053', Camt053TransactionDataImporter],
    ['mt940', MT940TransactionDataFileImporter],
    ['gnucash', GnuCashTransactionDataImporter],
    ['firefly_iii_csv', FireflyIIITransactionDataCsvFileImporter],
    ['beancount', BeancountTransactionDataImporter],
    ['feidee_mymoney_csv', FeideeMymoneyAppTransactionDataCsvFileImporter],
    ['feidee_mymoney_xls', FeideeMymoneyWebTransactionDataXlsFileImporter],
    ['feidee_mymoney_elecloud_xlsx', FeideeMymoneyElecloudTransactionDataXlsxFileImporter],
    ['alipay_app_csv', AlipayAppTransactionDataCsvFileImporter],
    ['alipay_web_csv', AlipayWebTransactionDataCsvFileImporter],
    ['wechat_pay_app_xlsx', WeChatPayTransactionDataXlsxFileImporter],
    ['wechat_pay_app_csv', WeChatPayTransactionDataCsvFileImporter],
    ['jdcom_finance_app_csv', JDComFinanceTransactionDataCsvFileImporter],
]);

// getTransactionDataImporter returns the transaction data importer according to the file type
export function getTransactionDataImporter(fileType: string): TransactionDataImporter {
    const importer = transactionDataImporters.get(fileType);

    if (!importer) {
        throw errs.ErrImportFileTypeNotSupported;
    }

    return importer;
}

// isCustomFileFormatFileType returns whether the file type is the custom file format
export function isCustomFileFormatFileType(fileType: string): boolean {
    return isDelimiterSeparatedValuesFileType(fileType) || isCustomExcelFileType(fileType);
}

// createNewCustomFileFormatTransactionDataParser returns a new custom transaction data parser according to the file type and encoding
export function createNewCustomFileFormatTransactionDataParser(fileType: string, fileEncoding: string): CustomTransactionDataParser {
    if (isDelimiterSeparatedValuesFileType(fileType)) {
        return createNewCustomTransactionDataDsvFileParser(fileType, fileEncoding);
    } else if (isCustomExcelFileType(fileType)) {
        return createNewCustomTransactionDataExcelFileParser(fileType);
    } else {
        throw errs.ErrImportFileTypeNotSupported;
    }
}

// createNewCustomTransactionDataImporter returns a new custom transaction data importer according to the file type and encoding
export function createNewCustomTransactionDataImporter(fileType: string, fileEncoding: string, columnIndexMapping: Map<TransactionDataTableColumn, number>, transactionTypeNameMapping: Map<string, TransactionType>, hasHeaderLine: boolean, timeFormat: string, timezoneFormat: string, amountDecimalSeparator: string, amountDigitGroupingSymbol: string, geoLocationSeparator: string, geoLocationOrder: string, transactionTagSeparator: string): TransactionDataImporter {
    if (isDelimiterSeparatedValuesFileType(fileType)) {
        return createNewCustomTransactionDataDsvFileImporter(fileType, fileEncoding, columnIndexMapping, transactionTypeNameMapping, hasHeaderLine, timeFormat, timezoneFormat, amountDecimalSeparator, amountDigitGroupingSymbol, geoLocationSeparator, geoLocationOrder, transactionTagSeparator);
    } else if (isCustomExcelFileType(fileType)) {
        return createNewCustomTransactionDataExcelFileImporter(fileType, columnIndexMapping, transactionTypeNameMapping, hasHeaderLine, timeFormat, timezoneFormat, amountDecimalSeparator, amountDigitGroupingSymbol, geoLocationSeparator, geoLocationOrder, transactionTagSeparator);
    } else {
        throw errs.ErrImportFileTypeNotSupported;
    }
}
