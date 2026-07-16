import APIClient from '../../api-client';
import { DEFAULTS } from '../../constants';
import type {
  CreateClientSessionResponse,
  StripeClientSessionResponse,
  MetadataType,
} from '../../types';

interface SessionParams {
  orgId: string;
  baseUrl?: string;
  region?: string;
  priceId: string;
  externalId: string;
  email?: string;
  clientMetadata?: MetadataType;
  countryCode?: string;
}

class SessionService {
  private cache = new Map<
    string,
    Promise<CreateClientSessionResponse | StripeClientSessionResponse>
  >();

  private buildCacheKey(p: SessionParams & { integration: string }): string {
    return [
      p.orgId,
      p.baseUrl || DEFAULTS.BASE_URL,
      p.region || DEFAULTS.REGION,
      p.countryCode ?? '',
      p.priceId,
      p.externalId,
      p.email,
      p.integration,
    ].join('|');
  }

  private makeClient(orgId: string, baseUrl?: string): APIClient {
    return new APIClient({
      baseUrl: baseUrl || DEFAULTS.BASE_URL,
      orgId,
      timeout: DEFAULTS.REQUEST_TIMEOUT,
      retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
    });
  }

  createSession(
    p: SessionParams & { integration: 'stripe' }
  ): Promise<StripeClientSessionResponse>;
  createSession(
    p: SessionParams & { integration: 'primer' }
  ): Promise<CreateClientSessionResponse>;
  createSession(
    p: SessionParams & { integration: 'primer' | 'stripe' }
  ): Promise<CreateClientSessionResponse | StripeClientSessionResponse> {
    const key = this.buildCacheKey(p);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const client = this.makeClient(p.orgId, p.baseUrl);
    const req = client.createClientSession({
      priceId: p.priceId,
      externalId: p.externalId,
      email: p.email,
      region: p.region || DEFAULTS.REGION,
      clientMetadata: p.clientMetadata,
      countryCode: p.countryCode,
      integration: p.integration,
    });

    this.cache.set(key, req);
    const evict = () => {
      if (this.cache.get(key) === req) this.cache.delete(key);
    };
    req.then(resp => {
      if (!resp || resp.status === 'error' || !resp.data) evict();
    }, evict);
    return req;
  }

  invalidate(p: SessionParams & { integration: 'primer' | 'stripe' }): void {
    this.cache.delete(this.buildCacheKey(p));
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export default new SessionService();
