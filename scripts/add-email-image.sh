#!/usr/bin/env bash
#
# Add one image to the marketing email library.
#
#   scripts/add-email-image.sh <source-image> <name>
#   scripts/add-email-image.sh ~/Downloads/nebraska.png ne-terrain-hero
#
# Produces BOTH sizes the email templates expect, in public/email/:
#   <name>.jpg      1122x748   the 2x file the <img> actually loads
#   <name>@1x.jpg    561x374   fallback for clients that ignore width
#
# WHY BOTH, AND WHY THIS EXACT SHAPE
# ----------------------------------
# email_templates.image() renders at width=561 with height:auto inside a
# 600px card. Serving the 2x file at that width is what keeps it sharp on a
# retina phone, which is where most of this mail is opened. Every existing
# hero is 1122x748 (a 3:2 crop); a file with different proportions will letter-
# box or crop oddly next to the others, so this script forces the ratio rather
# than trusting the source.
#
# WHY public/ AND NOT S3
# ----------------------
# These are small (~40-140 KB each) and change rarely. Living in the repo means
# they are version-controlled, they deploy with the site, they are served from
# the same CDN as the rest of groundgoat.com, and there is no second set of
# credentials or bucket policy to get wrong. Fifty states is about 7 MB.
#
# ⚠️ URLs are https://www.groundgoat.com/email/<name>.jpg — **www is REQUIRED,
# the apex domain 404s.** ASSETS in firm_outreach.py already points at www.
set -euo pipefail

SRC="${1:?usage: add-email-image.sh <source-image> <name>}"
NAME="${2:?usage: add-email-image.sh <source-image> <name>}"
[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }

DIR="$(cd "$(dirname "$0")/.." && pwd)/public/email"
mkdir -p "$DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# sips is preinstalled on macOS — no imagemagick dependency to keep in sync.
# -Z fits inside the box preserving aspect; the crop then forces 3:2 from the
# centre so every hero in the library lines up.
sips -s format jpeg -s formatOptions 82 "$SRC" --out "$TMP/base.jpg" >/dev/null
sips -Z 1400 "$TMP/base.jpg" >/dev/null
sips -c 748 1122 "$TMP/base.jpg" --out "$DIR/${NAME}.jpg" >/dev/null
sips -c 374  561 "$TMP/base.jpg" --out "$DIR/${NAME}@1x.jpg" >/dev/null

for f in "$DIR/${NAME}.jpg" "$DIR/${NAME}@1x.jpg"; do
  printf '%s  ' "$(basename "$f")"
  sips -g pixelWidth -g pixelHeight "$f" | tail -2 | tr -d '\n' | tr -s ' '
  printf '  %s KB\n' "$(( $(stat -f%z "$f") / 1024 ))"
done

cat <<MSG

Written to public/email/. To publish:
    git add public/email/${NAME}*.jpg && git commit -m "Email hero: ${NAME}" && git push
Then it is live at:
    https://www.groundgoat.com/email/${NAME}.jpg
MSG
