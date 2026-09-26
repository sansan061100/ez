import { createHmac, timingSafeEqual } from 'node:crypto';

import type { UserTokenClaims } from '../core/token_claims';

// JwtError represents the error of parsing jwt token (similar to golang-jwt error types)
export class JwtError extends Error {
    public readonly kind: 'malformed' | 'unverifiable' | 'signature_invalid' | 'expired' | 'used_before_issued';
    public override readonly cause?: unknown;

    public constructor(kind: JwtError['kind'], message: string, cause?: unknown) {
        super(message);
        this.name = 'JwtError';
        this.kind = kind;
        this.cause = cause;
    }
}

function base64UrlEncode(data: Buffer | string): string {
    return Buffer.from(data).toString('base64url');
}

function base64UrlDecode(text: string): Buffer {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) {
        throw new JwtError('malformed', 'token is malformed: could not base64 decode');
    }

    return Buffer.from(text, 'base64url');
}

// claimsToJson serializes claims with the same field order as the go struct
function claimsToJson(claims: UserTokenClaims): string {
    const data: Record<string, unknown> = {
        userTokenId: claims.userTokenId,
        jti: claims.uid.toString(),
    };

    if (claims.username !== '') {
        data['username'] = claims.username;
    }

    data['type'] = claims.type;
    data['iat'] = claims.issuedAt;
    data['exp'] = claims.expiresAt;

    return JSON.stringify(data);
}

// signJwt signs the claims with HS256 algorithm
export function signJwt(claims: UserTokenClaims, secret: string): string {
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64UrlEncode(claimsToJson(claims));
    const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest();

    return `${header}.${payload}.${base64UrlEncode(signature)}`;
}

function toInteger(value: unknown): number {
    if (typeof value === 'number') {
        return Math.trunc(value);
    }

    if (value === undefined || value === null) {
        return 0;
    }

    throw new JwtError('malformed', 'token is malformed: could not JSON decode claim');
}

// parseJwtClaims parses the payload of jwt token without verifying signature
export function parseJwtClaims(tokenString: string): [UserTokenClaims, Buffer, string] {
    const parts = tokenString.split('.');

    if (parts.length !== 3) {
        throw new JwtError('malformed', 'token is malformed: token contains an invalid number of segments');
    }

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;

    try {
        header = JSON.parse(base64UrlDecode(parts[0]!).toString()) as Record<string, unknown>;
    } catch (err) {
        throw err instanceof JwtError ? err : new JwtError('malformed', 'token is malformed: could not JSON decode header');
    }

    try {
        payload = JSON.parse(base64UrlDecode(parts[1]!).toString()) as Record<string, unknown>;
    } catch (err) {
        throw err instanceof JwtError ? err : new JwtError('malformed', 'token is malformed: could not JSON decode claim');
    }

    if (typeof payload !== 'object' || payload === null) {
        throw new JwtError('malformed', 'token is malformed: could not JSON decode claim');
    }

    const jti = payload['jti'];

    if (jti !== undefined && (typeof jti !== 'string' || !/^-?\d+$/.test(jti))) {
        throw new JwtError('malformed', 'token is malformed: could not JSON decode claim');
    }

    const claims: UserTokenClaims = {
        userTokenId: typeof payload['userTokenId'] === 'string' ? payload['userTokenId'] : '',
        uid: typeof jti === 'string' ? BigInt(jti) : 0n,
        username: typeof payload['username'] === 'string' ? payload['username'] : '',
        type: toInteger(payload['type']),
        issuedAt: toInteger(payload['iat']),
        expiresAt: toInteger(payload['exp']),
    };

    if (header['alg'] !== 'HS256') {
        throw new JwtError('signature_invalid', 'token signature is invalid: signing method is invalid');
    }

    return [claims, base64UrlDecode(parts[2]!), `${parts[0]}.${parts[1]}`];
}

// parseAndVerifyJwt parses jwt token, gets the secret key via keyFunc and verifies the signature and claims
export async function parseAndVerifyJwt(tokenString: string, keyFunc: (claims: UserTokenClaims) => Promise<string>): Promise<UserTokenClaims> {
    const [claims, signature, signingInput] = parseJwtClaims(tokenString);
    let secret: string;

    try {
        secret = await keyFunc(claims);
    } catch (err) {
        throw new JwtError('unverifiable', 'token is unverifiable: error while executing keyfunc', err);
    }

    const expectedSignature = createHmac('sha256', secret).update(signingInput).digest();

    if (signature.length !== expectedSignature.length || !timingSafeEqual(signature, expectedSignature)) {
        throw new JwtError('signature_invalid', 'token signature is invalid: signature is invalid');
    }

    const now = Math.floor(Date.now() / 1000);

    if (claims.expiresAt !== 0 && now > claims.expiresAt) {
        throw new JwtError('expired', 'token has invalid claims: token is expired');
    }

    if (claims.issuedAt !== 0 && now < claims.issuedAt) {
        throw new JwtError('used_before_issued', 'token has invalid claims: token used before issued');
    }

    return claims;
}
