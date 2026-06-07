import type { ContactRecord } from "./contact.js";

export interface DuplicatePair {
  id: string; // canonical key: min(idA,idB) + ':' + max(idA,idB)
  recordA: ContactRecord;
  recordB: ContactRecord;
  reasons: string[];
  score: number;
}

export interface DuplicateDetectionResult {
  pairs: DuplicatePair[];
  checkedCount: number; // total records scanned
  pairCount: number;   // total pairs found
}
