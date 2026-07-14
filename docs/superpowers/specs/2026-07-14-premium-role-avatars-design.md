# Premium Role Avatars Design

## Goal

Replace the phone-number digit currently shown as the authenticated header avatar with a premium illustrated portrait that clearly represents the user's role.

The avatar must work in:

- the 30px header profile pill;
- the larger account header inside the opened menu;
- both English and Hindi routes;
- all authenticated roles: tenant, owner, PG operator, and admin.

## Approved Visual Direction

Use one consistent illustrated portrait system with meaningful role differences:

| Role        | Portrait cue                      | Role seal       | Color family |
| ----------- | --------------------------------- | --------------- | ------------ |
| Tenant      | Casual blue clothing              | Key             | Blue         |
| Owner       | Structured plum blazer            | House           | Plum         |
| PG operator | Teal service clothing and headset | Building        | Teal         |
| Admin       | Charcoal formal clothing and tie  | Verified shield | Charcoal     |

The portraits use bold shapes and a single clear seal so they remain readable at 30px. Role identity must not depend on color alone.

## Architecture

Add a focused `RoleAvatar` React component under `apps/web/components/`. It accepts:

- the authenticated `UserRole`;
- a compact or menu size;
- an optional class name when needed by the existing header styles.

The component owns the role-to-portrait mapping and renders deterministic inline SVG. Inline SVG keeps the assets crisp at both sizes, avoids network requests, and allows the portraits to inherit established dimensions and states from the header.

`HeaderMenu` will render `RoleAvatar` in both authenticated avatar locations. The existing logged-out user icon and loading pulse remain unchanged.

## Behavior

- Authenticated users always see the portrait for their current session role.
- No digit is derived from the phone number.
- No generated face is presented as the user's real identity.
- The displayed phone number and role label in the expanded menu remain unchanged.
- Unknown or temporarily missing roles fall back to the generic user icon rather than selecting an incorrect portrait.
- Opening, closing, portaling, keyboard handling, and menu navigation behavior remain unchanged.

## Styling

The portrait component supplies its own role-specific visual variables and SVG artwork. Existing `.profile-pill__avatar` and `.menu-header__avatar` containers retain their stable dimensions, but authenticated variants remove the current text and gradient assumptions.

The compact portrait remains circular with a subtle white inset edge and role-colored outer ring. The menu portrait uses the same artwork at a larger size. The role seal overlaps the lower-right edge without changing layout dimensions.

## Accessibility

The avatar is decorative because the profile trigger already has an accessible menu label and the expanded menu includes account text. SVG details are hidden from assistive technology. The component must not introduce duplicate spoken role labels.

## Testing

Add focused component tests that verify:

- each authenticated role renders its matching avatar identifier;
- compact and menu avatars use the same role identity;
- authenticated rendering no longer exposes a phone-derived digit;
- unauthenticated users still receive the generic user icon;
- existing role-aware menu links continue to pass.

Run the focused header tests, web typecheck, and lint for the touched files or app.

## Scope

This change does not add profile-photo uploads, alter session contracts, modify authentication, or change role permissions. A future personal photo can override this default through the same component without changing the header API.
