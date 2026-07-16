/**
 * @jest-environment jsdom
 */

import APIClient from '../src/api-client';
import { APIError } from '../src/errors';

describe('APIClient.recalculateTax', () => {
  const client = new APIClient({
    baseUrl: 'https://api.example.com',
    orgId: 'org_123',
  });
  const params = { orderId: 'o1', clientToken: 'ct', countryCode: 'DE' };

  beforeEach(() => (global.fetch as jest.Mock).mockReset());

  test('returns data on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'success',
          data: {
            tax_calculation_id: 'calc_1',
            amount_total: 1190,
            tax_amount: 190,
            currency: 'EUR',
          },
        }),
    } as Response);
    const tax = await client.recalculateTax(params);
    expect(tax.tax_calculation_id).toBe('calc_1');
  });

  test('throws APIError on 200 status:error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'error',
          error: [{ msg: 'invalid postal code', code: 'bad_postal' }],
        }),
    } as Response);
    const err = await client.recalculateTax(params).catch(e => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err.message).toBe('invalid postal code');
  });
});
