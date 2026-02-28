import type { Metadata } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

interface CityData {
  slug: string;
  name: string;
  state: string;
  heroLine: string;
  description: string;
  avgRent1BHK: string;
  avgRent2BHK: string;
  avgRent3BHK: string;
  avgPG: string;
  popularLocalities: string[];
  rentTips: string[];
  faqs: { q: string; a: string }[];
}

const CITIES: Record<string, CityData> = {
  delhi: {
    slug: "delhi",
    name: "Delhi",
    state: "Delhi",
    heroLine: "Find Verified Rental Homes in Delhi — Zero Brokerage",
    description:
      "Explore thousands of verified rental flats, houses, and PGs in Delhi. From South Delhi's upscale colonies to affordable options in East and West Delhi, find your perfect home without paying any brokerage.",
    avgRent1BHK: "₹10,000 – ₹20,000",
    avgRent2BHK: "₹15,000 – ₹35,000",
    avgRent3BHK: "₹25,000 – ₹60,000",
    avgPG: "₹5,000 – ₹15,000",
    popularLocalities: [
      "Dwarka",
      "Rohini",
      "Saket",
      "Lajpat Nagar",
      "Karol Bagh",
      "Vasant Kunj",
      "Mayur Vihar",
      "Janakpuri",
      "Greater Kailash",
      "Pitampura"
    ],
    rentTips: [
      "Always verify the property with your own visit before signing any agreement.",
      "South Delhi clusters (GK, Saket, Hauz Khas) command premium rents — try Dwarka or Rohini for better value.",
      "Check metro connectivity — properties near metro stations are in higher demand but offer great commute convenience.",
      "Confirm parking availability separately, especially in older colonies.",
      "Read the rental agreement carefully for lock-in period, maintenance charges, and security deposit terms."
    ],
    faqs: [
      {
        q: "What is the average rent for a 2BHK flat in Delhi?",
        a: "The average rent for a 2BHK in Delhi ranges from ₹15,000 to ₹35,000 per month depending on the locality. Areas like Dwarka and Rohini are more affordable (₹15,000–₹22,000), while South Delhi areas command ₹30,000+."
      },
      {
        q: "Which is the cheapest area to rent in Delhi?",
        a: "Affordable areas include Uttam Nagar, Nangloi, Burari, and parts of North East Delhi with 1BHK flats available from ₹6,000–₹10,000."
      },
      {
        q: "Do I need a broker to rent a flat in Delhi?",
        a: "No! With Cribliv, you can find verified owner-listed properties and contact them directly — with zero brokerage. Save 1–2 months of rent in broker fees."
      },
      {
        q: "How do I find PG accommodation in Delhi?",
        a: "Search for PG on Cribliv and filter by Delhi. We list verified PG accommodations across all major areas starting from ₹5,000/month."
      }
    ]
  },
  noida: {
    slug: "noida",
    name: "Noida",
    state: "Uttar Pradesh",
    heroLine: "Rent Flats & PGs in Noida — Zero Brokerage, Verified Owners",
    description:
      "Discover verified rental properties in Noida and Greater Noida. From sector apartments to high-rise societies, find affordable 1BHK, 2BHK, 3BHK flats and PGs on Cribliv without paying any brokerage.",
    avgRent1BHK: "₹8,000 – ₹15,000",
    avgRent2BHK: "₹12,000 – ₹25,000",
    avgRent3BHK: "₹20,000 – ₹45,000",
    avgPG: "₹4,000 – ₹12,000",
    popularLocalities: [
      "Sector 62",
      "Sector 137",
      "Sector 50",
      "Sector 18",
      "Sector 76",
      "Gaur City (Greater Noida West)",
      "Sector 78",
      "Sector 44",
      "Sector 128",
      "Amity University Area"
    ],
    rentTips: [
      "Noida Expressway sectors (100+) offer modern high-rises at competitive rents.",
      "Greater Noida West (Gaur City, Ace City) is extremely affordable for working professionals.",
      "Sector 62 and 63 are ideal for IT professionals working in Noida's tech corridor.",
      "Confirm society maintenance charges — these can add ₹2,000–₹5,000 to monthly costs.",
      "Check distance to the nearest metro station (Blue Line/Aqua Line) before finalizing."
    ],
    faqs: [
      {
        q: "What is the average rent in Noida for a 2BHK?",
        a: "A 2BHK flat in Noida typically costs ₹12,000–₹25,000/month. Sectors near Noida Expressway (sectors 74–78, 137) are in the ₹14,000–₹20,000 range."
      },
      {
        q: "Is Noida cheaper than Delhi for renting?",
        a: "Yes, generally Noida offers 20–30% lower rents compared to equivalent localities in Delhi, with better amenities in newer societies."
      },
      {
        q: "How to find a flat in Noida without a broker?",
        a: "Use Cribliv to search for owner-listed, verified flats in Noida. You pay zero brokerage and connect directly with owners."
      },
      {
        q: "Which sectors in Noida are best for working professionals?",
        a: "Sectors 62, 63, 76, and 78 are popular with IT professionals. Sector 18 is great for commercial hub proximity. Greater Noida West suits budget-conscious renters."
      }
    ]
  },
  gurugram: {
    slug: "gurugram",
    name: "Gurugram",
    state: "Haryana",
    heroLine: "Rent Homes in Gurugram (Gurgaon) — Zero Brokerage on Cribliv",
    description:
      "Find verified rental flats, apartments, and PGs in Gurugram. From budget-friendly options near Sohna Road to premium apartments in Golf Course Road, explore the best rental deals in Gurgaon with zero brokerage.",
    avgRent1BHK: "₹10,000 – ₹20,000",
    avgRent2BHK: "₹15,000 – ₹35,000",
    avgRent3BHK: "₹25,000 – ₹70,000",
    avgPG: "₹6,000 – ₹15,000",
    popularLocalities: [
      "Sohna Road",
      "Golf Course Road",
      "DLF Phase 1–5",
      "Sector 49",
      "Sector 56",
      "MG Road",
      "Sector 82",
      "Nirvana Country",
      "South City",
      "Palam Vihar"
    ],
    rentTips: [
      "Golf Course Road and DLF Phase areas are premium — expect ₹30,000+ for a 2BHK.",
      "Sohna Road and Sector 82–86 offer good value for new construction at moderate rents.",
      "Traffic is a major factor — choose a locality near your workplace or close to Rapid Metro/Yellow Line.",
      "Gurugram societies often have excellent amenities (gym, pool, club) — check if they're included or extra.",
      "Negotiate rent for longer lease terms (11+ months) — owners prefer stable tenants."
    ],
    faqs: [
      {
        q: "What is the cost of renting a flat in Gurgaon?",
        a: "Rent ranges widely: 1BHK ₹10,000–₹20,000, 2BHK ₹15,000–₹35,000, 3BHK ₹25,000–₹70,000. Sohna Road and newer sectors are more affordable; DLF/Golf Course Road are premium."
      },
      {
        q: "Is Gurugram good for renting?",
        a: "Yes, Gurugram has excellent rental options with modern amenities, good connectivity via Rapid Metro and NH-48, and proximity to major corporate offices."
      },
      {
        q: "Where can I find cheap PGs in Gurgaon?",
        a: "Budget PGs are available in Sector 38, 46, and near Sohna Road starting from ₹6,000/month. Search on Cribliv and filter by PG type for verified options."
      },
      {
        q: "How to rent without broker in Gurgaon?",
        a: "Cribliv lists owner-verified properties with zero brokerage. Search, find your ideal property, unlock the owner's contact, and deal directly."
      }
    ]
  },
  ghaziabad: {
    slug: "ghaziabad",
    name: "Ghaziabad",
    state: "Uttar Pradesh",
    heroLine: "Affordable Rentals in Ghaziabad — Verified, Zero Brokerage",
    description:
      "Find budget-friendly verified rental flats and PGs in Ghaziabad. From Indirapuram to Vaishali, Raj Nagar Extension to Crossing Republik — explore the most affordable Delhi NCR rentals on Cribliv.",
    avgRent1BHK: "₹6,000 – ₹12,000",
    avgRent2BHK: "₹10,000 – ₹20,000",
    avgRent3BHK: "₹15,000 – ₹30,000",
    avgPG: "₹3,500 – ₹9,000",
    popularLocalities: [
      "Indirapuram",
      "Vaishali",
      "Raj Nagar Extension",
      "Crossing Republik",
      "Kaushambi",
      "Vasundhara",
      "Ahinsa Khand",
      "Lal Kuan",
      "Siddharth Vihar",
      "NH-24 Corridor"
    ],
    rentTips: [
      "Indirapuram is the most sought-after — good metro connectivity, schools, and markets.",
      "Raj Nagar Extension and Crossing Republik are great for budget renters with ₹7,000–₹12,000 for a 2BHK.",
      "Check whether the property is near the Red/Blue Line metro for daily commute to Delhi.",
      "Verify water supply reliability — some newer areas face intermittent supply.",
      "Ghaziabad offers some of the lowest rents in Delhi NCR while maintaining good connectivity."
    ],
    faqs: [
      {
        q: "Is Ghaziabad cheaper than Noida for rent?",
        a: "Yes, Ghaziabad is generally 15–25% cheaper than Noida. Areas like Raj Nagar Extension and Crossing Republik offer highly affordable options."
      },
      {
        q: "What is the rent for a 2BHK in Indirapuram?",
        a: "A 2BHK in Indirapuram typically costs ₹12,000–₹20,000/month depending on the society and floor."
      },
      {
        q: "How to find a flat in Ghaziabad without broker?",
        a: "Use Cribliv to search owner-verified properties in Ghaziabad. Zero brokerage, direct owner connection."
      },
      {
        q: "Which areas in Ghaziabad have metro connectivity?",
        a: "Vaishali, Kaushambi, and areas near Rajendra Nagar have direct metro access. Indirapuram is well-connected via shared autos to the metro."
      }
    ]
  },
  faridabad: {
    slug: "faridabad",
    name: "Faridabad",
    state: "Haryana",
    heroLine: "Rent Verified Homes in Faridabad — Zero Brokerage",
    description:
      "Discover verified rental properties in Faridabad. From Greater Faridabad to NIT, Sector 16 to Ballabgarh — find affordable flats, houses, and PGs on Cribliv with zero brokerage and verified owners.",
    avgRent1BHK: "₹5,000 – ₹10,000",
    avgRent2BHK: "₹8,000 – ₹18,000",
    avgRent3BHK: "₹12,000 – ₹28,000",
    avgPG: "₹3,000 – ₹8,000",
    popularLocalities: [
      "Sector 15",
      "Sector 16",
      "NIT Faridabad",
      "Greater Faridabad",
      "Sector 37",
      "Ballabgarh",
      "Sector 81",
      "Sector 86",
      "Surajkund Area",
      "Neharpar"
    ],
    rentTips: [
      "NIT Faridabad offers the best Mix of affordability and established infrastructure.",
      "Greater Faridabad (Sectors 75–89) has newer societies with modern amenities at competitive rents.",
      "Violet Line metro connects Faridabad to South Delhi — very convenient for commuters.",
      "Faridabad has some of the most affordable rents in Delhi NCR.",
      "Check proximity to the Faridabad-Gurugram road (KMP Expressway) for cross-NCR commute."
    ],
    faqs: [
      {
        q: "Is Faridabad good for renting?",
        a: "Yes, Faridabad offers some of the most affordable rents in Delhi NCR with Violet Line metro connectivity to Delhi. Great for budget-conscious renters working in South Delhi or Faridabad."
      },
      {
        q: "What is the average rent in Faridabad?",
        a: "A 2BHK flat in Faridabad costs ₹8,000–₹18,000/month. Greater Faridabad sectors are on the lower end; established NIT areas are higher."
      },
      {
        q: "Which area in Faridabad is best for families?",
        a: "NIT (sectors 14–17) and Sector 37 are well-established with schools, hospitals, and markets. Greater Faridabad sectors (81, 86) have modern society amenities."
      },
      {
        q: "How to find PG in Faridabad?",
        a: "Search PG listings on Cribliv filtered for Faridabad. Verified PGs start from ₹3,000/month in areas near the metro."
      }
    ]
  },
  chandigarh: {
    slug: "chandigarh",
    name: "Chandigarh",
    state: "Chandigarh",
    heroLine: "Rent Homes in Chandigarh — Verified Listings, Zero Brokerage",
    description:
      "Find verified rental flats, houses, and PGs in Chandigarh. From the planned sectors to Mohali and Panchkula, explore clean, organized living spaces on Cribliv with zero brokerage.",
    avgRent1BHK: "₹8,000 – ₹15,000",
    avgRent2BHK: "₹12,000 – ₹25,000",
    avgRent3BHK: "₹18,000 – ₹40,000",
    avgPG: "₹5,000 – ₹12,000",
    popularLocalities: [
      "Sector 22",
      "Sector 35",
      "Sector 44",
      "Sector 43",
      "Manimajra",
      "Zirakpur",
      "Mohali (Sector 66–80)",
      "Panchkula",
      "IT Park Area",
      "Sector 17"
    ],
    rentTips: [
      "Inner sectors (1–30) have charming old-world housing but limited availability — try early in the month.",
      "Mohali IT Park area and Zirakpur are budget-friendly alternatives with modern apartments.",
      "Chandigarh's planned layout means excellent roads and parks everywhere — prioritize work proximity.",
      "PG options are abundant near Panjab University and Chandigarh University campuses.",
      "Verify property type — Chandigarh has strict building regulations, so always confirm occupancy certificate."
    ],
    faqs: [
      {
        q: "How much does it cost to rent in Chandigarh?",
        a: "Rents in Chandigarh range from ₹8,000 for a 1BHK to ₹40,000 for a premium 3BHK. Mohali and Zirakpur outskirts are 20–30% cheaper."
      },
      {
        q: "Is Chandigarh a good city for renting?",
        a: "Excellent. Chandigarh consistently ranks among India's most livable cities with low pollution, planned infrastructure, and a high quality of life."
      },
      {
        q: "Where to find PG near IT Park Chandigarh?",
        a: "Mohali Sectors 66–80 and Industrial Area Phase are popular for PG accommodation near IT Park. Search on Cribliv for verified options."
      },
      {
        q: "Can I find a flat without a broker in Chandigarh?",
        a: "Yes! Cribliv lists owner-verified properties in Chandigarh with zero brokerage. Connect directly with property owners."
      }
    ]
  },
  jaipur: {
    slug: "jaipur",
    name: "Jaipur",
    state: "Rajasthan",
    heroLine: "Rent Flats & PGs in Jaipur — Verified, Zero Brokerage",
    description:
      "Find verified rental properties in Jaipur, the Pink City. From Malviya Nagar to Vaishali Nagar, Mansarovar to Jagatpura — explore affordable flats, houses, and PGs on Cribliv with zero brokerage.",
    avgRent1BHK: "₹5,000 – ₹12,000",
    avgRent2BHK: "₹8,000 – ₹20,000",
    avgRent3BHK: "₹15,000 – ₹35,000",
    avgPG: "₹3,500 – ₹10,000",
    popularLocalities: [
      "Malviya Nagar",
      "Vaishali Nagar",
      "Mansarovar",
      "Jagatpura",
      "C-Scheme",
      "Tonk Road",
      "Pratap Nagar",
      "Sitapura",
      "Bani Park",
      "Raja Park"
    ],
    rentTips: [
      "Malviya Nagar and Vaishali Nagar are the most popular areas with great infrastructure and connectivity.",
      "Jagatpura and Sitapura are ideal for IT professionals working at Mahindra World City or EPIP Zone.",
      "C-Scheme is premium and central but with higher rents — great for young professionals.",
      "Jaipur Metro (Pink and Blue Line) is expanding — properties near metro stations command premium.",
      "Summer heat is intense — confirm AC availability or at least cooler provision in the rental."
    ],
    faqs: [
      {
        q: "What is the rent for a 2BHK in Jaipur?",
        a: "A 2BHK in Jaipur costs ₹8,000–₹20,000/month. Areas like Mansarovar and Pratap Nagar are affordable; Malviya Nagar and C-Scheme are premium."
      },
      {
        q: "Which area in Jaipur is best for students?",
        a: "Areas near MNIT (Malviya Nagar), Rajasthan University (JLN Marg), and JECRC (Sitapura) have abundant PG and flat options for students."
      },
      {
        q: "Where to find cheap flats in Jaipur?",
        a: "Budget flats are available in Mansarovar, Pratap Nagar, Sanganer, and Jagatpura starting from ₹5,000 for 1BHK."
      },
      {
        q: "How to avoid brokers in Jaipur?",
        a: "Cribliv connects you directly with verified property owners in Jaipur — zero brokerage, transparent pricing."
      }
    ]
  },
  lucknow: {
    slug: "lucknow",
    name: "Lucknow",
    state: "Uttar Pradesh",
    heroLine: "Find Verified Rental Homes in Lucknow — Zero Brokerage",
    description:
      "Discover verified rental flats, houses, and PGs in Lucknow. From Gomti Nagar to Hazratganj, Indira Nagar to Aliganj — explore the City of Nawabs' best rental deals on Cribliv with zero brokerage.",
    avgRent1BHK: "₹5,000 – ₹10,000",
    avgRent2BHK: "₹8,000 – ₹18,000",
    avgRent3BHK: "₹12,000 – ₹30,000",
    avgPG: "₹3,000 – ₹8,000",
    popularLocalities: [
      "Gomti Nagar",
      "Hazratganj",
      "Indira Nagar",
      "Aliganj",
      "Mahanagar",
      "Rajajipuram",
      "Vibhuti Khand",
      "Jankipuram",
      "Alambagh",
      "Gomti Nagar Extension"
    ],
    rentTips: [
      "Gomti Nagar and Gomti Nagar Extension are the most premium areas with modern apartments.",
      "Hazratganj is central and well-connected but older housing stock — verify property condition.",
      "Lucknow Metro (Red Line) connects major areas — properties near stations are convenient.",
      "Indira Nagar and Aliganj offer excellent mid-range options near markets and hospitals.",
      "Lucknow has very affordable rents compared to Delhi NCR — get much more space for your budget."
    ],
    faqs: [
      {
        q: "What is the average flat rent in Lucknow?",
        a: "A 2BHK in Lucknow costs ₹8,000–₹18,000/month. Gomti Nagar Extension and newer areas are ₹10,000–₹14,000; premium areas like Hazratganj are ₹15,000+."
      },
      {
        q: "Which locality in Lucknow is best for families?",
        a: "Gomti Nagar, Indira Nagar, and Aliganj are top family-friendly areas with schools, hospitals, parks, and markets nearby."
      },
      {
        q: "Where to find PG in Lucknow?",
        a: "PG accommodations are common near universities — IIM Road, Lucknow University area, and BBAU campus vicinity. Search Cribliv for verified PG listings."
      },
      {
        q: "Is it better to rent in Gomti Nagar or Indira Nagar?",
        a: "Gomti Nagar is newer with modern amenities and higher rents. Indira Nagar is established, well-connected, and more affordable. Both are excellent choices."
      }
    ]
  }
};

