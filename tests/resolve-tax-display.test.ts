import { resolveTaxDisplay } from '../src/utils/helpers';

const nlVat = {
  amount: '1.73',
  percentage: '21',
  inclusive: false,
  tax_type: 'vat',
  country: 'NL',
  subdivision: null,
  taxability_reason: 'standard_rated',
};

const nlVatInfo = {
  amount: '1.73',
  percentage: '21',
  inclusive: false,
  taxType: 'vat',
  country: 'NL',
  subdivision: null,
  taxabilityReason: 'standard_rated',
};

describe('resolveTaxDisplay', () => {
  test.each([
    [
      'older billing without a breakdown',
      { tax_behavior: 'exclusive' as const, tax_amount: 173 },
      { taxBehavior: 'exclusive', taxAmount: 173 },
    ],
    [
      'rate taken from the breakdown, not from rounded minor units',
      {
        tax_behavior: 'exclusive' as const,
        tax_amount: 173,
        tax_breakdown: [nlVat],
      },
      {
        taxBehavior: 'exclusive',
        taxAmount: 173,
        taxRate: 21,
        taxBreakdown: [nlVatInfo],
      },
    ],
    [
      'inclusive price summed across jurisdictions',
      {
        tax_behavior: 'inclusive' as const,
        tax_amount: 0,
        tax_inclusive_amount: 82,
        tax_breakdown: [
          { ...nlVat, amount: '0.37', percentage: '4.0000', inclusive: true },
          { ...nlVat, amount: '0.45', percentage: '4.8750', inclusive: true },
        ],
      },
      {
        taxBehavior: 'inclusive',
        taxAmount: 82,
        taxRate: 8.875,
        taxBreakdown: [
          {
            ...nlVatInfo,
            amount: '0.37',
            percentage: '4.0000',
            inclusive: true,
          },
          {
            ...nlVatInfo,
            amount: '0.45',
            percentage: '4.8750',
            inclusive: true,
          },
        ],
      },
    ],
    [
      'no tax collected',
      { tax_behavior: undefined, tax_amount: 0, tax_breakdown: [] },
      { taxAmount: 0, taxBreakdown: [] },
    ],
    [
      'unparseable percentage',
      {
        tax_behavior: 'exclusive' as const,
        tax_amount: 173,
        tax_breakdown: [{ ...nlVat, percentage: 'n/a' }],
      },
      {
        taxBehavior: 'exclusive',
        taxAmount: 173,
        taxBreakdown: [{ ...nlVatInfo, percentage: 'n/a' }],
      },
    ],
  ])('%s', (_name, source, expected) => {
    expect(resolveTaxDisplay(source)).toStrictEqual(expected);
  });
});
