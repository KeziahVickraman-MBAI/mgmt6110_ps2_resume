// Typed view over the canonical FACILITIES table.
//
// The data itself lives in shared/facilities.js, which is plain ESM so that
// api/company.js (Vercel Node runtime) and this client bundle can both import
// it. There used to be two hand-maintained copies; keeping one avoids the
// figures drifting apart. All figures there are hand-entered — never derived
// from imagery.
import { FACILITIES as RAW_FACILITIES } from '../shared/facilities.js';

export type SiteType =
  | 'Corporate HQ'
  | 'Manufacturing'
  | 'Distribution'
  | 'Retail flagship'
  | 'Mixed campus';

export interface FacilityEntry {
  symbol: string;
  name: string;
  lat: number;
  lon: number;
  label: string;
  siteType?: SiteType;
  footprintHa?: number;
  scaleNote?: string;
  measuredOn?: string;
}

export const FACILITIES = RAW_FACILITIES as unknown as Record<string, FacilityEntry>;
