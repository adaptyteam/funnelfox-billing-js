import { SDK_VERSION } from '../constants';

export function getErrorImage(
  orgId: string,
  options: {
    message: string;
    code: string;
    req_id?: string;
  }
) {
  const params = new URLSearchParams({
    message: options.message,
    code: options.code,
    timestamp: Date.now().toString(),
    sdk_version: SDK_VERSION,
  });
  if (options.req_id) {
    params.append('req_id', options.req_id);
  }
  const url = `https://billing.funnelfox.com/sdk_report/${encodeURIComponent(orgId)}/crash?${params.toString()}`;
  const img = new Image();
  img.src = url;
  img.style.display = 'none';
  document.body.appendChild(img);
}
