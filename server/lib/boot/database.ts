import type { Context } from '../core/context';
import { Container as DataStoreContainer } from '../datastore/index';
import * as log from '../log/index';
import {
    AccountTable,
    BudgetTable,
    InsightsExplorerTable,
    TokenRecordTable,
    TransactionCategoryTable,
    TransactionPictureInfoTable,
    TransactionTable,
    TransactionTagGroupTable,
    TransactionTagIndexTable,
    TransactionTagTable,
    TransactionTemplateTable,
    TwoFactorRecoveryCodeTable,
    TwoFactorTable,
    UserApplicationCloudSettingTable,
    UserCustomExchangeRateTable,
    UserCustomIconTable,
    UserExternalAuthTable,
    UserTable,
} from '../models/index';

// updateAllDatabaseTablesStructure creates or updates the structure of all database tables
export async function updateAllDatabaseTablesStructure(c: Context): Promise<void> {
    const steps: [typeof DataStoreContainer.userStore, Parameters<typeof DataStoreContainer.userStore.syncStructs>[0], string][] = [
        [DataStoreContainer.userStore, UserTable, 'user table'],
        [DataStoreContainer.userStore, TwoFactorTable, 'two-factor table'],
        [DataStoreContainer.userStore, TwoFactorRecoveryCodeTable, 'two-factor recovery code table'],
        [DataStoreContainer.tokenStore, TokenRecordTable, 'token record table'],
        [DataStoreContainer.userDataStore, AccountTable, 'account table'],
        [DataStoreContainer.userDataStore, TransactionTable, 'transaction table'],
        [DataStoreContainer.userDataStore, TransactionCategoryTable, 'transaction category table'],
        [DataStoreContainer.userDataStore, TransactionTagGroupTable, 'transaction tag group table'],
        [DataStoreContainer.userDataStore, TransactionTagTable, 'transaction tag table'],
        [DataStoreContainer.userDataStore, TransactionTagIndexTable, 'transaction tag index table'],
        [DataStoreContainer.userDataStore, TransactionTemplateTable, 'transaction template table'],
        [DataStoreContainer.userDataStore, TransactionPictureInfoTable, 'transaction picture table'],
        [DataStoreContainer.userDataStore, UserCustomIconTable, 'user custom icon table'],
        [DataStoreContainer.userDataStore, UserCustomExchangeRateTable, 'user custom exchange rate table'],
        [DataStoreContainer.userDataStore, UserApplicationCloudSettingTable, 'user application cloud settings table'],
        [DataStoreContainer.userDataStore, UserExternalAuthTable, 'user external auth table'],
        [DataStoreContainer.userDataStore, InsightsExplorerTable, 'insights explorer table'],
        [DataStoreContainer.userDataStore, BudgetTable, 'budget table'],
    ];

    for (const [store, table, name] of steps) {
        await store.syncStructs(table);
        log.bootInfof(c, `[database.updateAllDatabaseTablesStructure] ${name} maintained successfully`);
    }
}
