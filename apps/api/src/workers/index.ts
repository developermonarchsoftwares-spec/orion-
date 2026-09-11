/**
 * Orion Worker Registry
 * Background queue workers for data enrichment, import ingestion, duplicate resolution,
 * and typesense syncing will register their worker instances here in subsequent phases.
 */

export const WORKER_REGISTRY = {
  description: 'Orion Background Queue Worker Registry Infrastructure',
  initialized: true,
};
