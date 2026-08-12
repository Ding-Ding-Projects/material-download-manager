# App-logo customization

## Behavior

The landing and documentation site has its own Logo customization card in
Settings. It ships three project-appropriate presets — Transfer arrow, Queue
arrow, and Relay mark — and a local custom-image control. Selecting any preset
updates the top-bar mark and all three safe-area previews immediately.

The custom-image control accepts only PNG and JPEG. The browser verifies actual
bytes before it decodes anything, then performs a second dimension check in a
same-origin dedicated worker. It does not trust a file extension or the file's
declared MIME type. A valid custom mark renders at the exact display targets the
site uses: 24 px compact, 40 px navigation, and 64 px feature preview. The
browser does not upload the image, contact a converter, or emit a hidden
derived-file download.

Crop zoom and numeric focal X/Y controls are the keyboard-operable equivalent
of a crop handle. Users can choose contain, cover, or fill, select a transparent
or continuous picker color background, and preview the result inside marked
safe areas. Fill and crop zoom show a warning before their potentially lossy
rendering choice becomes active. The original local source remains unchanged.

The card also has a local time schedule. It can temporarily show one shipped
preset between a local start and end time while preserving the user's normal
selection. Cross-midnight windows are supported; equal start and end values
mean all day. The browser re-evaluates the schedule every minute without a
network request.

## Configuration

Logo state lives inside the versioned browser settings record. It retains a
validated custom data URI only in this browser profile; no source path or
original filename is stored. Clearing the custom image restores the most
recent shipped preset. Reset restores the Transfer arrow and its default
transform, background, and disabled schedule.

The input limit is 1,572,864 bytes. A candidate is rejected before decode when
it is empty, too large, malformed, PNG-animated, not PNG/JPEG, wider or taller
than 4,096 pixels, or larger than 12,000,000 decoded pixels. The worker has a
three-second completion bound. If it cannot start or the browser decoder does
not confirm the validated dimensions, the prior valid logo remains active.

The Settings search indexes the preset, upload, crop, fit, focal-point,
background, schedule, safe-export, clear, and reset controls. Its adjacent
anchored regular-expression builder remains the same builder used by the rest
of Settings. The command palette teleports to the upload control and provides
safe export and reset actions. School mode keeps the logo controls usable but
forces their presentation to English; bilingual and funny-level presentation
returns when the mode is off.

## Failure modes

An invalid custom image is rejected without partial application. The card names
the failed boundary — for example, unsupported format, animation, byte limit,
dimension limit, malformed bytes, or unavailable isolated decoder — without
revealing the selected filename or its local path. Browser private mode or a
storage quota failure leaves the live preview usable but reports that the next
reload will retain the last successfully saved logo instead.

The safe export action emits configuration needed to recreate the visual
treatment, but deliberately omits image bytes, data URIs, source paths, and
original filenames. The site currently has no browser-side settings-history
export; when one is added it must use the same redaction boundary.

## Security and privacy

Image bytes are validated from bounded local memory and decoded only by the
site's bundled same-origin worker. The worker has no remote converter,
telemetry, analytics, or upload route. Both the worker and the main Settings
surface use only DOM text APIs for status copy. No selected image, filename,
source path, or image data URI is written to a notification, standard export,
documentation article, capture, log, or public record.

Custom marks change only browser presentation. They cannot alter the project
name, release identity, download URL, installer, update feed, or any other
stable product identity.

## Verification

Run from the repository root:

```powershell
npm --prefix site run check
npm --prefix site run build
```

The site check covers the hand-written Pages inventory, exact local-script
registration, presets, byte-signature and size limits, PNG-animation rejection,
JPEG and PNG bounds, data-URI type matching, safe-export redaction, local
schedule semantics, Settings/command-palette hooks, School-mode presentation,
and a negative fixture that removes the logo registration. The built-artifact
capture exercises the visible Settings card with a shipped preset only, so no
private custom image appears in the evidence.

## Capture evidence

The required built-artifact capture is recorded only after the final Settings
surface has been driven through the sanctioned hidden-desktop route. It will
show a shipped preset, never a custom image, and its record will name the exact
source commit, viewport, file size, and SHA-256. Until that record exists, the
feature inventory remains partial rather than claiming capture evidence.

## Suggested articles

- [Landing and documentation site](./landing-and-documentation-site.md)
- [Universal feature coverage](./universal-feature-coverage.md)
- [Language and appearance settings](../settings/language-and-appearance.md)
- [Regex builder](../search/regex-builder.md)
