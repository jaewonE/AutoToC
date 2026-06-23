# Changelog

All notable changes to AutoToC will be documented in this file.

## [1.0.2] - 2026-06-24

- Add 16, 32, 48, and 128 pixel extension icons generated from the supplied source image.
- Configure the Chrome extension manifest to use the new icon set.

## [1.0.1] - 2026-06-24

- Remove non-error console diagnostics, debug state, and the local storage debug toggle.
- Keep cleanup failures visible as errors.
- Add a demo image, GPL-3.0 license, and concise English and Korean project documentation for the public repository.

## [1.0.0] - 2026-06-23

- Promote AutoToC to its first stable release.
- Add English and Korean README documentation for installation, usage, behavior, troubleshooting, and privacy.
- Document the collapsed heading summary policy: the active answer ToC is summarized when the estimated collapsed list would exceed 80% of the viewport or when adjacent heading scroll positions are closer than 48px.

## [0.1.13] - 2026-06-23

- Restore collapsed question dot markers for every cached question while keeping the active answer ToC rendering unchanged.
- Suppress ChatGPT/native right-rail minimap bar groups outside AutoToC when they overlap the collapsed icon area.

## [0.1.12] - 2026-06-23

- Superseded by 0.1.13. The collapsed question dot markers are part of the intended UI and should remain visible.

## [0.1.11] - 2026-06-23

- Enforce a single AutoToC content-script instance by exposing and invoking a runtime cleanup hook.
- Remove stale AutoToC roots left by earlier extension reloads so old question-level collapsed indicators cannot overlap the current UI.
- Hide legacy AutoToC roots that do not carry a current instance marker.
- Clear the navigation polling interval during cleanup.

## [0.1.10] - 2026-06-23

- Increase the Q&A top activation margin so question jumps keep the clicked question active and avoid clipping its first line.
- Treat the scroll area above the first question as the first question so the first ToC remains visible at the top of the conversation.
- Replace omitted collapsed heading bars with a compact three-bar ToC summary icon when the detailed bars would be too tall or too tightly spaced.

## [0.1.9] - 2026-06-23

- Apply a small top-anchor offset only to Q&A activation so question clicks do not keep the previous question's ToC open.
- Keep heading activation on the real viewport top to avoid over-selecting nearby headings.
- Suppress collapsed mini heading bars when headings are too tightly spaced, while preserving the expanded ToC.

## [0.1.8] - 2026-06-23

- Cache previously observed Q&A blocks so ChatGPT DOM virtualization does not shrink AutoToC to only nearby messages.
- Keep cached heading labels and scroll positions available when their source DOM nodes are temporarily unmounted.

## [0.1.7] - 2026-06-23

- Fixed missed ToC updates after sending or editing messages by observing the stable ChatGPT conversation root.
- Mark the Q&A block that actually owns the streaming answer instead of always marking the last question.
- Keep the expanded panel viewport-fixed and independently scrollable to avoid clipped question entries.
- Show the streaming spinner in both the collapsed icon column and expanded panel.
- Match active Q&A and heading detection to the viewport top so clicked headings stay selected after scrolling.

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
