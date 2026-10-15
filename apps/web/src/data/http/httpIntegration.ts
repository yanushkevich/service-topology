import { ApiError, type ApiClient } from './apiClient';
import type { IntegrationStatus, SourceCheck, SourceIntegration, SyncPreview } from '../integrations/sourceIntegration';

/** The Dynatrace connector over the backend API (ADR-034). Every write is a backend use case. */
export function createHttpSourceIntegration(api: ApiClient): SourceIntegration {
  const base = '/integrations/dynatrace';
  return {
    async status(signal) {
      try {
        return await api.get<IntegrationStatus>(base, signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    async check() {
      return (await api.send<{ items: SourceCheck[] }>('POST', `${base}/check`))?.items ?? [];
    },
    async preview() {
      const preview = await api.send<SyncPreview>('POST', `${base}/preview`);
      if (!preview) throw new Error('The backend returned no preview.');
      return preview;
    },
    async apply(preview) {
      const res = await api.sendTagged<{ revision: string }>('POST', `${base}/apply`, { previewId: preview.id }, `"${preview.baseRevision}"`);
      return res.data?.revision ?? preview.baseRevision;
    },
    async aliases(signal) {
      const res = await api.getTagged<{ aliases: Record<string, string> }>(`${base}/aliases`, signal);
      return { aliases: res.data.aliases, revision: res.etag };
    },
    async saveAliases(aliases, revision) {
      const res = await api.sendTagged<{ aliases: Record<string, string> }>('PUT', `${base}/aliases`, { aliases }, revision ?? '"0"');
      return { aliases: res.data?.aliases ?? aliases, revision: res.etag };
    },
  };
}
