---
paths:
  - "app/**/*.tsx"
  - "src/components/**/*.tsx"
---

# Mobile UI

- Follow Expo Router's file-based routes and existing `router.push`, `replace`, and `back` patterns. Keep navigation decisions near screens, not in low-level visual primitives.
- Reuse existing components and nearby visual conventions before introducing another pattern. If a design value repeats broadly, centralize it instead of multiplying literals.
- Keep common actions to few screens and taps. Reduce decorative empty space while preserving readable grouping, safe areas, keyboard behavior, and at least practical platform touch targets.
- Give loading, disabled, approval-pending, denied, offline, timeout, unsupported, success, and error states distinct, readable treatment. Do not show success before the underlying service confirms it.
- Keep visual behavior coherent across iOS and Android; guard intentional platform differences explicitly.
- Put companion networking, persistence, and business rules in established services, utilities, or context rather than directly in presentation components.
- Check dynamic text, long device names, small screens, and screen-reader labels for icon-only controls.
