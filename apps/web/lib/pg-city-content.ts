export interface PgCityContent {
  slug: string;
  name: string;
  state: string;
  heroLine: string;
  intro: string;
  rentSingle: string;
  rentDouble: string;
  rentTriple: string;
  hubs: string[];
  faqs: { q: string; a: string }[];
}

export const PG_CITY_CONTENT: Record<string, PgCityContent> = {
  delhi: {
    slug: "delhi",
    name: "Delhi",
    state: "Delhi",
    heroLine: "Verified PGs in Delhi: Zero Brokerage",
    intro:
      "Find verified PG accommodation across Delhi, from student hubs near North Campus to working-professional PGs in South Delhi. Filter by sharing, food, AC and budget.",
    rentSingle: "₹9,000-₹18,000",
    rentDouble: "₹6,000-₹11,000",
    rentTriple: "₹4,500-₹8,000",
    hubs: ["North Campus", "Laxmi Nagar", "Saket", "Karol Bagh", "Mukherjee Nagar", "Hauz Khas"],
    faqs: [
      {
        q: "How much does a PG cost in Delhi?",
        a: "Single-sharing PGs in Delhi run ₹9,000 to ₹18,000/month; double and triple sharing are cheaper at ₹4,500 to ₹11,000. Mukherjee Nagar and Laxmi Nagar are the most affordable student belts."
      },
      {
        q: "Are food and meals included in Delhi PGs?",
        a: "Many Delhi PGs include 2 to 3 meals a day. Use the Food-included filter on Cribliv to see only PGs that bundle meals."
      },
      {
        q: "Which areas have the best PGs for students in Delhi?",
        a: "North Campus, Mukherjee Nagar and Kamla Nagar (for DU/UPSC aspirants), and Laxmi Nagar for coaching students."
      },
      {
        q: "Do I pay any brokerage on Cribliv PGs?",
        a: "No. Cribliv lists verified PGs directly from operators, zero brokerage. Express interest and the operator reaches out."
      }
    ]
  },
  noida: {
    slug: "noida",
    name: "Noida",
    state: "Uttar Pradesh",
    heroLine: "PGs & Hostels in Noida: Verified, Zero Brokerage",
    intro:
      "Discover verified PGs in Noida near IT parks and universities. Compare sharing options, food and AC across sectors with transparent rents.",
    rentSingle: "₹8,000-₹15,000",
    rentDouble: "₹5,000-₹9,000",
    rentTriple: "₹4,000-₹7,000",
    hubs: ["Sector 62", "Sector 18", "Sector 137", "Amity University", "Sector 15", "Sector 76"],
    faqs: [
      {
        q: "What is the average PG rent in Noida?",
        a: "Single sharing is ₹8,000 to ₹15,000/month; double/triple sharing ₹4,000 to ₹9,000. Sectors 62 and 137 are popular with IT professionals."
      },
      {
        q: "Are there PGs near Amity University Noida?",
        a: "Yes, Sector 125/126 and the Amity belt have many student PGs. Filter by Students tenant-type on Cribliv."
      },
      {
        q: "Do Noida PGs offer AC rooms?",
        a: "Many do. Use the AC filter to see only air-conditioned PG rooms."
      },
      {
        q: "Is brokerage charged?",
        a: "No, Cribliv PGs are listed directly by operators with zero brokerage."
      }
    ]
  },
  gurugram: {
    slug: "gurugram",
    name: "Gurugram",
    state: "Haryana",
    heroLine: "Verified PGs in Gurugram: Zero Brokerage",
    intro:
      "Find working-professional PGs near Cyber City, Sohna Road and Udyog Vihar. Filter verified Gurugram PGs by sharing, food and AC.",
    rentSingle: "₹10,000-₹20,000",
    rentDouble: "₹6,500-₹12,000",
    rentTriple: "₹5,000-₹9,000",
    hubs: ["Cyber City", "Sohna Road", "Udyog Vihar", "Sector 49", "DLF Phase 3", "Sector 14"],
    faqs: [
      {
        q: "How much is a PG in Gurugram?",
        a: "Single sharing ₹10,000 to ₹20,000/month; double/triple ₹5,000 to ₹12,000. PGs near Cyber City and Udyog Vihar command a premium."
      },
      {
        q: "Are there PGs for working women in Gurugram?",
        a: "Yes, filter by Girls gender and Working tenant-type to see women's professional PGs."
      },
      {
        q: "Do Gurugram PGs include food?",
        a: "Many include meals; use the Food-included filter to narrow down."
      },
      { q: "Any brokerage?", a: "None, Cribliv PGs are operator-listed with zero brokerage." }
    ]
  },
  ghaziabad: {
    slug: "ghaziabad",
    name: "Ghaziabad",
    state: "Uttar Pradesh",
    heroLine: "Affordable PGs in Ghaziabad: Verified",
    intro:
      "Budget-friendly verified PGs across Indirapuram, Vaishali and Raj Nagar. Compare sharing and food options on Cribliv.",
    rentSingle: "₹6,000-₹12,000",
    rentDouble: "₹4,000-₹7,500",
    rentTriple: "₹3,000-₹5,500",
    hubs: [
      "Indirapuram",
      "Vaishali",
      "Raj Nagar Extension",
      "Kaushambi",
      "Vasundhara",
      "Crossing Republik"
    ],
    faqs: [
      {
        q: "What is the cheapest PG rent in Ghaziabad?",
        a: "Triple-sharing PGs start around ₹3,000/month; single sharing ₹6,000 to ₹12,000. Raj Nagar Extension is the most affordable."
      },
      {
        q: "Are PGs near metro available in Ghaziabad?",
        a: "Vaishali and Kaushambi PGs are close to the Blue Line metro."
      },
      { q: "Is food included?", a: "Several PGs bundle meals. Use the Food-included filter." },
      { q: "Brokerage?", a: "Zero brokerage on all Cribliv PGs." }
    ]
  },
  faridabad: {
    slug: "faridabad",
    name: "Faridabad",
    state: "Haryana",
    heroLine: "Verified PGs in Faridabad: Zero Brokerage",
    intro:
      "Affordable verified PGs across NIT, Sector 15 and Greater Faridabad with transparent sharing-wise rents.",
    rentSingle: "₹5,500-₹11,000",
    rentDouble: "₹3,800-₹7,000",
    rentTriple: "₹3,000-₹5,000",
    hubs: [
      "NIT Faridabad",
      "Sector 15",
      "Sector 16",
      "Greater Faridabad",
      "Sector 37",
      "Ballabgarh"
    ],
    faqs: [
      {
        q: "How much does a PG cost in Faridabad?",
        a: "Single sharing ₹5,500 to ₹11,000/month; double/triple from ₹3,000. NIT and Sector 15 have the most options."
      },
      {
        q: "Are there PGs near the metro in Faridabad?",
        a: "Yes, the Violet Line corridor (Sectors 15 to 28) has several PGs."
      },
      { q: "Food included?", a: "Many PGs offer meals; filter by Food-included." },
      { q: "Brokerage?", a: "None, operator-listed, zero brokerage." }
    ]
  },
  chandigarh: {
    slug: "chandigarh",
    name: "Chandigarh",
    state: "Chandigarh",
    heroLine: "Verified PGs in Chandigarh: Zero Brokerage",
    intro:
      "PGs near Panjab University, IT Park and the sectors, verified, with clear sharing, food and AC options.",
    rentSingle: "₹8,000-₹15,000",
    rentDouble: "₹5,500-₹9,500",
    rentTriple: "₹4,000-₹7,000",
    hubs: ["Panjab University", "Sector 22", "Sector 35", "IT Park", "Mohali", "Sector 44"],
    faqs: [
      {
        q: "What is PG rent in Chandigarh?",
        a: "Single sharing ₹8,000 to ₹15,000/month; double/triple ₹4,000 to ₹9,500. PGs near Panjab University and IT Park are in highest demand."
      },
      {
        q: "Are there student PGs near Panjab University?",
        a: "Yes, Sector 15 and the PU belt have many student PGs. Filter by Students."
      },
      { q: "AC rooms?", a: "Available, use the AC filter." },
      { q: "Brokerage?", a: "Zero brokerage on Cribliv." }
    ]
  },
  jaipur: {
    slug: "jaipur",
    name: "Jaipur",
    state: "Rajasthan",
    heroLine: "Verified PGs in Jaipur: Zero Brokerage",
    intro:
      "Find student and working PGs across Malviya Nagar, Mansarovar and Jagatpura with transparent sharing-wise pricing.",
    rentSingle: "₹6,000-₹12,000",
    rentDouble: "₹4,000-₹8,000",
    rentTriple: "₹3,000-₹6,000",
    hubs: ["Malviya Nagar", "Mansarovar", "Jagatpura", "Vaishali Nagar", "C-Scheme", "Sitapura"],
    faqs: [
      {
        q: "How much is a PG in Jaipur?",
        a: "Single sharing ₹6,000 to ₹12,000/month; double/triple from ₹3,000. Malviya Nagar (MNIT) and Sitapura (JECRC) are popular student belts."
      },
      {
        q: "Are there PGs for students near colleges?",
        a: "Yes, Malviya Nagar, Jagatpura and Sitapura have abundant student PGs."
      },
      { q: "Food included?", a: "Many PGs bundle meals. Filter by Food-included." },
      { q: "Brokerage?", a: "None, verified, operator-listed, zero brokerage." }
    ]
  },
  lucknow: {
    slug: "lucknow",
    name: "Lucknow",
    state: "Uttar Pradesh",
    heroLine: "Verified PGs in Lucknow: Zero Brokerage",
    intro:
      "Discover verified PGs across Gomti Nagar, Hazratganj and the university belt. Compare sharing, food and AC with transparent rents on Cribliv.",
    rentSingle: "₹6,000-₹12,000",
    rentDouble: "₹4,000-₹7,500",
    rentTriple: "₹3,000-₹5,500",
    hubs: ["Gomti Nagar", "Hazratganj", "Aliganj", "Indira Nagar", "Jankipuram", "Aminabad"],
    faqs: [
      {
        q: "What is the average PG rent in Lucknow?",
        a: "Single sharing ₹6,000 to ₹12,000/month; double/triple from ₹3,000. Gomti Nagar is premium; Aliganj and Jankipuram are affordable student belts."
      },
      {
        q: "Are there student PGs near universities in Lucknow?",
        a: "Yes, the Lucknow University, IIM Road and BBAU belts have many student PGs. Filter by Students tenant-type."
      },
      {
        q: "Do Lucknow PGs include food?",
        a: "Many include 2 to 3 meals; use the Food-included filter to narrow down."
      },
      {
        q: "Is there any brokerage?",
        a: "No, Cribliv PGs are listed directly by verified operators with zero brokerage."
      }
    ]
  }
};
