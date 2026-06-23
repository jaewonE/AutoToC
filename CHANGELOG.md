# Changelog

All notable changes to AutoToC will be documented in this file.

## [0.1.6] - 2026-06-23

- Lowered collapsed icon overflow threshold from 90% to 80% of the viewport height.
- Lowered expanded panel maximum height from 90vh to 80vh.

## [0.1.5] - 2026-06-23

- Hide collapsed heading bars when the collapsed icon list would exceed 90% of the viewport height.
- Keep collapsed question dots visible when collapsed heading bars are hidden.
- Set the expanded panel maximum height to 90% of the viewport and keep overflow scrolling on the panel only.

## [0.1.4] - 2026-06-23

- Refined collapsed icon alignment with right-side spacing.
- Adjusted collapsed heading bar lengths to improve visual distinction by heading level.
- Fixed question labels so two-line clamping does not expose a partial third line.

## [0.1.3] - 2026-06-23

- Kept the collapsed icon column and expanded panel centered on the right edge of the viewport.
- Recomputed the viewport center after rebuilds and window resizes to prevent the expanded panel from being clipped.

## [0.1.2] - 2026-06-23

- Removed collapsed icon/text position synchronization by rendering the collapsed icon column separately from the expanded text panel.
- Kept collapsed icon order aligned with question and heading order while allowing compact independent icon spacing.

## [0.1.1] - 2026-06-23

- Simplified heading display policy.
- Hide the ToC heading area when no headings are available.
- Show all headings when a Q&A response has 10 or fewer headings.
- Show only H1 through H4 headings when a Q&A response has more than 10 headings.

## [0.1.0] - 2026-06-23

- Initial backup baseline for the AutoToC Chrome extension.
- Added a Manifest V3 content-script extension for ChatGPT conversations.
- Added a hoverable right-side Table of Contents panel with Q&A and heading navigation.
- Added SPA navigation rebuild handling for ChatGPT session changes.
