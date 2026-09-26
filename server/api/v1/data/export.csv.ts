import * as dataManagements from '~~/server/lib/api/data_managements';
import { bindCsv, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: apiV1Group,
    enabled: config => config.enableDataExport,
    handler: bindCsv(dataManagements.exportDataToEzbookkeepingCSVHandler),
});
