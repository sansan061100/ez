import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { type Budget, type BudgetSaveItemRequest, BudgetTable } from '../models/index';
import { nowUnix, ServiceBase } from './base';

// BudgetsService represents budget service
export class BudgetsService extends ServiceBase {
    // getAllBudgetsByUid returns all budgets of user
    public async getAllBudgetsByUid(c: Context, uid: bigint): Promise<Budget[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=?', uid).find(BudgetTable);
    }

    // saveAllBudgets replaces all budgets of user with the specified budgets
    public async saveAllBudgets(c: Context, uid: bigint, items: BudgetSaveItemRequest[]): Promise<Budget[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();
        const budgets: Budget[] = items.map(item => ({
            uid: uid,
            categoryId: item.categoryId,
            amount: item.amount,
            createdUnixTime: now,
            updatedUnixTime: now,
        }));

        await this.userDataDB(uid).doTransaction(c, async sess => {
            await sess.where('uid=?', uid).delete(BudgetTable);

            for (const budget of budgets) {
                await sess.insert(BudgetTable, budget);
            }
        });

        return budgets;
    }

    // deleteAllBudgets deletes all budgets of user
    public async deleteAllBudgets(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.userDataDB(uid).newSession(c).where('uid=?', uid).delete(BudgetTable);
    }
}

export const Budgets = new BudgetsService();
