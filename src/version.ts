/**
 * SDK version. Must equal the `version` field in package.json;
 * tests/version.test.ts fails if the two drift. Kept as a checked-in constant
 * (not a build-time define) so the ESM, CJS and test builds all read the same value.
 */
export const SDK_VERSION = '0.9.0';

/** Value of the `X-Estuary-Client` header sent on every REST request. */
export const CLIENT_HEADER_NAME = 'X-Estuary-Client';
export const CLIENT_HEADER_VALUE = `estuary-ts-sdk/${SDK_VERSION}`;
