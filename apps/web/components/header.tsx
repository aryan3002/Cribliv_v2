/**
 * The header moved into components/header/ when it grew a mega-menu (see
 * components/header/header.tsx). This re-export keeps `components/header` a
 * valid import path so every existing importer — and the regression suites
 * that render `<Header locale="en" />` — keep working untouched.
 */
export { Header } from "./header/header";
