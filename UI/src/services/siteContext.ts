const SITE_FILTER_KEY = 'site_filter_id';

export function getSelectedSiteId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SITE_FILTER_KEY);
}

export function setSelectedSiteId(siteId: string | null): void {
  if (typeof window === 'undefined') return;
  if (!siteId) {
    window.localStorage.removeItem(SITE_FILTER_KEY);
    return;
  }
  window.localStorage.setItem(SITE_FILTER_KEY, siteId);
}
