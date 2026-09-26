import { ApplicationName } from './types';

export const TokenUserAgentCreatedViaCli = ApplicationName + ' Cli';
export const TokenUserAgentForAPI = ApplicationName + ' API';
export const TokenUserAgentForMCP = ApplicationName + ' MCP';

export type TokenType = number;

export const USER_TOKEN_TYPE_NORMAL = 1;
export const USER_TOKEN_TYPE_REQUIRE_2FA = 2;
export const USER_TOKEN_TYPE_EMAIL_VERIFY = 3;
export const USER_TOKEN_TYPE_PASSWORD_RESET = 4;
export const USER_TOKEN_TYPE_MCP = 5;
export const USER_TOKEN_TYPE_OAUTH2_CALLBACK_REQUIRE_VERIFY = 6;
export const USER_TOKEN_TYPE_OAUTH2_CALLBACK = 7;
export const USER_TOKEN_TYPE_API = 8;

// UserTokenClaims represents the claims of the jwt token (uid is serialized as string "jti")
export interface UserTokenClaims {
    userTokenId: string;
    uid: bigint;
    username: string;
    type: TokenType;
    issuedAt: number;
    expiresAt: number;
}
