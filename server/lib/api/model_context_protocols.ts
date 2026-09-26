import type { JSONRPCRequest } from '../core/json_rpc';
import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_MCP_ACCESS } from '../core/feature_restriction';
import { ApplicationName, buildInfo } from '../core/types';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { Container as MCPContainer, LatestSupportedMCPVersion, MCPProtocolVersionHeaderName, SupportedMCPVersion, ToolResultStructuredContentMinVersion } from '../mcp/index';
import type { TokenRecord, User } from '../models/index';
import { Tokens } from '../services/tokens';
import { Users } from '../services/users';
import { stringToInt64 } from '../utils/converter';
import { goJsonField } from '../utils/gojson';
import type { WebContext } from '../web/context';
import { currentConfig, errMsg } from './base';

const P = 'model_context_protocols';
const mcpServerName = ApplicationName + '-mcp';

async function getUserWithMCPAccess(c: WebContext, handler: string): Promise<User> {
    const uid = c.getCurrentUid();
    let user: User;

    try {
        user = await Users.getUserById(c, uid);
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] failed to get user "uid:${uid}" info, because ${errMsg(err)}`);
        throw errs.ErrUserNotFound;
    }

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_MCP_ACCESS)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    return user;
}

// getParamsObject returns the params object like go json.Unmarshal into struct (throws if params is absent)
function getParamsObject(request: JSONRPCRequest): Record<string, unknown> {
    if (request.params === undefined) {
        throw errs.ErrIncompleteOrIncorrectSubmission;
    }

    if (request.params === null) {
        return {};
    }

    if (typeof request.params !== 'object' || Array.isArray(request.params)) {
        throw errs.newIncompleteOrIncorrectSubmissionError(new Error('json: cannot unmarshal into Go value of struct type'));
    }

    return request.params as Record<string, unknown>;
}

function getStringParam(params: Record<string, unknown>, key: string): string {
    const value = goJsonField(params, key);

    if (value === undefined || value === null) {
        return '';
    }

    if (typeof value !== 'string') {
        throw errs.newIncompleteOrIncorrectSubmissionError(new Error(`json: cannot unmarshal ${typeof value} into Go struct field .${key} of type string`));
    }

    return value;
}

// initializeHandler returns the initialize response of mcp server
export async function initializeHandler(c: WebContext, request: JSONRPCRequest): Promise<unknown> {
    const handler = 'InitializeHandler';
    const params = getParamsObject(request);
    const requestedVersion = getStringParam(params, 'protocolVersion');
    const uid = c.getCurrentUid();
    await getUserWithMCPAccess(c, handler);

    const tokenClaims = c.getTokenClaims();

    if (tokenClaims) {
        let userTokenId: bigint | null = null;

        try {
            userTokenId = stringToInt64(tokenClaims.userTokenId);
        } catch (err) {
            log.warnf(c, `[${P}.${handler}] parse user token id failed, because ${errMsg(err)}`);
        }

        if (userTokenId !== null) {
            const tokenRecord = {
                uid: tokenClaims.uid,
                userTokenId: userTokenId,
                createdUnixTime: tokenClaims.issuedAt,
            } as TokenRecord;

            const tokenId = Tokens.generateTokenId(tokenRecord);

            try {
                await Tokens.updateTokenLastSeen(c, tokenRecord);
            } catch (err) {
                log.warnf(c, `[${P}.${handler}] failed to update last seen of token "id:${tokenId}" for user "uid:${uid}", because ${errMsg(err)}`);
            }
        }
    }

    const protocolVersion = SupportedMCPVersion.has(requestedVersion) ? requestedVersion : LatestSupportedMCPVersion;

    return {
        protocolVersion: protocolVersion,
        capabilities: {
            tools: {
                listChanged: false,
            },
        },
        serverInfo: {
            name: mcpServerName,
            title: ApplicationName,
            version: buildInfo.version,
        },
    };
}

// listResourcesHandler returns the resources list of mcp server
export async function listResourcesHandler(c: WebContext): Promise<unknown> {
    await getUserWithMCPAccess(c, 'ListResourcesHandler');
    return { resources: [] };
}

// readResourceHandler returns the resource content of mcp server
export async function readResourceHandler(c: WebContext, request: JSONRPCRequest): Promise<unknown> {
    const params = getParamsObject(request);
    getStringParam(params, 'uri');
    await getUserWithMCPAccess(c, 'ReadResourceHandler');
    throw errs.ErrApiNotFound;
}

// listToolsHandler returns the tools list of mcp server
export async function listToolsHandler(c: WebContext): Promise<unknown> {
    await getUserWithMCPAccess(c, 'ListToolsHandler');
    const mcpVersion = c.getHeader(MCPProtocolVersionHeaderName);
    const toolsInfo = MCPContainer.getMCPTools() ?? [];

    const tools = toolsInfo.map(tool => {
        const finalTool: Record<string, unknown> = {
            name: tool['name'],
            inputSchema: tool['inputSchema'],
        };

        if (mcpVersion >= ToolResultStructuredContentMinVersion && tool['outputSchema'] !== undefined) {
            finalTool['outputSchema'] = tool['outputSchema'];
        }

        if (tool['title']) {
            finalTool['title'] = tool['title'];
        }

        if (tool['description']) {
            finalTool['description'] = tool['description'];
        }

        return finalTool;
    });

    return { tools: tools };
}

// callToolHandler calls the specified tool of mcp server
export async function callToolHandler(c: WebContext, request: JSONRPCRequest): Promise<unknown> {
    const user = await getUserWithMCPAccess(c, 'CallToolHandler');
    const params = getParamsObject(request);
    const name = getStringParam(params, 'name');
    const argumentsValue = goJsonField(params, 'arguments');

    try {
        return await MCPContainer.handleTool(c, { name: name, arguments: argumentsValue }, user, currentConfig());
    } catch (err) {
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// pingHandler returns an empty object
export async function pingHandler(_c: WebContext): Promise<unknown> {
    return {};
}
