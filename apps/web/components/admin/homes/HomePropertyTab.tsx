import type { AdminHomeDetail } from "@cribliv/shared-types";
import type { AdminListingDetailVm, AdminListingPhotoVm } from "../../../lib/admin-api";
import { LocationBlock } from "../review/LocationBlock";
import { PhotoGallery } from "../review/PhotoGallery";
import { PropertySpecs } from "../review/PropertySpecs";
import { SectionCard } from "../primitives/SectionCard";

export function HomePropertyTab({ detail }: { detail: AdminHomeDetail }) {
  const listing = mapListingForSpecs(detail);
  const location = mapLocationForReview(detail);
  const photos = mapPhotosForGallery(detail);

  return (
    <div className="admin-home-workspace__grid">
      <div className="admin-home-workspace__stack">
        <SectionCard title="Photos" subtitle="Visible listing media and moderation state">
          <PhotoGallery photos={photos} />
        </SectionCard>
        <SectionCard title="Listing copy" subtitle="English and Hindi">
          <div className="admin-home-workspace__copy-block">
            <h3>English</h3>
            <p>{detail.listing.title_en ?? "-"}</p>
            <p>{detail.listing.description_en ?? "-"}</p>
          </div>
          <div className="admin-home-workspace__copy-block">
            <h3>Hindi</h3>
            <p>{detail.listing.title_hi ?? "-"}</p>
            <p>{detail.listing.description_hi ?? "-"}</p>
          </div>
        </SectionCard>
      </div>

      <div className="admin-home-workspace__stack">
        <PropertySpecs listing={listing} />
        <LocationBlock location={location} />
        <SectionCard title="House rules" subtitle="Read-only owner configuration">
          <pre className="admin-home-workspace__rules">
            {JSON.stringify(detail.listing.rules, null, 2)}
          </pre>
        </SectionCard>
      </div>
    </div>
  );
}

function mapListingForSpecs(detail: AdminHomeDetail): AdminListingDetailVm["listing"] {
  return {
    id: detail.listing.id,
    listing_type: "flat_house",
    title_en: detail.listing.title_en,
    title_hi: detail.listing.title_hi,
    description_en: detail.listing.description_en,
    description_hi: detail.listing.description_hi,
    status: detail.listing.status,
    verification_status: detail.listing.verification_status,
    monthly_rent: detail.listing.monthly_rent,
    security_deposit: detail.listing.security_deposit,
    available_from: detail.listing.available_from,
    furnishing: detail.listing.furnishing,
    bhk: detail.listing.bhk,
    bathrooms: detail.listing.bathrooms,
    area_sqft: detail.listing.area_sqft,
    preferred_tenant: detail.listing.preferred_tenant,
    whatsapp_available: detail.listing.whatsapp_available,
    amenities: detail.listing.amenities,
    rules: detail.listing.rules,
    created_at: detail.listing.created_at
  };
}

function mapLocationForReview(detail: AdminHomeDetail): AdminListingDetailVm["location"] {
  if (!detail.location) return null;
  return {
    address_line1: detail.location.address_line1,
    landmark: detail.location.landmark,
    pincode: detail.location.pincode,
    lat: detail.location.lat,
    lng: detail.location.lng,
    masked_address: detail.location.masked_address,
    locality_name: detail.location.locality_name,
    city_slug: detail.location.city_slug,
    city_name: detail.location.city_name
  };
}

function mapPhotosForGallery(detail: AdminHomeDetail): AdminListingPhotoVm[] {
  return detail.photos.map((photo) => ({
    url: photo.url,
    is_cover: photo.is_cover,
    sort_order: photo.sort_order,
    moderation_status: photo.moderation_status
  }));
}
