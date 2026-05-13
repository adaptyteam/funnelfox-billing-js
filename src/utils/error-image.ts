import { DEFAULTS, SDK_VERSION } from '../constants';

type ErrorImageContext = Record<
  string,
  string | number | boolean | null | undefined
>;

const MAX_QUERY_LENGTH = 1800;

export function getErrorImage(
  orgId: string,
  options: {
    message: string;
    code?: string;
    req_id?: string;
    baseUrl?: string;
    context?: ErrorImageContext;
  }
) {
  if (typeof document === 'undefined') {
    return;
  }

  const params = new URLSearchParams({
    message: truncate(options.message, 500),
    code: options.code || 'SDK_ERROR',
    timestamp: Date.now().toString(),
    sdk_version: SDK_VERSION,
  });
  if (options.req_id) {
    appendIfFits(params, 'req_id', options.req_id, MAX_QUERY_LENGTH);
  }
  if (options.context) {
    Object.entries(options.context).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        appendIfFits(
          params,
          key,
          truncate(String(value), 1000),
          MAX_QUERY_LENGTH
        );
      }
    });
  }
  const origin = (options.baseUrl || DEFAULTS.BASE_URL).replace(/\/$/, '');
  const url = `${origin}/sdk_report/${encodeURIComponent(orgId)}/crash?${params.toString()}`;
  const img = new Image();
  img.src = url;
  img.style.display = 'none';
  img.onload = () => {
    img.remove();
  };
  img.onerror = () => {
    img.remove();
  };
  (document.body || document.documentElement)?.appendChild(img);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function appendIfFits(
  params: URLSearchParams,
  key: string,
  value: string,
  maxLength: number
): boolean {
  const nextParams = new URLSearchParams(params);
  nextParams.append(key, value);
  if (nextParams.toString().length > maxLength) {
    return false;
  }
  params.append(key, value);
  return true;
}
