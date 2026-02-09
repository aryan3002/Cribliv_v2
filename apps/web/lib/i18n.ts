export const locales = ["en", "hi"] as const;
export type Locale = (typeof locales)[number];

export function isValidLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

type Dictionary = Record<string, { en: string; hi: string }>;

const dictionary: Dictionary = {
  searchPlaceholder: {
    en: "Describe what you need. Example: 2BHK near Cyber City under 35k",
    hi: "अपनी जरूरत लिखें। उदाहरण: साइबर सिटी के पास 2BHK, 35k तक"
  },
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
  }
};

export function t(locale: Locale, key: string): string {
  const entry = dictionary[key];
  if (!entry) return key;
  return entry[locale] ?? entry.en;
}
