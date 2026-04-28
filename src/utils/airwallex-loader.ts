/**
 * @fileoverview Airwallex device fingerprinting script loader
 */

import { loadScript } from './script-loader';

/**
 * Loads Airwallex device fingerprinting script for fraud prevention.
 * The script collects browser, screen, device, and interaction data.
 *
 * @param sessionId - Unique order session ID (UUID v4 format, max 128 chars)
 * @param isDemoMode - If true, uses demo environment URL for testing
 * @returns Promise that resolves when script is loaded
 *
 * @see https://www.airwallex.com/docs/payments/online-payments/native-api/device-fingerprinting
 */
export async function loadAirwallexDeviceFingerprint(
  sessionId: string,
  isLivemode: boolean = true
): Promise<void> {
  const scriptId = 'airwallex-fraud-api';
  const src = isLivemode
    ? 'https://static.airwallex.com/webapp/fraud/device-fingerprint/index.js'
    : 'https://static-demo.airwallex.com/webapp/fraud/device-fingerprint/index.js';

  await loadScript({
    id: scriptId,
    src,
    async: true,
    attributes: {
      'data-order-session-id': sessionId,
    },
  });
}
