import Link from "next/link";
import styles from "../cribliv-times.module.css";
import { BLOG_DESKS } from "../../../../lib/blog-desks";

// The four seeded blog_categories become CRIBLIV TIMES "desks".
export const DESKS: Array<{ slug: string | null; en: string; hi: string }> = [
  { slug: null, en: "Front Page", hi: "मुख पृष्ठ" },
  ...BLOG_DESKS
];

export function Masthead({
  locale,
  activeCategory = null,
  dateLabel
}: {
  locale: string;
  activeCategory?: string | null;
  dateLabel: string;
}) {
  const hi = locale === "hi";
  return (
    <>
      <div className={styles.plateRule} />
      <header className={styles.plate}>
        <div className={styles.ears}>
          <span>Vol. I &nbsp;·&nbsp; No. 1</span>
          <span>{hi ? "हिन्दी संस्करण" : "City Edition"}</span>
        </div>
        <Link href={`/${locale}/blog`} className={styles.nameplate}>
          Cribliv&nbsp;Times
        </Link>
        <div className={styles.tagline}>
          {hi ? "शहरी भारत के लिए किराया इंटेलिजेंस" : "Rental Intelligence for Urban India"}
        </div>
      </header>
      <div className={styles.folio}>
        <span>
          <b>{dateLabel}</b>
        </span>
        <span>New Delhi &nbsp;·&nbsp; Noida &nbsp;·&nbsp; Lucknow</span>
        <span>cribliv.com</span>
        <span>
          <b>{hi ? "निःशुल्क" : "Free"}</b>
        </span>
      </div>
      <nav className={styles.sections} aria-label="Sections">
        {DESKS.map((desk) => {
          const active = (desk.slug ?? null) === (activeCategory ?? null);
          return (
            <Link
              key={desk.en}
              href={desk.slug ? `/${locale}/blog/category/${desk.slug}` : `/${locale}/blog`}
              className={active ? styles.sectionCurrent : undefined}
              aria-current={active ? "page" : undefined}
            >
              {hi ? desk.hi : desk.en}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
