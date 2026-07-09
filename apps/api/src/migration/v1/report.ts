export interface Report {
  migrated: number;
  skipped: number;
  photosOk: number;
  photosFail: number;
  ownerSource: Record<string, number>;
  dupes: string[];
  warnings: string[];
  add(kind: "warn" | "dupe", msg: string): void;
  print(label: string): void;
}
export function newReport(): Report {
  return {
    migrated: 0,
    skipped: 0,
    photosOk: 0,
    photosFail: 0,
    ownerSource: { mongo: 0, excel: 0, import_fallback: 0 },
    dupes: [],
    warnings: [],
    add(kind, msg) {
      (kind === "dupe" ? this.dupes : this.warnings).push(msg);
    },
    print(label) {
      console.log(`\n──── ${label} ────`);
      console.log(`migrated:      ${this.migrated}`);
      console.log(`skipped:       ${this.skipped}`);
      console.log(`photos ok/fail:${this.photosOk}/${this.photosFail}`);
      console.log(`owner source:  ${JSON.stringify(this.ownerSource)}`);
      if (this.dupes.length) {
        console.log(`\npossible duplicates (review):`);
        this.dupes.forEach((d) => console.log("  " + d));
      }
      if (this.warnings.length) {
        console.log(`\nwarnings:`);
        this.warnings.slice(0, 100).forEach((w) => console.log("  " + w));
      }
    }
  };
}
