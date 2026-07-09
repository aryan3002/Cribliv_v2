export interface V1Property {
  _id: string;
  nameListing?: string;
  description?: string;
  ownerPhone?: string;
  owner?: string;
  ownerEmail?: string;
  userId?: string;
  bedrooms?: number;
  bathrooms?: number;
  area?: number;
  floor?: string | number;
  furnishing?: string;
  type?: string;
  pref_tenant?: string;
  expected_rent?: number | string;
  expected_deposit?: number | string;
  avail_from?: string | Date;
  houseNum?: string;
  society?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string | number;
  amenities?: string[];
  location?: { type?: string; coordinates?: [number, number] }; // [lng, lat]
  cloudinary_public_ids?: string[];
  verified?: boolean;
}
export interface V1Pg extends V1Property {
  rooms?: Array<{
    roomNumber?: string | number;
    beds?: Array<{ type?: string; count?: number }>;
    bathrooms?: Array<{ type?: string }>;
    expected_rent?: number | string;
    expected_deposit?: number | string;
    floor?: string | number;
    area?: number;
  }>;
  services?: string[];
  // pgs store amenities as objects, not strings:
  amenities?: any; // overridden — see map-pg.ts (Array<{amenityName}> | string[])
}
export type OwnerSource = "mongo" | "excel" | "import_fallback";
