// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Parsing and validation for the user-configured LanguageTool server URL.
 *
 * Drafts are the most sensitive content in the app, so the rules are strict:
 *
 * - only `http:` and `https:` are allowed;
 * - `http:` is only allowed for loopback hosts;
 * - credentials, query strings, fragments and search parameters are rejected;
 * - the path is normalised so that `/v2/check` can be appended safely.
 */

export type ResolvedEndpointType = Readonly<{
  /** Normalised base URL, without a trailing slash. */
  baseUrl: string;
  /** True when the host is the local machine. */
  isLoopback: boolean;
}>;

export type EndpointResultType =
  | Readonly<{ ok: true; endpoint: ResolvedEndpointType }>
  | Readonly<{
      ok: false;
      error: 'unconfigured' | 'invalidEndpoint' | 'insecureEndpoint';
    }>;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(normalized);
}

/**
 * Returns the base URL to use for API calls, or an error describing why the
 * configured value cannot be used.
 */
export function resolveEndpoint(raw: string | undefined): EndpointResultType {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'unconfigured' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'invalidEndpoint' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'invalidEndpoint' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'invalidEndpoint' };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, error: 'invalidEndpoint' };
  }
  if (!parsed.hostname) {
    return { ok: false, error: 'invalidEndpoint' };
  }

  const isLoopback = isLoopbackHost(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLoopback) {
    return { ok: false, error: 'insecureEndpoint' };
  }

  const path = parsed.pathname.replace(/\/+$/, '');

  return {
    ok: true,
    endpoint: {
      baseUrl: `${parsed.protocol}//${parsed.host}${path}`,
      isLoopback,
    },
  };
}

export function buildApiUrl(
  endpoint: ResolvedEndpointType,
  apiPath: string
): string {
  return `${endpoint.baseUrl}${apiPath}`;
}
