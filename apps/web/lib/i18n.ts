export const locales = ["en", "hi"] as const;
export type Locale = (typeof locales)[number];

export function isValidLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

type Dictionary = Record<string, { en: string; hi: string }>;

const dictionary: Dictionary = {
  searchPlaceholder: {
    en: "e.g. 2BHK near Cyber City under 35k",
    hi: "उदा. साइबर सिटी के पास 2BHK, 35k तक"
  },
  heroSearchPlaceholder: {
    en: "Describe what you need — 2BHK near Cyber City under 35k",
    hi: "अपनी जरूरत लिखें — साइबर सिटी के पास 2BHK, 35k तक"
  },
  navSearch: { en: "Search", hi: "खोजें" },
  navShortlist: { en: "Shortlist", hi: "पसंदीदा" },
  navPostProperty: { en: "Post Property", hi: "प्रॉपर्टी पोस्ट करें" },
  navLoginSignup: { en: "Login / Sign up", hi: "लॉगिन / साइन अप" },
  navMyListings: { en: "My Listings", hi: "मेरी लिस्टिंग" },
  navAdmin: { en: "Admin", hi: "एडमिन" },
  menuOpen: { en: "Open menu", hi: "मेनू खोलें" },
  menuAccountSettings: { en: "Account settings", hi: "अकाउंट सेटिंग्स" },
  menuMyShortlist: { en: "My shortlist", hi: "मेरी पसंदीदा" },
  menuSearchRentals: { en: "Search rentals", hi: "किराया खोजें" },
  menuBecomeOwner: { en: "Become an owner", hi: "मालिक बनें" },
  menuHowItWorks: { en: "How it works", hi: "यह कैसे काम करता है" },
  menuHelpFaq: { en: "Help & FAQ", hi: "मदद और FAQ" },
  menuSignOut: { en: "Sign out", hi: "साइन आउट" },
  menuMyListings: { en: "My listings", hi: "मेरी लिस्टिंग" },
  menuAdmin: { en: "Admin", hi: "एडमिन" },
  rowPopularHomesLucknow: {
    en: "Popular homes in Lucknow",
    hi: "लखनऊ में लोकप्रिय घर"
  },
  rowPopularHomesLucknowSub: {
    en: "Hand-picked verified flats and houses",
    hi: "सत्यापित मालिकों से, बिना दलाली"
  },
  rowTrendingPgsLucknow: {
    en: "Trending PGs in Lucknow",
    hi: "लखनऊ में ट्रेंडिंग PG"
  },
  rowTrendingPgsLucknowSub: {
    en: "With meals, WiFi and shared amenities",
    hi: "खाने, वाईफाई और साझा सुविधाओं के साथ"
  },
  rowFurnishedLucknow: {
    en: "Furnished homes in Lucknow",
    hi: "फर्निश्ड घर — लखनऊ"
  },
  rowFurnishedLucknowSub: {
    en: "Move-in ready with furniture and appliances",
    hi: "सब कुछ तैयार, बस आइए"
  },
  viewAll: { en: "View all", hi: "सभी देखें" },
  postProperty: {
    en: "Post Property",
    hi: "प्रॉपर्टी पोस्ट करें"
  },
  unlock: {
    en: "Unlock Number",
    hi: "नंबर अनलॉक करें"
  },
  trustStrip: {
    en: "Verified Owners • No-Response Credit Refund • No Broker Spam",
    hi: "वेरिफाइड ओनर • नो-रिस्पॉन्स क्रेडिट रिफंड • नो ब्रोकर स्पैम"
  },
  yourListings: {
    en: "Your Listings",
    hi: "आपकी लिस्टिंग"
  },
  createListing: {
    en: "Create Listing",
    hi: "लिस्टिंग बनाएं"
  },
  editListing: {
    en: "Edit Listing",
    hi: "लिस्टिंग संपादित करें"
  },
  noListings: {
    en: "No listings found",
    hi: "कोई लिस्टिंग नहीं मिली"
  },
  noListingsDescription: {
    en: "Create your first listing to start receiving tenant enquiries.",
    hi: "किरायेदार पूछताछ प्राप्त करने के लिए अपनी पहली लिस्टिंग बनाएं।"
  },
  verification: {
    en: "Owner Verification",
    hi: "ओनर वेरिफिकेशन"
  },
  verificationDescription: {
    en: "Complete verification to earn a Verified badge. This builds trust and helps you get more enquiries.",
    hi: "वेरिफाइड बैज पाने के लिए वेरिफिकेशन पूरा करें। इससे भरोसा बनता है और ज़्यादा पूछताछ मिलती है।"
  },
  adminDashboard: {
    en: "Admin Dashboard",
    hi: "एडमिन डैशबोर्ड"
  },
  draft: { en: "Draft", hi: "ड्राफ्ट" },
  pendingReview: { en: "Pending Review", hi: "समीक्षाधीन" },
  active: { en: "Active", hi: "सक्रिय" },
  rejected: { en: "Rejected", hi: "अस्वीकृत" },
  paused: { en: "Paused", hi: "रोका गया" },
  verified: { en: "Verified", hi: "वेरिफाइड" },
  unverified: { en: "Unverified", hi: "अवेरिफाइड" },
  submit: { en: "Submit", hi: "जमा करें" },
  next: { en: "Next", hi: "आगे" },
  back: { en: "Back", hi: "पीछे" },
  loginRequired: {
    en: "Please log in to continue.",
    hi: "जारी रखने के लिए लॉग इन करें।"
  },
  submitForReview: {
    en: "Submit for Review",
    hi: "समीक्षा के लिए जमा करें"
  },
  reviewInfo: {
    en: "Review your listing details before submitting. Once submitted, our team will review it within 24 hours.",
    hi: "जमा करने से पहले अपनी लिस्टिंग की जानकारी देखें। जमा करने के बाद, हमारी टीम 24 घंटे में इसकी समीक्षा करेगी।"
  },
  listingReviewQueue: {
    en: "Listing Review",
    hi: "लिस्टिंग समीक्षा"
  },
  verificationQueue: {
    en: "Verification Review",
    hi: "वेरिफिकेशन समीक्षा"
  },
  approve: { en: "Approve", hi: "स्वीकृत करें" },
  reject: { en: "Reject", hi: "अस्वीकृत करें" },
  pause: { en: "Pause", hi: "रोकें" },
  pass: { en: "Pass", hi: "पास" },
  fail: { en: "Fail", hi: "फेल" },
  manualReview: { en: "Manual Review", hi: "मैनुअल रिव्यू" },
  reasonRequired: {
    en: "Please provide a reason.",
    hi: "कृपया कारण दें।"
  },
  // CriblMap keys
  cmapTitle: {
    en: "CriblMap — Verified Rent Intelligence",
    hi: "CriblMap — सत्यापित किराया मानचित्र"
  },
  cmapAreaStats: { en: "Area Statistics", hi: "क्षेत्र आँकड़े" },
  cmapListingsInArea: { en: "listings in area", hi: "इस क्षेत्र में लिस्टिंग" },
  cmapVerified: { en: "verified", hi: "सत्यापित" },
  cmapRentsRising: { en: "Rents rising", hi: "किराया बढ़ रहा है" },
  cmapRentsFalling: { en: "Rents falling", hi: "किराया घट रहा है" },
  cmapRentsStable: { en: "Rents stable", hi: "किराया स्थिर" },
  cmapSaveAsAlert: { en: "Save as Alert Zone", hi: "अलर्ट ज़ोन सेव करें" },
  cmapClearSelection: { en: "Clear Selection", hi: "चयन साफ करें" },
  cmapDrawInstruction: {
    en: "Tap two corners to define your area",
    hi: "अपना क्षेत्र बनाने के लिए दो कोने टैप करें"
  },
  cmapMetroLines: { en: "Metro Lines", hi: "मेट्रो लाइन" },
  cmapDropSearchPin: { en: "Drop Search Pin", hi: "खोज पिन छोड़ें" },
  cmapDemandView: { en: "Demand View", hi: "माँग दृश्य" },
  cmapCommuteOverlay: { en: "Commute Overlay", hi: "आवागमन ओवरले" },
  cmapLocalityInsight: { en: "Locality Insight", hi: "इलाके की जानकारी" },
  cmapIsMyRentFair: { en: "Is my rent fair?", hi: "क्या मेरा किराया सही है?" },
  cmapAlertZone: { en: "Alert Zone", hi: "अलर्ट ज़ोन" },
  cmapActiveSeekers: { en: "active seekers in view", hi: "दृश्य में सक्रिय खोजकर्ता" },
  cmapAvgBudget: { en: "Avg budget", hi: "औसत बजट" },
  cmapBelowMarket: { en: "Below market", hi: "बाजार से कम" },
  cmapAtMarket: { en: "At market", hi: "बाजार के अनुसार" },
  cmapAboveMarket: { en: "Above market", hi: "बाजार से ऊपर" },
  cmapNoListings: { en: "No listings in this area", hi: "इस क्षेत्र में कोई लिस्टिंग नहीं" },
  cmapZoomOut: {
    en: "Try zooming out or adjusting your filters",
    hi: "ज़ूम आउट करें या फ़िल्टर बदलें"
  }
};

export function t(locale: Locale, key: string): string {
  const entry = dictionary[key];
  if (!entry) return key;
  return entry[locale] ?? entry.en;
}
