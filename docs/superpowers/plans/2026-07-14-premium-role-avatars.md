# Premium Role Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace authenticated phone-number digits in the header with the approved tenant, owner, PG operator, and admin illustrated role portraits.

**Architecture:** Add one reusable `RoleAvatar` component that owns the role-to-SVG mapping and decorative accessibility behavior. Integrate it into the compact profile pill and expanded menu header while preserving the existing loading, logged-out, menu, and auth behavior.

**Tech Stack:** Next.js 14, React 18, TypeScript, inline SVG, CSS, Vitest, Testing Library.

## Global Constraints

- Render distinct illustrated portraits for `tenant`, `owner`, `pg_operator`, and `admin`.
- Use clothing/role cues plus key, house, building, and shield seals; role identity must not depend on color alone.
- Keep compact and menu dimensions stable.
- Do not derive avatar content from the phone number.
- Keep loading and logged-out states unchanged.
- Do not alter authentication, session contracts, database state, permissions, or menu navigation.
- Treat avatar artwork as decorative and avoid duplicate accessible labels.
- Use TDD and verify each new behavior fails before adding production code.
- Do not add generated brainstorming images under `output/` to git.

---

### Task 1: Reusable Role Avatar

**Files:**

- Create: `apps/web/components/role-avatar.tsx`
- Create: `apps/web/components/__tests__/role-avatar.test.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Produces:

```ts
export type RoleAvatarRole = "tenant" | "owner" | "pg_operator" | "admin";

export interface RoleAvatarProps {
  role?: RoleAvatarRole;
  size: "compact" | "menu";
  className?: string;
}

export function RoleAvatar(props: RoleAvatarProps): JSX.Element;
```

- Each supported role exposes `data-role-avatar="<role>"`.
- Missing roles expose `data-role-avatar="fallback"` and render the generic `User` icon.

- [ ] **Step 1: Write the failing component tests**

Create parameterized tests:

```tsx
it.each(["tenant", "owner", "pg_operator", "admin"] as const)(
  "renders the %s portrait in compact and menu sizes",
  (role) => {
    const { rerender } = render(<RoleAvatar role={role} size="compact" />);
    expect(screen.getByTestId("role-avatar")).toHaveAttribute("data-role-avatar", role);
    expect(screen.getByTestId("role-avatar")).toHaveClass("role-avatar--compact");

    rerender(<RoleAvatar role={role} size="menu" />);
    expect(screen.getByTestId("role-avatar")).toHaveClass("role-avatar--menu");
  }
);

