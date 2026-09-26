import * as errs from '../errs/index';
import type { Config } from '../settings/settings';
import { createDriver, type DbDriver, type DbExecutor } from './driver';
import type { TableDef } from './schema';
import { Session } from './session';
import { syncTable } from './sync';

export * from './driver';
export * from './schema';
export * from './session';
export * from './values';

// ContextIdProvider is the minimal context used by database sessions
export interface ContextIdProvider {
    getContextId(): string;
}

// Database represents a database connection
export class Database {
    public readonly databaseType: string;
    private readonly driver: DbDriver;

    public constructor(databaseType: string, driver: DbDriver) {
        this.databaseType = databaseType;
        this.driver = driver;
    }

    public newSession(c?: ContextIdProvider | null): Session {
        return new Session(this.driver, c?.getContextId());
    }

    // doTransaction executes the function in a database transaction, the transaction will be rolled back if error is thrown
    public async doTransaction<R>(c: ContextIdProvider | null | undefined, fn: (sess: Session) => Promise<R>): Promise<R> {
        return this.driver.transaction(async (tx: DbExecutor) => fn(new Session(tx, c?.getContextId())));
    }

    public async setSavePoint(sess: Session, savePointName: string): Promise<void> {
        if (this.databaseType === 'postgres') {
            await sess.exec('SAVEPOINT ' + savePointName);
        }
    }

    public async rollbackToSavePoint(sess: Session, savePointName: string): Promise<void> {
        if (this.databaseType === 'postgres') {
            await sess.exec('ROLLBACK TO SAVEPOINT ' + savePointName);
        }
    }

    public async syncStructs(...tables: TableDef<unknown>[]): Promise<void> {
        for (const table of tables) {
            await syncTable(this.driver, table);
        }
    }

    public async close(): Promise<void> {
        await this.driver.close();
    }
}

// DataStore represents a data storage containing a series of database shards
export class DataStore {
    private readonly databases: Database[];

    public constructor(...databases: Database[]) {
        if (databases.length < 1) {
            throw errs.ErrDatabaseIsNull;
        }

        this.databases = databases;
    }

    public count(): number {
        return this.databases.length;
    }

    public get(index: number): Database {
        return this.databases[index]!;
    }

    public choose(_key: bigint): Database {
        return this.databases[0]!;
    }

    public query(c: ContextIdProvider | null | undefined, key: bigint): Session {
        return this.choose(key).newSession(c);
    }

    public async doTransaction<R>(key: bigint, c: ContextIdProvider | null | undefined, fn: (sess: Session) => Promise<R>): Promise<R> {
        return this.choose(key).doTransaction(c, fn);
    }

    public async syncStructs(...tables: TableDef<unknown>[]): Promise<void> {
        for (const database of this.databases) {
            await database.syncStructs(...tables);
        }
    }
}

// DataStoreContainer contains all data storages
class DataStoreContainer {
    public userStore!: DataStore;
    public tokenStore!: DataStore;
    public userDataStore!: DataStore;
    private database: Database | null = null;

    public async close(): Promise<void> {
        await this.database?.close();
    }

    public setDatabase(database: Database): void {
        this.database = database;
        this.userStore = new DataStore(database);
        this.tokenStore = new DataStore(database);
        this.userDataStore = new DataStore(database);
    }
}

export const Container = new DataStoreContainer();

// initializeDataStore initializes all data storages according to the config
export async function initializeDataStore(config: Config): Promise<void> {
    const driver = await createDriver(config.databaseConfig);
    Container.setDatabase(new Database(config.databaseConfig.databaseType, driver));
}
