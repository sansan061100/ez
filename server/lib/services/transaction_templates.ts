import type { Context } from '../core/context';
import type { Session } from '../datastore/index';
import * as errs from '../errs/index';
import {
    ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS,
    AccountTable,
    CATEGORY_TYPE_EXPENSE,
    CATEGORY_TYPE_INCOME,
    CATEGORY_TYPE_TRANSFER,
    getTemplateTagIds,
    LevelOneTransactionCategoryParentId,
    TRANSACTION_TEMPLATE_TYPE_NORMAL,
    TRANSACTION_TEMPLATE_TYPE_SCHEDULE,
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_TRANSFER,
    TransactionCategoryTable,
    TransactionTagTable,
    type TransactionTemplate,
    TransactionTemplateTable,
    type TransactionTemplateType,
} from '../models/index';
import { UUID_TYPE_TEMPLATE } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

// TransactionTemplateService represents transaction template service
export class TransactionTemplateService extends ServiceBase {
    // getTotalNormalTemplateCountByUid returns total normal template count of user
    public async getTotalNormalTemplateCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=? AND template_type=?', uid, false, TRANSACTION_TEMPLATE_TYPE_NORMAL).count(TransactionTemplateTable);
    }

    // getTotalScheduledTemplateCountByUid returns total scheduled template count of user
    public async getTotalScheduledTemplateCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=? AND template_type=?', uid, false, TRANSACTION_TEMPLATE_TYPE_SCHEDULE).count(TransactionTemplateTable);
    }

    // getAllTemplatesByUid returns all transaction template models of user
    public async getAllTemplatesByUid(c: Context, uid: bigint, templateType: TransactionTemplateType): Promise<TransactionTemplate[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=? AND template_type=?', uid, false, templateType).find(TransactionTemplateTable);
    }

    // getTemplateByTemplateId returns a transaction template model according to transaction template id
    public async getTemplateByTemplateId(c: Context, uid: bigint, templateId: bigint): Promise<TransactionTemplate> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (templateId <= 0n) {
            throw errs.ErrTransactionTemplateIdInvalid;
        }

        const template = await this.userDataDB(uid).newSession(c).id(templateId).where('uid=? AND deleted=?', uid, false).get(TransactionTemplateTable);

        if (!template) {
            throw errs.ErrTransactionTemplateNotFound;
        }

        return template;
    }

    // getMaxDisplayOrder returns the max display order
    public async getMaxDisplayOrder(c: Context, uid: bigint, templateType: TransactionTemplateType): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const template = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'display_order').where('uid=? AND deleted=? AND template_type=?', uid, false, templateType).orderBy('display_order desc').limit(1).get(TransactionTemplateTable);
        return template ? template.displayOrder : 0;
    }

    // createTemplate saves a new transaction template model to database
    public async createTemplate(c: Context, template: TransactionTemplate): Promise<void> {
        if (template.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        template.templateId = this.generateUuid(UUID_TYPE_TEMPLATE);

        if (template.templateId < 1n) {
            throw errs.ErrSystemIsBusy;
        }

        template.deleted = false;
        template.createdUnixTime = nowUnix();
        template.updatedUnixTime = nowUnix();

        await this.userDataDB(template.uid).doTransaction(c, async sess => {
            await this.isTemplateValid(sess, template);
            await sess.insert(TransactionTemplateTable, template);
        });
    }

    // modifyTemplate saves an existed transaction template model to database
    public async modifyTemplate(c: Context, template: TransactionTemplate): Promise<void> {
        if (template.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        template.updatedUnixTime = nowUnix();

        await this.userDataDB(template.uid).doTransaction(c, async sess => {
            await this.isTemplateValid(sess, template);

            const updatedRows = await sess.id(template.templateId)
                .cols('name', 'type', 'category_id', 'account_id', 'scheduled_frequency_type', 'scheduled_frequency', 'scheduled_start_time', 'scheduled_end_time', 'scheduled_at', 'scheduled_timezone_utc_offset', 'tag_ids', 'amount', 'related_account_id', 'related_account_amount', 'hide_amount', 'comment', 'updated_unix_time')
                .where('uid=? AND deleted=?', template.uid, false)
                .update(TransactionTemplateTable, template);

            if (updatedRows < 1) {
                throw errs.ErrTransactionTemplateNotFound;
            }
        });
    }

    // hideTemplate updates hidden field of given transaction templates
    public async hideTemplate(c: Context, uid: bigint, ids: bigint[], hidden: boolean): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionTemplate> = {
            hidden: hidden,
            updatedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const updatedRows = await sess.cols('hidden', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).in('template_id', ids).update(TransactionTemplateTable, updateModel);

            if (updatedRows < 1) {
                throw errs.ErrTransactionTemplateNotFound;
            }
        });
    }

    // modifyTemplateDisplayOrders updates display order of given transaction templates
    public async modifyTemplateDisplayOrders(c: Context, uid: bigint, templates: TransactionTemplate[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        for (const template of templates) {
            template.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const template of templates) {
                const updatedRows = await sess.id(template.templateId).cols('display_order', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTemplateTable, template);

                if (updatedRows < 1) {
                    throw errs.ErrTransactionTemplateNotFound;
                }
            }
        });
    }

    // deleteTemplate deletes an existed transaction template from database
    public async deleteTemplate(c: Context, uid: bigint, templateId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionTemplate> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const deletedRows = await sess.id(templateId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTemplateTable, updateModel);

            if (deletedRows < 1) {
                throw errs.ErrTransactionTemplateNotFound;
            }
        });
    }

    // deleteAllTemplates deletes all existed transaction templates from database
    public async deleteAllTemplates(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<TransactionTemplate> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(TransactionTemplateTable, updateModel);
        });
    }

    private async isTemplateValid(sess: Session, template: TransactionTemplate): Promise<void> {
        const sourceAccount = await sess.id(template.accountId).where('uid=? AND deleted=?', template.uid, false).get(AccountTable);

        if (!sourceAccount) {
            throw errs.ErrSourceAccountNotFound;
        }

        if (sourceAccount.hidden) {
            throw errs.ErrCannotUseHiddenAccount;
        }

        let destinationAccountType = 0;

        if (template.type === TRANSACTION_TYPE_TRANSFER) {
            if (template.relatedAccountId <= 0n) {
                throw errs.ErrAccountIdInvalid;
            }

            const destinationAccount = await sess.id(template.relatedAccountId).where('uid=? AND deleted=?', template.uid, false).get(AccountTable);

            if (!destinationAccount) {
                throw errs.ErrDestinationAccountNotFound;
            }

            if (destinationAccount.hidden) {
                throw errs.ErrCannotUseHiddenAccount;
            }

            destinationAccountType = destinationAccount.type;
        }

        if (sourceAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS || destinationAccountType === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
            throw errs.ErrCannotAddTransactionToParentAccount;
        }

        const category = await sess.id(template.categoryId).where('uid=? AND deleted=?', template.uid, false).get(TransactionCategoryTable);

        if (!category) {
            throw errs.ErrTransactionCategoryNotFound;
        }

        if (category.hidden) {
            throw errs.ErrCannotUseHiddenTransactionCategory;
        }

        if (category.parentCategoryId === LevelOneTransactionCategoryParentId) {
            throw errs.ErrCannotUsePrimaryCategoryForTransaction;
        }

        if ((template.type === TRANSACTION_TYPE_INCOME && category.type !== CATEGORY_TYPE_INCOME) ||
            (template.type === TRANSACTION_TYPE_EXPENSE && category.type !== CATEGORY_TYPE_EXPENSE) ||
            (template.type === TRANSACTION_TYPE_TRANSFER && category.type !== CATEGORY_TYPE_TRANSFER)) {
            throw errs.ErrTransactionCategoryTypeInvalid;
        }

        const tagIds = getTemplateTagIds(template);
        const tags = await sess.where('uid=? AND deleted=?', template.uid, false).in('tag_id', tagIds).find(TransactionTagTable);

        if (tags.length < tagIds.length) {
            throw errs.ErrTransactionTagNotFound;
        }

        for (const tag of tags) {
            if (tag.hidden) {
                throw errs.ErrCannotUseHiddenTransactionTag;
            }
        }
    }
}

export const TransactionTemplates = new TransactionTemplateService();
