export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem('mw_access_token');
}

export function clearAccessToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.removeItem('mw_access_token');
  localStorage.removeItem('mw_active_workspace_id');
}
