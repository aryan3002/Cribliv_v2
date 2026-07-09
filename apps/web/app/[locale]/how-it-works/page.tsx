import type { Metadata, Route } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileCheck2,
  Home,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck
} from "lucide-react";
import styles from "./how-it-works.module.css";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

type LocaleKey = "en" | "hi";
type LocalizedText = Record<LocaleKey, string>;
type Tone = "brand" | "trust" | "accent" | "amber";

type ProcessStep = {
  icon: LucideIcon;
  tone: Tone;
  title: LocalizedText;
  desc: LocalizedText;
  features: Record<LocaleKey, string[]>;
};

type TrustItem = {
  icon: LucideIcon;
  tone: Tone;
  title: LocalizedText;
  desc: LocalizedText;
};

type PathItem = {
  icon: LucideIcon;
  tone: Tone;
  label: LocalizedText;
  title: LocalizedText;
  desc: LocalizedText;
  cta: LocalizedText;
  href: (locale: LocaleKey) => string;
};

const HERO = {
  breadcrumbHome: { en: "Home", hi: "होम" },
  breadcrumbCurrent: { en: "How it works", hi: "यह कैसे काम करता है" },
  title: {
    en: "Find a verified rental without the broker runaround",
    hi: "ब्रोकर की भागदौड़ के बिना सत्यापित किराया खोजें"
  },
  lede: {
    en: "Cribliv connects natural-language search, owner verification, and protected contact unlocks into one clear path from shortlist to phone call.",
    hi: "Cribliv प्राकृतिक भाषा खोज, मालिक सत्यापन और सुरक्षित संपर्क अनलॉक को शॉर्टलिस्ट से फोन कॉल तक एक साफ रास्ते में जोड़ता है।"
  },
  primaryCta: { en: "Find verified rentals", hi: "खोज शुरू करें" },
  secondaryCta: { en: "List your property", hi: "प्रॉपर्टी लिस्ट करें" },
  proof: [
    { en: "No broker spam", hi: "ब्रोकर स्पैम नहीं" },
    { en: "Verified owners", hi: "सत्यापित मालिक" },
    { en: "12-hour protection", hi: "12-घंटे सुरक्षा" }
  ],
  previewLabel: { en: "Example search", hi: "उदाहरण खोज" },
  previewQuery: { en: "2BHK near metro under ₹15k", hi: "मेट्रो के पास 2BHK ₹15k के अंदर" },
  previewRows: [
    {
      icon: Search,
      title: { en: "AI reads the full request", hi: "AI पूरी जरूरत समझता है" },
      meta: { en: "Budget, city, locality and type", hi: "बजट, शहर, इलाका और प्रकार" }
    },
    {
      icon: BadgeCheck,
      title: { en: "Verified listings move up", hi: "सत्यापित लिस्टिंग ऊपर आती हैं" },
      meta: { en: "Owner and property signals checked", hi: "मालिक और प्रॉपर्टी संकेत जांचे गए" }
    },
    {
      icon: MessageCircle,
      title: { en: "Unlock direct owner contact", hi: "सीधा मालिक संपर्क अनलॉक करें" },
      meta: { en: "Protected by the response guarantee", hi: "प्रतिक्रिया गारंटी से सुरक्षित" }
    }
  ]
} as const;

