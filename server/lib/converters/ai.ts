import type { Config } from '../settings/settings';
import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { Container as LLMContainer, LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL, LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_TEXT, type LargeLanguageModelRequest } from '../llm/index';
import * as log from '../log/index';
import { type RecognizedTransactionResult, TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_TRANSFER, type User } from '../models/index';
import { getTemplate, type KnownTemplate, SYSTEM_PROMPT_BATCH_RECEIPT_IMAGE_RECOGNITION, SYSTEM_PROMPT_BATCH_TRANSACTION_TEXT_RECOGNITION } from '../templates/index';
import { formatUnixTimeToLongDateTime, type Timezone } from '../utils/datetimes';
import { goJsonField, goJsonString, goJsonStringArray, goJsonUnmarshalObject } from '../utils/gojson';
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
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataRow,
    type TransactionDataRowIterator,
    type TransactionDataTable,
    type TransactionDataTableColumn,
} from './datatable';

const aiRecognizedTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_INCOME, String(TRANSACTION_TYPE_INCOME)],
    [TRANSACTION_TYPE_EXPENSE, String(TRANSACTION_TYPE_EXPENSE)],
    [TRANSACTION_TYPE_TRANSFER, String(TRANSACTION_TYPE_TRANSFER)],
]);

const aiTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

// ---------------------------------------------------------------------------
// data table

function parseAIRecognizedTransaction(result: RecognizedTransactionResult | null): RowData {
    const data: RowData = new Map();

    if (!result || !result.type) {
        throw errs.ErrTransactionTypeInvalid;
    }

    data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, result.time);

    if (result.type === 'income') {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_INCOME));
    } else if (result.type === 'expense') {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_EXPENSE));
    } else if (result.type === 'transfer') {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_TRANSFER));
    } else {
        throw errs.ErrTransactionTypeInvalid;
    }

    data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, result.category ?? '');
    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, result.account ?? '');
    data.set(TRANSACTION_DATA_TABLE_AMOUNT, result.amount ?? '');
    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, result.destination_account ?? '');
    data.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, result.destination_amount ?? '');
    data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, result.description ?? '');

    return data;
}

class AIRecognizedTransactionDataTable implements TransactionDataTable {
    public constructor(private readonly allData: (RecognizedTransactionResult | null)[]) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        return aiTransactionSupportedColumns.has(column);
    }

    public transactionRowCount(): number {
        return this.allData.length;
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        let currentIndex = -1;

        return {
            hasNext: () => currentIndex + 1 < this.allData.length,
            next: async (ctx: Context): Promise<TransactionDataRow | null> => {
                if (currentIndex + 1 >= this.allData.length) {
                    return null;
                }

                currentIndex++;
                let rowItems: RowData;

                try {
                    rowItems = parseAIRecognizedTransaction(this.allData[currentIndex] ?? null);
                } catch (err) {
                    log.errorf(ctx, `[ai_recognized_transaction_data_table.Next] cannot parsing transaction in row#${currentIndex}, because ${(err as Error).message}`);
                    throw err;
                }

                return {
                    isValid: () => true,
                    getData: (column: TransactionDataTableColumn) => (aiTransactionSupportedColumns.has(column) ? rowItems.get(column) ?? '' : ''),
                };
            },
        };
    }
}

// ---------------------------------------------------------------------------
// parser

function recognizedTransactionResultFromJson(value: unknown): RecognizedTransactionResult | null {
    if (value === null) {
        return null;
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('json: cannot unmarshal into Go value of type models.RecognizedTransactionResult');
    }

    const obj = value as Record<string, unknown>;
    const result: RecognizedTransactionResult = {
        type: goJsonString(obj, 'type'),
        time: goJsonString(obj, 'time'),
        amount: goJsonString(obj, 'amount'),
        account: goJsonString(obj, 'account'),
        category: goJsonString(obj, 'category'),
        description: goJsonString(obj, 'description'),
        destination_amount: goJsonString(obj, 'destination_amount'),
        destination_account: goJsonString(obj, 'destination_account'),
    };

    const tags = goJsonStringArray(obj, 'tags');

    if (tags) {
        result.tags = tags;
    }

    return result;
}

function isTextRecognitionEnabled(config: Config | null): config is Config {
    return !!config && !!config.textRecognitionLLMConfig && config.textRecognitionLLMConfig.llmProvider !== '' && config.transactionFromAITextRecognition;
}

function isImageRecognitionEnabled(config: Config | null): config is Config {
    return !!config && !!config.receiptImageRecognitionLLMConfig && config.receiptImageRecognitionLLMConfig.llmProvider !== '' && config.transactionFromAIImageRecognition;
}

function buildRecognitionSystemPrompt(c: Context, user: User, templateName: KnownTemplate, additionalPrompt: string, defaultTimezone: Timezone, accountMap: AccountNameMap | null, expenseCategoryMap: CategoryNameMap | null, incomeCategoryMap: CategoryNameMap | null, transferCategoryMap: CategoryNameMap | null, tagMap: TagNameMap | null): string {
    const getCategoryNames = (categoryMap: CategoryNameMap | null): string[] => {
        const names: string[] = [];

        for (const subCategoryMap of categoryMap?.values() ?? []) {
            for (const category of subCategoryMap.values()) {
                names.push(category.name);
            }
        }

        return names;
    };

    const systemPromptParams: Record<string, string> = {
        CurrentDateTime: formatUnixTimeToLongDateTime(Math.floor(Date.now() / 1000), defaultTimezone),
        AllExpenseCategoryNames: getCategoryNames(expenseCategoryMap).join('\n'),
        AllIncomeCategoryNames: getCategoryNames(incomeCategoryMap).join('\n'),
        AllTransferCategoryNames: getCategoryNames(transferCategoryMap).join('\n'),
        AllAccountNames: [...(accountMap?.values() ?? [])].map(account => account.name).join('\n'),
        AllTagNames: [...(tagMap?.values() ?? [])].map(tag => tag.name).join('\n'),
        AdditionalNotes: additionalPrompt,
    };

    try {
        return getTemplate(templateName).execute(systemPromptParams).replaceAll('\r\n', '\n');
    } catch (err) {
        log.errorf(c, `[ai_recognized_transaction_data_parser.buildRecognitionSystemPrompt] failed to render prompt template for user "uid:${user.uid}", because ${(err as Error).message}`);
        throw errs.ErrOperationFailed;
    }
}

