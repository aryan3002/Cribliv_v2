import type { PgMaintenanceCategory } from "@cribliv/shared-types";

export const COMMON_AREA_OPTIONS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "common_bathroom", label: "Common bathroom" },
  { value: "lift", label: "Lift" },
  { value: "stairs", label: "Stairs" },
  { value: "corridor", label: "Corridor" },
  { value: "terrace", label: "Terrace" },
  { value: "laundry", label: "Laundry" },
  { value: "parking", label: "Parking" },
  { value: "reception", label: "Reception" },
  { value: "mess_food_area", label: "Mess/Food area" },
  { value: "water_tank_motor", label: "Water tank/motor" },
  { value: "wifi_router", label: "Wi-Fi/router" },
  { value: "security_cctv", label: "Security/CCTV" },
  { value: "other", label: "Other" }
] as const;

export const FALLBACK_MAINTENANCE_CATEGORIES: PgMaintenanceCategory[] = [
  {
    slug: "plumbing",
    display_name: "Plumbing",
    default_priority: "high",
    active: true,
    sort_order: 10
  },
  {
    slug: "electrical",
    display_name: "Electrical",
    default_priority: "emergency",
    active: true,
    sort_order: 20
  },
  {
    slug: "internet_wifi",
    display_name: "Internet/Wi-Fi",
    default_priority: "high",
    active: true,
    sort_order: 30
  },
  {
    slug: "appliance",
    display_name: "Appliance",
    default_priority: "normal",
    active: true,
    sort_order: 40
  },
  {
    slug: "furniture",
    display_name: "Furniture",
    default_priority: "normal",
    active: true,
    sort_order: 50
  },
  {
    slug: "cleaning",
    display_name: "Cleaning",
    default_priority: "normal",
    active: true,
    sort_order: 60
  },
  {
    slug: "pest_control",
    display_name: "Pest control",
    default_priority: "normal",
    active: true,
    sort_order: 70
  },
  {
    slug: "water_supply",
    display_name: "Water supply",
    default_priority: "emergency",
    active: true,
    sort_order: 80
  },
  {
    slug: "power_backup",
    display_name: "Power backup",
    default_priority: "high",
    active: true,
    sort_order: 90
  },
  {
    slug: "food_mess",
    display_name: "Food/Mess",
    default_priority: "normal",
    active: true,
    sort_order: 100
  },
  {
    slug: "security",
    display_name: "Security",
    default_priority: "emergency",
    active: true,
    sort_order: 110
  },
  {
    slug: "room_access_keys",
    display_name: "Room access/keys",
    default_priority: "high",
    active: true,
    sort_order: 120
  },
  {
    slug: "noise_roommate",
    display_name: "Noise/roommate",
    default_priority: "low",
    active: true,
    sort_order: 130
  },
  {
    slug: "billing",
    display_name: "Billing",
    default_priority: "low",
    active: true,
    sort_order: 140
  },
  {
    slug: "other",
    display_name: "Other",
    default_priority: "normal",
    active: true,
    sort_order: 150
  }
];

export const MINIMUM_DESCRIPTION_LENGTH = 10;
