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
    en: "Describe what you need, like 2BHK near Cyber City under 35k",
    hi: "अपनी जरूरत लिखें, जैसे साइबर सिटी के पास 2BHK, 35k तक"
  },
  navSearch: { en: "Search", hi: "खोजें" },
  navSaved: { en: "Saved", hi: "सेव किए" },
  navPostProperty: { en: "Post Property", hi: "प्रॉपर्टी पोस्ट करें" },
  navLoginSignup: { en: "Login / Sign up", hi: "लॉगिन / साइन अप" },
  navMyListings: { en: "My Listings", hi: "मेरी लिस्टिंग" },
  navAdmin: { en: "Admin", hi: "एडमिन" },
  ownerOverview: { en: "Overview", hi: "ओवरव्यू" },
  ownerListings: { en: "Listings", hi: "लिस्टिंग" },
  ownerAdd: { en: "Add", hi: "जोड़ें" },
  ownerLeads: { en: "Leads", hi: "लीड्स" },
  ownerVerify: { en: "Verify", hi: "वेरिफाई" },
  ownerLanguageSwitch: { en: "हिंदी", hi: "EN" },
  ownerLanguageSwitchLabel: { en: "Switch to Hindi", hi: "अंग्रेज़ी में बदलें" },
  ownerOverviewEyebrow: { en: "Owner overview", hi: "ओनर ओवरव्यू" },
  ownerOverviewGreetingMorning: { en: "Good morning", hi: "सुप्रभात" },
  ownerOverviewGreetingAfternoon: { en: "Good afternoon", hi: "नमस्ते" },
  ownerOverviewGreetingEvening: { en: "Good evening", hi: "शुभ संध्या" },
  ownerOverviewEmptySubtitle: {
    en: "Start with one listing, then track every lead from here.",
    hi: "एक लिस्टिंग से शुरू करें, फिर हर लीड यहीं से ट्रैक करें।"
  },
  ownerOverviewPortfolioSubtitle: {
    en: "{listings} listings in your portfolio, {leads} tenant leads tracked.",
    hi: "आपके पोर्टफोलियो में {listings} लिस्टिंग हैं, {leads} किरायेदार लीड ट्रैक हो रही हैं।"
  },
  ownerOverviewHeadlineMetrics: {
    en: "Owner headline metrics",
    hi: "ओनर मुख्य मीट्रिक"
  },
  ownerOverviewActiveListings: { en: "Active listings", hi: "सक्रिय लिस्टिंग" },
  ownerOverviewVisibleTenants: { en: "Visible to tenants", hi: "किरायेदारों को दिख रही हैं" },
  ownerOverviewNewLeads7d: { en: "New leads (7d)", hi: "नई लीड्स (7 दिन)" },
  ownerOverviewLeadRefreshFailed: { en: "Lead refresh failed", hi: "लीड रिफ्रेश नहीं हुई" },
  ownerOverviewFreshInterest: { en: "Fresh tenant interest", hi: "नई किरायेदार रुचि" },
  ownerOverviewPortfolioSummary: { en: "Portfolio summary", hi: "पोर्टफोलियो सारांश" },
  ownerOverviewPending: { en: "Pending", hi: "समीक्षाधीन" },
  ownerOverviewDrafts: { en: "Drafts", hi: "ड्राफ्ट" },
  ownerOverviewTotal: { en: "Total", hi: "कुल" },
  ownerOverviewPriorityWork: { en: "Priority work", hi: "जरूरी काम" },
  ownerOverviewVerificationAttention: {
    en: "Verification needs attention",
    hi: "वेरिफिकेशन पर ध्यान दें"
  },
  ownerOverviewVerificationAttentionBody: {
    en: "Complete verification for active listings to improve tenant trust.",
    hi: "किरायेदार भरोसा बढ़ाने के लिए सक्रिय लिस्टिंग का वेरिफिकेशन पूरा करें।"
  },
  ownerOverviewCompleteVerification: {
    en: "Complete verification",
    hi: "वेरिफिकेशन पूरा करें"
  },
  ownerOverviewNoUrgentVerification: {
    en: "No urgent verification work",
    hi: "कोई जरूरी वेरिफिकेशन काम नहीं"
  },
  ownerOverviewNoUrgentVerificationBody: {
    en: "Your active portfolio has no verification blockers.",
    hi: "आपके सक्रिय पोर्टफोलियो में कोई वेरिफिकेशन रुकावट नहीं है।"
  },
  ownerOverviewViewVerification: { en: "View verification", hi: "वेरिफिकेशन देखें" },
  ownerOverviewPortfolioManagement: { en: "Portfolio management", hi: "पोर्टफोलियो मैनेजमेंट" },
  ownerOverviewPortfolioManagementBody: {
    en: "Jump into focused pages for listing updates and tenant follow-up.",
    hi: "लिस्टिंग अपडेट और किरायेदार फॉलो-अप के लिए अलग पेज खोलें।"
  },
  ownerOverviewManageListings: { en: "Manage listings", hi: "लिस्टिंग संभालें" },
  ownerOverviewReviewLeads: { en: "Review leads", hi: "लीड्स देखें" },
  ownerOverviewPortfolio: { en: "Portfolio", hi: "पोर्टफोलियो" },
  ownerOverviewRecentListings: { en: "Recent listings", hi: "हाल की लिस्टिंग" },
  ownerOverviewTenantInterest: { en: "Tenant interest", hi: "किरायेदार रुचि" },
  ownerOverviewRecentLeads: { en: "Recent leads", hi: "हाल की लीड्स" },
  ownerOverviewLoadingListings: { en: "Loading listings", hi: "लिस्टिंग लोड हो रही हैं" },
  ownerOverviewLoadingLeads: { en: "Loading leads", hi: "लीड्स लोड हो रही हैं" },
  ownerOverviewNoListingsYet: { en: "No listings yet", hi: "अभी कोई लिस्टिंग नहीं" },
  ownerOverviewNoListingsYetBody: {
    en: "Create your first listing to start receiving tenant interest.",
    hi: "किरायेदार रुचि पाने के लिए अपनी पहली लिस्टिंग बनाएं।"
  },
  ownerOverviewNoLeadsYet: { en: "No leads yet", hi: "अभी कोई लीड नहीं" },
  ownerOverviewNoLeadsYetBody: {
    en: "New tenant enquiries will appear here.",
    hi: "नई किरायेदार पूछताछ यहां दिखेगी।"
  },
  ownerOverviewLocationPending: {
    en: "Location details pending",
    hi: "लोकेशन जानकारी बाकी है"
  },
  ownerOverviewPropertyManagementAssistance: {
    en: "Property management assistance",
    hi: "प्रॉपर्टी मैनेजमेंट मदद"
  },
  ownerOverviewSecondaryAction: { en: "Secondary action", hi: "दूसरा विकल्प" },
  ownerOverviewManagementTitle: {
    en: "Need help managing properties?",
    hi: "प्रॉपर्टी मैनेज करने में मदद चाहिए?"
  },
  ownerOverviewManagementBody: {
    en: "Ask the Cribliv team for hands-off onboarding and operations support.",
    hi: "ऑनबोर्डिंग और ऑपरेशन सपोर्ट के लिए Cribliv टीम से मदद मांगें।"
  },
  ownerOverviewRequestHelp: { en: "Request management help", hi: "मैनेजमेंट मदद मांगें" },
  ownerOverviewRetryHelp: { en: "Retry management help", hi: "मैनेजमेंट मदद फिर मांगें" },
  ownerOverviewSendingRequest: { en: "Sending request...", hi: "रिक्वेस्ट भेजी जा रही है..." },
  ownerOverviewRequestSubmitted: {
    en: "Request submitted. Our team will contact you shortly.",
    hi: "रिक्वेस्ट जमा हो गई। हमारी टीम जल्द संपर्क करेगी।"
  },
  ownerOverviewRetry: { en: "Retry", hi: "फिर कोशिश करें" },
  ownerListingsEyebrow: { en: "Listings", hi: "लिस्टिंग" },
  ownerListingsTitle: { en: "Manage listings", hi: "लिस्टिंग संभालें" },
  ownerListingsSubtitle: {
    en: "Review every property, adjust availability, boost active homes, and fix items that need attention.",
    hi: "हर प्रॉपर्टी देखें, उपलब्धता बदलें, सक्रिय घरों को बूस्ट करें और जिन लिस्टिंग पर ध्यान चाहिए उन्हें ठीक करें।"
  },
  ownerListingsToolbar: { en: "Listing controls", hi: "लिस्टिंग कंट्रोल" },
  ownerFilterGroup: { en: "Listing status filters", hi: "लिस्टिंग स्टेटस फिल्टर" },
  ownerFilterAll: { en: "All", hi: "सभी" },
  ownerFilterDrafts: { en: "Drafts", hi: "ड्राफ्ट" },
  ownerFilterPending: { en: "Pending", hi: "समीक्षाधीन" },
  ownerFilterActive: { en: "Active", hi: "सक्रिय" },
  ownerFilterRejected: { en: "Rejected", hi: "अस्वीकृत" },
  ownerFilterPaused: { en: "Paused", hi: "रोकी गई" },
  ownerListingsLoading: { en: "Loading listings", hi: "लिस्टिंग लोड हो रही हैं" },
  ownerListingsEmptyTitle: { en: "No listings yet", hi: "अभी कोई लिस्टिंग नहीं" },
  ownerListingsEmptyBody: {
    en: "Create your first listing to start receiving tenant enquiries.",
    hi: "किरायेदार पूछताछ पाने के लिए अपनी पहली लिस्टिंग बनाएं।"
  },
  ownerListingsFilteredEmpty: {
    en: "No listings in this status",
    hi: "इस स्टेटस में कोई लिस्टिंग नहीं"
  },
  ownerListingsFilteredEmptyBody: {
    en: "Try another status filter or view all listings.",
    hi: "दूसरा स्टेटस फिल्टर चुनें या सभी लिस्टिंग देखें।"
  },
  ownerListingsShowAll: { en: "Show all listings", hi: "सभी लिस्टिंग दिखाएं" },
  ownerListingsBoostSuccess: {
    en: "Boost started. Your listing will get higher visibility.",
    hi: "बूस्ट शुरू हो गया। आपकी लिस्टिंग को ज्यादा विजिबिलिटी मिलेगी।"
  },
  ownerListingsErrorUnauthorized: {
    en: "Your session expired. Please log in again to continue.",
    hi: "आपका सेशन समाप्त हो गया है। जारी रखने के लिए फिर से लॉग इन करें।"
  },
  ownerListingsErrorNetwork: {
    en: "You're offline or the connection dropped. Check your internet and retry.",
    hi: "आप ऑफलाइन हैं या कनेक्शन टूट गया है। इंटरनेट जांचें और फिर कोशिश करें।"
  },
  ownerListingsErrorListings: {
    en: "We couldn't refresh your listings. Please try again.",
    hi: "हम आपकी लिस्टिंग रिफ्रेश नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  ownerListingsErrorAvailability: {
    en: "We couldn't update availability. Please try again.",
    hi: "हम उपलब्धता अपडेट नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  ownerListingsErrorListingAvailability: {
    en: "We couldn't update availability. Please try again.",
    hi: "हम उपलब्धता अपडेट नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  ownerOverviewErrorUnauthorized: {
    en: "Your session expired. Please log in again to continue.",
    hi: "आपका सेशन समाप्त हो गया है। जारी रखने के लिए फिर से लॉग इन करें।"
  },
  ownerOverviewErrorNetwork: {
    en: "You're offline or the connection dropped. Check your internet and retry.",
    hi: "आप ऑफलाइन हैं या कनेक्शन टूट गया है। इंटरनेट जांचें और फिर कोशिश करें।"
  },
  ownerOverviewErrorListings: {
    en: "We couldn't refresh your listings. Please try again.",
    hi: "हम आपकी लिस्टिंग रिफ्रेश नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  ownerOverviewErrorLeads: {
    en: "We couldn't refresh your leads. Please try again.",
    hi: "हम आपकी लीड्स रिफ्रेश नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  ownerOverviewErrorPm: {
    en: "We couldn't send your request. Please try again.",
    hi: "हम आपकी रिक्वेस्ट नहीं भेज सके। कृपया फिर कोशिश करें।"
  },
  ownerOverviewLeadStatusNew: { en: "New", hi: "नई" },
  ownerOverviewLeadStatusContacted: { en: "Contacted", hi: "संपर्क हुआ" },
  ownerOverviewLeadStatusVisitScheduled: { en: "Visit Scheduled", hi: "विजिट तय" },
  ownerOverviewLeadStatusDealDone: { en: "Deal Done", hi: "डील पूरी" },
  ownerOverviewLeadStatusLost: { en: "Lost", hi: "छूटी" },
  menuOpen: { en: "Open menu", hi: "मेनू खोलें" },
  menuAccountSettings: { en: "Account settings", hi: "अकाउंट सेटिंग्स" },
  menuMySaved: { en: "My saved", hi: "मेरे सेव किए" },
  menuMyStay: { en: "My stay", hi: "मेरा स्टे" },
  menuSearchRentals: { en: "Search rentals", hi: "किराया खोजें" },
  menuMap: { en: "CriblMap", hi: "CriblMap" },
  menuBecomeOwner: { en: "Become an owner", hi: "मालिक बनें" },
  menuHowItWorks: { en: "How it works", hi: "यह कैसे काम करता है" },
  menuHelpFaq: { en: "Help & FAQ", hi: "मदद और FAQ" },
  menuSignOut: { en: "Sign out", hi: "साइन आउट" },
  menuMyListings: { en: "My listings", hi: "मेरी लिस्टिंग" },
  menuPgDashboard: { en: "PG dashboard", hi: "PG डैशबोर्ड" },
  menuPgNewListing: { en: "New PG listing", hi: "नई PG लिस्टिंग" },
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
    hi: "लखनऊ में फर्निश्ड घर"
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
  verificationListingLabel: { en: "Listing", hi: "लिस्टिंग" },
  verificationSelectListing: { en: "Select listing...", hi: "लिस्टिंग चुनें..." },
  verificationCreateListingFirst: {
    en: "Create a listing first, then complete owner verification.",
    hi: "पहले लिस्टिंग बनाएं, फिर ओनर वेरिफिकेशन पूरा करें।"
  },
  verificationSelectListingFirst: {
    en: "Select a listing before uploading a verification file.",
    hi: "वेरिफिकेशन फ़ाइल अपलोड करने से पहले लिस्टिंग चुनें।"
  },
  verificationCurrentStatus: { en: "Current status", hi: "मौजूदा स्थिति" },
  verificationPassedTitle: { en: "Verification Passed", hi: "वेरिफिकेशन पास" },
  verificationPassedBody: {
    en: "Your identity is verified. Tenants will see a Verified badge on your listing.",
    hi: "आपकी पहचान वेरिफाइड है। किरायेदारों को आपकी लिस्टिंग पर Verified बैज दिखेगा।"
  },
  verificationFailedTitle: { en: "Verification Failed", hi: "वेरिफिकेशन फेल" },
  verificationFailedBody: {
    en: "We could not verify this listing. Re-submit with clearer details.",
    hi: "हम इस लिस्टिंग को वेरिफाई नहीं कर सके। कृपया स्पष्ट जानकारी के साथ दोबारा जमा करें।"
  },
  verificationPendingTitle: {
    en: "Verification In Progress",
    hi: "वेरिफिकेशन प्रक्रिया में"
  },
  verificationPendingBody: {
    en: "Your submission is being reviewed.",
    hi: "आपकी सबमिशन की समीक्षा चल रही है।"
  },
  verificationUnverifiedTitle: { en: "Get Verified", hi: "वेरिफाइड हों" },
  verificationUnverifiedBody: {
    en: "Complete verification to build trust and improve lead quality.",
    hi: "भरोसा बढ़ाने और बेहतर लीड पाने के लिए वेरिफिकेशन पूरा करें।"
  },
  verificationAwaitingAdmin: {
    en: "Awaiting admin review for final verification status.",
    hi: "अंतिम वेरिफिकेशन स्थिति के लिए एडमिन समीक्षा बाकी है।"
  },
  verificationStatusFailed: { en: "Verification Failed", hi: "वेरिफिकेशन फेल" },
  verificationResultPending: { en: "Verification Pending", hi: "वेरिफिकेशन लंबित" },
  verificationProvider: { en: "Provider", hi: "प्रोवाइडर" },
  verificationProviderReference: { en: "Provider reference", hi: "प्रोवाइडर रेफरेंस" },
  verificationProviderResultCode: { en: "Provider result code", hi: "प्रोवाइडर रिजल्ट कोड" },
  verificationReviewReason: { en: "Review reason", hi: "समीक्षा कारण" },
  verificationMatchScore: { en: "Match score: {score}%", hi: "मैच स्कोर: {score}%" },
  verificationThreshold: { en: "Threshold: {threshold}%", hi: "थ्रेशहोल्ड: {threshold}%" },
  verificationNoScore: {
    en: "Complete a verification step to see results.",
    hi: "परिणाम देखने के लिए एक वेरिफिकेशन स्टेप पूरा करें।"
  },
  verificationMethodLabel: { en: "Verification method", hi: "वेरिफिकेशन तरीका" },
  verificationChooseMethod: { en: "Choose one method", hi: "एक तरीका चुनें" },
  verificationMethodVideo: { en: "Video selfie", hi: "वीडियो सेल्फी" },
  verificationMethodElectricity: { en: "Electricity bill", hi: "बिजली बिल" },
  verificationVideoTitle: { en: "Video verification", hi: "वीडियो वेरिफिकेशन" },
  verificationVideoBody: {
    en: "Upload a clear liveness video for this listing. We upload it first, then submit the completed artifact for review.",
    hi: "इस लिस्टिंग के लिए साफ लिवनेस वीडियो अपलोड करें। हम पहले इसे अपलोड करेंगे, फिर पूरे आर्टिफैक्ट को समीक्षा के लिए जमा करेंगे।"
  },
  verificationVideoArtifactLabel: {
    en: "Upload verification video",
    hi: "वेरिफिकेशन वीडियो अपलोड करें"
  },
  verificationVideoReferenceLabel: { en: "Reference code (if any)", hi: "रेफरेंस कोड (यदि हो)" },
  verificationVideoReferencePlaceholder: { en: "e.g. REF-12345", hi: "जैसे REF-12345" },
  verificationSubmitVideo: {
    en: "Submit Video Verification",
    hi: "वीडियो वेरिफिकेशन जमा करें"
  },
  verificationVideoRequired: {
    en: "Please select a listing and upload a verification video.",
    hi: "कृपया लिस्टिंग चुनें और वेरिफिकेशन वीडियो अपलोड करें।"
  },
  verificationVideoSubmitted: {
    en: "Video verification submitted.",
    hi: "वीडियो वेरिफिकेशन जमा हो गया।"
  },
  verificationElectricityTitle: {
    en: "Electricity verification",
    hi: "बिजली बिल वेरिफिकेशन"
  },
  verificationElectricityBody: {
    en: "Enter your consumer ID and the address printed on the bill. Uploading a bill is optional, but helps review.",
    hi: "अपना कंज्यूमर ID और बिल पर छपा पता दर्ज करें। बिल अपलोड करना वैकल्पिक है, लेकिन समीक्षा में मदद करता है।"
  },
  verificationConsumerIdLabel: { en: "Consumer ID", hi: "कंज्यूमर ID" },
  verificationConsumerIdPlaceholder: { en: "Consumer ID", hi: "कंज्यूमर ID" },
  verificationBillArtifactLabel: {
    en: "Upload electricity bill (optional)",
    hi: "बिजली बिल अपलोड करें (वैकल्पिक)"
  },
  verificationAddressTextLabel: { en: "Address text", hi: "पते का टेक्स्ट" },
  verificationAddressTextPlaceholder: {
    en: "Enter bill address text for fuzzy match",
    hi: "मैच के लिए बिल पर लिखा पता दर्ज करें"
  },
  verificationSubmitElectricity: {
    en: "Submit Electricity Verification",
    hi: "बिजली वेरिफिकेशन जमा करें"
  },
  verificationElectricityRequired: {
    en: "Please select a listing and provide your consumer ID and address.",
    hi: "कृपया लिस्टिंग चुनें और कंज्यूमर ID व पता दें।"
  },
  verificationBillUploadRequired: {
    en: "Wait for the bill upload to finish, or remove it before submitting.",
    hi: "सबमिट करने से पहले बिल अपलोड पूरा होने दें या उसे हटा दें।"
  },
  verificationElectricitySubmitted: {
    en: "Electricity verification submitted successfully.",
    hi: "बिजली वेरिफिकेशन सफलतापूर्वक जमा हो गया।"
  },
  verificationSubmitting: { en: "Submitting...", hi: "जमा हो रहा है..." },
  verificationSelectFile: { en: "Select file", hi: "फ़ाइल चुनें" },
  verificationRetryUpload: { en: "Retry", hi: "फिर कोशिश करें" },
  verificationRemoveFile: { en: "Remove", hi: "हटाएं" },
  verificationUploadReady: { en: "Ready", hi: "तैयार" },
  verificationNoFileSelected: { en: "No file selected", hi: "कोई फ़ाइल नहीं चुनी गई" },
  verificationUploaded: { en: "uploaded", hi: "अपलोड हुआ" },
  verificationHistoryKicker: { en: "Audit trail", hi: "ऑडिट ट्रेल" },
  verificationHistoryTitle: { en: "Submission history", hi: "सबमिशन इतिहास" },
  verificationHistoryVideo: { en: "Video selfie", hi: "वीडियो सेल्फी" },
  verificationHistoryElectricity: { en: "Electricity bill", hi: "बिजली बिल" },
  verificationHistoryStatus: { en: "Status", hi: "स्थिति" },
  verificationHistoryMachineResult: { en: "Machine result", hi: "मशीन परिणाम" },
  verificationHistoryAddressScore: { en: "Address match score", hi: "पता मैच स्कोर" },
  verificationHistoryLivenessScore: { en: "Liveness score", hi: "लिवनेस स्कोर" },
  verificationRetryableProvider: {
    en: "Provider signaled this attempt may be retried.",
    hi: "प्रोवाइडर ने बताया कि इस कोशिश को दोबारा किया जा सकता है।"
  },
  verificationSubmittedAt: { en: "Submitted", hi: "जमा किया गया" },
  verificationErrorNetwork: {
    en: "You're offline or the connection dropped. Check your internet and retry.",
    hi: "आप ऑफलाइन हैं या कनेक्शन टूट गया है। इंटरनेट जांचें और फिर कोशिश करें।"
  },
  verificationErrorLoadListings: {
    en: "We couldn't load your listings. Please retry.",
    hi: "हम आपकी लिस्टिंग लोड नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  verificationErrorLoadStatus: {
    en: "We couldn't load verification status. Please retry.",
    hi: "हम वेरिफिकेशन स्थिति लोड नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  verificationErrorSubmitVideo: {
    en: "Video submission failed. Please retry.",
    hi: "वीडियो सबमिशन विफल रहा। कृपया फिर कोशिश करें।"
  },
  verificationErrorSubmitElectricity: {
    en: "Electricity submission failed. Please retry.",
    hi: "बिजली वेरिफिकेशन सबमिशन विफल रहा। कृपया फिर कोशिश करें।"
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
  archived: { en: "Archived", hi: "आर्काइव" },
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
    en: "CriblMap: Verified Rent Intelligence",
    hi: "CriblMap: सत्यापित किराया मानचित्र"
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
  },
  // Listing detail page
  aboutThisProperty: {
    en: "About this property",
    hi: "इस प्रॉपर्टी के बारे में"
  },
  whatThisPlaceOffers: {
    en: "What this place offers",
    hi: "यहाँ क्या-क्या मिलेगा"
  },
  showAllAmenities: {
    en: "Show all amenities",
    hi: "सभी सुविधाएं देखें"
  },
  listedBy: {
    en: "Listed by",
    hi: "लिस्टिंग: "
  },
  memberSince: {
    en: "On Cribliv since",
    hi: "Cribliv पर जुड़े"
  },
  whatsappReady: {
    en: "WhatsApp ready",
    hi: "WhatsApp उपलब्ध"
  },
  thingsToKnow: {
    en: "Things to know",
    hi: "जानने योग्य बातें"
  },
  moveInAndLease: {
    en: "Move-in & lease",
    hi: "मूव-इन और किराया अनुबंध"
  },
  tenantPreferences: {
    en: "Preferred tenants",
    hi: "किरायेदार प्राथमिकताएं"
  },
  criblivGuarantees: {
    en: "Cribliv guarantees",
    hi: "Cribliv की गारंटी"
  },
  whereYoullBe: {
    en: "Where you'll be",
    hi: "लोकेशन"
  },
  exactAddressAfterUnlock: {
    en: "Exact address shared after you unlock the owner's contact.",
    hi: "ओनर का नंबर अनलॉक करने पर पूरा पता मिलेगा।"
  },
  similarProperties: {
    en: "Similar properties nearby",
    hi: "आस-पास की इसी तरह की प्रॉपर्टी"
  },
  showAllPhotos: {
    en: "Show all photos",
    hi: "सभी फोटो देखें"
  },
  noChargeUntilUnlock: {
    en: "You won't be charged unless the owner picks up. Auto-refund in 12h.",
    hi: "ओनर के जवाब देने तक कोई शुल्क नहीं, 12 घंटे में ऑटो-रिफंड।"
  },
  keyHighlights: {
    en: "Key highlights",
    hi: "मुख्य बातें"
  },
  bhkLabel: { en: "BHK", hi: "BHK" },
  bathLabel: { en: "Bathrooms", hi: "बाथरूम" },
  areaLabel: { en: "Carpet Area", hi: "क्षेत्रफल" },
  furnishingLabel: { en: "Furnishing", hi: "फर्निशिंग" },
  propertyTypeLabel: { en: "Type", hi: "प्रकार" },
  perMonth: { en: "/month", hi: "/महीना" },
  depositShort: { en: "deposit", hi: "जमा" },
  availableFrom: { en: "Available from", hi: "उपलब्ध" },
  availableNow: { en: "Available now", hi: "तुरंत उपलब्ध" },
  totalBeds: { en: "Total beds", hi: "कुल बेड" },
  occupancyType: { en: "Occupancy", hi: "ऑक्यूपेंसी" },
  sharing: { en: "Sharing options", hi: "शेयरिंग विकल्प" },
  mealsIncluded: { en: "Meals included", hi: "भोजन शामिल" },
  curfew: { en: "Curfew", hi: "कर्फ्यू" },
  attachedBath: { en: "Attached bathroom", hi: "अटैच्ड बाथरूम" },
  leaseTerm: { en: "11-month rent agreement", hi: "11-महीने का किराया अनुबंध" },
  noBrokerSpam: { en: "No broker spam, direct from owner", hi: "कोई दलाल नहीं, सीधे ओनर से" },
  verifiedOwner: { en: "Verified owner", hi: "वेरिफाइड ओनर" },
  autoRefund12h: {
    en: "Auto-refund credit if no response in 12h",
    hi: "12 घंटे में जवाब न मिले तो ऑटो-रिफंड"
  },
  saveListing: { en: "Save", hi: "सेव करें" },
  savedListing: { en: "Saved", hi: "सेव किया" },
  shareListing: { en: "Share", hi: "शेयर करें" },
  closeLabel: { en: "Close", hi: "बंद करें" },
  amenityCategoryConnectivity: { en: "Connectivity", hi: "कनेक्टिविटी" },
  amenityCategoryComfort: { en: "Comfort & climate", hi: "कम्फर्ट" },
  amenityCategorySafety: { en: "Safety & security", hi: "सुरक्षा" },
  amenityCategoryLifestyle: { en: "Lifestyle", hi: "लाइफस्टाइल" },
  amenityCategoryKitchen: { en: "Kitchen & laundry", hi: "किचन और लॉन्ड्री" },
  amenityCategoryServices: { en: "Services", hi: "सर्विसेज" },
  amenityCategoryOther: { en: "Other", hi: "अन्य" },
  notIncluded: { en: "Not included", hi: "उपलब्ध नहीं" },
  exploreOnMap: { en: "Explore on CriblMap", hi: "CriblMap पर देखें" },
  // PG Operator keys (Task 26 — EN canonical, HI stubbed)
  pgBecomeTitle: { en: "Become a PG operator", hi: "Become a PG operator" },
  pgBecomeTenantSetup: {
    en: "Setting up your PG operator account…",
    hi: "Setting up your PG operator account…"
  },
  pgBecomeOwnerBlocked: {
    en: "You already manage properties as an owner",
    hi: "You already manage properties as an owner"
  },
  pgBecomeOwnerBlockedBody: {
    en: "Managing both an owner account and a PG operator account in one profile is on the V1.5 roadmap.",
    hi: "Managing both an owner account and a PG operator account in one profile is on the V1.5 roadmap."
  },
  pgOnboardingTitle: { en: "How big is your PG?", hi: "How big is your PG?" },
  pgWizardStep1: { en: "Property & Identity", hi: "Property & Identity" },
  pgWizardStep2: { en: "Rooms & Pricing", hi: "Rooms & Pricing" },
  pgWizardStep3: { en: "Payment", hi: "Payment" },
  pgWizardStep4: { en: "Rules", hi: "Rules" },
  pgWizardStep5: { en: "Amenities & Food", hi: "Amenities & Food" },
  pgWizardStep6: { en: "Photos & Review", hi: "Photos & Review" },
  pgVoiceOpenCta: {
    en: "Or speak it, Chaya can fill this in",
    hi: "Or speak it, Chaya can fill this in"
  },
  pgVoiceTapToTalk: { en: "Tap to talk", hi: "Tap to talk" },
  pgVoiceTimerAria: { en: "Session time remaining", hi: "Session time remaining" },
  pgVoiceWarnOneMin: {
    en: "Almost out of time. Wrap up your listing",
    hi: "Almost out of time. Wrap up your listing"
  },
  pgDashboardTitle: { en: "Your PG dashboard", hi: "Your PG dashboard" },
  pgDashboardEmpty: {
    en: "Once your listing is live, performance shows here.",
    hi: "Once your listing is live, performance shows here."
  },
  listenHeroTitle: { en: "Tell me what you're looking for", hi: "बताइए, कैसा घर चाहिए?" },
  listenHeroSub: {
    en: "Type or speak, Hindi or English. Live homes across {city}.",
    hi: "टाइप करें या बोलें, हिंदी या अंग्रेज़ी में। {city} के लाइव घर।"
  },
  listenHeroCountIdle: {
    en: "{n} homes live in {city} right now",
    hi: "{n} घर अभी {city} में लाइव हैं"
  },
  listenHeroCountMatching: { en: "{n} homes match so far…", hi: "{n} घर अब तक मैच हुए…" },
  listenHeroCountReady: {
    en: "{n} homes match, press enter or keep talking",
    hi: "{n} घर मैच, एंटर दबाएँ या बोलते रहें"
  },
  listenHeroCountZero: {
    en: "No exact matches yet. Try widening, or press enter to explore",
    hi: "अभी कोई सटीक मैच नहीं, थोड़ा बदलें या एंटर दबाकर देखें"
  },
  listenHeroListening: { en: "Listening…", hi: "सुन रहे हैं…" },
  listenHeroGrowing: {
    en: "Cribliv is growing in {city}. Tell us what you need",
    hi: "Cribliv {city} में बढ़ रहा है, बताइए आपको क्या चाहिए"
  },
  listenHeroExample1: { en: "2BHK Gomti Nagar under 15k", hi: "गोमती नगर में 2BHK, 15 हज़ार तक" },
  listenHeroExample2: {
    en: "furnished flat near Hazratganj",
    hi: "हज़रतगंज के पास फर्निश्ड फ्लैट"
  },
  listenHeroExample3: { en: "PG with food in Indira Nagar", hi: "इंदिरा नगर में खाने के साथ PG" },
  listenHeroCityStrip: { en: "Browse rentals by city", hi: "शहर के अनुसार किराये देखें" },
  mayaSectionTitle: {
    en: "List your property by talking to Maya",
    hi: "Maya से बात करके अपनी प्रॉपर्टी लिस्ट करें"
  },
  mayaSectionSub: {
    en: "Speak in Hindi or English. Maya fills in the listing as you talk.",
    hi: "हिंदी या अंग्रेज़ी में बोलें, Maya आपकी लिस्टिंग खुद भर देती है।"
  },
  mayaSectionCta: { en: "Try voice listing", hi: "वॉइस लिस्टिंग आज़माएं" },
  // ── Lead monetization: tenant callback flow ────────────────────────────────
  cbGuaranteeIntro: {
    en: "Use 1 credit and you'll get a call for this property within 24 hours. If nobody calls, your credit comes back automatically. Guaranteed.",
    hi: "1 क्रेडिट में इस प्रॉपर्टी के लिए 24 घंटे के भीतर आपको कॉल आएगी। कॉल न आए तो आपका क्रेडिट अपने आप वापस। गारंटीड।"
  },
  cbRequestButton: { en: "Request Callback", hi: "कॉलबैक का अनुरोध करें" },
  cbVerifyButton: { en: "Verify & Request Callback", hi: "सत्यापित करें और कॉलबैक पाएं" },
  cbRequestedTitle: { en: "Callback requested ✓", hi: "कॉलबैक अनुरोध हो गया ✓" },
  cbStepRequested: { en: "Requested ✓", hi: "अनुरोध हो गया ✓" },
  cbStepOwnerNotified: { en: "Owner notified ✓", hi: "मालिक को सूचित किया गया ✓" },
  cbStepCallOnWay: { en: "Call on its way by {time}", hi: "कॉल आने वाली है, {time} तक" },
  cbStepRefunded: { en: "Credit refunded ✓", hi: "क्रेडिट वापस हो गया ✓" },
  cbRefundReassure: {
    en: "No call by then? Your credit comes back automatically. Credits left: {n}",
    hi: "तब तक कॉल नहीं? आपका क्रेडिट अपने आप वापस आ जाएगा। बचे क्रेडिट: {n}"
  },
  cbGuestHint: {
    en: "Guest browsing is open. Sign in with OTP to request a callback. New accounts get 10 free credits.",
    hi: "मेहमान के तौर पर ब्राउज़िंग खुली है। कॉलबैक के लिए OTP से साइन इन करें। नए खातों को 10 मुफ़्त क्रेडिट मिलते हैं।"
  },
  cbMyCallbacks: { en: "My Callbacks", hi: "मेरी कॉलबैक" },
  cbGuaranteeLine: {
    en: "Every request is guaranteed: a call within 24 hours or your credit back.",
    hi: "हर अनुरोध की गारंटी: 24 घंटे में कॉल या आपका क्रेडिट वापस।"
  },
  cbGotCall: { en: "Yes, I got the call", hi: "हाँ, मुझे कॉल आई" },
  cbNoCall: { en: "No call, refund my credit", hi: "कॉल नहीं आई, मेरा क्रेडिट वापस करें" },
  cbRefundedCaption: {
    en: "Nobody called in time, so your credit came back automatically.",
    hi: "समय पर किसी ने कॉल नहीं की, इसलिए आपका क्रेडिट अपने आप वापस आ गया।"
  },
  cbConfirmedCaption: {
    en: "Confirmed. Glad the call happened.",
    hi: "पुष्टि हो गई। अच्छा लगा कि कॉल हुई।"
  },
  cbDisputedCaption: {
    en: "Dispute recorded. Your credit was refunded.",
    hi: "शिकायत दर्ज। आपका क्रेडिट वापस कर दिया गया।"
  },
  cbCallMadePrompt: { en: "Call made. Did you get it?", hi: "कॉल की गई। क्या आपको मिली?" },
  cbEmptyState: {
    en: "No callback requests yet. Find a property and request a callback.",
    hi: "अभी कोई कॉलबैक अनुरोध नहीं। कोई प्रॉपर्टी चुनें और कॉलबैक मांगें।"
  },
  cbLoginPrompt: {
    en: "Please log in to see your callbacks.",
    hi: "अपनी कॉलबैक देखने के लिए कृपया लॉग इन करें।"
  },
  cbNoCredits: { en: "Not enough credits", hi: "पर्याप्त क्रेडिट नहीं हैं" },
  cbBuyCreditsSub: {
    en: "Buy credits to unlock this listing.",
    hi: "इस लिस्टिंग को अनलॉक करने के लिए क्रेडिट खरीदें।"
  },
  // ── Lead monetization: owner lead cards ────────────────────────────────────
  leadFreeBadge: { en: "FREE LEAD", hi: "मुफ़्त लीड" },
  leadUnlockButton: { en: "Unlock for 1 credit", hi: "1 क्रेडिट में अनलॉक करें" },
  leadCallNow: { en: "Call now", hi: "अभी कॉल करें" },
  leadCallAgain: { en: "Call again", hi: "फिर कॉल करें" },
  leadCallReminder: {
    en: "Call before the timer ends or the tenant is refunded.",
    hi: "टाइमर खत्म होने से पहले कॉल करें वरना किरायेदार को रिफंड हो जाएगा।"
  },
  leadExpired: {
    en: "Expired. Respond faster next time.",
    hi: "समय समाप्त। अगली बार जल्दी जवाब दें।"
  },
  leadNoCredits: { en: "Not enough lead credits", hi: "लीड क्रेडिट कम हैं" },
  leadBuyPackSub: {
    en: "Buy lead credits to unlock tenant contacts instantly.",
    hi: "किरायेदार का नंबर तुरंत अनलॉक करने के लिए लीड क्रेडिट खरीदें।"
  },
  leadBalanceLabel: { en: "Lead credits", hi: "लीड क्रेडिट" },
  leadLockedWaiting: {
    en: "{n} locked leads waiting",
    hi: "{n} लॉक्ड लीड इंतज़ार में हैं"
  },
  ownerLeadsBackDashboard: { en: "Dashboard", hi: "डैशबोर्ड" },
  ownerLeadsTitle: { en: "Your leads", hi: "आपकी लीड्स" },
  ownerLeadsTotal: { en: "total", hi: "कुल" },
  ownerLeadsThisWeek: { en: "this week", hi: "इस हफ्ते" },
  ownerLeadsVsLast7d: { en: "vs last 7d", hi: "पिछले 7 दिन से तुलना" },
  ownerLeadsSearchLabel: { en: "Search leads", hi: "लीड्स खोजें" },
  ownerLeadsSearchPlaceholder: {
    en: "Search tenant, listing, phone",
    hi: "किरायेदार, लिस्टिंग, फोन खोजें"
  },
  ownerLeadsViewMode: { en: "View mode", hi: "व्यू मोड" },
  ownerLeadsBoard: { en: "Board", hi: "बोर्ड" },
  ownerLeadsList: { en: "List", hi: "लिस्ट" },
  ownerLeadsExportCsv: { en: "Export CSV", hi: "CSV एक्सपोर्ट करें" },
  ownerLeadsExportingCsv: { en: "Exporting...", hi: "एक्सपोर्ट हो रहा है..." },
  ownerLeadsExportDownloaded: {
    en: "Export downloaded.",
    hi: "एक्सपोर्ट डाउनलोड हो गया।"
  },
  ownerLeadsExportFailed: {
    en: "We couldn't export your leads. Please try again.",
    hi: "हम आपकी लीड्स एक्सपोर्ट नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  ownerLeadsActions: { en: "Lead actions", hi: "लीड क्रियाएं" },
  ownerLeadsMobileControls: { en: "Mobile lead controls", hi: "मोबाइल लीड कंट्रोल" },
  ownerLeadsFilterByStatus: {
    en: "Filter leads by status",
    hi: "स्टेटस से लीड फिल्टर करें"
  },
  ownerLeadsFilterEmpty: {
    en: "Try another search or status filter.",
    hi: "दूसरी खोज या स्टेटस फिल्टर आज़माएं।"
  },
  ownerLeadsLoading: { en: "Loading leads", hi: "लीड्स लोड हो रही हैं" },
  ownerLeadsLoginRequired: {
    en: "Please log in to view leads.",
    hi: "लीड्स देखने के लिए कृपया लॉग इन करें।"
  },
  ownerLeadsUpdateFailed: {
    en: "We couldn't update this lead. Please try again.",
    hi: "हम यह लीड अपडेट नहीं कर सके। कृपया फिर कोशिश करें।"
  },
  ownerLeadsMovedTo: { en: "Moved to {status}", hi: "{status} में ले जाया गया" },
  ownerLeadStatusAll: { en: "All", hi: "सभी" },
  ownerLeadStatusNew: { en: "New", hi: "नई" },
  ownerLeadStatusContacted: { en: "Contacted", hi: "संपर्क हुआ" },
  ownerLeadStatusVisitScheduled: { en: "Visit Scheduled", hi: "विजिट तय" },
  ownerLeadStatusDealDone: { en: "Deal Done", hi: "डील पूरी" },
  ownerLeadStatusLost: { en: "Lost", hi: "छूटी" },
  ownerLeadActionMarkContacted: { en: "Mark Contacted", hi: "संपर्क हुआ मार्क करें" },
  ownerLeadActionMarkLost: { en: "Mark Lost", hi: "छूटी मार्क करें" },
  ownerLeadActionScheduleVisit: { en: "Schedule Visit", hi: "विजिट तय करें" },
  ownerLeadActionDealDone: { en: "Deal Done", hi: "डील पूरी" },
  ownerLeadActionReopen: { en: "Re-open", hi: "फिर खोलें" },
  ownerLeadSaving: { en: "Saving...", hi: "सेव हो रहा है..." },
  ownerLeadEnquired: { en: "Enquired {date}", hi: "{date} को पूछताछ" },
  ownerLeadUpdated: { en: "Updated {date}", hi: "{date} को अपडेट" },
  ownerLeadNotesPlaceholder: {
    en: "Add notes about this lead...",
    hi: "इस लीड के बारे में नोट्स जोड़ें..."
  },
  ownerLeadAddNotes: { en: "Add notes", hi: "नोट्स जोड़ें" },
  ownerLeadEditNotes: { en: "Edit notes", hi: "नोट्स संपादित करें" },
  ownerLeadHideNotes: { en: "Hide notes", hi: "नोट्स छिपाएं" },
  ownerLeadDealDoneMessage: {
    en: "Deal completed. Great work!",
    hi: "डील पूरी हो गई। अच्छा काम!"
  },
  ownerLeadsStatsEmptySub: {
    en: "Share your listings to start receiving tenant enquiries.",
    hi: "किरायेदार पूछताछ पाने के लिए अपनी लिस्टिंग शेयर करें।"
  },
  ownerLeadsTotalEnquiries: { en: "total enquiries", hi: "कुल पूछताछ" },
  ownerLeadsListEmptyTitle: { en: "No leads", hi: "कोई लीड नहीं" },
  ownerLeadsListEmptyStatusTitle: {
    en: 'No leads with status "{status}"',
    hi: '"{status}" स्टेटस में कोई लीड नहीं'
  },
  ownerLeadsListEmptyAllBody: {
    en: "Once tenants enquire about your listings, they'll appear here.",
    hi: "किरायेदार आपकी लिस्टिंग पर पूछताछ करेंगे तो वे यहां दिखेंगे।"
  },
  ownerLeadsListEmptySearchBody: {
    en: "Try another search or clear the search field.",
    hi: "दूसरी खोज करें या खोज फील्ड खाली करें।"
  },
  ownerLeadsListEmptyStatusBody: {
    en: "Try selecting a different status filter above.",
    hi: "ऊपर कोई दूसरा स्टेटस फिल्टर चुनें।"
  },
  ownerLeadsLoadMore: {
    en: "Load more ({n} remaining)",
    hi: "और लोड करें ({n} बाकी)"
  },
  ownerLeadsLoadingMore: { en: "Loading...", hi: "लोड हो रहा है..." },
  ownerLeadsShowingCount: {
    en: "Showing {shown} of {total} leads",
    hi: "{total} में से {shown} लीड दिख रही हैं"
  },
  // ── Guest gating ────────────────────────────────────────────────────────────
  gateHeadline: { en: "Sign up free, get 10 credits", hi: "मुफ़्त साइन अप करें, 10 क्रेडिट पाएं" },
  gateSub: {
    en: "Owners call you back within 24 hours.",
    hi: "मालिक 24 घंटे के भीतर आपको कॉल करते हैं।"
  },
  gateButton: { en: "Create free account", hi: "मुफ़्त खाता बनाएं" },
  galleryGateCta: {
    en: "Sign up free to see all photos",
    hi: "सभी फ़ोटो देखने के लिए मुफ़्त साइन अप करें"
  },
  // ── Welcome credits celebration ────────────────────────────────────────────
  welcomeTitle: { en: "Welcome to Cribliv", hi: "Cribliv में आपका स्वागत है" },
  welcomeTenantBody: {
    en: "Your signup reward is ready in your wallet.",
    hi: "आपका साइनअप इनाम आपके वॉलेट में तैयार है।"
  },
  welcomeOwnerBody: {
    en: "Your signup reward is ready in your wallet.",
    hi: "आपका साइनअप इनाम आपके वॉलेट में तैयार है।"
  },
  welcomeCta: { en: "Start finding homes", hi: "घर खोजना शुरू करें" },
  welcomeRewardBadge: {
    en: "Account verified · Reward unlocked",
    hi: "खाता सत्यापित · इनाम अनलॉक हुआ"
  },
  welcomeRewardHeading: {
    en: "Welcome to Cribliv",
    hi: "Cribliv में आपका स्वागत है"
  },
  welcomeRewardSupporting: {
    en: "Your home search starts with a little more freedom.",
    hi: "आपके घर की तलाश अब थोड़ी और आज़ादी के साथ शुरू होती है।"
  },
  welcomeRewardLabel: {
    en: "Free credits added",
    hi: "मुफ़्त क्रेडिट जोड़े गए"
  },
  welcomeRewardCreditsFact: {
    en: "{credits} credits added to your wallet",
    hi: "आपके वॉलेट में {credits} क्रेडिट जोड़े गए"
  },
  welcomeRewardExpiryFact: {
    en: "Use by {date}",
    hi: "{date} तक इस्तेमाल करें"
  },
  welcomeRewardCta: {
    en: "Start finding homes",
    hi: "घर खोजना शुरू करें"
  },
  welcomeRewardFootnote: {
    en: "Promotional credits are used first. Purchased and refunded credits do not expire.",
    hi: "प्रमोशनल क्रेडिट पहले इस्तेमाल होते हैं। खरीदे गए और वापस किए गए क्रेडिट की समय-सीमा समाप्त नहीं होती।"
  },
  welcomeRewardLive: {
    en: "{credits} free credits were added to your wallet. Use by {date}.",
    hi: "आपके वॉलेट में {credits} मुफ़्त क्रेडिट जोड़े गए। {date} तक इस्तेमाल करें।"
  },
  welcomeRewardClose: { en: "Close reward", hi: "इनाम बंद करें" },
  promotionalCreditExpiry: {
    en: "{credits} promotional credits expire {date}",
    hi: "{credits} प्रमोशनल क्रेडिट {date} को समाप्त होंगे"
  },
  // ── Login page benefits ─────────────────────────────────────────────────────
  loginBenefitsTitle: { en: "Why sign up?", hi: "साइन अप क्यों करें?" },
  loginBenefit1: { en: "10 free credits on signup", hi: "साइन अप पर 10 मुफ़्त क्रेडिट" },
  loginBenefit2: {
    en: "Guaranteed callback in 24 hours, or your credit back",
    hi: "24 घंटे में कॉलबैक की गारंटी, वरना क्रेडिट वापस"
  },
  loginBenefit3: { en: "Verified listings, no brokers", hi: "सत्यापित लिस्टिंग, कोई ब्रोकर नहीं" },
  // ── Shared credit purchase dialog (Razorpay + UPI) ─────────────────────────
  cpTitle: { en: "Buy Credits", hi: "क्रेडिट खरीदें" },
  cpWalletBalance: { en: "Wallet balance", hi: "वॉलेट बैलेंस" },
  cpUnitPrice: { en: "₹{price} / credit", hi: "₹{price} / क्रेडिट" },
  cpBestValue: { en: "Best value", hi: "सबसे बेहतर" },
  cpPaySecurely: { en: "Pay securely", hi: "सुरक्षित भुगतान करें" },
  cpPayWithUpi: { en: "Pay with UPI", hi: "UPI से भुगतान करें" },
  cpLoading: { en: "Creating your order…", hi: "आपका ऑर्डर बनाया जा रहा है…" },
  cpCancelled: {
    en: "Payment cancelled — you can try again.",
    hi: "भुगतान रद्द — आप फिर से कोशिश कर सकते हैं।"
  },
  cpPendingWebhook: {
    en: "Payment received — waiting for confirmation…",
    hi: "भुगतान मिल गया — पुष्टि का इंतज़ार है…"
  },
  cpCaptured: {
    en: "Payment successful! Credits added to your wallet.",
    hi: "भुगतान सफल! क्रेडिट आपके वॉलेट में जुड़ गए।"
  },
  cpFailed: {
    en: "Payment failed. Please try again.",
    hi: "भुगतान विफल रहा। कृपया फिर कोशिश करें।"
  },
  cpRetry: { en: "Retry", hi: "फिर कोशिश करें" },
  cpClose: { en: "Close", hi: "बंद करें" },
  cpGatewayUnavailable: {
    en: "Couldn't load the payment gateway. Please use UPI instead.",
    hi: "भुगतान गेटवे लोड नहीं हो सका। कृपया UPI से भुगतान करें।"
  },
  // ── Unavailable listings: notify-when-available waitlist (calm-swap CTA) ───
  availUnavailableBadge: { en: "Unavailable", hi: "अनुपलब्ध" },
  availUnavailableChip: {
    en: "Not available right now",
    hi: "फ़िलहाल उपलब्ध नहीं है"
  },
  availNotifyButton: { en: "Notify when available", hi: "उपलब्ध होने पर सूचित करें" },
  availVerifyButton: {
    en: "Verify & notify me",
    hi: "सत्यापित करें और मुझे सूचित करें"
  },
  availGuestHint: {
    en: "Guest browsing is open. OTP is required only to join the waitlist.",
    hi: "मेहमान के तौर पर ब्राउज़िंग खुली है। प्रतीक्षा सूची में शामिल होने के लिए ही OTP ज़रूरी है।"
  },
  availJoinedSuccess: {
    en: "You're on the list — we'll notify you when it's available",
    hi: "आप सूची में शामिल हो गए हैं — उपलब्ध होने पर हम आपको सूचित करेंगे"
  },
  availAlreadyOnList: {
    en: "You're already on the waitlist",
    hi: "आप पहले से ही प्रतीक्षा सूची में हैं"
  },
  availWaitlistCount: {
    en: "{n} people are already waiting",
    hi: "{n} लोग पहले से प्रतीक्षा कर रहे हैं"
  },
  availWaitlistCountOne: {
    en: "1 person is already waiting",
    hi: "1 व्यक्ति पहले से प्रतीक्षा कर रहा है"
  },
  availTakenTitle: {
    en: "This home is currently taken",
    hi: "यह घर फ़िलहाल किसी और ने ले लिया है"
  },
  availTakenSub: {
    en: "Get notified the moment it opens up",
    hi: "जैसे ही यह उपलब्ध हो, तुरंत सूचना पाएं"
  },
  availNotifyCard: {
    en: "Notify me when it opens up",
    hi: "उपलब्ध होने पर मुझे सूचित करें"
  },
  availReassure: {
    en: "We'll text you the moment it's back. No spam.",
    hi: "जैसे ही यह वापस आएगा, हम आपको सूचित करेंगे। कोई स्पैम नहीं।"
  },
  // ── Task 16: remaining availability copy (owner toggles, cards, search) ───
  availabilityLabel: { en: "Availability", hi: "उपलब्धता" },
  availabilityAvailable: { en: "Available", hi: "उपलब्ध" },
  availabilityNotAvailable: { en: "Not available", hi: "उपलब्ध नहीं" },
  availabilityHelper: {
    en: "Stays listed, sinks in search, collects notify sign-ups.",
    hi: "लिस्टिंग बनी रहती है, खोज में नीचे जाती है, और नोटिफाई साइन-अप जुटाती है।"
  },
  visibilityLabel: { en: "Visibility", hi: "दृश्यता" },
  visibilityLive: { en: "Live", hi: "सक्रिय" },
  visibilityHelper: {
    en: "Paused hides it from search completely",
    hi: "रोकने पर यह खोज से पूरी तरह हट जाती है"
  },
  notifyMe: { en: "Notify me", hi: "मुझे सूचित करें" },
  waitlistPeopleWaiting: {
    en: "{count} people want to be notified when this is available",
    hi: "{count} लोग इसके उपलब्ध होने पर सूचना पाना चाहते हैं"
  },
  currentlyUnavailableDivider: {
    en: "Currently unavailable · get notified when they're back",
    hi: "फ़िलहाल अनुपलब्ध · वापस आने पर सूचना पाएं"
  },
  // Aliases matching the original task-16 brief's literal key names — same
  // copy as availNotifyButton / currentlyUnavailableDivider above, kept as
  // separate entries in case anything references these exact names.
  notifyWhenAvailable: { en: "Notify when available", hi: "उपलब्ध होने पर सूचित करें" },
  currentlyUnavailable: {
    en: "Currently unavailable · get notified when they're back",
    hi: "फ़िलहाल अनुपलब्ध · वापस आने पर सूचना पाएं"
  }
};

export function t(locale: Locale, key: string): string {
  const entry = dictionary[key];
  if (!entry) return key;
  return entry[locale] ?? entry.en;
}