it("renders a generic fallback when the role is missing", () => {
  render(<RoleAvatar size="compact" />);
  expect(screen.getByTestId("role-avatar")).toHaveAttribute("data-role-avatar", "fallback");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @cribliv/web exec vitest run components/__tests__/role-avatar.test.tsx
```

Expected: FAIL because `../role-avatar` does not exist.

- [ ] **Step 3: Implement the component**

Create a single component with four private portrait SVG functions. The root element:

```tsx
const avatarRole = role && role in PORTRAITS ? role : "fallback";

return (
  <span
    className={clsx("role-avatar", `role-avatar--${size}`, className)}
    data-role-avatar={avatarRole}
    data-testid="role-avatar"
    aria-hidden="true"
  >
    {avatarRole === "fallback" ? <User /> : PORTRAITS[avatarRole]}
  </span>
);
```

Each SVG uses the approved role-specific clothing silhouette and renders one lower-right seal:

- tenant: casual blue top and key seal;
- owner: plum blazer and house seal;
- PG operator: teal service top, headset, and building seal;
- admin: charcoal formal top, tie, and verified shield seal.

- [ ] **Step 4: Add stable component styling**

Add `.role-avatar`, `.role-avatar--compact`, `.role-avatar--menu`, `.role-avatar__portrait`, and `.role-avatar__seal` rules. Compact is `30px`; menu is `42px`. Use a white inset edge, role-colored outer ring, and an absolutely positioned seal that does not affect layout.

- [ ] **Step 5: Run the tests and verify GREEN**

Run:

```bash
pnpm --filter @cribliv/web exec vitest run components/__tests__/role-avatar.test.tsx
```

Expected: 5 tests pass.

---

### Task 2: Header Integration and Regression Coverage

**Files:**

- Modify: `apps/web/components/header-menu.tsx`
- Modify: `apps/web/components/__tests__/header-menu.pg-split.test.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Consumes: `RoleAvatar({ role, size, className })`.
- Removes the `initial` phone/name derivation from `HeaderMenu`.
- Preserves existing `.profile-pill__avatar` and `.menu-header__avatar` layout hooks through component class names.

- [ ] **Step 1: Write failing header integration tests**

Extend the role split suite:

```tsx
it.each(["tenant", "owner", "pg_operator", "admin"] as const)(
  "uses the %s avatar in the trigger and menu header",
  (role) => {
    setSession(role);
    render(<HeaderMenu locale="en" />);

    expect(document.querySelectorAll(`[data-role-avatar="${role}"]`)).toHaveLength(1);
    openMenu();
    expect(document.querySelectorAll(`[data-role-avatar="${role}"]`)).toHaveLength(2);
    expect(screen.queryByText("8")).not.toBeInTheDocument();
  }
);

it("keeps the generic icon for logged-out users", () => {
  setSession(null);
  render(<HeaderMenu locale="en" />);
  expect(document.querySelector('[data-role-avatar="fallback"]')).toBeNull();
});
```

- [ ] **Step 2: Run the focused header test and verify RED**

Run:

```bash
pnpm --filter @cribliv/web exec vitest run components/__tests__/header-menu.pg-split.test.tsx
```

Expected: FAIL because `HeaderMenu` still renders a phone-derived digit and no role-avatar markers.

- [ ] **Step 3: Integrate `RoleAvatar`**

Import `RoleAvatar`, remove `initial`, and render:

```tsx
<RoleAvatar role={role} size="menu" className="menu-header__avatar" />
```

inside the authenticated menu header. In the trigger, keep the existing loading and logged-out branches, and render:

```tsx
<RoleAvatar role={role} size="compact" className="profile-pill__avatar" />
```

for authenticated sessions.

- [ ] **Step 4: Remove obsolete authenticated avatar styling**

Keep the container dimensions and loading pulse, but remove the old gradient/text rules from `.profile-pill__avatar` and `.menu-header__avatar` that conflict with `RoleAvatar`. Logged-out icon centering remains intact.

- [ ] **Step 5: Verify focused tests**

Run:

```bash
pnpm --filter @cribliv/web exec vitest run \
  components/__tests__/role-avatar.test.tsx \
  components/__tests__/header-menu.pg-split.test.tsx
```

Expected: all role-avatar and existing role-menu tests pass.

- [ ] **Step 6: Verify the web app**

Run:

```bash
pnpm --filter @cribliv/web typecheck
pnpm --filter @cribliv/web lint
```

Expected: both commands exit 0.

- [ ] **Step 7: Inspect the production UI**

Start the web app on an available port, inject each test role session, and capture desktop plus mobile screenshots. Verify:

- portraits are nonblank and correctly clipped;
- all four roles remain visibly different at 30px;
- the seal does not overlap the pill or menu text;
- the pill dimensions do not shift;
- the menu still opens, closes, and portals correctly.

- [ ] **Step 8: Commit the implementation**

```bash
git add \
  apps/web/components/role-avatar.tsx \
  apps/web/components/header-menu.tsx \
  apps/web/components/__tests__/role-avatar.test.tsx \
  apps/web/components/__tests__/header-menu.pg-split.test.tsx \
  apps/web/app/globals.css \
  docs/superpowers/plans/2026-07-14-premium-role-avatars.md
git commit -m "feat(web): add premium role avatars"
```
