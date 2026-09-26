import type { TransactionCategoryCreateWithSubCategories } from './transaction_category';
import type { TransactionType } from './transaction';
import type { UserBasicInfo } from './user';
import type { ApplicationCloudSetting } from './user_app_cloud_setting';

// auth_response.go

export interface AuthResponse {
    token: string;
    need2FA: boolean;
    user: UserBasicInfo | null;
    applicationCloudSettings?: ApplicationCloudSetting[];
    notificationContent?: string;
}

export type RegisterResponse = AuthResponse & {
    needVerifyEmail: boolean;
    presetCategoriesSaved: boolean;
};

// data_management.go

export interface ClearDataRequest {
    password: string;
}

export interface ClearAccountTransactionsRequest {
    accountId: bigint;
    password: string;
}

export interface DataStatisticsResponse {
    totalAccountCount: string;
    totalTransactionCategoryCount: string;
    totalTransactionTagCount: string;
    totalTransactionCount: string;
    totalTransactionPictureCount: string;
    totalExplorationCount: string;
    totalTransactionTemplateCount: string;
    totalScheduledTransactionCount: string;
    totalCustomIconCount: string;
}

export interface ExportTransactionDataRequest {
    type: TransactionType;
    categoryIds: string;
    accountIds: string;
    tagFilter: string;
    amountFilter: string;
    keyword: string;
    matchMode: number;
    maxTime: number;
    minTime: number;
}

// forget_password.go

export interface ForgetPasswordRequest {
    email: string;
}

export interface PasswordResetRequest {
    email: string;
    password: string;
}

// large_language_model.go

export interface TransactionTextRecognitionRequest {
    text: string;
}

export interface RecognizedTransactionResponse {
    type: TransactionType;
    time?: number;
    categoryId?: bigint;
    sourceAccountId?: bigint;
    destinationAccountId?: bigint;
    sourceAmount?: number;
    destinationAmount?: number;
    tagIds?: string[];
    comment?: string;
}

// RecognizedTransactionResult represents the result of transaction recognized by large language model
export interface RecognizedTransactionResult {
    type?: string;
    time: string;
    amount?: string;
    account?: string;
    category?: string;
    tags?: string[];
    description?: string;
    destination_amount?: string;
    destination_account?: string;
}

// RecognizedTransactionResultJsonSchema is the json schema of RecognizedTransactionResult (same as invopop/jsonschema output with anonymous, expanded struct and empty version)
export const RecognizedTransactionResultJsonSchema = {
    'properties': {
        'type': {
            'type': 'string',
            'enum': ['income', 'expense', 'transfer'],
            'description': 'Transaction type (income, expense, transfer)',
        },
        'time': {
            'type': 'string',
            'format': 'date-time',
            'description': 'Transaction time in long date time format (YYYY-MM-DD HH:mm:ss, e.g. 2023-01-01 12:00:00)',
        },
        'amount': {
            'type': 'string',
            'description': 'Transaction amount',
        },
        'account': {
            'type': 'string',
            'description': 'Account name for the transaction',
        },
        'category': {
            'type': 'string',
            'description': 'Category name for the transaction',
        },
        'tags': {
            'items': {
                'type': 'string',
            },
            'type': 'array',
            'description': 'List of tags associated with the transaction (maximum 10 tags allowed)',
        },
        'description': {
            'type': 'string',
            'description': 'Transaction description',
        },
        'destination_amount': {
            'type': 'string',
            'description': 'Destination amount for transfer transactions',
        },
        'destination_account': {
            'type': 'string',
            'description': 'Destination account name for transfer transactions',
        },
    },
    'additionalProperties': false,
    'type': 'object',
    'required': ['time'],
};

// oauth2.go

export interface OAuth2LoginRequest {
    platform: string;
    clientSessionId: string;
    token: string;
}

export interface OAuth2CallbackRequest {
    state: string;
    code: string;
    error: string;
    errorDescription: string;
}

export interface OAuth2CallbackLoginRequest {
    password: string;
    passcode: string;
    token: string;
}

export type { TransactionCategoryCreateWithSubCategories };
