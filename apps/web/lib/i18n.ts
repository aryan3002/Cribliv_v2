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
  menuOpen: { en: "Open menu", hi: "मेनू खोलें" },
  menuAccountSettings: { en: "Account settings", hi: "अकाउंट सेटिंग्स" },
  menuMySaved: { en: "My saved", hi: "मेरे सेव किए" },
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
  welcomeTitle: { en: "Welcome to Cribliv! 🎉", hi: "Cribliv में आपका स्वागत है! 🎉" },
  welcomeTenantBody: {
    en: "You've got 10 free credits. Request callbacks and get a call within 24 hours.",
    hi: "आपको 10 मुफ़्त क्रेडिट मिले हैं। कॉलबैक मांगें और 24 घंटे के भीतर कॉल पाएं।"
  },
  welcomeOwnerBody: {
    en: "Welcome! Your first 2 tenant leads are free.",
    hi: "स्वागत है! आपकी पहली 2 किरायेदार लीड मुफ़्त हैं।"
  },
  welcomeCta: { en: "Start exploring", hi: "खोजना शुरू करें" },
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
  }
};

export function t(locale: Locale, key: string): string {
  const entry = dictionary[key];
  if (!entry) return key;
  return entry[locale] ?? entry.en;
}
