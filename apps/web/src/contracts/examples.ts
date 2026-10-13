import type { OpenApiDocument } from './openapi';

/**
 * Example OpenAPI documents (ADR-029), one per service, named `<service-definition-id>.openapi.json`.
 * They stand in for ingested specifications and are labelled as examples wherever they show.
 */
const files = import.meta.glob<OpenApiDocument>('./examples/*.openapi.json', { eager: true, import: 'default' });

export const exampleOpenApi: ReadonlyMap<string, { file: string; doc: OpenApiDocument }> = new Map(
  Object.entries(files).map(([path, doc]) => {
    const file = path.split('/').pop() ?? path;
    return [file.replace(/\.openapi\.json$/, ''), { file, doc }];
  }),
);
