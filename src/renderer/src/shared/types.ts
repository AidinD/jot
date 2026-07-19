// Types moved to the framework-agnostic core (src/core/types.ts) as part of the
// core/UI split (DECISIONS 2026-07-18). This re-export keeps the `@shared/types`
// alias working for the renderer during the incremental migration; new code
// should import from the core directly. Remove once all importers point at core.
export * from '../../../core/types'