export async function generateStaticParams() {
  return Object.keys(CITIES).map((city) => ({ city }));
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; city: string };
}): Promise<Metadata> {
  const city = CITIES[params.city];
  if (!city) return { title: "City Not Found" };

  const isHindi = params.locale === "hi";
  const title = isHindi
    ? `${city.name} में किराये पर फ्लैट और PG — शून्य ब्रोकरेज | Cribliv`
    : `Rent Flats & PGs in ${city.name} — Zero Brokerage, Verified Owners | Cribliv`;
  const description = city.description;

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/rent-in/${city.slug}`,
      languages: {
        en: `${BASE_URL}/en/rent-in/${city.slug}`,
        hi: `${BASE_URL}/hi/rent-in/${city.slug}`
      }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/rent-in/${city.slug}`,
      siteName: "Cribliv",
      type: "website"
    },
    keywords: [
      `rent in ${city.name}`,
      `flat for rent in ${city.name}`,
      `2BHK in ${city.name}`,
      `PG in ${city.name}`,
      `${city.name} rental`,
      `no broker ${city.name}`,
      `zero brokerage ${city.name}`,
      `house for rent ${city.name}`,
      `room for rent ${city.name}`
    ]
  };
}

function faqJsonLd(city: CityData) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: city.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
}

function breadcrumbJsonLd(locale: string, city: CityData) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${locale}` },
      {
        "@type": "ListItem",
        position: 2,
        name: `Rent in ${city.name}`,
        item: `${BASE_URL}/${locale}/rent-in/${city.slug}`
      }
    ]
  };
}

export default function RentInCityPage({ params }: { params: { locale: string; city: string } }) {
  const city = CITIES[params.city];

  if (!city) {
    return (
      <div
        className="container--narrow"
        style={{ padding: "var(--space-16) 0", textAlign: "center" }}
      >
        <h1>City Not Found</h1>
        <p className="text-secondary">We don&apos;t have rental guides for this city yet.</p>
        <a
          href={`/${params.locale}`}
          style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
        >
          Back to Home
        </a>
      </div>
    );
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(city)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(params.locale, city)) }}
      />

      <div style={{ paddingTop: "var(--space-10)", paddingBottom: "var(--space-16)" }}>
        {/* Hero Section */}
        <div
          style={{
            background: "linear-gradient(135deg, var(--brand) 0%, #004BB5 100%)",
            padding: "var(--space-12) 0",
            color: "white",
            marginBottom: "var(--space-10)"
          }}
        >
          <div className="container--narrow">
            <nav
              style={{ marginBottom: "var(--space-4)", fontSize: "var(--text-sm)", opacity: 0.8 }}
            >
              <a href={`/${params.locale}`} style={{ color: "white", textDecoration: "none" }}>
                Home
              </a>
              <span style={{ margin: "0 var(--space-2)" }}>/</span>
              <span>Rent in {city.name}</span>
            </nav>
            <h1
              style={{
                color: "white",
                marginBottom: "var(--space-3)",
                fontSize: "clamp(1.75rem, 4vw, 2.5rem)"
              }}
            >
              {city.heroLine}
            </h1>
            <p
              style={{
                opacity: 0.9,
                maxWidth: 640,
                lineHeight: 1.75,
                marginBottom: "var(--space-6)"
              }}
            >
              {city.description}
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <a
                href={`/${params.locale}/search?city=${city.slug}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "var(--space-3) var(--space-7)",
                  background: "white",
                  color: "var(--brand)",
                  borderRadius: "var(--radius-full)",
                  fontWeight: 700,
                  textDecoration: "none"
                }}
              >
                Search Rentals in {city.name}
              </a>
              <a
                href={`/${params.locale}/city/${city.slug}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "var(--space-3) var(--space-7)",
                  background: "rgba(255,255,255,0.15)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.3)",
                  borderRadius: "var(--radius-full)",
                  fontWeight: 600,
                  textDecoration: "none"
                }}
              >
                Browse {city.name} Listings
              </a>
            </div>
          </div>
        </div>

        {/* Average Rents */}
        <div className="container--narrow" style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
            Average Rental Prices in {city.name}
          </h2>
          <div className="grid grid-4" style={{ gap: "var(--space-4)" }}>
            {[
              { type: "1 BHK", range: city.avgRent1BHK, icon: "🏠" },
              { type: "2 BHK", range: city.avgRent2BHK, icon: "🏡" },
              { type: "3 BHK", range: city.avgRent3BHK, icon: "🏘️" },
              { type: "PG / Room", range: city.avgPG, icon: "🛏️" }
            ].map((r) => (
              <div
                key={r.type}
                style={{
                  background: "white",
                  borderRadius: "var(--radius-lg)",
                  padding: "var(--space-5)",
                  textAlign: "center",
                  border: "1px solid var(--border)",
                  boxShadow: "var(--shadow-sm)"
                }}
              >
                <div style={{ fontSize: 32, marginBottom: "var(--space-2)" }}>{r.icon}</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "var(--text-lg)",
                    marginBottom: "var(--space-1)"
                  }}
                >
                  {r.type}
                </div>
                <div className="text-secondary" style={{ fontSize: "var(--text-sm)" }}>
                  {r.range}/mo
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Popular Localities */}
        <div className="section--alt" style={{ padding: "var(--space-10) 0" }}>
          <div className="container--narrow">
            <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
              Popular Localities in {city.name}
            </h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-3)",
                justifyContent: "center"
              }}
            >
              {city.popularLocalities.map((loc) => (
                <a
                  key={loc}
                  href={`/${params.locale}/search?city=${city.slug}&q=${encodeURIComponent(loc)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "var(--space-2) var(--space-4)",
                    background: "white",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-full)",
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    textDecoration: "none",
                    transition: "border-color 0.2s, box-shadow 0.2s"
                  }}
                >
                  📍 {loc}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Rental Tips */}
        <div className="container--narrow" style={{ padding: "var(--space-10) 0" }}>
          <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
            Tips for Renting in {city.name}
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              maxWidth: 700,
              margin: "0 auto"
            }}
          >
            {city.rentTips.map((tip, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: "var(--space-4)",
                  alignItems: "flex-start",
                  padding: "var(--space-4) var(--space-5)",
                  background: "white",
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)"
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--brand)",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "var(--text-sm)",
                    fontWeight: 700
                  }}
                >
                  {i + 1}
                </span>
                <p className="text-secondary" style={{ lineHeight: 1.65, margin: 0 }}>
                  {tip}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ Section */}
        <div className="section--alt" style={{ padding: "var(--space-10) 0" }}>
          <div className="container--narrow">
            <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
              FAQ — Renting in {city.name}
            </h2>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
                maxWidth: 700,
                margin: "0 auto"
              }}
            >
              {city.faqs.map((faq) => (
                <details
                  key={faq.q}
                  style={{
                    background: "white",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--border)",
                    overflow: "hidden"
                  }}
                >
                  <summary
                    style={{
                      padding: "var(--space-4) var(--space-5)",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "var(--text-base)",
                      listStyle: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between"
                    }}
                  >
                    {faq.q}
                    <span style={{ marginLeft: "var(--space-3)", flexShrink: 0 }}>▸</span>
                  </summary>
                  <div
                    style={{
                      padding: "0 var(--space-5) var(--space-4)",
                      lineHeight: 1.75
                    }}
                    className="text-secondary"
                  >
                    {faq.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div
          className="container--narrow"
          style={{ padding: "var(--space-12) 0", textAlign: "center" }}
        >
          <h2 style={{ marginBottom: "var(--space-3)" }}>
            Ready to find your home in {city.name}?
          </h2>
          <p className="text-secondary" style={{ marginBottom: "var(--space-6)" }}>
            Join thousands of tenants finding verified, zero-brokerage rentals on Cribliv.
          </p>
          <a
            href={`/${params.locale}/search?city=${city.slug}`}
            className="btn btn--primary"
            style={{
              display: "inline-flex",
              padding: "var(--space-3) var(--space-8)",
              borderRadius: "var(--radius-full)",
              fontWeight: 700,
              textDecoration: "none"
            }}
          >
            Start Searching in {city.name}
          </a>
        </div>

        {/* Other Cities */}
        <div className="section--alt" style={{ padding: "var(--space-10) 0" }}>
          <div className="container--narrow">
            <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
              Explore Other Cities
            </h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-3)",
                justifyContent: "center"
              }}
            >
              {Object.values(CITIES)
                .filter((c) => c.slug !== city.slug)
                .map((c) => (
                  <a
                    key={c.slug}
                    href={`/${params.locale}/rent-in/${c.slug}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      padding: "var(--space-2) var(--space-5)",
                      background: "white",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-full)",
                      fontWeight: 500,
                      color: "var(--brand)",
                      textDecoration: "none",
                      fontSize: "var(--text-sm)"
                    }}
                  >
                    Rent in {c.name}
                  </a>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
