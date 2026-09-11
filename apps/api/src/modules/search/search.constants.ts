import { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections';

export const BUSINESSES_SEARCH_COLLECTION = 'businesses';

export const BUSINESSES_COLLECTION_SCHEMA: CollectionCreateSchema = {
  name: BUSINESSES_SEARCH_COLLECTION,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string', sort: true },
    { name: 'legal_name', type: 'string', optional: true },
    { name: 'slug', type: 'string' },
    { name: 'status', type: 'string', facet: true },
    { name: 'industry_id', type: 'string', facet: true, optional: true },
    { name: 'industry_name', type: 'string', facet: true, optional: true },
    { name: 'category_id', type: 'string', facet: true, optional: true },
    { name: 'category_name', type: 'string', facet: true, optional: true },
    { name: 'business_type', type: 'string', facet: true, optional: true },
    { name: 'msme_category', type: 'string', facet: true, optional: true },
    { name: 'state', type: 'string', facet: true },
    { name: 'district', type: 'string', facet: true },
    { name: 'city', type: 'string', facet: true },
    { name: 'pincode', type: 'string', facet: true },
    { name: 'has_website', type: 'bool', facet: true },
    { name: 'has_email', type: 'bool', facet: true },
    { name: 'has_phone', type: 'bool', facet: true },
    { name: 'has_gstin', type: 'bool', facet: true },
    { name: 'orion_score', type: 'int32', facet: true, sort: true },
    { name: 'opportunity_tier', type: 'string', facet: true },
    { name: 'completeness_score', type: 'int32', optional: true },
    { name: 'verification_score', type: 'int32', optional: true },
    { name: 'freshness_score', type: 'int32', optional: true },
    { name: 'digital_presence_score', type: 'int32', optional: true },
    { name: 'confidence_score', type: 'int32', optional: true },
    { name: 'founding_year', type: 'int32', facet: true, optional: true },
    { name: 'created_at', type: 'int64' },
    { name: 'updated_at', type: 'int64' },
  ],
  default_sorting_field: 'orion_score',
};