const PROCESS_STEPS: ProcessStep[] = [
  {
    icon: Search,
    tone: "brand",
    title: { en: "Search in your own words", hi: "अपनी भाषा में खोजें" },
    desc: {
      en: "Type or speak what you need. Cribliv turns real requests into useful filters for city, budget, home type, locality, and move-in needs.",
      hi: "जो चाहिए उसे टाइप या बोलें। Cribliv शहर, बजट, घर के प्रकार, इलाके और मूव-इन जरूरतों को उपयोगी फिल्टर में बदल देता है।"
    },
    features: {
      en: ["Voice and text search", "Budget and locality filters", "Hindi and English support"],
      hi: ["वॉइस और टेक्स्ट खोज", "बजट और इलाके के फिल्टर", "हिंदी और अंग्रेजी सपोर्ट"]
    }
  },
  {
    icon: ShieldCheck,
    tone: "trust",
    title: { en: "Trust the listing before you visit", hi: "विजिट से पहले लिस्टिंग पर भरोसा करें" },
    desc: {
      en: "Owner identity, property details, photos, and quality signals are checked before a listing earns Cribliv's verified treatment.",
      hi: "लिस्टिंग को Cribliv का सत्यापित संकेत मिलने से पहले मालिक की पहचान, प्रॉपर्टी विवरण, फोटो और गुणवत्ता संकेत जांचे जाते हैं।"
    },
    features: {
      en: ["Aadhaar OTP checks", "Property document review", "Quality scoring before listing"],
      hi: ["Aadhaar OTP जांच", "प्रॉपर्टी दस्तावेज समीक्षा", "लिस्टिंग से पहले गुणवत्ता स्कोर"]
    }
  },
  {
    icon: MessageCircle,
    tone: "accent",
    title: { en: "Contact the owner directly", hi: "मालिक से सीधे जुड़ें" },
    desc: {
      en: "Unlock the owner's contact after you find a match. If the owner does not respond within 12 hours, the unlock is protected.",
      hi: "मैच मिलने के बाद मालिक का संपर्क अनलॉक करें। अगर मालिक 12 घंटे में जवाब नहीं देता, तो आपका अनलॉक सुरक्षित रहता है।"
    },
    features: {
      en: ["Zero brokerage contact", "Secure UPI/card payment", "12-hour no-response refund"],
      hi: ["शून्य ब्रोकरेज संपर्क", "सुरक्षित UPI/कार्ड भुगतान", "12-घंटे नो-रिस्पॉन्स रिफंड"]
    }
  }
];

const TRUST_ITEMS: TrustItem[] = [
  {
    icon: UserCheck,
    tone: "trust",
    title: { en: "Aadhaar-verified owners", hi: "Aadhaar-सत्यापित मालिक" },
    desc: {
      en: "Owners complete identity verification before tenant contact unlocks are trusted.",
      hi: "किरायेदार संपर्क अनलॉक भरोसेमंद होने से पहले मालिक पहचान सत्यापन पूरा करते हैं।"
    }
  },
  {
    icon: FileCheck2,
    tone: "brand",
    title: { en: "Property document signals", hi: "प्रॉपर्टी दस्तावेज संकेत" },
    desc: {
      en: "Listing details are checked against documents and review signals before they are promoted.",
      hi: "प्रमोट होने से पहले लिस्टिंग विवरण दस्तावेजों और समीक्षा संकेतों से मिलाए जाते हैं।"
    }
  },
  {
    icon: Home,
    tone: "accent",
    title: { en: "Direct owner contact", hi: "सीधा मालिक संपर्क" },
    desc: {
      en: "You pay for the owner's contact, not a broker queue or hidden handoff.",
      hi: "आप मालिक के संपर्क के लिए भुगतान करते हैं, ब्रोकर कतार या छिपे हुए हैंडऑफ के लिए नहीं।"
    }
  },
  {
    icon: Clock3,
    tone: "amber",
    title: { en: "12-hour response protection", hi: "12-घंटे प्रतिक्रिया सुरक्षा" },
    desc: {
      en: "If an unlocked owner does not respond in time, the refund flow is built in.",
      hi: "अगर अनलॉक किया गया मालिक समय पर जवाब नहीं देता, तो रिफंड फ्लो पहले से बना है।"
    }
  }
];

const PATHS: PathItem[] = [
  {
    icon: Search,
    tone: "brand",
    label: { en: "For tenants", hi: "किरायेदारों के लिए" },
    title: { en: "Start with a real search", hi: "एक असली खोज से शुरू करें" },
    desc: {
      en: "Describe the home you want, compare verified options, and unlock only when a listing is worth a call.",
      hi: "अपना घर बताएं, सत्यापित विकल्पों की तुलना करें, और केवल सही लिस्टिंग पर संपर्क अनलॉक करें।"
    },
    cta: { en: "Start your search", hi: "सत्यापित किराये खोजें" },
    href: (locale) => `/${locale}/search`
  },
  {
    icon: Home,
    tone: "trust",
    label: { en: "For owners", hi: "मालिकों के लिए" },
    title: { en: "Publish a verified listing", hi: "सत्यापित लिस्टिंग प्रकाशित करें" },
    desc: {
      en: "Complete quick verification, keep control of your listing, and connect with tenants who know what they want.",
      hi: "त्वरित सत्यापन पूरा करें, अपनी लिस्टिंग पर नियंत्रण रखें, और स्पष्ट जरूरत वाले किरायेदारों से जुड़ें।"
    },
    cta: { en: "List your property", hi: "प्रॉपर्टी लिस्ट करें" },
    href: (locale) => `/${locale}/become-owner`
  }
];