function parseRecognizedResult(c: Context, user: User, content: string): (RecognizedTransactionResult | null)[] {
    if (content.length === 0 || content.startsWith('[]')) {
        throw errs.ErrNotFoundTransactionDataInFile;
    }

    let transactions: (RecognizedTransactionResult | null)[] | null = null;

    try {
        const obj = goJsonUnmarshalObject(content, 'ai.aiTransactionDataParsedResult');

        if (obj) {
            const value = goJsonField(obj, 'transactions');

            if (value !== undefined && value !== null) {
                if (!Array.isArray(value)) {
                    throw new Error('json: cannot unmarshal into Go struct field aiTransactionDataParsedResult.transactions');
                }

                transactions = value.map(recognizedTransactionResultFromJson);
            }
        }
    } catch (err) {
        log.errorf(c, `[ai_recognized_transaction_data_parser.parseRecognizedResult] failed to unmarshal batch llm response "${content}" for user "uid:${user.uid}", because ${(err as Error).message}`);
        throw errs.ErrOperationFailed;
    }

    if (!transactions || transactions.length < 1) {
        throw errs.ErrNotFoundTransactionDataInFile;
    }

    return transactions;
}

async function getImportTransactionResponse(ctx: Context, user: User, results: (RecognizedTransactionResult | null)[], defaultTimezone: Timezone, additionalOptions: TransactionDataImporterOptions, accountMap: AccountNameMap | null, expenseCategoryMap: CategoryNameMap | null, incomeCategoryMap: CategoryNameMap | null, transferCategoryMap: CategoryNameMap | null, tagMap: TagNameMap | null): Promise<ImportedDataResult> {
    const transactionDataTable = new AIRecognizedTransactionDataTable(results);
    const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(aiRecognizedTransactionTypeNameMapping);
    return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
}

// AIRecognizedTextTransactionDataImporter returns the imported transaction data parsed by AI text recognition
export const AIRecognizedTextTransactionDataImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, fileData, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const config = additionalOptions.currentConfig;

        if (!isTextRecognitionEnabled(config)) {
            throw errs.ErrLargeLanguageModelProviderNotEnabled;
        }

        const text = fileData.toString('utf8').trim();

        if (text.length === 0) {
            log.warnf(ctx, `[ai_recognized_transaction_data_parser.parseText] input text is empty for user "uid:${user.uid}"`);
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        const systemPrompt = buildRecognitionSystemPrompt(ctx, user, SYSTEM_PROMPT_BATCH_TRANSACTION_TEXT_RECOGNITION, additionalOptions.aiAdditionalPrompt, defaultTimezone, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);

        const llmRequest: LargeLanguageModelRequest = {
            stream: false,
            systemPrompt: systemPrompt,
            userPrompt: Buffer.from(text, 'utf8'),
            userPromptType: LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_TEXT,
            userPromptContentType: '',
            responseJsonSchema: null,
        };

        let content: string;

        try {
            content = (await LLMContainer.getJsonResponseByTextRecognitionModel(ctx, user.uid, config, llmRequest)).content;
        } catch (err) {
            log.errorf(ctx, `[ai_recognized_transaction_data_parser.parseText] failed to get llm response for user "uid:${user.uid}", because ${(err as Error).message}`);
            throw errs.ErrOperationFailed;
        }

        const results = parseRecognizedResult(ctx, user, content);
        return getImportTransactionResponse(ctx, user, results, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};

// AIRecognizedImageTransactionDataImporter returns the imported transaction data parsed by AI image recognition
export const AIRecognizedImageTransactionDataImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, fileData, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const config = additionalOptions.currentConfig;

        if (!isImageRecognitionEnabled(config)) {
            throw errs.ErrLargeLanguageModelProviderNotEnabled;
        }

        if (fileData.length === 0) {
            log.warnf(ctx, `[ai_recognized_transaction_data_parser.parseImage] input image is empty for user "uid:${user.uid}"`);
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        const systemPrompt = buildRecognitionSystemPrompt(ctx, user, SYSTEM_PROMPT_BATCH_RECEIPT_IMAGE_RECOGNITION, additionalOptions.aiAdditionalPrompt, defaultTimezone, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);

        const llmRequest: LargeLanguageModelRequest = {
            stream: false,
            systemPrompt: systemPrompt,
            userPrompt: fileData,
            userPromptType: LARGE_LANGUAGE_MODEL_REQUEST_PROMPT_TYPE_IMAGE_URL,
            userPromptContentType: additionalOptions.aiImageContentType,
            responseJsonSchema: null,
        };

        let content: string;

        try {
            content = (await LLMContainer.getJsonResponseByReceiptImageRecognitionModel(ctx, user.uid, config, llmRequest)).content;
        } catch (err) {
            log.errorf(ctx, `[ai_recognized_transaction_data_parser.parseImage] failed to get llm response for user "uid:${user.uid}", because ${(err as Error).message}`);
            throw errs.ErrOperationFailed;
        }

        const results = parseRecognizedResult(ctx, user, content);
        return getImportTransactionResponse(ctx, user, results, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