const SECTION_COPY = {
  processTitle: {
    en: "From vague search to verified owner call",
    hi: "आम खोज से सत्यापित मालिक कॉल तक"
  },
  processLede: {
    en: "The page is simple because the hard work happens behind the scenes: request understanding, trust checks, and protected contact.",
    hi: "रास्ता सरल है क्योंकि कठिन काम पीछे होता है: जरूरत समझना, भरोसे की जांच, और सुरक्षित संपर्क।"
  },
  trustTitle: { en: "What Cribliv checks for you", hi: "Cribliv आपके लिए क्या जांचता है" },
  trustLede: {
    en: "Verification is built into the journey instead of being a badge you have to interpret on your own.",
    hi: "सत्यापन यात्रा का हिस्सा है, सिर्फ ऐसा बैज नहीं जिसे आपको खुद समझना पड़े।"
  },
  pathsTitle: { en: "One page, two clear paths", hi: "एक पेज, दो साफ रास्ते" },
  pathsLede: {
    en: "Most visitors are here to search, but owners get a direct route without interrupting the tenant journey.",
    hi: "ज्यादातर लोग खोजने आते हैं, लेकिन मालिकों के लिए भी किरायेदार यात्रा को रोके बिना सीधा रास्ता है।"
  },
  finalTitle: {
    en: "Ready to search with fewer surprises?",
    hi: "कम सरप्राइज़ के साथ किराया खोजने के लिए तैयार?"
  },
  finalDesc: {
    en: "Browse verified rentals first. Unlock contact only when the listing, owner, and location make sense.",
    hi: "पहले सत्यापित किराये देखें। संपर्क तभी अनलॉक करें जब लिस्टिंग, मालिक और लोकेशन सही लगे।"
  },
  finalCta: { en: "Open search", hi: "अब खोजें" },
  finalOwner: { en: "Owners can list a property instead", hi: "मालिक अपनी प्रॉपर्टी लिस्ट कर सकते हैं" }
} as const;

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = normalizeLocale(params.locale);
  const title = locale === "hi" ? "यह कैसे काम करता है" : "How It Works";
  const description =
    locale === "hi"
      ? "Cribliv पर सत्यापित किराये खोजें: प्राकृतिक खोज, मालिक सत्यापन, सीधा संपर्क और 12-घंटे प्रतिक्रिया सुरक्षा।"
      : "Find a verified rental on Cribliv with natural search, owner verification, direct contact unlocks, and 12-hour response protection.";

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/how-it-works`,
      languages: {
        en: `${BASE_URL}/en/how-it-works`,
        hi: `${BASE_URL}/hi/how-it-works`
      }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${locale}/how-it-works`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

export default function HowItWorksPage({ params }: { params: { locale: string } }) {
  const locale = normalizeLocale(params.locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name:
      locale === "hi"
        ? "Cribliv पर सत्यापित किराये का घर कैसे खोजें"
        : "How to find a verified rental on Cribliv",
    description:
      locale === "hi"
        ? "Cribliv पर खोज, सत्यापन और मालिक संपर्क की प्रक्रिया।"
        : "The Cribliv process for search, verification, and direct owner contact.",
    step: PROCESS_STEPS.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title[locale],
      text: step.desc[locale]
    }))
  };

  return (
    <div className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className={styles.hero} data-testid="how-hero">
        <div className={`container ${styles.heroInner}`}>
          <div className={styles.heroCopy}>
            <nav className={styles.breadcrumb} aria-label={HERO.breadcrumbCurrent[locale]}>
              <Link href={`/${locale}`}>{HERO.breadcrumbHome[locale]}</Link>
              <span aria-hidden="true">/</span>
              <span>{HERO.breadcrumbCurrent[locale]}</span>
            </nav>

            <h1>{HERO.title[locale]}</h1>
            <p className={styles.heroLede}>{HERO.lede[locale]}</p>

            <div className={styles.heroActions}>
              <Link href={`/${locale}/search`} className={`btn btn--primary ${styles.action}`}>
                {HERO.primaryCta[locale]} <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link href={`/${locale}/become-owner`} className={`btn btn--secondary ${styles.action}`}>
                {HERO.secondaryCta[locale]}
              </Link>
            </div>

            <ul className={styles.proofList} aria-label="Cribliv assurances">
              {HERO.proof.map((item) => (
                <li key={item.en}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {item[locale]}
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.previewCard} aria-label={HERO.previewLabel[locale]}>
            <div className={styles.previewHeader}>
              <span>{HERO.previewLabel[locale]}</span>
              <Sparkles size={18} aria-hidden="true" />
            </div>
            <div className={styles.searchMock}>
              <Search size={18} aria-hidden="true" />
              <span>{HERO.previewQuery[locale]}</span>
            </div>
            <div className={styles.previewRows}>
              {HERO.previewRows.map((row) => {
                const Icon = row.icon;
                return (
                  <div key={row.title.en} className={styles.previewRow}>
                    <span className={styles.previewIcon} aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span>
                      <strong>{row.title[locale]}</strong>
                      <small>{row.meta[locale]}</small>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className={styles.previewFooter}>
              <span>
                <CreditCard size={15} aria-hidden="true" />
                {locale === "hi" ? "सुरक्षित अनलॉक" : "Protected unlock"}
              </span>
              <span>{locale === "hi" ? "12 घंटे" : "12 hours"}</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} data-testid="how-process">
        <div className="container">
          <div className={styles.sectionHead}>
            <h2>{SECTION_COPY.processTitle[locale]}</h2>
            <p>{SECTION_COPY.processLede[locale]}</p>
          </div>

          <div className={styles.processGrid}>
            {PROCESS_STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <article
                  key={step.title.en}
                  className={`${styles.processStep} ${styles[step.tone]}`}
                  data-testid="how-process-step"
                >
                  <div className={styles.stepTop}>
                    <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.stepIcon} aria-hidden="true">
                      <Icon size={22} />
                    </span>
                  </div>
                  <h3>{step.title[locale]}</h3>
                  <p>{step.desc[locale]}</p>
                  <ul>
                    {step.features[locale].map((feature) => (
                      <li key={feature}>
                        <CheckCircle2 size={15} aria-hidden="true" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.trustSection}`} data-testid="how-trust">
        <div className="container">
          <div className={styles.trustLayout}>
            <div className={styles.sectionHead}>
              <h2>{SECTION_COPY.trustTitle[locale]}</h2>
              <p>{SECTION_COPY.trustLede[locale]}</p>
            </div>
            <div className={styles.trustGrid}>
              {TRUST_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title.en} className={`${styles.trustItem} ${styles[item.tone]}`}>
                    <span className={styles.trustIcon} aria-hidden="true">
                      <Icon size={21} />
                    </span>
                    <div>
                      <h3>{item.title[locale]}</h3>
                      <p>{item.desc[locale]}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} data-testid="how-audience-paths">
        <div className="container">
          <div className={styles.sectionHead}>
            <h2>{SECTION_COPY.pathsTitle[locale]}</h2>
            <p>{SECTION_COPY.pathsLede[locale]}</p>
          </div>

          <div className={styles.pathGrid}>
            {PATHS.map((path) => {
              const Icon = path.icon;
              return (
                <article key={path.title.en} className={`${styles.pathCard} ${styles[path.tone]}`}>
                  <div className={styles.pathHeader}>
                    <span className={styles.pathIcon} aria-hidden="true">
                      <Icon size={21} />
                    </span>
                    <span className={styles.pathLabel}>{path.label[locale]}</span>
                  </div>
                  <h3>{path.title[locale]}</h3>
                  <p>{path.desc[locale]}</p>
                  <Link href={path.href(locale) as Route} className={styles.pathLink}>
                    {path.cta[locale]} <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.finalCta} data-testid="how-final-cta">
        <div className={`container ${styles.finalInner}`}>
          <div>
            <h2>{SECTION_COPY.finalTitle[locale]}</h2>
            <p>{SECTION_COPY.finalDesc[locale]}</p>
          </div>
          <div className={styles.finalActions}>
            <Link href={`/${locale}/search`} className={`btn ${styles.finalButton}`}>
              {SECTION_COPY.finalCta[locale]} <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link href={`/${locale}/become-owner`} className={styles.finalOwnerLink}>
              {SECTION_COPY.finalOwner[locale]}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function normalizeLocale(locale: string): LocaleKey {
  return locale === "hi" ? "hi" : "en";
}
